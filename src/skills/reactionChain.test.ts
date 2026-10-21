/**
 * v2.8.22 响应链执法刀（#71）——「到点自动响」换成「停下来按规矩问」。
 * v2.9.16 询问制刀把这一句的覆盖面从"受击／受伤两型"扩到**除「在场即生效」与
 * 「强制发动」以外的每一型**（用户 2026-10-20 裁）。
 *
 * 这里钉的是六件事，逐条对应 §H9 的裁决原文：
 *   ① 分流（第九轮 a/c ＋ v2.9.16）：没打强制发动的定义搬出结算链、forced 与
 *      passive 一字不动（绝不既自动响又问）；
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
import type { GameEvent, GameEventType } from '../core/Event';
import { createAction } from '../action/ActionTypes';
import { applyReactionAnsweredEvent } from '../core/eventProcessors/reactionEvents';
import type { General, Skill, SkillTriggerType } from '../data/generals';
import { triggerTypeLabels } from '../data/generals';
import { syncPlayerSkills } from './skillCompiler';
import {
  getReactionAsk,
  hasReactionListeners,
  listReactionCandidates,
  reactionAnsweredOf,
  reactionSubjectKey,
  mayOpenReactionCell,
  syncReactionQueue,
  reactionQueueFingerprint,
} from './reactionChain';
import { ANY_TRIGGER_EVENT_TYPES, TRIGGER_EVENTS, eventsHeardBy } from './reactionTriggers';
import type { DataSkillTrigger } from './dataTypes';
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

/** 一次真攻击，攻击方带 `attackerSkill`（p1 的 g1 打 p2 的 g2，目标不带技能）。 */
function attackWith(attackerSkill: Skill): { engine: GameEngine; events: GameEvent[] } {
  const attackerGeneral = makeGeneral('g1', [attackerSkill]);
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
  return { engine, events };
}

function typesOf(events: GameEvent[]): string[] {
  return events.map(event => event.type);
}

describe('响应链 · 分流（§H9 第九轮 a/c ＋ v2.9.16 询问制）', () => {
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

  it('「造成伤害后」也进问答（v2.9.16 询问制：问不问不由时机定）；同一枚摘掉强制发动才回到自动路', () => {
    const withCounter = attackOnce([counterSkill('回刺')]);
    const ask = getReactionAsk(withCounter.state);
    expect(ask).not.toBeNull();
    expect(ask!.sourceEvent.type).toBe('BEFORE_DAMAGE');
    expect(ask!.options.map(o => o.skillId)).toEqual(['g2:回刺:e1']);
    // 措辞念头里这一格自己的时机，不再由组件猜（v2.9.16 新字段）。
    expect(ask!.trigger).toBe('onBecomingTarget');

    // 攻击方的「造成伤害后」以前自动响，今天同样停下来问一句。
    const dealt: Skill = {
      name: '烈攻',
      effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' } }],
    };
    const asked = attackWith(dealt);
    expect(getReactionAsk(asked.engine.state)).not.toBeNull();
    const ask2 = getReactionAsk(asked.engine.state)!;
    expect(ask2.playerId).toBe(1);
    expect(ask2.generalId).toBe('g1');
    expect(ask2.trigger).toBe('onDamageDealt');
    // 自动路结构性保证：这枚压根没注册进触发链⇒攻击那一趟里没有 TRIGGERED。
    expect(typesOf(asked.events)).not.toContain('TRIGGERED');
    expect(defersToReactionQueue({
      id: 'x', name: '烈攻', trigger: 'onDamageDealt', description: '', effects: [],
    })).toBe(true);

    // 判据的另一半＝只有「强制发动」能把它放回自动路（单独改坏 `forced` 那一行必红）。
    const forced = attackWith({ ...dealt, forced: true });
    expect(getReactionAsk(forced.engine.state)).toBeNull();
    expect(typesOf(forced.events)).toContain('TRIGGERED');
  });

  it('「在场即生效」永远不问、永远不响（它不是一次发动，账由修正器单点落笔）', () => {
    expect(defersToReactionQueue({
      id: 'x', name: '奋威', trigger: 'passive', description: '', effects: [], passive: true,
    })).toBe(false);
    expect(eventsHeardBy('passive')).toEqual([]);
    expect(mayOpenReactionCell({ id: 'e', type: 'STAT_MODIFY', data: {} } as unknown as GameEvent)).toBe(false);
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

  it('点名不到场上任何一员（打营地）⇒ 退到席位那一层：整席先答', () => {
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

  it('真实形状的那一刀（每员将各一声、各点自己的名）＝开两格、每格按自己那一格的受击者排、格与格不插队', () => {
    // 上面那两例喂的是 §H9 工作例的合成形状（一声带 `targetIds`）；引擎里从来没有那种
    // 事件——`victimRefOf` 认 `targetIds`，但 `src/` 里没有任何一处生产它（如实登记见
    // HANDOFF §12-96）。真实派生是一员将一声、只带 `targetId`，所以这里补的是**实况形状**。
    const injuryFor = (seat: number, generalId: string): GameEvent => ({
      type: 'INJURY',
      data: {
        sourcePlayerId: 1, targetPlayerId: seat, targetId: generalId,
        damageType: 'attack', value: 1, hpLost: 1,
      },
    });

    const state = buildWorkExample();
    const { queue } = syncReactionQueue(state, [injuryFor(2, 'gA'), injuryFor(3, 'gC')]);
    expect(queue?.nodes.map(node => node.key)).toEqual(['rn:0:0', 'rn:0:1']);
    // 同一件"挨了两刀"的事在队列里是**两格**，每一格的分组轴只认自己那一声点名的受击者。
    expect(listReactionCandidates(state, queue!.nodes[0]).map(c => c.generalId))
      .toEqual(['gA', 'gC', 'gD', 'gB']);
    expect(listReactionCandidates(state, queue!.nodes[1]).map(c => c.generalId))
      .toEqual(['gC', 'gD', 'gA', 'gB']);

    let current: EngineState = { ...state, pendingReaction: queue };
    const seen: string[] = [];
    for (let guard = 0; guard < 16; guard += 1) {
      const ask = getReactionAsk(current);
      if (!ask) break;
      seen.push(`p${ask.playerId}:${ask.generalId}`);
      current = applyReactionAnsweredEvent(current, {
        type: 'REACTION_ANSWERED',
        data: reactionAnsweredOf(ask, ask.options[0]),
      });
    }
    // 第一格问完才进第二格（第九轮⑨不插队）；同一员将在两格里各被问一次＝台账按格记，不跨格抵。
    expect(seen).toEqual(['p2:gA', 'p3:gC', 'p4:gD', 'p2:gB', 'p3:gC', 'p4:gD', 'p2:gA', 'p2:gB']);
    // 槽不是"答完"清掉的，是结算后那一趟扫描收走的（第④件事）：两格台账都满⇒扫描收干净。
    expect(syncReactionQueue(current, []).queue).toBeNull();
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
    // v2.9.16：这一句的门从"两型专属的开格判据"换成了那张表派生的总集⇒证人跟着换名，
    // 判据本身一字未动。
    expect(mayOpenReactionCell(injuryOf('gX', 2))).toBe(true);
    expect(mayOpenReactionCell(injuryOf('gX', 2, 1))).toBe(false);
    expect(mayOpenReactionCell({
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
      playerId: 2, generalId: 'gX', generalName: '响应将gX',
      trigger: 'onDamageTaken' as DataSkillTrigger, options: [],
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

  it('发动＝纯通知的 SKILL_ACTIVATED＋REACTION_ANSWERED＋效果事件（自带 skillId/skillName），台账一字不记', () => {
    const engine = askedEngine();
    const ask = getReactionAsk(engine.state)!;
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', 2, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(events.some(e => e.type === 'REACTION_ANSWERED')).toBe(true);
    // v2.9.15 乙档刀改的就是这一句。旧口径"问答路绝不写 SKILL_ACTIVATED"随
    // 「其他将领技能发动时」接电而作废——它听的就是这一声。写的是**不带 stableId
    // 的纯通知**，所以状态转移仍然一字未动，下面两行就是这一句的证人。
    const activation = events.find(e => e.type === 'SKILL_ACTIVATED');
    expect(activation?.data).toMatchObject({ skillId: 'g2:奸雄:e1', skillName: '奸雄', playerId: 2 });
    expect('stableId' in ((activation?.data ?? {}) as object)).toBe(false);
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);
    const carried = events.find(e => e.type !== 'SKILL_ACTIVATED'
      && (e.data as { skillId?: string } | undefined)?.skillId === 'g2:奸雄:e1');
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

  it('一张表派生到底：开格总集＝表里所有声的并集，而"问不问"只剩 forced／passive 两个判据', () => {
    expect(eventsHeardBy('onDamageTaken')).toEqual(['INJURY']);
    expect(eventsHeardBy('onBecomingTarget')).toEqual(['BEFORE_DAMAGE']);
    // 2.3.1 单发动路：回合结束技能压根不在触发面上（它有自己的窗，永远问）。
    expect(eventsHeardBy('onTurnEnd')).toEqual([]);
    const fromTable = [...new Set((Object.values(TRIGGER_EVENTS) as (readonly GameEventType[])[]).flat())].sort();
    expect([...ANY_TRIGGER_EVENT_TYPES].sort()).toEqual(fromTable);
    // v2.9.16 询问制的正身：**表里每一型**（＝听得懂至少一声）都问，摘掉强制发动才自动。
    const heard = Object.keys(TRIGGER_EVENTS) as DataSkillTrigger[];
    expect(heard.length).toBeGreaterThan(0);
    heard.forEach(trigger => {
      expect(defersToReactionQueue({ id: 'x', name: 'n', trigger, description: '', effects: [] })).toBe(true);
      expect(defersToReactionQueue({ id: 'x', name: 'n', trigger, description: '', effects: [], forced: true })).toBe(false);
    });
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

// ── v2.9.16 询问制刀 · 一技能一按钮 ──
// `compileGeneralSkills` 按**效果**编定义（一枚技能的每个可结算效果＝一条），而问答路的
// 表态单位是"某一席的某一员将"（§H9 第九轮⑤：点一个键吃掉整格）。两条规则直接相乘＝
// 按钮按效果开、点下去吃掉整格：黄盖「苦肉」（自伤 1 点＋摸两张）在问窗里排成两个
// 「发动苦肉」，玩家点第一个只拿到自伤，**摸两张那一半永远没机会响**——既不会再问一次
// （台账已记这一格），也不会自动补。下面这三条把修法钉住：一次表态结这一枚技能这一刻的
// **全部**效果；而"一次表态吃掉整格"那条一字未改（不同技能仍是两键、仍是择一）。
describe('响应链 · 一技能一按钮（v2.9.16 询问制刀，苦肉形状）', () => {
  /** 苦肉的形状：同一条时机上两个各自独立触发的效果（自伤 1 点＋摸两张）。 */
  function twoEffectSelf(name: string): Skill {
    return {
      name,
      description: `${name}：成为目标时自伤 1 点，然后摸两张牌`,
      effects: [
        { id: 'e1', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1, target: 'SELF' } },
        { id: 'e2', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' } },
      ],
    } as Skill;
  }

  it('一枚两效果的技能＝问窗里一个按钮，按钮带的是这一刻的全部定义', () => {
    const engine = attackOnce([twoEffectSelf('苦形')]);
    const ask = getReactionAsk(engine.state)!;
    expect(ask.options).toHaveLength(1);
    expect(ask.options[0].skillName).toBe('苦形');
    // 寻址键＝头一枚定义（点这一下结的是整枚技能，不需要玩家再点第二次）
    expect(ask.options[0].skillId).toBe('g2:苦形:e1');
    expect(ask.options[0].definitions.map(d => d.id)).toEqual(['g2:苦形:e1', 'g2:苦形:e2']);
    // 派生点自证：每条定义都还认这一声（否则并进来的那半在翻译时会被丢掉）
    expect(ask.options[0].definitions.every(d => d.trigger === 'onBecomingTarget')).toBe(true);
  });

  it('点这一下：自伤那一刀与摸两张那一张**同时**落账——少了后半就是这条证人红的', () => {
    const engine = attackOnce([twoEffectSelf('苦形')]);
    const before = (engine.state.players.find(p => p.id === 2)!.fieldGenerals as Array<{ currentHp: number }>)[0].currentHp;
    const ask = getReactionAsk(engine.state)!;
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    // 前半：自伤那一刀（点名到 `苦形:e1` 这条定义，不是"随便有一声伤害"）
    const selfHurt = events.filter(e => e.type === 'DAMAGE'
      && String((e.data as { skillId?: unknown }).skillId ?? '').includes('苦形:e1'));
    expect(selfHurt).toHaveLength(1);
    expect(selfHurt[0].data).toMatchObject({ sourceGeneralId: 'g2', targetId: 'g2', value: 1 });
    // 后半：摸两张那一张——缺了它，整条证人就是当年那个真缺陷
    const drawn = events.filter(e => e.type === 'DRAW'
      && String((e.data as { skillId?: unknown }).skillId ?? '').includes('苦形:e2'));
    expect(drawn).toHaveLength(1);
    expect(drawn[0].data).toMatchObject({ playerId: 2, count: 2 });

    const p2 = engine.state.players.find(p => p.id === 2)!;
    // 实测：「成为目标时」那一格开在**伤害落地之前**（冻结世界），所以答完这一句之后
    // 普攻那 2 点才补落——体力 4→1＝自伤 1 ＋普攻 2。少了自伤会停在 2、少了摸两张手牌
    // 会是 0：两个数一起把住，才证的是"一次表态结这一枚技能的全部效果"。
    expect((p2.fieldGenerals as Array<{ currentHp: number }>)[0].currentHp).toBe(before - 1 - 2);
    expect(p2.hand ?? []).toHaveLength(2);
    // 一次表态吃掉整格：答完不再有第二格等这一员将点第二次（后半**只能**靠这一次结掉）
    expect(getReactionAsk(engine.state)).toBeNull();
  });

  it('不同技能仍是两个按钮、仍是一次表态择一（§H9 第九轮⑤ 一字未改）', () => {
    // 两枚技能挂在**同一声**上（成为目标时）⇒同一格里两个按钮；奸雄那一枚若挂在另一声上
    // 就是另一格，那是"格与格各答一次"，不是这里要证的择一。
    const engine = attackOnce([twoEffectSelf('苦形'), counterSkill('反伤')]);
    const ask = getReactionAsk(engine.state)!;
    expect(ask.options.map(o => o.skillName)).toEqual(['苦形', '反伤']);
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    // 点了苦形⇒反伤在这一格里不响，也不再问第二次：玩家择一，不是"全都响"。
    expect(events.filter(e => String((e.data as { skillId?: unknown }).skillId ?? '').includes('反伤')))
      .toHaveLength(0);
    expect(getReactionAsk(engine.state)).toBeNull();
  });
});

// ── v2.9.16 询问制刀 · 阵亡那一格 ──
// 「自身被击杀时」是询问制新覆盖的一型：候选从**坟场**捞（那一员已经不在场），
// 而问句的名字原先只在场名单里找⇒界面把内部运行时 id（`du_vic` 这种）当将名念给玩家看。
// 这是反转之后才新可达的一条路（旧口径下这一格压根不开）。
describe('响应链 · 阵亡那一格念得出名字（v2.9.16 询问制刀）', () => {
  /** 「自身被击杀时摸一张」——说话的那一员此刻已经不在场。 */
  function lastWords(name: string): Skill {
    return {
      name,
      description: `${name}：被击杀时可摸一张牌`,
      effects: [{ id: 'e1', trigger: { type: 'onDeath' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    } as Skill;
  }

  /** 一刀打死：p1 的 g1 斩 p2 那员只剩 1 点体力的将（伤害 2＞1）。 */
  function killedOnce(victimSkills: Skill[]): GameEngine {
    const dying = makeGeneral('g2', victimSkills);
    const dyingField = makeFieldGeneral(dying, 2);
    Object.assign(dyingField, { currentHp: 1 });
    const state = makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [dyingField] }),
    ]);
    const engine = new GameEngine(state);
    syncPlayerSkills(engine, state);
    engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    return engine;
  }

  it('问句里的将名取自坟场那一份卡面——不是把内部运行时 id 念给玩家听', () => {
    const engine = killedOnce([lastWords('遗言')]);
    const ask = getReactionAsk(engine.state);
    expect(ask).not.toBeNull();
    expect(ask!.playerId).toBe(2);
    expect(ask!.generalId).toBe('g2');
    expect(ask!.generalName).toBe('响应将g2'); // 坟场回落：这一员已经不在场名单里
    expect(ask!.trigger).toBe('onDeath');
    expect(ask!.options.map(o => o.skillId)).toEqual(['g2:遗言:e1']);
  });

  it('点头⇒阵亡方那一席摸到牌；摇头⇒同一声不再问第二遍（一次表态吃掉这一格）', () => {
    const nodded = killedOnce([lastWords('遗言')]);
    const ask = getReactionAsk(nodded.state)!;
    nodded.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect((nodded.state.players.find(p => p.id === 2)!.hand ?? [])).toHaveLength(1);
    expect(getReactionAsk(nodded.state)).toBeNull();

    const declined = killedOnce([lastWords('遗言')]);
    const openAsk = getReactionAsk(declined.state)!;
    declined.dispatch(createAction('SKIP_REACTION', openAsk.playerId, { nodeKey: openAsk.nodeKey }));
    expect((declined.state.players.find(p => p.id === 2)!.hand ?? [])).toHaveLength(0);
    expect(getReactionAsk(declined.state)).toBeNull();
  });
});

// ── v2.9.16 询问制刀 · 问句措辞的唯一词源 ──
// 组件原先把两句措辞写死在 JSX 里（`BEFORE_DAMAGE ? '成为目标时' : '受到伤害后'`）。
// 覆盖面从两型扩到每一型之后，那句写死的 ternary 会把"回合开始时"念成"受到伤害后"，
// 所以现在措辞改由**这一格自己的时机**去词源取。这里钉的是那条依赖：问句里可能出现
// 的每一型时机，词源都必给得出一个非空中文名（否则界面念出 `undefined` 给玩家看）。
describe('响应链 · 问句时机名取自词源（v2.9.16 询问制刀）', () => {
  it('问答路能问到的每一型时机，在 `triggerTypeLabels` 里都有一个非空中文名', () => {
    const askable = (Object.keys(TRIGGER_EVENTS) as DataSkillTrigger[])
      .filter(trigger => eventsHeardBy(trigger).length > 0);
    expect(askable.length).toBeGreaterThan(0);
    askable.forEach(trigger => {
      expect(triggerTypeLabels[trigger as SkillTriggerType], `时机 ${trigger} 没有中文名`).toBeTruthy();
    });
    // 问句里出现过的这一格（阵亡那一格）也在同一张表上：不是组件另写的一句
    expect(triggerTypeLabels.onDeath).toBe('自身被击杀时');
    expect(triggerTypeLabels.onBecomingTarget).toBe('成为目标时');
  });
});

// ── v2.9.16 询问制刀 · 对局结束撞上一格没问完 ──
// 询问制把"每一型都问"铺开之后，多了一条要当面问清的路：**把对局打死的那一声**
// 会不会同时开出一格？开出来了就没人能答——校验器在 `phase==='gameOver'` 时不再
// 走响应闸（`src/rules/ActionValidator.ts:29`），落回普通阶段闸⇒点"发动"一律被
// 顶回 `ACTION_NOT_ALLOWED_IN_PHASE`，问句却还挂在界面上。
// 实测结论＝这一型今天**不存在**，两条理由都是结构性的，各配一条证人：
//   ① 营地那一格（`onBaseDamaged`）不认「我听谁」，只听自家席位那一声
//      （判据 `src/skills/skillEventMatch.ts:137`）⇒**赢家侧**不可能有候选；
//   ② 营地掉到 0 的那一笔里，阵亡席位连人带牌当场抹净（`fieldGenerals`／`hand`
//      清空，`src/core/eventProcessors/damageEvents.ts:14`）⇒**欠答那一席**也没候选，
//      而扫描发生在这一笔全部事件落账**之后**。
// 两池各 300 局的现场复量（seed 1..300）：`phase==='gameOver'` 时队列非空＝**0 次**。
// 所以这里不写防御代码（不给不会发生的场景加闸），只把这两条理由钉成证人：
// 哪天营地那一格认了「我听谁」、或者营地掉血不再抹掉在场将，第二条证人就会红。
describe('响应链 · 把对局打死的那一声开不出格子（v2.9.16 询问制刀）', () => {
  /** 「营地受到伤害时摸一张牌」——v2.9.14 那一型，听的是带 `isBase` 的那一声。 */
  function campInjuryDraw(name: string): Skill {
    return {
      name,
      description: `${name}：营地受到伤害时可摸一张牌`,
      effects: [{ id: 'e1', trigger: { type: 'onBaseDamaged' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    } as Skill;
  }

  /** 打营地那一席，另一席站着一员**也挂营地技**的将（①那条理由的受力点）。 */
  function hitCamp(p2BaseHp: number, p2Skills: Skill[], p1Skills: Skill[] = []): GameEngine {
    const rusher = makeFieldGeneral(makeGeneral('g1', p1Skills), 1);
    rusher.position = { zone: 'front', slot: 0, areaOwnerId: 2 };
    const state = makeState([
      makePlayer(1, { fieldGenerals: [rusher], hand: [ATTACK_COST] }),
      makePlayer(2, {
        baseHp: p2BaseHp,
        fieldGenerals: [makeFieldGeneral(makeGeneral('g2', p2Skills), 2)],
      }),
    ]);
    const engine = new GameEngine(state);
    syncPlayerSkills(engine, state);
    engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST,
    }));
    return engine;
  }

  it('营地**没死**那一笔：这一格照样开、照样问（接线是活的，不是空跑）', () => {
    const engine = hitCamp(9, [campInjuryDraw('护营')]);
    const p2 = engine.state.players.find(p => p.id === 2)!;
    expect(p2.baseHp).toBe(8); // 打在营地上的那一下掉 1 点（不是打将的那 2 点）
    const ask = getReactionAsk(engine.state);
    expect(ask).not.toBeNull();
    expect(ask!.playerId).toBe(2);
    expect(ask!.trigger).toBe('onBaseDamaged');
    expect(ask!.options.map(o => o.skillId)).toEqual(['g2:护营:e1']);
    // ①的正面半边：同一笔里**赢家侧**那员也挂着营地技，它不听（自家营地没掉血）⇒
    // 问句只欠挨打那一席。改坏 `skillEventMatch` 里营地那一格的席位判据，这条先红。
    expect(listReactionCandidates(engine.state, {
      key: 'probe', sourceEvent: { type: 'INJURY', data: { targetPlayerId: 2, targetId: 'base_2', isBase: true, hpLost: 1 } },
      answered: [],
    }).map(c => `${c.ownerId}:${c.generalId}`)).toEqual(['2:g2']);
  });

  it('营地**掉到 0**那一笔：对局结束，且这一格根本开不出来', () => {
    const engine = hitCamp(1, [campInjuryDraw('护营')], [campInjuryDraw('隔营')]);
    const p2 = engine.state.players.find(p => p.id === 2)!;
    const p1 = engine.state.players.find(p => p.id === 1)!;
    expect(engine.state.phase).toBe('gameOver');
    // 证的是②那条理由本身（不是"恰好没连上电"）：这一席的将在这一笔里已被抹净
    expect(p2.isAlive).toBe(false);
    expect(p2.fieldGenerals).toHaveLength(0);
    // ①：赢家那员将**还在场**、也挂着营地技，但营地那一格不认「我听谁」⇒它不是候选
    expect(p1.fieldGenerals).toHaveLength(1);
    // 队列里没有待答格⇒界面不会在胜负已分的牌桌上摆一个点了必被顶回的按钮
    expect(engine.state.pendingReaction?.nodes.length ?? 0).toBe(0);
    expect(getReactionAsk(engine.state)).toBeNull();
  });
});
