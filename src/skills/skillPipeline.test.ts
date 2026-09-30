/**
 * End-to-end skill pipeline tests (Phase 5 uniqueness convergence).
 *
 * These cover the full canonical chain that previously had ZERO coverage:
 *   register (syncPlayerSkills) → event → condition → TriggerEngine expansion
 *   → effect events → EventProcessor state mutation
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { dispatchStoreAction } from '../store/engineExecutionBridge';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type { General, Skill } from '../data/generals';
import { syncPlayerSkills } from './skillCompiler';
import { getReactionAsk } from './reactionChain';
import { parseGateText } from './skillGateText';

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id,
    name: '测试将' + id,
    faction: '魏',
    hp: 4,
    type: '武将',
    meleeAtk: 2,
    rangedAtk: 1,
    armor: 0,
    skills,
  };
}

function makeFieldGeneral(general: General, ownerId: number, slot = 0, zone: 'camp' | 'front' | 'battle' = 'front') {
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
    // Same contested area so a melee attack is in range (matches the
    // AttackResolver test fixtures: areaOwnerId 1 is the shared battle area).
    position: { zone, slot, areaOwnerId: 1 },
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
    ],
    discardPile: [],
    drawState: null,
  };
}

function jianxiong(): Skill {
  return {
    name: '奸雄',
    description: '受到伤害后摸一张牌',
    effects: [
      {
        id: 'e1',
        trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      },
    ],
  };
}

function buildEngine(players: EnginePlayer[]): GameEngine {
  const state = makeState(players);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  return engine;
}

/**
 * v2.8.22 响应链执法刀（#71）：受击／受伤两型已搬出自动结算链，效果落在"答完那句"
 * 的那一次 dispatch 里。本文件这批端到端测钉的正是"技能的效果照旧落地"，所以每次
 * 触发后把当前问句按顺序答完（每格选第一枚），把这些 dispatch 的事件流回给用例。
 * 问答本身的形状（谁先答、跳过、冻结世界）由 skills/reactionChain.test.ts 钉。
 */
function answerReactions(engine: GameEngine, pick: 'first' | 'skip' = 'first'): GameEvent[] {
  const out: GameEvent[] = [];
  for (let guard = 0; guard < 16; guard += 1) {
    const ask = getReactionAsk(engine.state);
    if (!ask) break;
    const action = pick === 'skip'
      ? createAction('SKIP_REACTION', ask.playerId, { nodeKey: ask.nodeKey })
      : createAction('ACTIVATE_SKILL', ask.playerId, {
        skillId: ask.options[0].skillId, generalId: ask.generalId,
      });
    out.push(...engine.dispatch(action));
  }
  return out;
}

// The rules layer requires every ATTACK to carry a consumed resource card.
const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' };
const ATTACK_COST_2 = { id: 'cost_2', name: '粮草', type: '粮草' };

describe('skill pipeline · end-to-end', () => {
  it('onTurnStart draw skill fires when the owner turn begins', () => {
    const p2General = makeGeneral('g2', [
      {
        name: '遗计',
        effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
      },
    ]);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(p2General, 2)] }),
    ]);

    const events = engine.dispatch(createAction('END_TURN', 1));

    expect(events.some(e => e.type === 'TRIGGERED')).toBe(true);
    const draws = events.filter(e => e.type === 'DRAW');
    expect(draws.length).toBeGreaterThanOrEqual(1);
    expect((draws[draws.length - 1].data as any).playerId).toBe(2);

    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect(p2.hand).toHaveLength(1);
    expect((p2.hand as any[])[0].id).toBe('deck_1');
    expect(engine.state.deck).toHaveLength(2);
  });

  it('奸雄 archetype: owner draws 1 card after their general takes attack damage', () => {
    const attacker = makeGeneral('g1', []);
    const victim = makeGeneral('g2', [jianxiong()]);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );
    // 搬出结算链：攻击那一趟只有问句、没有那一摸。
    expect(events.filter(e => e.type === 'DRAW' && (e.data as any).effectType === 'DRAW_CARD')).toHaveLength(0);
    expect(getReactionAsk(engine.state)!.generalId).toBe('g2');
    const answered = answerReactions(engine);

    const skillDraws = answered.filter(e => e.type === 'DRAW' && (e.data as any).effectType === 'DRAW_CARD');
    expect(skillDraws).toHaveLength(1);
    expect((skillDraws[0].data as any).playerId).toBe(2);

    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect(p2.hand).toHaveLength(1);
    // Attack dealt 2 damage to a 4 HP general, then the skill drew a card.
    const victimOnField = (p2.fieldGenerals as any[])[0];
    expect(victimOnField.currentHp).toBe(2);
  });

  it('conditions isolate owners: victim skills never fire for the attacker damage', () => {
    const attackerOwner = makeGeneral('g1', [jianxiong()]);
    const victim = makeGeneral('g2', []);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attackerOwner, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );

    const p1 = engine.state.players.find(p => p.id === 1)!;
    expect(p1.hand).toHaveLength(0);
    expect(events.filter(e => e.type === 'DRAW' && (e.data as any).effectType === 'DRAW_CARD')).toHaveLength(0);
    // v2.8.22：这一条在问答侧同样成立——身份不匹配的监听连问都不该被问。
    expect(getReactionAsk(engine.state)).toBeNull();
  });

  it('general scope holds: a damage-taken skill only reacts to ITS OWN general', () => {
    const skilled = makeGeneral('g2', [jianxiong()]);
    const unskilled = makeGeneral('g3', []);
    const attacker = makeGeneral('g1', []);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, {
        fieldGenerals: [
          makeFieldGeneral(skilled, 2, 0),
          makeFieldGeneral(unskilled, 2, 1),
        ],
      }),
    ]);

    // Attack g3 (no skill): g2's 奸雄 must NOT fire even though the same
    // player owns it.
    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g3', ranged: false, consumeCard: ATTACK_COST }),
    );

    expect(events.filter(e => e.type === 'DRAW' && (e.data as any).effectType === 'DRAW_CARD')).toHaveLength(0);
    // v2.8.22：同一条身份判定也管问答路——别人挨的打不会替 g2 开一句问。
    expect(getReactionAsk(engine.state)).toBeNull();
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect(p2.hand).toHaveLength(0);
  });

  it('onDamageDealt skill damage settles with the canonical armor rule', () => {
    const attacker = makeGeneral('g1', [
      {
        name: '烈攻',
        effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' } }],
      },
    ]);
    const victim = makeGeneral('g2', []);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );

    const skillDamage = events.filter(e => e.type === 'DAMAGE' && (e.data as any).damageType === 'skill');
    expect(skillDamage).toHaveLength(1);
    expect((skillDamage[0].data as any).targetId).toBe('g2');

    // 2 (attack) + 1 (skill) damage on a 4 HP general.
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect((p2.fieldGenerals as any[])[0].currentHp).toBe(1);
  });

  it('damage-type filter separates attack damage from skill damage triggers', () => {
    const attacker = makeGeneral('g1', [
      {
        name: '烈攻',
        effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' } }],
      },
    ]);
    const victim = makeGeneral('g2', [
      {
        name: '刚腹',
        effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
      },
      {
        name: '忍伤',
        effects: [{ id: 'e2', trigger: { type: 'onDamageTaken', damageSubType: 'skillDamage' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
      },
    ]);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );
    // 答之前：攻击趟里两张问句都已开格（两声伤害），一张牌都还没摸。
    expect(events.filter(e => e.type === 'DRAW' && (e.data as any).effectType === 'DRAW_CARD')).toHaveLength(0);
    expect(engine.state.pendingReaction!.nodes).toHaveLength(2);

    const draws = answerReactions(engine).filter(e => e.type === 'DRAW' && (e.data as any).effectType === 'DRAW_CARD');
    // 两声伤害＝两格问答（先开的先问），答之前一张都摸不到。
    expect(engine.state.pendingReaction).toBeNull();
    // 刚腹 (attackDamage filter) reacts to the attack hit; 忍伤 (skillDamage
    // filter) reacts only to the follow-up skill damage from 烈攻 — and each
    // filter must reject the other damage category.
    // v2.8.22：这两声现在是**两格**问答（先开的先问），所以答完的顺序＝伤害落地顺序。
    expect(draws).toHaveLength(2);
    expect((draws[0].data as any).skillId).toContain('刚腹');
    expect((draws[1].data as any).skillId).toContain('忍伤');
  });

  it('skill draws never duplicate card instances across chained draws', () => {
    const a = makeGeneral('g1', [jianxiong()]);
    const b = makeGeneral('g2', [jianxiong()]);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(a, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(b, 2)] }),
    ]);

    // g1 attacks g2 → g2's 奸雄 draws exactly one deck card, consumed once.
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    answerReactions(engine); // v2.8.22：那一摸现在要点头（答一句才落地）

    const drawnIds = [
      ...(engine.state.players[1].hand as any[]).map(c => c.id),
    ];
    expect(drawnIds).toEqual(['deck_1']);
    expect(engine.state.deck.map((c: any) => c.id)).toEqual(['deck_2', 'deck_3']);
    void a; void b;
  });

  it('store bridge re-registers skills on every dispatch (per-dispatch engine rebuilt)', () => {
    const attacker = makeGeneral('g1', []);
    const attacker2 = makeGeneral('g3', []);
    const victim = makeGeneral('g2', [jianxiong()]);
    const storeState = {
      engineState: makeState([
        makePlayer(1, {
          fieldGenerals: [makeFieldGeneral(attacker, 1), makeFieldGeneral(attacker2, 1, 1)],
          hand: [ATTACK_COST, ATTACK_COST_2],
        }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
      ]),
    };

    // v2.8.22：问答也走同一条桥——pendingReaction 是随状态一起搬的 A 类槽，
    // 每次 dispatch 都重建引擎，所以"答一句"必须能在重建后的状态上接着答。
    const answerThroughBridge = (state: EngineState): EngineState => {
      let current = state;
      for (let guard = 0; guard < 4; guard += 1) {
        const ask = getReactionAsk(current);
        if (!ask) break;
        current = dispatchStoreAction({ engineState: current }, createAction(
          'ACTIVATE_SKILL', ask.playerId, { skillId: ask.options[0].skillId, generalId: ask.generalId },
        )).engineState;
      }
      return current;
    };

    const opened = dispatchStoreAction(storeState,
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    // 攻击趟里没摸——问句挂着。
    expect((opened.engineState.players[1].hand as any[])).toHaveLength(0);
    const first = { engineState: answerThroughBridge(opened.engineState) };
    expect((first.engineState.players[1].hand as any[]).map((c: any) => c.id)).toEqual(['deck_1']);

    const openedSecond = dispatchStoreAction({ engineState: first.engineState },
      createAction('ATTACK', 1, { attackerId: 'g3', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST_2 }));
    const second = { engineState: answerThroughBridge(openedSecond.engineState) };
    // Lethal follow-up. v2.8.22 换的那笔账（如实登记）：扫描在整块结算**之后**开格，
    // 当场阵亡的将领已经离场⇒不再被问⇒旧口径"死了也照样摸一张"翻转成"死了就不问"。
    // 与 §H9 第七轮"阵亡者不结算受伤类"同一条纪律；受伤但未死的那一摸见上一段。
    expect((second.engineState.players[1].hand as any[]).map((c: any) => c.id)).toEqual(['deck_1']);
    expect(second.engineState.players[1].fieldGenerals).toHaveLength(0);
    expect((second.engineState.players[1].graveyard as any[]).map((c: any) => c.id)).toContain('g2');
  });
});

describe('skill pipeline · onBecomingTarget (2.3.0, BEFORE_DAMAGE-backed)', () => {
  function huici(): Skill {
    return {
      name: '回刺',
      effects: [
        { id: 'e1', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } },
      ],
    };
  }

  it('counter damage hits the attacker — 受击那一格现在先问一句，点头之后才落地', () => {
    const attacker = makeGeneral('g1', []);
    const victim = makeGeneral('g2', [huici()]);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );

    // 搬出结算链（v2.8.22 #71）：攻击那一趟不再有反伤，只留下一句"要不要响"。
    expect(events.filter(e => e.type === 'DAMAGE' && (e.data as any).damageType === 'skill')).toHaveLength(0);
    const ask = getReactionAsk(engine.state)!;
    expect(ask.sourceEvent.type).toBe('BEFORE_DAMAGE');
    expect(ask.playerId).toBe(2);
    expect((engine.state.players.find(p => p.id === 1)!.fieldGenerals as any[])[0].currentHp).toBe(4);

    const answered = answerReactions(engine);
    const counters = answered.filter(e => e.type === 'DAMAGE' && (e.data as any).damageType === 'skill');
    expect(counters).toHaveLength(1);
    expect((counters[0].data as any).targetId).toBe('g1');
    expect((counters[0].data as any).sourceGeneralId).toBe('g2');

    // 挨打的血照旧先落地：问的是"这一次受击要不要响"，不是把伤害本身推后。
    // 读引擎当前状态，不读答复前的旧引用（dispatch 会换掉整个 state）。
    const after = engine.state.players.find(p => p.id === 2)!;
    const afterAttacker = engine.state.players.find(p => p.id === 1)!;
    expect((after.fieldGenerals as any[])[0].currentHp).toBe(2); // 4 - 2 attack
    expect((afterAttacker.fieldGenerals as any[])[0].currentHp).toBe(3); // 4 - 1 counter
  });

  it('attacks on a base never trigger becoming-target skills', () => {
    const attacker = makeGeneral('g1', []);
    const victim = makeGeneral('g2', [huici()]);
    const attackerField = makeFieldGeneral(attacker, 1);
    // Melee base rule: stand in the target player's area and hit their base.
    attackerField.position = { zone: 'front', slot: 0, areaOwnerId: 2 };
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [attackerField], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }),
    );

    expect(events.some(e => e.type === 'BEFORE_DAMAGE')).toBe(true);
    expect(events.filter(e => e.type === 'DAMAGE' && (e.data as any).damageType === 'skill')).toHaveLength(0);
    // v2.8.22：打本营那一声没有"受击的将领"⇒问答侧同样不开格。
    expect(getReactionAsk(engine.state)).toBeNull();
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect(p2.baseHp).toBe(9);
    expect((engine.state.players.find(p => p.id === 1)!.fieldGenerals as any[])[0].currentHp).toBe(4);
  });

  it('isolation: attacking another general of the same owner does not trigger', () => {
    const attacker = makeGeneral('g1', []);
    const skilled = makeGeneral('g2', [huici()]);
    const unskilled = makeGeneral('g3', []);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, {
        fieldGenerals: [makeFieldGeneral(skilled, 2, 0), makeFieldGeneral(unskilled, 2, 1)],
      }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g3', ranged: false, consumeCard: ATTACK_COST }),
    );

    expect(events.filter(e => e.type === 'DAMAGE' && (e.data as any).damageType === 'skill')).toHaveLength(0);
    // v2.8.22：同一席位里没挨打的那一员也不被问（身份轴两条路共用一份实现）。
    expect(getReactionAsk(engine.state)).toBeNull();
    const p1 = engine.state.players.find(p => p.id === 1)!;
    expect((p1.fieldGenerals as any[])[0].currentHp).toBe(4);
  });

  it('当场被打死的将领不再被问——旧「死了也照样反伤」的冻结时序按第七轮口径翻转', () => {
    const attacker = makeGeneral('g1', []);
    const victim = { ...makeGeneral('g2', [huici()]), hp: 2 };
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );

    const deaths = events.filter(e => e.type === 'DEATH');
    expect(deaths).toHaveLength(1);
    // 扫描排在整块结算之后：这一格还没开口问，人已经离场⇒没有候选⇒不开格。
    // 于是旧事实"来源伤害把目标打死，反伤照样落地"翻转为"当场死就不问"。
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(answerReactions(engine)).toHaveLength(0);

    const p1 = engine.state.players.find(p => p.id === 1)!;
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect((p1.fieldGenerals as any[])[0].currentHp).toBe(4); // 无反伤
    expect(p2.fieldGenerals).toHaveLength(0);
    expect((p2.graveyard as any[]).map((c: any) => c.id)).toContain('g2');
  });
});

describe('skill pipeline · Stage C coverage (HEAL / GAIN_ARMOR / skill-kill DEATH)', () => {
  it('HEAL effect restores HP and caps at maxHp', () => {
    const healer = makeGeneral('g2', [
      {
        name: '疗愈',
        effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'HEAL', value: 5, target: 'SELF' } }],
      },
    ]);
    const wounded = makeFieldGeneral(healer, 2);
    wounded.currentHp = 1;
    const engine = buildEngine([
      makePlayer(1),
      makePlayer(2, { fieldGenerals: [wounded] }),
    ]);

    const events = engine.dispatch(createAction('END_TURN', 1));

    expect(events.some(e => e.type === 'HEAL')).toBe(true);
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect((p2.fieldGenerals as any[])[0].currentHp).toBe(4); // maxHp, not 6
  });

  it('GAIN_ARMOR effect grants armor points to the owner general', () => {
    const guarded = makeGeneral('g2', [
      {
        name: '固甲',
        effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'GAIN_ARMOR', value: 2, target: 'SELF' } }],
      },
    ]);
    const engine = buildEngine([
      makePlayer(1),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(guarded, 2)] }),
    ]);

    const events = engine.dispatch(createAction('END_TURN', 1));

    expect(events.some(e => e.type === 'GAIN_ARMOR')).toBe(true);
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect((p2.fieldGenerals as any[])[0].currentArmor).toBe(2);
  });

  it('skill-kill derives one DEATH event, fires onKill and onDeath skills, and grants the compensating draw', () => {
    // Victim at 3 HP: melee attack deals 2, the 烈攻 follow-up skill deals 1
    // — the kill itself happens inside DAMAGE settlement, with no
    // resolver-side DEATH.
    const victim = { ...makeGeneral('g2', [
      {
        name: '遗志',
        effects: [{ id: 'e1', trigger: { type: 'onDeath' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
      },
    ]), hp: 3 };
    const attacker = makeGeneral('g1', [
      {
        name: '烈攻',
        effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' } }],
      },
      {
        name: '枭斩',
        effects: [{ id: 'e2', trigger: { type: 'onKill' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
      },
    ]);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );

    const deaths = events.filter(e => e.type === 'DEATH');
    expect(deaths).toHaveLength(1);
    expect((deaths[0].data as any).skillKill).toBe(true);
    expect((deaths[0].data as any).attackerId).toBe('g1');

    // The bounded re-entry round expanded the derived DEATH through the
    // trigger engine: killer's 枭斩 and the victim's 遗志 each drew a card.
    // Trigger priority order: onDeath (100) settles before onKill (60).
    const p1 = engine.state.players.find(p => p.id === 1)!;
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect((p1.hand as any[]).map((c: any) => c.id)).toContain('deck_2');
    expect((p2.hand as any[]).map((c: any) => c.id)).toContain('deck_1');
    expect((p2.fieldGenerals as any[])).toHaveLength(0);
    expect((p2.graveyard as any[]).map((c: any) => c.id)).toContain('g2');
    // Compensating draw window opened for the victim's owner (DEATH →
    // DRAW_REQUIRED), same as an attack kill.
    expect(engine.state.drawState).toMatchObject({ reason: 'compensation', playerId: 2, totalCards: 1 });
  });

  it('attack kills keep exactly one DEATH event (no derived duplicate)', () => {
    const victim = { ...makeGeneral('g2', []), hp: 2 };
    const attacker = makeGeneral('g1', []);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );

    const deaths = events.filter(e => e.type === 'DEATH');
    expect(deaths).toHaveLength(1);
    expect((deaths[0].data as any).skillKill).toBeUndefined();
    expect(engine.state.drawState).toMatchObject({ reason: 'compensation', playerId: 2 });
  });

  // v2.8.3 刀 B：门槛从表格里那句大白话一路走到引擎，中间不掺任何 mock。
  // 这一条同时防两种空转：门槛被录入面吃掉（conditions 为空）、门槛被引擎忽略（照样发动）。
  it('gate text recorded on a skill really holds the skill back in the engine', () => {
    const gateText = '手牌≤1';
    const parsed = parseGateText(gateText);
    expect(parsed.unknown).toEqual([]);
    expect(parsed.conditions).toEqual([{ metric: 'HAND_COUNT', op: 'LTE', value: 1 }]);

    const gated = (): Skill => ({
      name: '奸雄·看手牌',
      description: '受到伤害后，若手牌不超过一张则摸一张牌',
      effects: [{
        id: 'e1',
        trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
        conditions: parsed.conditions,
      }],
    });

    const attackInto = (handCards: number) => {
      const victim = makeGeneral('g2', [gated()]);
      const engine = buildEngine([
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
        makePlayer(2, {
          fieldGenerals: [makeFieldGeneral(victim, 2)],
          hand: Array.from({ length: handCards }, (_, i) => ({ id: `hand_${i}`, name: '粮草', type: '粮草' })),
        }),
      ]);
      engine.dispatch(
        createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
      );
      // v2.8.22 #71：门槛活在同一张表上，只是位置从"结算链里静默筛"搬到"问句里
      // 摆不摆得出这一键"。门槛过 ⇒ 开格、有键可点；门槛不过 ⇒ 连格都不开。
      const ask = getReactionAsk(engine.state);
      const answered = answerReactions(engine);
      const p2 = engine.state.players.find(p => p.id === 2)!;
      return {
        askOptions: ask?.options.map(o => o.skillName) ?? [],
        skillDraws: answered.filter(e => e.type === 'DRAW' && (e.data as any).effectType === 'DRAW_CARD'),
        handSize: (p2.hand as unknown[]).length,
      };
    };

    const open = attackInto(0);
    expect(open.askOptions).toHaveLength(1);
    expect(open.skillDraws).toHaveLength(1);
    expect(open.handSize).toBe(1);

    const blocked = attackInto(2);
    expect(blocked.askOptions).toEqual([]);
    expect(blocked.skillDraws).toHaveLength(0);
    expect(blocked.handSize).toBe(2);
  });
});
