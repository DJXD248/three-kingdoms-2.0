/**
 * v2.8.22 响应链执法刀（#71）——「到点自动响」换成「停下来按规矩问」。
 *
 * 这里钉的是六件事，逐条对应 §H9 的裁决原文：
 *   ① 三类分流（第九轮 a/c）：非 forced 的受击／受伤两型搬出结算链、forced 与
 *      其余触发型一字不动（绝不既自动响又问）；
 *   ② 顺序（第十轮①工作例）：A→C→D→B 逐字；
 *   ③ 不插队（第九轮⑨）：应答新开的格只排队尾；
 *   ④ 收格与出口：问完的格被扫描收掉、跳过恒在（§12-61）、没候选不开格；
 *   ⑤ 决斗逐轮不唤监听（§H5-6＋第七轮）；
 *   ⑥ 冻结世界四方一致（校验器/合法动作/解析器/store 读同一个 `getReactionAsk`）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createInitialEngineState, cloneEngineState } from '../core/GameState';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { createAction } from '../action/ActionTypes';
import { applyReactionAnsweredEvent } from '../core/eventProcessors/reactionEvents';
import type { General, Skill } from '../data/generals';
import { syncPlayerSkills } from './skillCompiler';
import {
  getReactionAsk,
  hasReactionListeners,
  listReactionCandidates,
  reactionAnsweredOf,
  reactionSubjectKey,
  isReactionSourceEvent,
  syncReactionQueue,
  reactionQueueFingerprint,
} from './reactionChain';
import { REACTION_EVENT_TYPES, REACTION_TRIGGERS, eventsHeardBy } from './reactionTriggers';
import { defersToReactionQueue } from './SkillTriggerBridge';

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id,
    name: '响应将' + id,
    faction: '魏',
    hp: 4,
    type: '武将',
    meleeAtk: 2,
    rangedAtk: 1,
    armor: 0,
    skills,
  } as unknown as General;
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
    ],
    discardPile: [],
    drawState: null,
  };
}

/** 「受到伤害后摸一张牌」——第八轮点名要接进问窗的那一型。 */
function hurtDraw(name: string, extra: Record<string, unknown> = {}): Skill {
  return {
    name,
    description: `${name}：受到伤害后可摸一张牌`,
    effects: [{
      id: 'e1',
      trigger: { type: 'onDamageTaken', damageSubType: 'allDamage', ...extra },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
  } as Skill;
}

/** 「成为目标时反伤 1」——受击那一型。 */
function counterSkill(name: string, extra: Record<string, unknown> = {}): Skill {
  return {
    name,
    description: `${name}：成为目标时对来源造成 1 点伤害`,
    effects: [{
      id: 'e1',
      trigger: { type: 'onBecomingTarget', ...extra },
      runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' },
    }],
  } as Skill;
}

const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' };

/** 一次真攻击：p1 的 g1 打 p2 的 g2。返回打完之后的引擎（含事件流）。 */
function attackOnce(victimSkills: Skill[]): GameEngine {
  const attackerGeneral = makeGeneral('g1', []);
  const victim = makeGeneral('g2', victimSkills);
  const state = makeState([
    makePlayer(1, { fieldGenerals: [makeFieldGeneral(attackerGeneral, 1)], hand: [ATTACK_COST] }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
  ]);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  engine.dispatch(createAction('ATTACK', 1, {
    attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
  }));
  return engine;
}

function typesOf(events: GameEvent[]): string[] {
  return events.map(event => event.type);
}

describe('响应链 · 三类分流（§H9 第九轮 a/c）', () => {
  it('非 forced 的「受到伤害后」不再自动响——事件流里没有它的效果，改成开格问人', () => {
    const engine = attackOnce([hurtDraw('奸雄')]);

    // 分流开关：这一型压根不进触发链。
    const deferred = defersToReactionQueue({
      id: 'x', name: '奸雄', trigger: 'onDamageTaken', description: '', effects: [],
    });
    expect(deferred).toBe(true);

    const events = engine.dispatch(createAction('END_TURN', 1));
    expect(events[0].type).toBe('ACTION_REJECTED');
    expect((events[0].data as { reason?: string }).reason).toBe('REACTION_PENDING');

    const ask = getReactionAsk(engine.state);
    expect(ask).not.toBeNull();
    expect(ask!.playerId).toBe(2);
    expect(ask!.generalId).toBe('g2');
    expect(ask!.options.map(o => o.skillId)).toEqual(['g2:奸雄:e1']);
    // 搬出结算链的代价如实记在账上：那一摸一张牌此刻**还没发生**。
    expect(engine.state.players.find(p => p.id === 2)!.hand).toHaveLength(0);
  });

  it('forced（强制发动）的同型监听照旧自动响，且绝不进问答队列', () => {
    const engine = attackOnce([{ ...hurtDraw('刚毅'), forced: true }]);

    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.pendingReaction ?? null).toBeNull();
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect((p2.hand ?? []).length).toBeGreaterThan(0);
  });

  it('「成为目标时」也进问答；既不受击也不受伤的那一型（造成伤害后）一字不动', () => {
    const withCounter = attackOnce([counterSkill('回刺')]);
    const ask = getReactionAsk(withCounter.state);
    expect(ask).not.toBeNull();
    expect(ask!.sourceEvent.type).toBe('BEFORE_DAMAGE');
    expect(ask!.options.map(o => o.skillId)).toEqual(['g2:回刺:e1']);

    // 攻击方的「造成伤害后」不在响应两型里 ⇒ 自动响、不开格。
    const dealt: Skill = {
      name: '烈攻',
      effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' } }],
    };
    const attackerGeneral = makeGeneral('g1', [dealt]);
    const victim = makeGeneral('g2', []);
    const state = makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attackerGeneral, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);
    const engine = new GameEngine(state);
    syncPlayerSkills(engine, state);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    expect(typesOf(events)).toContain('TRIGGERED');
    expect(getReactionAsk(engine.state)).toBeNull();
  });

  it('同一格内同一将领只问一次：两枚可响应被动＝三键一问（第九轮⑤）', () => {
    const twoSkills = [hurtDraw('奸雄'), { ...hurtDraw('奋威'), effects: [{
      id: 'e2',
      trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
      runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' },
    }] } as Skill];
    const engine = attackOnce(twoSkills);
    const ask = getReactionAsk(engine.state);
    expect(ask!.options).toHaveLength(2);
    expect(new Set(ask!.options.map(o => o.skillName))).toEqual(new Set(['奸雄', '奋威']));

    // 一次表态（选其一）就把这一格这一员记满 ⇒ 不会紧接着被问第二枚。
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', 2, {
      skillId: ask!.options[0].skillId, generalId: ask!.generalId,
    }));
    expect(typesOf(events)).toContain('REACTION_ANSWERED');
    expect(getReactionAsk(engine.state)).toBeNull();
  });
});

describe('响应链 · 顺序（§H9 第十轮①工作例逐字）', () => {
  /** 四席各一枚「听场上」的受伤监听；一声打中 p2 的 A 与 p3 的 C。 */
  function buildWorkExample(): EngineState {
    const state = createInitialEngineState();
    const seats: Array<[number, string, number]> = [
      [2, 'gA', 2], [2, 'gB', 2], [3, 'gC', 3], [4, 'gD', 4],
    ];
    const bySeat = new Map<number, ReturnType<typeof makeFieldGeneral>[]>();
    for (const [seat, id] of seats) {
      const general = makeGeneral(id, [hurtDraw('响' + id, { listenerScope: 'field' })]);
      bySeat.set(seat, [...(bySeat.get(seat) ?? []), makeFieldGeneral(general, seat)]);
    }
    state.players = [1, 2, 3, 4].map(id => makePlayer(id, {
      fieldGenerals: bySeat.get(id) ?? [],
    }) as EnginePlayer);
    state.currentPlayerId = 1;
    return state;
  }

  // 刀5 起「受到伤害后」只听 `INJURY` 这一声（＝每一刀落账后按真实掉血派生的那一声）。
  const twoVictimInjury = (): GameEvent => ({
    type: 'INJURY',
    data: {
      sourcePlayerId: 1, targetPlayerId: 2, targetIds: ['gA', 'gC'],
      damageType: 'attack', value: 1, hpLost: 1,
    },
  });

  it('A→C→D→B：受击组整组先、组内座次升序、非受击组从受击组末席的后一席绕圈', () => {
    let state = buildWorkExample();
    const { queue } = syncReactionQueue(state, [twoVictimInjury()]);
    expect(queue).not.toBeNull();
    state = { ...state, pendingReaction: queue };

    const seen: string[] = [];
    for (let guard = 0; guard < 8; guard += 1) {
      const ask = getReactionAsk(state);
      if (!ask) break;
      seen.push(`p${ask.playerId}:${ask.generalId}`);
      state = applyReactionAnsweredEvent(state, {
        type: 'REACTION_ANSWERED',
        data: reactionAnsweredOf(ask, ask.options[0]),
      });
    }
    expect(seen).toEqual(['p2:gA', 'p3:gC', 'p4:gD', 'p2:gB']);
  });

  it('点名不到场上任何一员（打本营）⇒ 退到席位那一层：整席先答', () => {
    let state = buildWorkExample();
    const event: GameEvent = {
      type: 'INJURY',
      data: { sourcePlayerId: 1, targetPlayerId: 2, targetId: 'base_2', damageType: 'attack', value: 1, hpLost: 1 },
    };
    // base_2 不是任何一员将领⇒ 身份层按席位分：整席 2 属受击组。四员都「听场上」
    // ⇒ 候选是全部四员，这里钉的是**先后**，不是有无。
    const { queue } = syncReactionQueue(state, [event]);
    expect(queue?.nodes).toHaveLength(1);
    state = { ...state, pendingReaction: queue };
    expect(listReactionCandidates(state, queue!.nodes[0]).map(c => c.generalId))
      .toEqual(['gA', 'gB', 'gC', 'gD']);
  });
});

describe('响应链 · 队列规则', () => {
  const injuryOf = (generalId: string, seat: number, duelRound?: number): GameEvent => ({
    type: 'INJURY',
    data: {
      sourcePlayerId: 1, targetPlayerId: seat, targetId: generalId, damageType: 'attack', value: 1, hpLost: 1,
      // 普攻／技能那两路压根没有这一维；只有决斗里带 `duelRound` 的那几声才是"要显式
      // 排除的那一类"⇒未定义时整键省略，绝不写成 `duelRound: undefined`。
      ...(duelRound === undefined ? {} : { duelRound }),
    },
  });

  function twoListeners(): EngineState {
    const state = createInitialEngineState();
    state.players = [
      makePlayer(1, { fieldGenerals: [] }) as EnginePlayer,
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('gX', [hurtDraw('奸雄')]), 2)] }) as EnginePlayer,
      makePlayer(3, { fieldGenerals: [makeFieldGeneral(makeGeneral('gY', [hurtDraw('奋威')]), 3)] }) as EnginePlayer,
    ];
    state.currentPlayerId = 1;
    return state;
  }

  it('第九轮⑨：应答后又让别的技能可响应⇒不插当前链，新格只排队尾', () => {
    const state = twoListeners();
    const first = syncReactionQueue(state, [injuryOf('gX', 2)]);
    const withFirst: EngineState = { ...state, pendingReaction: first.queue };
    const second = syncReactionQueue(withFirst, [injuryOf('gY', 3)]);
    const keys = second.queue!.nodes.map(node => node.key);
    expect(keys).toEqual(['rn:0:0', 'rn:0:1']);

    const ask = getReactionAsk(withFirst);
    expect(ask!.generalId).toBe('gX');
  });

  it('问完的格被扫描收掉；全部收完⇒槽清成 null（指纹归空）', () => {
    const state = twoListeners();
    const opened = syncReactionQueue(state, [injuryOf('gX', 2)]);
    let current: EngineState = { ...state, pendingReaction: opened.queue };
    expect(reactionQueueFingerprint(current.pendingReaction ?? null)).not.toBe('');

    const ask = getReactionAsk(current)!;
    current = applyReactionAnsweredEvent(current, {
      type: 'REACTION_ANSWERED', data: reactionAnsweredOf(ask, null),
    });
    const after = syncReactionQueue(current, []);
    expect(after.queue).toBeNull();
    expect(reactionQueueFingerprint(after.queue)).toBe('');
  });

  it('没有候选就不开格（门槛不过／场上没人听⇒世界不冻结）', () => {
    const state = twoListeners();
    // gZ 谁都不听：这一声场上没人有得响应。
    const empty = syncReactionQueue(state, [injuryOf('gZ', 2)]);
    expect(empty.queue).toBeNull();
    expect(empty.overflow).toBe(0);
  });

  it('决斗逐轮不唤监听：那几声压根不是 `INJURY`（逐轮不派生受伤声，§H5-6＋第七轮）', () => {
    // 刀5 起的结构性判据：「受到伤害后」只听 `INJURY`，而逐轮那些"打"是带
    // `duelRound` 的 `DAMAGE`——**压根不进**那张表，所以"逐轮静默"不再是扫描器里的
    // 一条特例，而是"这一声不存在"。带 `duelRound` 的显式排除仍留着，钉的是万一
    // 有人手工喂一块进来也别开格（§H9 第七轮点名的那道保险）。
    expect(isReactionSourceEvent(injuryOf('gX', 2))).toBe(true);
    expect(isReactionSourceEvent(injuryOf('gX', 2, 1))).toBe(false);
    expect(isReactionSourceEvent({
      type: 'DAMAGE',
      data: { targetPlayerId: 2, targetId: 'gX', damageType: 'attack', value: 1 },
    })).toBe(false);
    const state = twoListeners();
    const duelOnly = syncReactionQueue(state, [{
      type: 'DAMAGE',
      data: { targetPlayerId: 2, targetId: 'gX', duelRound: 2, damageType: 'skill', value: 1 },
    }]);
    expect(duelOnly.queue).toBeNull();
  });

  it('封顶如实记账：超限只丢真实该问的格，不开第二套账', () => {
    const state = twoListeners();
    const events = Array.from({ length: 40 }, () => injuryOf('gX', 2));
    const { queue, overflow } = syncReactionQueue(state, events);
    expect(queue!.nodes).toHaveLength(32);
    expect(overflow).toBe(8);
  });
});

describe('响应链 · 表态落账（唯一状态突变入口＝EventProcessor）', () => {
  function seededQueue(): EngineState {
    const state = createInitialEngineState();
    state.turn = 5;
    state.players = [
      makePlayer(1, { fieldGenerals: [] }) as EnginePlayer,
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('gX', [hurtDraw('奸雄')]), 2)] }) as EnginePlayer,
    ];
    const { queue } = syncReactionQueue(state, [{
      type: 'INJURY', data: { targetPlayerId: 2, targetId: 'gX', damageType: 'attack', value: 1, hpLost: 1 },
    }]);
    return { ...state, pendingReaction: queue };
  }

  it('REACTION_ANSWERED 只给对得上号的那一格、那一位记一笔，重复表态不重复记账', () => {
    const state = seededQueue();
    const ask = getReactionAsk(state)!;
    const data = reactionAnsweredOf(ask, ask.options[0]);
    expect(data).toMatchObject({
      nodeKey: ask.nodeKey, playerId: 2, generalId: 'gX',
      subjectKey: reactionSubjectKey(2, 'gX'), skillId: 'gX:奸雄:e1', skillName: '奸雄',
    });
    const once = applyReactionAnsweredEvent(state, { type: 'REACTION_ANSWERED', data });
    const twice = applyReactionAnsweredEvent(once, { type: 'REACTION_ANSWERED', data });
    expect(twice.pendingReaction!.nodes[0].answered).toEqual([reactionSubjectKey(2, 'gX')]);
  });

  it('跳过＝skillId/skillName 记 null（正身：一个也不做，§12-75①）', () => {
    const ask = {
      nodeKey: 'rn:5:0',
      sourceEvent: { type: 'INJURY', data: {} } as GameEvent,
      playerId: 2, generalId: 'gX', generalName: '响应将gX', options: [],
    };
    const data = reactionAnsweredOf(ask, null);
    expect(data.skillId).toBeNull();
    expect(data.skillName).toBeNull();
  });

  it('队列重建（常驻⇒重建）逐字保形：pendingReaction 是 A 类槽，掉了就等于欠债清零', () => {
    const state = seededQueue();
    const roundTrip = cloneEngineState(state) as EngineState;
    expect(roundTrip.pendingReaction).toEqual(state.pendingReaction);
    expect(getReactionAsk(roundTrip)!.generalId).toBe('gX');
  });
});

describe('响应链 · 冻结世界四方一致（校验器／合法动作／解析器／问句同一派生点）', () => {
  function askedEngine(): GameEngine {
    return attackOnce([hurtDraw('奸雄')]);
  }

  it('欠答席的合法动作＝该将全部可响应技能＋跳过；其余席位零动作，且列出的每一条真能落地', () => {
    const engine = askedEngine();
    const debtor = engine.legalActions(2);
    expect(debtor.map(a => `${a.type}:${JSON.stringify(a.payload)}`)).toEqual([
      'ACTIVATE_SKILL:{"skillId":"g2:奸雄:e1","generalId":"g2"}',
      `SKIP_REACTION:{"nodeKey":"${getReactionAsk(engine.state)!.nodeKey}"}`,
    ]);
    expect(engine.legalActions(1)).toEqual([]);

    // 枚举与执法读同一条规则：列出来的动作逐一 dispatch 都不被拒。
    const events = engine.dispatch(debtor[0]);
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
  });

  it('问句活着时，别人的常规动作与欠答席自己的其余动作一律 REACTION_PENDING', () => {
    const engine = askedEngine();
    for (const action of [
      createAction('END_TURN', 1),
      createAction('END_TURN', 2),
      createAction('SURRENDER', 2),
    ]) {
      const events = engine.dispatch(action);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as { reason?: string }).reason).toBe('REACTION_PENDING');
    }
    // 问句没被回答⇒它还在（拒绝不消耗欠债）。
    expect(getReactionAsk(engine.state)).not.toBeNull();
  });

  it('解析器逐条点名：错席位／错将领／错技能／错格号／缺载荷各归各位', () => {
    const nodeKey = getReactionAsk(askedEngine().state)!.nodeKey;
    const cases: Array<[ReturnType<typeof createAction>, string]> = [
      [createAction('ACTIVATE_SKILL', 1, { skillId: 'g2:奸雄:e1', generalId: 'g2' }), 'NOT_REACTION_PLAYER'],
      [createAction('ACTIVATE_SKILL', 2, { skillId: 'g2:奸雄:e1', generalId: 'gX' }), 'GENERAL_NOT_CONTROLLED'],
      [createAction('ACTIVATE_SKILL', 2, { skillId: 'g2:不存在:e1', generalId: 'g2' }), 'REACTION_SKILL_NOT_FOUND'],
      [createAction('SKIP_REACTION', 2, { nodeKey: 'rn:99:9' }), 'REACTION_NODE_MISMATCH'],
      [createAction('SKIP_REACTION', 1, { nodeKey }), 'NOT_REACTION_PLAYER'],
    ];
    for (const [action, reason] of cases) {
      const engine = askedEngine();
      const events = engine.dispatch(action);
      // 解析器层的拒绝走"承认收到、如实入账一条拒绝"（校验器层才是单事件路），
      // 所以这里按事件类型找，不按下标。
      const rejectedEvent = events.find(e => e.type === 'ACTION_REJECTED');
      expect(rejectedEvent, `${action.type}/${JSON.stringify(action.payload)}`).toBeDefined();
      expect((rejectedEvent!.data as { reason?: string }).reason).toBe(reason);
      // 拒答不销欠债：问句还原样挂着。
      expect(events.some(e => e.type === 'REACTION_ANSWERED')).toBe(false);
      expect(getReactionAsk(engine.state)).not.toBeNull();
    }
    // 载荷形状门（校验器层，不等解析器）：缺 nodeKey。
    const engine = askedEngine();
    const events = engine.dispatch(createAction('SKIP_REACTION', 2, {}));
    expect(events[0].type).toBe('ACTION_REJECTED');
    expect((events[0].data as { reason?: string }).reason).toBe('INVALID_SKIP_REACTION_PAYLOAD');
  });

  it('发动＝REACTION_ANSWERED＋效果事件（自带 skillId/skillName），且绝不写 SKILL_ACTIVATED——与自动路逐字同一套账', () => {
    const engine = askedEngine();
    const ask = getReactionAsk(engine.state)!;
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', 2, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(events.some(e => e.type === 'REACTION_ANSWERED')).toBe(true);
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
    const carried = events.find(e => (e.data as { skillId?: string } | undefined)?.skillId === 'g2:奸雄:e1');
    expect(carried).toBeDefined();
    expect((carried!.data as { skillName?: string }).skillName).toBe('奸雄');
    // 搬出来的那一摸一张牌，在玩家点头之后照常落地。
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect((p2.hand ?? []).length).toBeGreaterThan(0);
    // 该格问完⇒扫描收格⇒世界解冻。
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.pendingReaction ?? null).toBeNull();
  });

  it('跳过＝恒常出口（§12-61）：一个也不发动也能把这一格答完，回合照旧能结束', () => {
    const engine = askedEngine();
    const ask = getReactionAsk(engine.state)!;
    const events = engine.dispatch(createAction('SKIP_REACTION', 2, { nodeKey: ask.nodeKey }));
    const answered = events.find(e => e.type === 'REACTION_ANSWERED');
    expect(answered).toBeDefined();
    expect((answered!.data as { skillId?: string | null }).skillId).toBeNull();
    expect(engine.state.players.find(p => p.id === 2)!.hand).toHaveLength(0);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.dispatch(createAction('END_TURN', 1))[0].type).not.toBe('ACTION_REJECTED');
  });
});

/**
 * v2.8.25 强制发动执法刀（#72）——`forced` 从此是全链路**唯一**的"自动响还是停下来问"
 * 开关，而"这一型听哪几一声"全库只有一份表（`skills/reactionTriggers.ts`）。
 * 这里钉的是这张表在两条路上的一致面；决斗那一层的结算证据在
 * `core/transitionEquivalence.test.ts` 的刀 25 专测里（四路对账）。
 */
describe('强制发动执法刀 · 两条路同读一份事件表', () => {
  function listenerState(skill: Skill): EngineState {
    const state = createInitialEngineState();
    state.players = [
      makePlayer(1, { fieldGenerals: [] }) as EnginePlayer,
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('gX', [skill]), 2)] }) as EnginePlayer,
    ];
    state.currentPlayerId = 1;
    return state;
  }

  /** 决斗收官那一声＝受伤型（累计值、零状态位移；刀5 起与普攻派生的那一声同名）。 */
  const duelInjury = (): GameEvent => ({
    type: 'INJURY',
    data: {
      sourcePlayerId: 1, sourceGeneralId: 'gDuel', targetPlayerId: 2, targetId: 'gX',
      damageType: 'skill', value: 2, duelStage: 'injury', duelKey: 'k|gDuel>gX',
    },
  });

  it('一张表：一型几声就注册几枚监听（刀5 起「受到伤害后」只剩 `INJURY` 一声，第一枚 id 逐字不变）', () => {
    const engine = attackOnce([{ ...hurtDraw('刚毅'), forced: true }]);
    const triggers = engine.triggers.getByOwner(2);
    expect(triggers.map(t => t.eventType)).toEqual(['INJURY']);
    expect(triggers.map(t => t.id)).toEqual(['skill:2:g2:刚毅:e1']);
  });

  it('问答路的两型事件维由那张表派生，不存在第二份写法', () => {
    expect(eventsHeardBy('onDamageTaken')).toEqual(['INJURY']);
    expect(eventsHeardBy('onBecomingTarget')).toEqual(['BEFORE_DAMAGE']);
    // 2.3.1 单发动路：回合结束技能压根不在触发面上。
    expect(eventsHeardBy('onTurnEnd')).toEqual([]);
    for (const trigger of REACTION_TRIGGERS) {
      expect(REACTION_EVENT_TYPES[trigger]).toEqual(eventsHeardBy(trigger));
    }
  });

  it('探针与候选枚举同判据：问答路能开格的那一声，探针必说有听众', () => {
    const asked = listenerState(hurtDraw('奸雄'));
    const injury = duelInjury();
    expect(hasReactionListeners(asked, injury)).toBe(true);
    expect(syncReactionQueue(asked, [injury]).queue?.nodes).toHaveLength(1);
  });

  it('只有 forced 听众的那一声：探针说有听众（决斗因此等这一层走完），问答路却零候选（绝不开第二发动路）', () => {
    const forcedOnly = listenerState({ ...hurtDraw('刚毅'), forced: true });
    const injury = duelInjury();
    expect(hasReactionListeners(forcedOnly, injury)).toBe(true);
    expect(listReactionCandidates(forcedOnly, {
      key: 'probe', sourceEvent: { type: injury.type, data: injury.data }, answered: [],
    })).toHaveLength(0);
    // 零候选⇒零格：世界不冻结，也没有第二次表态机会。
    expect(syncReactionQueue(forcedOnly, [injury]).queue).toBeNull();
  });

  it('同一格里两条路各走各的：forced 那枚当场落账，问窗只列非 forced 那枚', () => {
    const engine = attackOnce([{ ...hurtDraw('刚毅'), forced: true }, hurtDraw('奸雄')]);
    const p2 = engine.state.players.find(p => p.id === 2)!;
    // 自动路：刚毅那一摸在派发当场就落了账，不用任何人点头。
    expect(p2.hand ?? []).toHaveLength(1);
    const ask = getReactionAsk(engine.state);
    expect(ask?.options.map(o => o.skillId)).toEqual(['g2:奸雄:e1']);
  });
});
