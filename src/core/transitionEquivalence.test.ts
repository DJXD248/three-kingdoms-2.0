/**
 * TransitionCore reconciliation (decision D-1, v2.2.20 → v2.2.21):
 * the direct resident engine, the store's resident-container bridge, the
 * demoted rebuild path and the ReplayPlayer playback must all produce
 * IDENTICAL event streams and final state for the same scripted match —
 * including a skill kill that exercises the bounded DEATH-reentry chain.
 * v2.2.21 adds the container guards: one long-lived GameEngine instance
 * across dispatches, and a skill registry that is re-synced every step so
 * dead generals cannot keep triggering.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './GameEngine';
import { cloneEngineState } from './GameState';
import type { EngineState, EnginePlayer } from './GameState';
import type { GameEvent } from './Event';
import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';
import { allGenerals, type General, type Skill } from '../data/generals';
import { syncPlayerSkills } from '../skills/skillCompiler';
import {
  dispatchStoreAction,
  dispatchStoreActionReconcile,
  __resetResidentEngineContainer,
  __residentEngineProbe,
} from '../store/engineExecutionBridge';
import { ReplayPlayer } from '../replay/ReplayPlayer';
import { resetLiveReplay } from '../replay/liveReplayRecorder';

function makeGeneral(id: string, hp: number, skills: Skill[]): General {
  return {
    id,
    name: '对账将' + id,
    faction: '魏',
    hp,
    type: '武将',
    meleeAtk: 2,
    rangedAtk: 1,
    armor: 0,
    skills,
  };
}

function makeFieldGeneral(general: General, ownerId: number, slot = 0) {
  return {
    general,
    currentHp: general.hp,
    maxHp: general.hp,
    meleeAtk: general.meleeAtk,
    rangedAtk: general.rangedAtk,
    armor: 0,
    currentArmor: 0,
    armorCards: [],
    isArming: false,
    hasMoved: false,
    hasAttacked: false,
    hasSupplied: false,
    justDeployed: false,
    ownerId,
    position: { zone: 'front' as const, slot, areaOwnerId: 1 },
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id,
    name: 'Player ' + id,
    hp: 4,
    hand: [],
    generalPool: [],
    fieldGenerals: [],
    graveyard: [],
    baseHp: 10,
    baseMaxHp: 10,
    isAlive: true,
    statuses: [],
    ...overrides,
  };
}

function makeState(players: EnginePlayer[]): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0]?.id ?? null,
    turn: 1,
    round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
      { id: 'deck_4', name: '粮草', type: '粮草' },
    ],
    discardPile: [],
    drawState: null,
  };
}

const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' };

/** EventBus.emit stamps id/timestamp in place — including events embedded
 * in TRIGGERED.data.sourceEvent and the time-derived rootEventId strings
 * built during expansion. The reconciliation compares the transition's
 * logical output, so all stamp-layer noise is normalized away (card/action
 * ids are untouched: they sit on objects without the event {type,data} shape). */
function isEventLike(value: Record<string, unknown>): boolean {
  return typeof value.type === 'string' && 'data' in value;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const eventLike = isEventLike(source);
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(source)) {
      if (key === 'rootEventId') continue;
      if (eventLike && (key === 'id' || key === 'timestamp')) continue;
      out[key] = normalize(nested);
    }
    return out;
  }
  return value;
}

function rawEvents(events: GameEvent[]): string[] {
  return events.map(event => JSON.stringify(normalize({ type: event.type, data: event.data })));
}

function buildInitial(): EngineState {
  // g1: 烈攻 kills g2 via the skill-damage follow-up → derived DEATH settles
  // inside process() and only fires 枭斩/遗志 through the bounded reentry loop.
  const killer = makeGeneral('g1', 4, [
    {
      name: '烈攻',
      effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' } }],
    },
    {
      name: '枭斩',
      effects: [{ id: 'e2', trigger: { type: 'onKill' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    },
  ]);
  const victim = makeGeneral('g2', 3, [
    {
      name: '遗志',
      effects: [{ id: 'e1', trigger: { type: 'onDeath' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    },
  ]);
  const survivor = makeGeneral('g3', 4, [
    {
      name: '奸雄',
      effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    },
  ]);
  return makeState([
    makePlayer(1, {
      fieldGenerals: [makeFieldGeneral(killer, 1)],
      hand: [ATTACK_COST],
    }),
    makePlayer(2, {
      fieldGenerals: [makeFieldGeneral(victim, 2), makeFieldGeneral(survivor, 2, 1)],
    }),
  ]);
}

const SCRIPT: GameAction[] = [
  createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
  createAction('END_TURN', 1), // blocked by the compensation draw window → rejected
  createAction('END_TURN', 1), // still blocked → rejected again
  createAction('END_TURN', 2),
];

function playResident(initial: EngineState): { steps: string[][]; final: EngineState; engine: GameEngine } {
  const engine = new GameEngine(cloneEngineState(initial));
  const steps: string[][] = [];
  for (const action of SCRIPT) {
    syncPlayerSkills(engine, engine.state);
    steps.push(rawEvents(engine.dispatch(action)));
  }
  return { steps, final: engine.state, engine };
}

function playReconcile(initial: EngineState): { steps: string[][]; final: EngineState } {
  let state = cloneEngineState(initial);
  const steps: string[][] = [];
  for (const action of SCRIPT) {
    const result = dispatchStoreActionReconcile({ engineState: state }, action);
    state = result.engineState;
    steps.push(rawEvents(result.events));
  }
  return { steps, final: state };
}

function playBridgeResident(initial: EngineState): { steps: string[][]; final: EngineState } {
  __resetResidentEngineContainer();
  resetLiveReplay();
  let state = cloneEngineState(initial);
  const steps: string[][] = [];
  for (const action of SCRIPT) {
    const result = dispatchStoreAction({ engineState: state }, action);
    state = result.engineState;
    steps.push(rawEvents(result.events));
  }
  return { steps, final: state };
}

describe('TransitionCore · 常驻 === 重建 (decision D-1)', () => {
  it('script guards: the match really contains a skill-kill reentry and a rejected action', () => {
    const { steps } = playResident(buildInitial());

    const killChain = steps[0].map(raw => JSON.parse(raw) as { type: string });
    expect(killChain.some(e => e.type === 'DEATH')).toBe(true);
    expect(killChain.some(e => e.type === 'TRIGGERED')).toBe(true);
    expect(steps[2]).toHaveLength(1);
    expect(JSON.parse(steps[2][0]).type).toBe('ACTION_REJECTED');
  });

  it('direct engine, resident store bridge and rebuild reconciliation emit identical events and end in identical state', () => {
    const initial = buildInitial();
    const resident = playResident(initial);
    const reconciled = playReconcile(initial);
    const bridged = playBridgeResident(initial);

    expect(reconciled.steps).toEqual(resident.steps);
    expect(JSON.stringify(reconciled.final)).toBe(JSON.stringify(resident.final));
    expect(bridged.steps).toEqual(resident.steps);
    expect(JSON.stringify(bridged.final)).toBe(JSON.stringify(resident.final));
  });

  it('recorded replay plays back step-for-step identical to live (2.2.20 ReplayPlayer skill-registration fix)', () => {
    const initial = buildInitial();
    const resident = playResident(initial);

    const document = resident.engine.replay.getDocument();
    expect(document).not.toBeNull();

    const playback = new ReplayPlayer().play(document!);
    expect(playback.processed).toBe(SCRIPT.length);
    const playedSteps = playback.events.map(entry => rawEvents(entry.events));
    expect(playedSteps).toEqual(resident.steps);
    expect(JSON.stringify(playback.state)).toBe(JSON.stringify(resident.final));
  });
});

describe('onBecomingTarget counter chain plays identically across all paths (2.3.0)', () => {
  function buildCounterInitial(): EngineState {
    const counter = makeGeneral('g2', 4, [
      {
        name: '回刺',
        effects: [{ id: 'e1', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } }],
      },
    ]);
    return makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', 4, []), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(counter, 2)] }),
    ]);
  }

  const ATTACK_G1_G2 = createAction('ATTACK', 1, {
    attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
  });

  it('resident, rebuild-reconcile and recorded replay stream the counter chain identically', () => {
    const initial = buildCounterInitial();

    const engine = new GameEngine(cloneEngineState(initial));
    syncPlayerSkills(engine, engine.state);
    const live = rawEvents(engine.dispatch(ATTACK_G1_G2));
    expect(live.some(raw => JSON.parse(raw).type === 'BEFORE_DAMAGE')).toBe(true);
    expect(live.filter(raw => JSON.parse(raw).type === 'DAMAGE')).toHaveLength(2);

    __resetResidentEngineContainer();
    resetLiveReplay();
    const bridged = dispatchStoreAction({ engineState: cloneEngineState(initial) }, ATTACK_G1_G2);
    expect(rawEvents(bridged.events)).toEqual(live);

    const reconciled = dispatchStoreActionReconcile({ engineState: cloneEngineState(initial) }, ATTACK_G1_G2);
    expect(rawEvents(reconciled.events)).toEqual(live);

    const document = engine.replay.getDocument();
    expect(document).not.toBeNull();
    const playback = new ReplayPlayer().play(document!);
    expect(playback.events.map(entry => rawEvents(entry.events))).toEqual([live]);
    expect(JSON.stringify(playback.state)).toBe(JSON.stringify(engine.state));
  });
});

describe('store resident container (decision D-1, v2.2.21 second cut)', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  it('consecutive dispatches reuse ONE GameEngine instance and count through the container', () => {
    const initial = buildInitial();
    let state = cloneEngineState(initial);
    const first = dispatchStoreAction({ engineState: state }, SCRIPT[0]);
    const { engine: engineAfterFirst, dispatches: dispatchesAfterFirst } = __residentEngineProbe();
    expect(engineAfterFirst).not.toBeNull();
    expect(dispatchesAfterFirst).toBe(1);

    state = first.engineState;
    const second = dispatchStoreAction({ engineState: state }, SCRIPT[1]);
    const probe = __residentEngineProbe();
    expect(probe.engine).toBe(engineAfterFirst); // same instance, not rebuilt
    expect(probe.dispatches).toBe(2);
    expect(second.events.length).toBeGreaterThan(0);
  });

  it('skill registry is re-synced every step: a general killed last step leaves the resident registry', () => {
    const initial = buildInitial();
    // Step 1 kills g2 (烈攻 chain). The registry was synced from the PRE-dispatch
    // state, so g2's 遗志 binding exists until the next resync.
    const first = dispatchStoreAction({ engineState: initial }, SCRIPT[0]);
    const afterKill = __residentEngineProbe().engine!;
    expect(afterKill.triggers.getAll().some(t => t.id.includes(':g2:'))).toBe(true);

    // Step 2 (a rejected END_TURN still resyncs first): g2 is off-field in the
    // adopted state, so its bindings must be gone — identical to a fresh rebuild.
    dispatchStoreAction({ engineState: first.engineState }, SCRIPT[1]);
    const residentIds = afterKill.triggers.getAll().map(t => t.id);

    const fresh = new GameEngine(cloneEngineState(first.engineState));
    syncPlayerSkills(fresh, fresh.state);
    expect(residentIds).toEqual(fresh.triggers.getAll().map(t => t.id));
    expect(residentIds.some(id => id.includes(':g2:'))).toBe(false);
  });

  it('store-side aliasing mutation of the provided engineState is honored (adopt-clone semantics)', () => {
    const initial = buildInitial();
    const mutated = cloneEngineState(initial);
    (mutated.players[0].hand as unknown[]).push({ id: 'stolen_1', name: '粮草', type: '粮草' });
    const viaBridge = dispatchStoreAction({ engineState: mutated }, SCRIPT[3]);
    const viaReconcile = dispatchStoreActionReconcile({ engineState: mutated }, SCRIPT[3]);
    expect(JSON.stringify(viaBridge.engineState)).toBe(JSON.stringify(viaReconcile.engineState));
    expect(rawEvents(viaBridge.events)).toEqual(rawEvents(viaReconcile.events));
  });
});

/**
 * 2.4.1 batch one: REAL built-in general templates (魏蜀群 tier-1 runtime
 * payloads) play through every transition path with byte-identical event
 * streams and final state — the first content-era extension of the
 * D-1 equivalence harness to ship data, not synthetic skills.
 */
describe('内置批量一 · 真实模板全路径对账 (v2.4.1)', () => {
  function builtinAs(newId: string, srcId: string): General {
    const source = allGenerals.find(g => g.id === srcId);
    if (!source) throw new Error(`missing built-in template ${srcId}`);
    const copy = JSON.parse(JSON.stringify(source)) as General;
    copy.id = newId;
    return copy;
  }

  const COSTS = [1, 2, 3, 4, 5].map(i => ({ id: `cost_${i}`, name: '粮草', type: '粮草' }));

  function buildBatchInitial(): EngineState {
    // p1 attackers: 魏延(狂骨,半血) / 祝融(烈刃) / 董卓(肉林,半血) / 无技能将×2
    // p2 defenders: 夏侯惇(刚烈) / 曹操(奸雄) / 关平(龙吟) / 庞德(猛进)
    const yan = makeFieldGeneral(builtinAs('g1', 'shu_009'), 1, 0);
    yan.currentHp = 2;
    const rong = makeFieldGeneral(builtinAs('g2', 'shu_021'), 1, 1);
    const zhuo = makeFieldGeneral(builtinAs('g3', 'qun_004'), 1, 2);
    zhuo.currentHp = 2;
    return makeState([
      makePlayer(1, {
        fieldGenerals: [
          yan, rong, zhuo,
          makeFieldGeneral(makeGeneral('g4', 4, []), 1, 3),
          makeFieldGeneral(makeGeneral('g5', 4, []), 1, 4),
        ],
        hand: COSTS.map(c => ({ ...c })),
      }),
      makePlayer(2, {
        fieldGenerals: [
          makeFieldGeneral(builtinAs('g7', 'wei_003'), 2, 0),
          makeFieldGeneral(builtinAs('g8', 'wei_001'), 2, 1),
          makeFieldGeneral(builtinAs('g9', 'shu_018'), 2, 2),
          makeFieldGeneral(builtinAs('g10', 'qun_010'), 2, 3),
        ],
      }),
    ]);
  }

  function attack(attackerId: string, targetId: string, costIndex: number): GameAction {
    return createAction('ATTACK', 1, {
      attackerId, targetId, ranged: false, consumeCard: COSTS[costIndex],
    });
  }

  const BATCH_SCRIPT: GameAction[] = [
    attack('g1', 'g7', 0), // 狂骨 vs 刚烈反伤：魏延 2-1+1 封顶回 2
    attack('g2', 'g10', 1), // 猛进迎击祝融 -1，烈刃命中摸 1
    attack('g4', 'g8', 2), // 奸雄：曹操受击摸 1
    attack('g5', 'g9', 3), // 龙吟：护甲派生效果队尾晚于本击，掉 2 血但 +1 甲留在身上
    attack('g3', 'g7', 4), // 刚烈再反伤董卓，肉林受技能伤回 1（2-1+1），夏侯惇阵亡
  ];

  it('五条攻击链在常驻/桥接/重建/录像回放四条路径逐事件一致，肉林/狂骨/奸雄/烈刃/龙吟/猛进/刚烈全部真实触发', () => {
    const initial = buildBatchInitial();

    const engine = new GameEngine(cloneEngineState(initial));
    const residentSteps: string[][] = [];
    for (const action of BATCH_SCRIPT) {
      syncPlayerSkills(engine, engine.state);
      residentSteps.push(rawEvents(engine.dispatch(action)));
    }
    const residentFinal = JSON.stringify(normalize(engine.state as unknown as Record<string, unknown>));

    __resetResidentEngineContainer();
    resetLiveReplay();
    let bridgeState = cloneEngineState(initial);
    const bridgeSteps: string[][] = [];
    for (const action of BATCH_SCRIPT) {
      const result = dispatchStoreAction({ engineState: bridgeState }, action);
      bridgeState = result.engineState;
      bridgeSteps.push(rawEvents(result.events));
    }
    expect(bridgeSteps).toEqual(residentSteps);
    expect(JSON.stringify(normalize(bridgeState as unknown as Record<string, unknown>))).toBe(residentFinal);

    let reconcileState = cloneEngineState(initial);
    const reconcileSteps: string[][] = [];
    for (const action of BATCH_SCRIPT) {
      const result = dispatchStoreActionReconcile({ engineState: reconcileState }, action);
      reconcileState = result.engineState;
      reconcileSteps.push(rawEvents(result.events));
    }
    expect(reconcileSteps).toEqual(residentSteps);
    expect(JSON.stringify(normalize(reconcileState as unknown as Record<string, unknown>))).toBe(residentFinal);

    const document = engine.replay.getDocument();
    expect(document).not.toBeNull();
    const playback = new ReplayPlayer().play(document!);
    expect(playback.processed).toBe(BATCH_SCRIPT.length);
    expect(playback.events.map(entry => rawEvents(entry.events))).toEqual(residentSteps);
    expect(JSON.stringify(normalize(playback.state as unknown as Record<string, unknown>))).toBe(residentFinal);
  });

  it('技能确实改变了局面：逐项锚定七条 batch-1 技能的可观察后果', () => {
    const engine = new GameEngine(cloneEngineState(buildBatchInitial()));
    let damageCount = 0;
    for (const action of BATCH_SCRIPT) {
      syncPlayerSkills(engine, engine.state);
      damageCount += engine.dispatch(action).filter(event => event.type === 'DAMAGE').length;
    }
    const [p1, p2] = engine.state.players;
    type FieldView = { general: General; currentHp: number; currentArmor: number };
    const field = (player: (typeof engine.state.players)[number], id: string) =>
      (player.fieldGenerals as unknown as FieldView[]).find(f => f.general.id === id);

    expect(field(p1, 'g1')?.currentHp).toBe(2); // 狂骨把刚烈的反伤血回了回来
    expect(field(p1, 'g2')?.currentHp).toBe(3); // 猛进迎击：祝融被反 1
    expect(field(p1, 'g3')?.currentHp).toBe(2); // 肉林把刚烈反伤血回了回来
    expect(field(p2, 'g9')?.currentHp).toBe(2); // 龙吟护甲按 2.3.0 队尾语义晚于本击到达：不挡首发，留给后续
    expect(field(p2, 'g9')?.currentArmor).toBe(1);
    expect(field(p2, 'g10')?.currentHp).toBe(2);
    expect(field(p2, 'g7')).toBeUndefined(); // 第二次攻击击杀夏侯惇
    expect(field(p2, 'g8')?.currentHp).toBe(2);
    // 摸牌链：祝融烈刃 +1（归 p1）、曹操奸雄 +1（归 p2），p1 五张攻击成本全部消耗
    expect(p1.hand).toHaveLength(1);
    expect(engine.state.deck).toHaveLength(2);
    expect(p2.hand).toHaveLength(1); // 曹操奸雄摸的牌归曹操玩家
    // 攻击伤害 5 + 刚烈反伤 2 + 猛进迎击 1 = 全链共 8 个 DAMAGE
    expect(damageCount).toBe(8);
  });
});
