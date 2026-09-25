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

describe('内置批量二 · 真实模板全路径对账 (v2.4.2)', () => {
  function builtin2As(newId: string, srcId: string): General {
    const source = allGenerals.find(g => g.id === srcId);
    if (!source) throw new Error(`missing built-in template ${srcId}`);
    const copy = JSON.parse(JSON.stringify(source)) as General;
    copy.id = newId;
    return copy;
  }

  const COSTS = [1, 2, 3, 4, 5, 6].map(i => ({ id: `b2cost_${i}`, name: '粮草', type: '粮草' }));

  function attack(attackerId: string, targetId: string, costIndex: number, playerId = 1): GameAction {
    return createAction('ATTACK', playerId, {
      attackerId, targetId, ranged: false, consumeCard: COSTS[costIndex],
    });
  }

  function fieldHp(state: EngineState, playerId: number, generalId: string) {
    const player = state.players.find(p => p.id === playerId);
    const fg = (player?.fieldGenerals as unknown as Array<{ general: General; currentHp: number; currentArmor: number }> | undefined)
      ?.find(f => f.general.id === generalId);
    return fg ? { hp: fg.currentHp, armor: fg.currentArmor } : undefined;
  }

  // 哨兵①（苦肉 SELF 自伤）与哨兵②（奋威链式 TARGET）在本 describe 的
  // it('苦肉…') / it('批量二载荷…') 中以真实模板实证。
  function buildBatch2AttackInitial(): EngineState {
    // p1: 乐綝(奋威/临阵) 张春华(慧眼) 司马昭(司敌)
    // p2: 孙策(激昂) 吴国太(补益) 夏侯惇(刚烈·batch-1 交叉链)
    return makeState([
      makePlayer(1, {
        fieldGenerals: [
          makeFieldGeneral(builtin2As('g1', 'jin_011'), 1, 0),
          makeFieldGeneral(builtin2As('g2', 'jin_005'), 1, 1),
          makeFieldGeneral(builtin2As('g3', 'jin_003'), 1, 2),
        ],
        hand: COSTS.map(c => ({ ...c })),
      }),
      makePlayer(2, {
        fieldGenerals: [
          makeFieldGeneral(builtin2As('g6', 'wu_016'), 2, 0),
          makeFieldGeneral(builtin2As('g7', 'wu_021'), 2, 1),
          makeFieldGeneral(builtin2As('g8', 'wei_003'), 2, 2),
        ],
      }),
    ]);
  }

  const BATCH2_SCRIPT: GameAction[] = [
    attack('g1', 'g6', 0), // 激昂摸1 + 奋威链式追加1（哨兵②）
    attack('g2', 'g7', 1), // 慧眼摸1；补益受攻击伤回1
    attack('g3', 'g8', 2), // 刚烈反伤司马昭（技能伤）→ 司敌摸1
  ];

  it('三条攻击链在常驻/桥接/重建/录像回放四条路径逐事件一致（激昂/奋威/慧眼/补益/司敌真实触发）', () => {
    const initial = buildBatch2AttackInitial();

    const engine = new GameEngine(cloneEngineState(initial));
    const residentSteps: string[][] = [];
    for (const action of BATCH2_SCRIPT) {
      syncPlayerSkills(engine, engine.state);
      residentSteps.push(rawEvents(engine.dispatch(action)));
    }
    const residentFinal = JSON.stringify(normalize(engine.state as unknown as Record<string, unknown>));

    __resetResidentEngineContainer();
    resetLiveReplay();
    let bridgeState = cloneEngineState(initial);
    const bridgeSteps: string[][] = [];
    for (const action of BATCH2_SCRIPT) {
      const result = dispatchStoreAction({ engineState: bridgeState }, action);
      bridgeState = result.engineState;
      bridgeSteps.push(rawEvents(result.events));
    }
    expect(bridgeSteps).toEqual(residentSteps);
    expect(JSON.stringify(normalize(bridgeState as unknown as Record<string, unknown>))).toBe(residentFinal);

    let reconcileState = cloneEngineState(initial);
    const reconcileSteps: string[][] = [];
    for (const action of BATCH2_SCRIPT) {
      const result = dispatchStoreActionReconcile({ engineState: reconcileState }, action);
      reconcileState = result.engineState;
      reconcileSteps.push(rawEvents(result.events));
    }
    expect(reconcileSteps).toEqual(residentSteps);
    expect(JSON.stringify(normalize(reconcileState as unknown as Record<string, unknown>))).toBe(residentFinal);

    const document = engine.replay.getDocument();
    expect(document).not.toBeNull();
    const playback = new ReplayPlayer().play(document!);
    expect(playback.processed).toBe(BATCH2_SCRIPT.length);
    expect(playback.events.map(entry => rawEvents(entry.events))).toEqual(residentSteps);
    expect(JSON.stringify(normalize(playback.state as unknown as Record<string, unknown>))).toBe(residentFinal);
  });

  it('批量二载荷逐项锚定：奋威链伤/激昂蓄势/慧眼鉴微/补益自养/司敌识破/刚烈交叉链全部改变局面', () => {
    const engine = new GameEngine(cloneEngineState(buildBatch2AttackInitial()));
    const all: GameEvent[] = [];
    for (const action of BATCH2_SCRIPT) {
      syncPlayerSkills(engine, engine.state);
      all.push(...engine.dispatch(action));
    }
    const bySkill = (skillSuffix: string, type: string) =>
      all.filter(e => e.type === type && String((e.data as Record<string, unknown>)?.skillId ?? '').includes(skillSuffix));

    // 哨兵②实证：奋威在 AFTER_DAMAGE 之后把目标 g6 再削 1 点技能伤
    const fenwei = bySkill('奋威:e1', 'DAMAGE');
    expect(fenwei).toHaveLength(1);
    expect(fenwei[0].data as unknown as Record<string, unknown>).toMatchObject({
      targetPlayerId: 2, targetId: 'g6', damageType: 'skill', value: 1,
    });
    // 激昂：每次孙策被瞄准摸 1（本链只被打两次瞄准，另一次是致死击）
    expect(bySkill('激昂:e1', 'DRAW')).toHaveLength(1);
    expect(bySkill('慧眼:e1', 'DRAW')).toHaveLength(1);
    expect(bySkill('司敌:e1', 'DRAW')).toHaveLength(1);
    expect(bySkill('补益:e1', 'HEAL')).toHaveLength(1);
    // 交叉链：batch-1 刚烈的反伤（技能伤）喂给 batch-2 司敌
    expect(bySkill('刚烈:e1', 'DAMAGE')).toHaveLength(1);

    expect(fieldHp(engine.state, 2, 'g6')).toEqual({ hp: 1, armor: 0 }); // 4-2-1(奋威)
    expect(fieldHp(engine.state, 2, 'g7')).toEqual({ hp: 3, armor: 0 }); // 3-1+1(补益)
    expect(fieldHp(engine.state, 2, 'g8')).toEqual({ hp: 3, armor: 0 });
    expect(fieldHp(engine.state, 1, 'g3')).toEqual({ hp: 2, armor: 0 }); // 刚烈反伤
    const p1 = engine.state.players.find(p => p.id === 1)!;
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect(p1.hand).toHaveLength(5); // 6-3 成本 +慧眼 +司敌
    expect(p2.hand).toHaveLength(1); // 激昂摸的牌
    expect(engine.state.deck).toHaveLength(1); // 4 张牌堆被摸走 3 张
  });

  it('临阵实证：乐綝受攻击伤害后 +1 护甲（p2 侧攻击手反向瞄准）', () => {
    const state = buildBatch2AttackInitial();
    const dingfeng = makeFieldGeneral(builtin2As('g_df', 'wu_020'), 2, 3);
    (state.players[1].fieldGenerals as unknown as unknown[]).push(dingfeng);
    state.players[1].hand = COSTS.map(c => ({ ...c })); // 行动方手持消耗牌
    state.currentPlayerId = 2;
    const engine = new GameEngine(state);
    syncPlayerSkills(engine, engine.state);
    const events = engine.dispatch(attack('g_df', 'g1', 3, 2));
    const linzhen = events.filter(e => e.type === 'GAIN_ARMOR'
      && String((e.data as Record<string, unknown>)?.skillId ?? '').includes('临阵:e1'));
    expect(linzhen).toHaveLength(1);
    expect(fieldHp(engine.state, 1, 'g1')).toEqual({ hp: 2, armor: 1 }); // 4-2 攻伤，+1 甲
  });

  it('哨兵①实证：苦肉在 TURN_START 自动自伤 1 点并摸 2（合成 DAMAGE 的 SELF 受击路径被引擎接受）', () => {
    const state = makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g_plain', 4, []), 1)] }),
      makePlayer(2, {
        fieldGenerals: [
          makeFieldGeneral(builtin2As('g_hg', 'wu_004'), 2, 0),  // 苦肉
          makeFieldGeneral(builtin2As('g_df', 'wu_020'), 2, 1),  // 奋迅：回合开始+1甲
          makeFieldGeneral(builtin2As('g_jc', 'jin_004'), 2, 2), // 帷幄：回合开始+1甲
          makeFieldGeneral(builtin2As('g_yh', 'jin_010'), 2, 3), // 清德：回合开始回1
          makeFieldGeneral(builtin2As('g_sym', 'jin_014'), 2, 4), // 封赏：回合开始摸1
        ],
      }),
    ]);
    const yh = (state.players[1].fieldGenerals as unknown as Array<{ general: General; currentHp: number }>)
      .find(f => f.general.id === 'g_yh')!;
    yh.currentHp = 2; // 半血让清德的回血可观察
    const engine = new GameEngine(state);
    syncPlayerSkills(engine, engine.state);
    const events = engine.dispatch(createAction('END_TURN', 1));

    // 自伤：target 与 source 同为玩家 2 的拥有者本体
    const kurouDmg = events.filter(e => e.type === 'DAMAGE'
      && String((e.data as Record<string, unknown>)?.skillId ?? '').includes('苦肉:e1'));
    expect(kurouDmg).toHaveLength(1);
    expect(kurouDmg[0].data as unknown as Record<string, unknown>).toMatchObject({
      sourcePlayerId: 2, targetPlayerId: 2, targetId: 'g_hg', damageType: 'skill', value: 1,
    });
    // 两效果独立成义：苦肉 e2 摸 2 + 封赏摸 1
    const draws = events.filter(e => e.type === 'DRAW');
    expect(draws.find(e => String((e.data as Record<string, unknown>)?.skillId ?? '').includes('苦肉:e2'))).toBeTruthy();
    expect(draws.find(e => String((e.data as Record<string, unknown>)?.skillId ?? '').includes('封赏:e1'))).toBeTruthy();
    expect(fieldHp(engine.state, 2, 'g_hg')).toEqual({ hp: 3, armor: 0 });
    expect(fieldHp(engine.state, 2, 'g_df')).toEqual({ hp: 4, armor: 1 }); // 奋迅
    expect(fieldHp(engine.state, 2, 'g_jc')).toEqual({ hp: 3, armor: 1 }); // 帷幄
    expect(fieldHp(engine.state, 2, 'g_yh')).toEqual({ hp: 3, armor: 0 }); // 清德 2→3
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect(p2.hand).toHaveLength(3); // 苦肉2 + 封赏1（TURN_START 补给窗口不逐内入手持）
  });

  it('同命族实证：单骑/追忆/死节+并吞/戮杀在真实击杀链上触发（含技能击杀→DEATH 回灌）', () => {
    // 单骑：文鸯被普通击杀 → 反伤凶手 1
    const s1 = makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('a1', 4, []), 1)],
        hand: COSTS.map(c => ({ ...c })),
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(builtin2As('wy', 'jin_012'), 2)] }),
    ]);
    const wy = (s1.players[1].fieldGenerals as unknown as Array<{ currentHp: number }>)[0];
    wy.currentHp = 2;
    const e1 = new GameEngine(s1);
    syncPlayerSkills(e1, e1.state);
    const ev1 = e1.dispatch(attack('a1', 'wy', 0));
    expect(ev1.some(e => e.type === 'DEATH' && (e.data as any)?.targetId === 'wy')).toBe(true);
    const danqi = ev1.find(e => e.type === 'DAMAGE' && String((e.data as any)?.skillId ?? '').includes('单骑:e1'));
    expect(danqi).toBeTruthy();
    expect(fieldHp(e1.state, 1, 'a1')?.hp).toBe(3);

    // 追忆：步练师被普通击杀 → 拥有者摸 1
    const s2 = makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('a2', 4, []), 1)],
        hand: COSTS.map(c => ({ ...c })),
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(builtin2As('bls', 'wu_018'), 2)] }),
    ]);
    (s2.players[1].fieldGenerals as unknown as Array<{ currentHp: number }>)[0].currentHp = 2;
    const e2 = new GameEngine(s2);
    syncPlayerSkills(e2, e2.state);
    const ev2 = e2.dispatch(attack('a2', 'bls', 0));
    const zhuiyi = ev2.find(e => e.type === 'DRAW' && String((e.data as any)?.skillId ?? '').includes('追忆:e1'));
    expect(zhuiyi).toBeTruthy();
    expect((zhuiyi!.data as any).playerId).toBe(2);
    expect((zhuiyi!.data as any).count).toBe(1);

    // 死节+并吞：司马炎击杀诸葛诞 → +2甲（并吞）与被反伤 2（死节），顺序无关终态
    const s3 = makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(builtin2As('sym3', 'jin_014'), 1)],
        hand: COSTS.map(c => ({ ...c })),
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(builtin2As('zgd', 'jin_015'), 2)] }),
    ]);
    (s3.players[1].fieldGenerals as unknown as Array<{ currentHp: number }>)[0].currentHp = 1;
    const e3 = new GameEngine(s3);
    syncPlayerSkills(e3, e3.state);
    const ev3 = e3.dispatch(attack('sym3', 'zgd', 0));
    expect(ev3.some(e => e.type === 'GAIN_ARMOR' && String((e.data as any)?.skillId ?? '').includes('并吞:e1'))).toBe(true);
    expect(ev3.some(e => e.type === 'DAMAGE' && String((e.data as any)?.skillId ?? '').includes('死节:e1'))).toBe(true);
    expect(fieldHp(e3.state, 1, 'sym3')).toEqual({ hp: 1, armor: 2 });

    // 戮杀：贾南风击杀 → 满血也发 HEAL 事件（封顶在结算层）
    const s4 = makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(builtin2As('jnf', 'jin_013'), 1)],
        hand: COSTS.map(c => ({ ...c })),
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(builtin2As('bls4', 'wu_018'), 2)] }),
    ]);
    (s4.players[1].fieldGenerals as unknown as Array<{ currentHp: number }>)[0].currentHp = 1;
    const e4 = new GameEngine(s4);
    syncPlayerSkills(e4, e4.state);
    const ev4 = e4.dispatch(attack('jnf', 'bls4', 0));
    expect(ev4.some(e => e.type === 'HEAL' && String((e.data as any)?.skillId ?? '').includes('戮杀:e1'))).toBe(true);
    expect(fieldHp(e4.state, 1, 'jnf')?.hp).toBe(3); // 满血封顶
  });

  it('奋威击杀实证：链式技能伤完成击杀 → skillKill DEATH 回灌并喂给追忆（onDeath 于技能击杀路径）', () => {
    const s = makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(builtin2As('lc5', 'jin_011'), 1)],
        hand: COSTS.map(c => ({ ...c })),
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(builtin2As('bls5', 'wu_018'), 2)] }),
    ]);
    (s.players[1].fieldGenerals as unknown as Array<{ currentHp: number }>)[0].currentHp = 3;
    const engine = new GameEngine(s);
    syncPlayerSkills(engine, engine.state);
    const events = engine.dispatch(attack('lc5', 'bls5', 0)); // 2+1 奋威 → 0
    const death = events.find(e => e.type === 'DEATH' && (e.data as any)?.targetId === 'bls5');
    expect(death).toBeTruthy();
    expect((death!.data as any).skillKill).toBe(true);
    expect((death!.data as any).attackerPlayerId).toBe(1);
    const zhuiyi = events.find(e => e.type === 'DRAW' && String((e.data as any)?.skillId ?? '').includes('追忆:e1'));
    expect(zhuiyi).toBeTruthy();
    expect((zhuiyi!.data as any).playerId).toBe(2);
  });

  it('onDeploy 活性探针（英慧）：部署成功但监听器尚未注册 → 永不触发，实证 §12-26 降级依据', () => {
    const wyj = builtin2As('wyj', 'jin_008');
    const s = makeState([
      makePlayer(1, { fieldGenerals: [], hand: [wyj, { ...COSTS[0] }, { ...COSTS[1] }] }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    const engine = new GameEngine(s);
    syncPlayerSkills(engine, engine.state); // 场上无人 → 注册表里也没有英慧
    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, {
      general: wyj, slot: 0, consumeCards: [{ ...COSTS[0] }],
    }));
    const deployed = events.some(e => e.type === 'GENERAL_DEPLOYED');
    const yinghui = events.some(e => e.type === 'DRAW'
      && String((e.data as Record<string, unknown>)?.skillId ?? '').includes('英慧:e1'));
    // 注册时序缺口固化：若未来为 onDeploy 接通激活路径（2.5 候选），
    // 本断言会失败并强制同步更新 §G/§12-26 与三条降级技能的去向。
    expect({ deployed, yinghui }).toEqual({ deployed: true, yinghui: false });
  });
});

