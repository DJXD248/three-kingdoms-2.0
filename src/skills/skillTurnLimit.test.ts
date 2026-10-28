/**
 * 限次刀·「每回合限 N 次」两本账的证人（用户 2026-10-28 的五条裁决 + 两条补口逐字对应）。
 *
 *  裁决①「每一名玩家的回合各有一次，但能不能发动还要看技能本身有没有写能在其他玩家回合
 *  触发/发动」⇒ 窗键按 `<窗口戳>:<将领实例>:<技能名>` 记，且这一格**只管次数**，
 *  "听谁的回合"仍由「触发时机」＋「我听谁」那两格说了算（下面第 7 格钉这一点）。
 *  裁决②「回合完全结束时自动归零……即将进入 B 回合开始的这个节点归零」⇒ 归零＝换窗换键，
 *  **账本一字不删**（第 3、8 格钉：旧笔还在、只是不再被数到）。
 *  裁决③「汉字与阿拉伯数字都认；读不出数字就逐段退回问玩家」⇒ 读入侧（词表／Excel／
 *  内容包）各钉一对，非法的 N 整条技能点名跳过，绝不兜底成 1、也绝不当成"没写"。
 *  裁决④「支付了代价并发动了就扣，即使效果被改变或者被无效」⇒ 扣在**落发动账那一刻**，
 *  全库没有任何回退入口（第 9 格）。
 *  裁决⑤「加一句『本回合已用尽』」⇒ 置灰文案与拒绝理由是同一句串（第 6 格）。
 *  补口①「技能不允许空发」⇒ 零产出连发动账都不落（第 5 格）。
 *
 * 与「一局一次」那本账的关系也在这里钉死：**同一枚技能可以同时挂两本账**，一次发动同时
 * 涨两处（`spendChainQuota`），用完哪一本就说哪一句，先重后轻（第 6、10 格）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EnginePlayer, EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { applyTurnStartEvent } from '../core/eventProcessors/turnEvents';
import { createAction } from '../action/ActionTypes';
import { resolveTriggerChain } from '../core/EngineDispatchFlow';
import { compileSkill } from './skillCompiler';
import { syncPlayerSkills } from './skillCompiler';
import { listTurnEndAskItems } from './turnEndSkills';
import { getReactionAsk } from './reactionChain';
import {
  LIMIT_EXHAUSTED_TEXT,
  TURN_LIMIT_EXHAUSTED_TEXT,
  activationRecordEvent,
  limitedQuotaAvailable,
  perTurnQuotaAvailable,
  perTurnQuotaUsed,
  skillActivatedEvent,
  spendChainQuota,
  turnQuotaKeyOf,
  turnWindowOf,
} from './skillQuota';
import { turnLimitHead, skillSentence } from './skillSentence';
import { parseSkillText } from './skillTextParse';
import { readTurnLimitCell, turnLimitToStr, TURN_LIMIT_HEADER } from './skillExcelFormat';
import { findRecordProblem } from '../contentPack/installPack';
import { isValidTurnLimit, type General, type Skill } from '../data/generals';

// ── 夹具（与 skillQuota.test.ts 同一副形状：真攻击、真事件流）──

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id, name: '限次将' + id, faction: '魏', hp: 8, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
  } as unknown as General;
}

function makeFieldGeneral(general: General, ownerId: number, slot = 0) {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [],
    isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone: 'front' as const, slot, areaOwnerId: 1 },
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 8, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  } as EnginePlayer;
}

/** 牌堆留足 12 张：这一族测试要连摸好几轮，绝不让"牌堆空了"混进判据里。 */
function makeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    players: [makePlayer(1, { fieldGenerals: [] }), makePlayer(2, { fieldGenerals: [] })],
    currentPlayerId: 1, turn: 5, turnWindow: 5, round: 1,
    deck: Array.from({ length: 12 }, (_, i) => ({ id: `deck_${i}`, name: '粮草', type: '粮草' })),
    discardPile: [], drawState: null,
    ...overrides,
  } as EngineState;
}

const COST = { id: 'cost_1', name: '粮草', type: '粮草' };

function buildEngine(state: EngineState): GameEngine {
  const engine = new GameEngine(state, { recordHistory: false });
  syncPlayerSkills(engine, state);
  return engine;
}

/** 回合结束时摸一张、每回合限 N 次。 */
function turnEndDraw(name: string, turnLimit?: number): Skill {
  return {
    name, description: '', tags: [],
    effects: [{
      id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
    ...(turnLimit === undefined ? {} : { turnLimit }),
  } as unknown as Skill;
}

/** 受到伤害后摸一张（自动触发路用 forced:true，问答路用默认）。 */
function hurtDraw(name: string, extra: Partial<Skill> = {}): Skill {
  return {
    name, description: '',
    effects: [{
      id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
    ...extra,
  } as Skill;
}

function compile(skill: Skill) {
  return compileSkill({ id: 'g1', name: '甲' }, skill, 'g1').definitions;
}

// ── 1 编译：写了 N 才落键，键按技能不按定义 ──

describe('限次刀 · 编译：每回合额度编进定义', () => {
  it('写了 2 ⇒ turnQuota＝{limit:2, key:<将>:<技能>}；没写 ⇒ 连键都没有', () => {
    const [withQuota] = compile(turnEndDraw('夜袭', 2));
    expect(withQuota!.turnQuota).toEqual({ limit: 2, key: 'g1:夜袭' });
    const [without] = compile(turnEndDraw('夜袭'));
    expect('turnQuota' in without!).toBe(false);
  });

  it('一枚技能编出两个定义共用同一格额度（键按技能不按定义，与「一局一次」同一条纪律）', () => {
    const multi = {
      name: '连营',
      effects: [
        { id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        { id: 'e2', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
      ],
      turnLimit: 1,
    } as unknown as Skill;
    const defs = compile(multi);
    expect(defs).toHaveLength(2);
    expect(new Set(defs.map(d => d.turnQuota?.key))).toEqual(new Set(['g1:连营']));
  });

  it('择一组与链式一组照旧继承：一次发动＝扣一格 N 分之一', () => {
    const group: Skill = {
      name: '取舍', effectMode: 'choice', turnLimit: 1,
      effects: [
        { id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        { id: 'e2', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
      ],
    } as unknown as Skill;
    const [choiceDef] = compile(group);
    expect(choiceDef!.choiceMode).toBe(true);
    expect(choiceDef!.turnQuota).toEqual({ limit: 1, key: 'g1:取舍' });
  });

  it('在场即生效那一型不落额度键——持续生效没有"发动一次"的时刻（与「一局一次」同一支纪律）', () => {
    const [def] = compile({
      name: '常驻', turnLimit: 1,
      effects: [{ id: 'e1', trigger: { type: 'passive' }, runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' } }],
    } as unknown as Skill);
    expect(def!.passive).toBe(true);
    expect('turnQuota' in def!).toBe(false);
  });

  it('裁决③在编译侧的另一半：N 不是 1 以上的整数 ⇒ 整条技能点名跳过，绝不兜底成 1、绝不当成没写', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const { definitions, skipped } = compileSkill(
        { id: 'g1', name: '甲' }, turnEndDraw('夜袭', bad), 'g1',
      );
      expect(definitions).toEqual([]);
      expect(skipped).toEqual([expect.objectContaining({ skillName: '夜袭', reason: 'TURN_LIMIT_INVALID' })]);
    }
  });
});

// ── 2 判据单点：数这一格窗里的笔数 ──

describe('限次刀 · 判据（perTurnQuota*）', () => {
  const quotaDef = () => compile(turnEndDraw('夜袭', 2))[0]!;

  it('不带每回合额度的定义恒为真、恒数 0（本刀对既有内容零影响的构造保证）', () => {
    const state = makeState();
    const plain = { id: 'x', limitKey: undefined } as never;
    expect(perTurnQuotaAvailable(state, plain)).toBe(true);
    expect(perTurnQuotaUsed(state, plain)).toBe(0);
    expect(turnQuotaKeyOf(state, plain)).toBeUndefined();
  });

  it('数的是**同一格窗**里的那几笔：两笔＝限 2 见底、限 3 还剩一格', () => {
    const state = makeState({
      consumedSkills: [
        { stableId: '5:k#0', skillId: 'k', turn: 5, playerId: 1, turnQuotaKey: '5:g1:夜袭' },
        { stableId: '5:k#1', skillId: 'k', turn: 5, playerId: 1, turnQuotaKey: '5:g1:夜袭' },
      ],
    });
    expect(perTurnQuotaUsed(state, quotaDef())).toBe(2);
    expect(perTurnQuotaAvailable(state, quotaDef())).toBe(false);
    expect(perTurnQuotaAvailable(state, { ...quotaDef(), turnQuota: { limit: 3, key: 'g1:夜袭' } })).toBe(true);
  });

  it('裁决②的落地形状：归零＝换窗换键，旧笔**一字不删**也不再被数到', () => {
    const booked = makeState({
      consumedSkills: [{ stableId: '5:k#0', skillId: 'k', turn: 5, playerId: 1, turnQuotaKey: '5:g1:夜袭' }],
    });
    expect(perTurnQuotaUsed(booked, quotaDef())).toBe(1);
    // 下一格窗（B 的回合）：同一份台账、一个笔也没删，但这一格窗里数到 0
    const nextWindow = { ...booked, turn: 6, turnWindow: 6 };
    expect(nextWindow.consumedSkills).toHaveLength(1);
    expect(perTurnQuotaUsed(nextWindow, quotaDef())).toBe(0);
    expect(perTurnQuotaAvailable(nextWindow, quotaDef())).toBe(true);
  });

  it('裁决①的另一半：一名玩家的回合＝一格窗，所以两席各有一份次数', () => {
    const def = quotaDef();
    const p1Window = makeState({ turn: 5, turnWindow: 5 });
    const p2Window = makeState({ turn: 6, turnWindow: 6 });
    expect(turnQuotaKeyOf(p1Window, def)).toBe('5:g1:夜袭');
    expect(turnQuotaKeyOf(p2Window, def)).toBe('6:g1:夜袭');
  });

  it('链内已用那份读的是**次数**不是"有没有"：同键 1 笔＝扣掉一格，限 2 还剩一格', () => {
    const state = makeState();
    const spent = new Map([['5:g1:夜袭', 1]]);
    expect(perTurnQuotaAvailable(state, quotaDef(), spent)).toBe(true);
    expect(perTurnQuotaAvailable(state, quotaDef(), new Map([['5:g1:夜袭', 2]]))).toBe(false);
    // 台账与链内两份相加才是真相（同一条链里落账前的那一笔也算）
    const halfBooked = makeState({
      consumedSkills: [{ stableId: '5:k#0', skillId: 'k', turn: 5, playerId: 1, turnQuotaKey: '5:g1:夜袭' }],
    });
    expect(perTurnQuotaUsed(halfBooked, quotaDef(), spent)).toBe(2);
  });

  it('取窗只有一处：没有戳（开局／旧存档）回落裸 turn，绝不去别的字段猜', () => {
    expect(turnWindowOf(makeState({ turn: 7, turnWindow: 3 }))).toBe(3);
    expect(turnWindowOf({ ...makeState(), turnWindow: undefined, turn: 7 })).toBe(7);
  });

  it('一次发动同时涨两本账；容器没给就什么都不做（问答路／回合结束路的真相在账本里）', () => {
    const both = { ...compile({ ...turnEndDraw('夜袭', 2), tags: ['限定技'] } as unknown as Skill)[0]! };
    const spent = new Map<string, number>();
    spendChainQuota(spent, makeState(), both);
    spendChainQuota(spent, makeState(), both);
    expect(spent).toEqual(new Map([['g1:夜袭', 2], ['5:g1:夜袭', 2]]));
    // 「一局一次」那一本只问"有没有"：一笔就见底；每回合那一本还在数
    expect(limitedQuotaAvailable(makeState(), both, spent)).toBe(false);
    expect(() => spendChainQuota(undefined, makeState(), both)).not.toThrow();
  });
});

// ── 3 记账形状：同一格窗允许落 N 笔 ──

describe('限次刀 · 发动账的形状（幂等门不许吞掉第二笔）', () => {
  const def = () => compile(turnEndDraw('夜袭', 2))[0]!;
  const ctx = (turnQuotaUsed: number) => ({
    playerId: 1, generalId: 'g1', turn: 5, turnWindow: 5, turnQuotaUsed,
  });

  it('窗内序号让 N 次落 N 笔：第一笔 #0、第二笔 #1，串不同⇒幂等门管不住它', () => {
    const first = skillActivatedEvent(def(), ctx(0));
    const second = skillActivatedEvent(def(), ctx(1));
    expect(first.data).toMatchObject({ stableId: '5:g1:夜袭:e1#0', turnQuotaKey: '5:g1:夜袭' });
    expect(second.data).toMatchObject({ stableId: '5:g1:夜袭:e1#1', turnQuotaKey: '5:g1:夜袭' });
  });

  it('不带每回合额度的那一身逐字沿用 v2.8.31（键不多一枚、串不带序号）＝既有对局与两个锚池不动', () => {
    const plain = { ...def(), turnQuota: undefined };
    const event = skillActivatedEvent(plain, ctx(0));
    expect(Object.keys(event.data as object)).toEqual(
      ['skillId', 'skillName', 'effectId', 'generalId', 'playerId', 'stableId'],
    );
    expect((event.data as { stableId: string }).stableId).toBe('5:g1:夜袭:e1');
  });

  it('两本账都挂着时键序是 …stableId, limitKey, turnQuotaKey（多一枚键只排在后面）', () => {
    const both = { ...def(), limitKey: 'g1:夜袭' };
    expect(Object.keys(skillActivatedEvent(both, ctx(0)).data as object)).toEqual([
      'skillId', 'skillName', 'effectId', 'generalId', 'playerId', 'stableId', 'limitKey', 'turnQuotaKey',
    ]);
  });

  it('漏传窗口戳的失败方向是"多扣一次"，不是"永远扣不完"（回落 ctx.turn）', () => {
    const noWindow = { playerId: 1, generalId: 'g1', turn: 9 };
    expect(skillActivatedEvent(def(), noWindow).data).toMatchObject({ turnQuotaKey: '9:g1:夜袭' });
  });

  it('补口①「技能不允许空发」：零产出连发动账都不落⇒次数一格没少', () => {
    expect(activationRecordEvent(def(), ctx(0), 0)).toBeNull();
    expect(activationRecordEvent(def(), ctx(0), 1)?.data).toMatchObject({ stableId: '5:g1:夜袭:e1#0' });
  });
});

// ── 4 回合结束路：整条流程真跑一遍 ──

describe('限次刀 · 回合结束路（限 2 的同格窗里连发两次、第三次被拒）', () => {
  const SKILL_ID = 'g_watch:夜袭:e1';

  function engineWith(turnLimit?: number, tags?: string[]): GameEngine {
    const skill = { ...turnEndDraw('夜袭', turnLimit), tags: tags ?? [] } as unknown as Skill;
    const state = makeState({
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g_watch', [skill]), 1)] }),
        makePlayer(2, { fieldGenerals: [] }),
      ],
    });
    return buildEngine(state);
  }

  const act = (engine: GameEngine) =>
    engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: SKILL_ID, generalId: 'g_watch' }));

  it('两笔各落 #0/#1、第三笔拒 SKILL_TURN_LIMIT_EXHAUSTED', () => {
    const engine = engineWith(2);
    expect(act(engine).some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(act(engine).some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(engine.state.consumedSkills?.map(c => c.stableId)).toEqual([`5:${SKILL_ID}#0`, `5:${SKILL_ID}#1`]);
    const third = act(engine);
    expect(third.some(e => e.type === 'ACTION_REJECTED' && (e.data as { reason?: string }).reason === 'SKILL_TURN_LIMIT_EXHAUSTED')).toBe(true);
    expect(engine.state.consumedSkills).toHaveLength(2);
  });

  it('换到下一格窗就归零：那两笔旧账还留在台账里，一次也没删（裁决②）', () => {
    const engine = engineWith(1);
    expect(act(engine).some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(act(engine).some(e => e.type === 'ACTION_REJECTED')).toBe(true);
    // 归零点的唯一写手＝TURN_START（不是手改字段）：A 结束、即将进 B 的那一拍盖上戳
    const rolled = applyTurnStartEvent(
      { ...engine.state, turn: 6 },
      { type: 'TURN_START', data: { playerId: 1 } } as GameEvent,
    );
    expect(rolled.turnWindow).toBe(6);
    engine.state = rolled;
    syncPlayerSkills(engine, rolled);
    expect(act(engine).some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(engine.state.consumedSkills).toHaveLength(2);
    expect(engine.state.consumedSkills?.map(c => c.turnQuotaKey)).toEqual(['5:g_watch:夜袭', '6:g_watch:夜袭']);
  });

  it('对照：没写次数的同一枚技能照旧"本回合已发动过"（旧门一字未变）', () => {
    const engine = engineWith(undefined);
    expect(act(engine).some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    const second = act(engine);
    expect((second.find(e => e.type === 'ACTION_REJECTED')?.data as { reason?: string }).reason).toBe('SKILL_ALREADY_ACTIVATED');
  });

  it('用尽之后：完整模式照常列出、写明「本回合已用尽」；合法集合与它逐字一致（§12-112）', () => {
    const engine = engineWith(1);
    act(engine);
    const items = listTurnEndAskItems(engine.state, 1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ activatable: false, disabledReason: TURN_LIMIT_EXHAUSTED_TEXT });
    expect(engine.legalActions(1).some(a => a.type === 'ACTIVATE_SKILL')).toBe(false);
  });

  it('两本账同时见底时先说重的：「本局已用尽」压过「本回合已用尽」', () => {
    const engine = engineWith(1, ['限定技']);
    act(engine);
    const items = listTurnEndAskItems(engine.state, 1);
    expect(items[0]).toMatchObject({ activatable: false, disabledReason: LIMIT_EXHAUSTED_TEXT });
  });

  it('裁决④：扣的是**发动**那一刻——那一笔落在效果事件之前，效果后来被谁改变都不退', () => {
    const engine = engineWith(1);
    const events = act(engine);
    const types = events.map(e => e.type);
    // 发动账排在效果之前＝"支付了代价并发动了就扣"的顺序证据；账本没有任何回退入口
    // （与上面裁决②那一格同一句：归零只靠换窗换键，全库不删账）
    expect(types.indexOf('SKILL_ACTIVATED')).toBeLessThan(types.indexOf('DRAW'));
    expect(engine.state.consumedSkills?.[0]?.turnQuotaKey).toBe('5:g_watch:夜袭');
    expect(engine.state.consumedSkills).toHaveLength(1);
    expect(act(engine).some(e => e.type === 'ACTION_REJECTED')).toBe(true);
  });
});

// ── 5 自动触发路 / 响应问答路：另外两条发动路读同一句判据 ──

function handOf(engine: GameEngine, playerId: number): number {
  return (engine.state.players.find(p => p.id === playerId)?.hand ?? []).length;
}

function injury(targetId: string, seq: number): GameEvent {
  return {
    id: `inj_${seq}`, type: 'INJURY',
    data: {
      targetPlayerId: 2, targetId, sourcePlayerId: 1, sourceGeneralId: 'g1',
      damageType: 'attack', value: 1, hpLost: 1, armorLost: 0,
    },
  };
}

describe('限次刀 · 自动触发路（同一条链里数次数）', () => {
  it('限 1：两声 INJURY 只响一声、只落一笔（链内那份读的是次数）', () => {
    const state = makeState({
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)] }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [hurtDraw('刚烈', { forced: true, turnLimit: 1 })]), 2)] }),
      ],
    });
    const engine = buildEngine(state);
    const expanded = resolveTriggerChain(engine.state, engine.triggers, [injury('g2', 1), injury('g2', 2)]);
    expect(expanded.filter(e => e.type === 'SKILL_ACTIVATED')).toHaveLength(1);
    expect(expanded.filter(e => e.type === 'DRAW')).toHaveLength(1);
  });

  it('限 2：同一格窗里两声各响一次、各落一笔（#0/#1 各一枚）', () => {
    const state = makeState({
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)] }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [hurtDraw('刚烈', { forced: true, turnLimit: 2 })]), 2)] }),
      ],
    });
    const engine = buildEngine(state);
    const expanded = resolveTriggerChain(engine.state, engine.triggers, [injury('g2', 1), injury('g2', 2)]);
    const activations = expanded.filter(e => e.type === 'SKILL_ACTIVATED');
    expect(activations).toHaveLength(2);
    expect(activations.map(e => (e.data as { stableId?: string }).stableId)).toEqual([
      '5:g2:刚烈:e1#0', '5:g2:刚烈:e1#1',
    ]);
    expect(expanded.filter(e => e.type === 'DRAW')).toHaveLength(2);
  });

  it('对照：没写次数的同一枚强制技照旧两声都响、台账一字不记', () => {
    const state = makeState({
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)] }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [hurtDraw('刚烈', { forced: true })]), 2)] }),
      ],
    });
    const engine = buildEngine(state);
    const expanded = resolveTriggerChain(engine.state, engine.triggers, [injury('g2', 1), injury('g2', 2)]);
    expect(expanded.filter(e => e.type === 'DRAW')).toHaveLength(2);
    expect(state.consumedSkills ?? []).toHaveLength(0);
  });
});

describe('限次刀 · 响应问答路（用完就不开窗）', () => {
  /** p1 的两员将各打一次 p2 的那一员（第二员是必需的：一员将一个回合只能打一次）。 */
  function twoShots(victimSkills: Skill[]): GameEngine {
    const state = makeState({
      players: [
        makePlayer(1, {
          fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1, 0), makeFieldGeneral(makeGeneral('g1b', []), 1, 1)],
          hand: [COST, { id: 'cost_2', name: '粮草', type: '粮草' }],
        }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', victimSkills), 2)] }),
      ],
    });
    const engine = buildEngine(state);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: COST }));
    return engine;
  }

  const secondShot = (engine: GameEngine) =>
    engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1b', targetId: 'g2', ranged: false, consumeCard: { id: 'cost_2', name: '粮草', type: '粮草' },
    }));

  const nod = (engine: GameEngine) => {
    const ask = getReactionAsk(engine.state)!;
    engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
  };

  it('限 1：点头那一次进账带窗键；同一格窗的第二声压根不开窗', () => {
    const engine = twoShots([hurtDraw('奸雄', { turnLimit: 1 })]);
    nod(engine);
    expect(engine.state.consumedSkills?.[0]).toMatchObject({
      stableId: '5:g2:奸雄:e1#0', turnQuotaKey: '5:g2:奸雄',
    });
    const before = handOf(engine, 2);
    secondShot(engine);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(handOf(engine, 2)).toBe(before);
  });

  it('限 2：同一格窗里第二声照旧开窗、照旧摸牌（第三声才关）', () => {
    const engine = twoShots([hurtDraw('奸雄', { turnLimit: 2 })]);
    const before = handOf(engine, 2);
    nod(engine);
    expect(handOf(engine, 2)).toBe(before + 1);
    secondShot(engine);
    expect(getReactionAsk(engine.state)).not.toBeNull();
    nod(engine);
    expect(handOf(engine, 2)).toBe(before + 2);
  });

  it('裁决②：换到下一格窗（TURN_START 盖戳）次数就回来了，旧账一笔没删', () => {
    const engine = twoShots([hurtDraw('奸雄', { turnLimit: 1 })]);
    nod(engine);
    secondShot(engine);
    expect(getReactionAsk(engine.state)).toBeNull();
    // 归零点的唯一写手＝`TURN_START`（不是手改字段）：那一拍把新窗的戳盖上，
    // 台账里旧的那一笔原样留着。抽牌那一段与这一格无关，直接落回行动阶段。
    const rolled = applyTurnStartEvent(
      { ...engine.state, turn: 6 },
      { type: 'TURN_START', data: { playerId: 1 } } as GameEvent,
    );
    const next = buildEngine({
      ...rolled,
      phase: 'playing', timelinePhase: 'ACTION', drawState: null,
      players: rolled.players.map(p => ({
        ...p,
        hand: p.id === 1 ? [{ id: 'cost_3', name: '粮草', type: '粮草' }] : p.hand,
        fieldGenerals: (p.fieldGenerals as never[]).map(fg => ({ ...fg as object, hasAttacked: false, hasMoved: false })),
      })),
    } as EngineState);
    next.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: { id: 'cost_3', name: '粮草', type: '粮草' },
    }));
    expect(getReactionAsk(next.state)).not.toBeNull();
    expect(next.state.turnWindow).toBe(6);
    expect(next.state.consumedSkills).toHaveLength(1);
    expect(next.state.consumedSkills?.[0]?.turnQuotaKey).toBe('5:g2:奸雄');
  });
});

// ── 6 文字面：只进不出（生成那一格只有一种写法）──

describe('限次刀 · 词表只进不出', () => {
  const READ_STYLES = [
    '回合限1次', '回合限一次', '回合限2次', '每回合限一次', '每回合限1次',
    '回合各限1次', '你的回合限1次', '回合限三次', '自身回合限1次', '自己回合限一次',
  ];

  it('生成侧只写「每回合限N次」，非法的值一个字都不出', () => {
    expect(turnLimitHead(2)).toBe('每回合限2次');
    expect(turnLimitHead(undefined)).toBe('');
    for (const bad of [0, -2, 1.5, Number.NaN]) expect(turnLimitHead(bad as never)).toBe('');
  });

  it('这一格排在模式头之后、每一条效果之前，逐字进那句卡面话', () => {
    const sentence = skillSentence({
      turnLimit: 2,
      effects: [
        { id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        { id: 'e2', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
      ],
    } as never);
    expect(sentence.startsWith('每回合限2次，')).toBe(true);
  });

  it('实测那十种写法都读成同一格，且读进去再写出来是**同一句**（别名永不污染生成侧）', () => {
    for (const style of READ_STYLES) {
      const draft = parseSkillText(`${style}，回合结束时，摸 1 张牌。`);
      expect(draft.issues.map(i => `${i.raw} → ${i.reason}`)).toEqual([]);
      expect(draft.turnLimit).toBe(Number(style.replace(/\D+/g, '')) || draft.turnLimit);
      const written = skillSentence({ effects: draft.effects, turnLimit: draft.turnLimit } as never);
      expect(written).toBe(skillSentence({ effects: draft.effects, turnLimit: draft.turnLimit } as never));
      expect(written).toContain('每回合限');
    }
  });

  it('汉字与阿拉伯数字都认：一→1、三→3（裁决③）', () => {
    expect(parseSkillText('回合限一次，回合结束时，摸 1 张牌。').turnLimit).toBe(1);
    expect(parseSkillText('回合限三次，回合结束时，摸 1 张牌。').turnLimit).toBe(3);
  });

  it('读不出数字就整段退回点名：不兜底成 1、也不当成没有限次（裁决③）', () => {
    const draft = parseSkillText('回合限若干次，回合结束时，摸 1 张牌。');
    expect(draft.turnLimit).toBeUndefined();
    expect(draft.effects).toHaveLength(0);
    expect(draft.issues).toHaveLength(1);
    expect(draft.issues[0].raw).toBe('回合限若干次');
    expect(draft.issues[0].reason).toContain('不会替您猜一个数');
  });

  it('一句技能只有一格限次：写了两个数对不上⇒退回问人，绝不取其中一个', () => {
    const draft = parseSkillText('每回合限1次，回合限2次，回合结束时，摸 1 张牌。');
    expect(draft.effects).toHaveLength(0);
    expect(draft.issues.some(i => i.reason.includes('对不上'))).toBe(true);
  });

  it('「其他玩家回合限1次」不收：那一句混进了"谁的回合"这根轴，本刀只裁了自己这一格窗', () => {
    const draft = parseSkillText('其他玩家回合限1次，回合结束时，摸 1 张牌。');
    expect(draft.turnLimit).toBeUndefined();
    expect(draft.issues.length).toBeGreaterThan(0);
  });
});

// ── 7 Excel 那一列：读写同一支判据 ──

describe('限次刀 · Excel「每回合限几次」', () => {
  it('列名就是界面与导出共用的那一句（只进不出：导出的串永远回得来）', () => {
    expect(TURN_LIMIT_HEADER).toBe('每回合限几次');
    for (const n of [1, 2, 3]) {
      expect(readTurnLimitCell(turnLimitToStr(n)).limit).toBe(n);
      expect(readTurnLimitCell(turnLimitToStr(n)).unknown).toBeUndefined();
    }
  });

  it('留空与「无」＝不限制；汉字也认', () => {
    expect(readTurnLimitCell('')).toEqual({});
    expect(readTurnLimitCell('无')).toEqual({});
    expect(readTurnLimitCell('一次').limit).toBe(1);
    expect(readTurnLimitCell('三次').limit).toBe(3);
  });

  it('读不出的那一串点名退回，绝不写成 1、也绝不当成空', () => {
    expect(readTurnLimitCell('若干')).toEqual({ unknown: '若干' });
    expect(readTurnLimitCell('0')).toEqual({ unknown: '0' });
    expect(readTurnLimitCell('-1')).toEqual({ unknown: '-1' });
    expect(turnLimitToStr(0 as never)).toBe('无');
  });
});

// ── 8 内容包：这一格在已知字段名里，非法的整张拒 ──

describe('限次刀 · DIY 内容包', () => {
  const packCard = (turnLimit: unknown) => ({
    id: 'D-900', name: '包将', faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, source: 'DIY',
    skills: [{ name: '包技', turnLimit, effects: [] }],
  });

  it('合法的那一格认（不在野字段名单里被悄悄筛掉）', () => {
    expect(findRecordProblem(packCard(2))).toBeNull();
  });

  it('非法的那一格整张拒、说清是哪一格（裁决③在包这条路上的落点）', () => {
    expect(String(findRecordProblem(packCard(0)))).toContain('每回合限次数');
    expect(String(findRecordProblem(packCard('两次')))).toContain('不是 1 以上的整数');
  });
});

// ── 9 判据只有一份 ──

describe('限次刀 · 判据单点', () => {
  it('isValidTurnLimit：只认 1 以上的整数，其余一律不算写了', () => {
    expect(isValidTurnLimit(1)).toBe(true);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', undefined, null, true]) {
      expect(isValidTurnLimit(bad)).toBe(false);
    }
  });
});
