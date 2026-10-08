/**
 * 2.9.3 刀B：「觉醒技」徽章第一次被结算读到。
 *
 * 用户口径（2026-10-08 三条，逐字）：
 *  ①「觉醒技和限定技同理，在同一局中发动过一次就不能再发动」⇒ 额度与限定技**同一本账**
 *    （同一个 `limitKey` 形状、同一个 `limitedQuotaAvailable`）；
 *  ②「觉醒达成条件当场问」⇒ 达成那一刻停下来问一次，**不拖到回合结束**；
 *  ③摇头＝不发动⇒不扣额度（`SKIP_REACTION` 那条出口从来不落账，本刀只钉它真的可达）。
 * 徽章语义里那句「非强制发动」（用户 2026-10-04）⇒ 它走问答路，不走自动路；
 * 而真打了「强制发动」的觉醒技照旧自动响（分流开关第一句就把它放回自动路）。
 *
 * 这一档钉的是**整条链**：徽章 ⇒ 编译位 ⇒ 分流开关 ⇒ 扫描开格 ⇒ 冻结世界 ⇒
 * 表态（canonical 两条出口）⇒ 额度落账 ⇒ 用尽后不再问。单层测试抓不到的是中间
 * 掉链子那一类：编译位有、扫描不认；格开了、解析器不接；额度落了、下一次照问。
 *
 * 与相邻几档的分工：`reactionChain.test.ts` 钉受击／受伤两型的队列机器（本刀复用
 * 它，一字未改），`gainSkill.test.ts` 钉「获得技能」那一条效果，`skillQuota.test.ts`
 * 钉额度本账的四条裁决。这里只钉"徽章把它搬进问答路"这一族新事实。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EnginePlayer, EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { createAction } from '../action/ActionTypes';
import { effectiveMaxHp } from '../core/statModifiers';
import { allGenerals } from '../data/generals';
import { DIY_FIXTURE_GENERALS } from '../ai/fixtures/diyGeneralFixture';
import type { General, Skill, SkillCondition } from '../data/generals';
import { tagsOf } from '../domain/skillTags';
import { compileSkill, syncPlayerSkills } from './skillCompiler';
import { getReactionAsk, syncReactionQueue } from './reactionChain';
import { defersToReactionQueue } from './SkillTriggerBridge';
import { LIMIT_EXHAUSTED_TEXT, limitedQuotaAvailable } from './skillQuota';

// ── 夹具（与 `skillQuota.test.ts` 同一副形状：真攻击、真事件流、真死亡） ──

function makeGeneral(id: string, skills: Skill[], hp = 8): General {
  return {
    id, name: '觉醒将' + id, faction: '魏', hp, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
  } as unknown as General;
}

function makeFieldGeneral(general: General, ownerId: number, slot = 0, currentHp = general.hp) {
  return {
    general, currentHp, maxHp: general.hp,
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

const COST_1 = { id: 'cost_1', name: '粮草', type: '粮草' };
const COST_2 = { id: 'cost_2', name: '粮草', type: '粮草' };

function makeState(players: EnginePlayer[]): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: Array.from({ length: 8 }, (_, i) => ({ id: `deck_${i + 1}`, name: '粮草', type: '粮草' as const })),
    discardPile: [], drawState: null,
  } as EngineState;
}

/**
 * 「单骑」的最小真实形状：近战击杀后，失去1点体力上限**并**获得技能「屯田」。
 * 效果名册用 `屯田`（官方卡上印着、刀A 那个解析点查得到）——本刀判的是问窗与额度，
 * 拿到哪一枚无所谓；"真拿到手"那一半由 `gainSkill.test.ts` 钉。
 */
function awakeningKill(name: string, extra: Partial<Skill> = {}): Skill {
  return {
    name,
    description: `${name}：觉醒技，你近战击杀战场区域的角色后，失去1点体力上限并获得技能「屯田」`,
    tags: ['觉醒技'],
    effectMode: 'chain',
    effects: [
      {
        id: 'e1',
        trigger: { type: 'onKill' },
        runtime: { type: 'MODIFY_STAT', stat: 'MAX_HP', modifyMode: 'delta', value: -1, target: 'SELF' },
      },
      {
        id: 'e2',
        trigger: { type: 'onKill' },
        runtime: { type: 'GAIN_SKILL', skillName: '屯田', target: 'SELF' },
      },
    ],
    ...extra,
  } as Skill;
}

/** 对照组：同一声击杀，但没挂徽章⇒今天既有的自动路（也是两锚不动的结构证人）。 */
function plainKill(name: string): Skill {
  return {
    name,
    description: `${name}：击杀后摸一张牌`,
    effects: [{ id: 'e1', trigger: { type: 'onKill' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  } as Skill;
}

interface KillScene {
  engine: GameEngine;
  killer: General;
  firstKill: GameEvent[];
}

/** 场面旋钮（2.9.3 刀C）：谁站哪片区域、这一刀是近战还是远程、击杀者同席还站几员将。 */
interface SceneOpts {
  killerZone?: 'camp' | 'front' | 'battle';
  victimZone?: 'camp' | 'front' | 'battle';
  ranged?: boolean;
  allies?: number;
}

const reposition = (fg: unknown, zone: 'camp' | 'front' | 'battle', areaOwnerId: number | null) => {
  (fg as { position: unknown }).position = { zone, slot: 0, areaOwnerId };
  return fg;
};

/**
 * p1 的那一员将当面砍死 p2 那一员只剩 1 体的将⇒DEATH 真的落进事件流。
 * 派发前 `syncPlayerSkills`＝常驻容器那条路（`store/engineExecutionBridge.ts:90`）。
 */
function sceneWithKill(killerSkills: Skill[], opts: SceneOpts = {}): KillScene {
  const killer = makeGeneral('g1', killerSkills);
  const victimFg = makeFieldGeneral(makeGeneral('g2', [], 1), 2, 0, 1);
  // 默认形状＝刀C 之前那副夹具（前线、areaOwnerId 1）：近战铁定够得着，既有各条逐字不变。
  if (opts.victimZone) reposition(victimFg, opts.victimZone, opts.victimZone === 'battle' ? null : 2);
  const allies = Array.from({ length: opts.allies ?? 0 }, (_, i) =>
    // 同席那几员都站战场：门槛数的是"本体那片区域＋战场"，站战场一定被数进去。
    reposition(makeFieldGeneral(makeGeneral(`g_ally_${i}`, [], 5), 1, i + 1), 'battle', null));
  const state = makeState([
    makePlayer(1, {
      fieldGenerals: [
        reposition(makeFieldGeneral(killer, 1, 0), opts.killerZone ?? 'front', (opts.killerZone ?? 'front') === 'battle' ? null : 1),
        ...allies,
      ],
      hand: [COST_1, COST_2],
    }),
    makePlayer(2, { fieldGenerals: [victimFg] }),
  ]);
  const engine = new GameEngine(state, { recordHistory: false });
  syncPlayerSkills(engine, state);
  const firstKill = engine.dispatch(createAction('ATTACK', 1, {
    attackerId: 'g1', targetId: 'g2', ranged: opts.ranged ?? false, consumeCard: COST_1,
  }));
  return { engine, killer, firstKill };
}

/** 从这一趟的事件流里取那一声**真的**阵亡：喂回扫描器的必须是已记账的事实，
 *  不是编出来的输入（夹具要是没产出 DEATH，这一档的证人根本不成立⇒当场炸）。 */
function deathEventOf(events: GameEvent[]): GameEvent {
  const death = events.find(e => e.type === 'DEATH');
  if (!death) throw new Error('夹具没有产出真 DEATH：这一档的证人不成立');
  return death;
}

function skillsOf(state: EngineState, playerId: number, generalId: string): Skill[] {
  const fg = (state.players.find(p => p.id === playerId)?.fieldGenerals as any[] | undefined)
    ?.find(f => f?.general?.id === generalId)?.general;
  return (fg?.skills ?? []) as Skill[];
}

function quotaEntries(state: EngineState): Array<{ limitKey?: string }> {
  return (state.consumedSkills ?? []) as Array<{ limitKey?: string }>;
}

// ── ① 编译面：徽章译成「觉醒」位＋同一本额度账 ──

describe('觉醒技 · 编译面（徽章⇒编译位，额度与限定技同键）', () => {
  it('挂徽章：落 awakening:true 与 limitKey＝<将领实例>:<技能名>', () => {
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '关羽' }, awakeningKill('单骑'), 'g1');
    expect(skipped).toEqual([]);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      trigger: 'onKill', awakening: true, limitKey: 'g1:单骑', effectChain: true,
    });
  });

  it('没挂徽章的对照组：两个键都不出现（＝既有编译产物逐字不变）', () => {
    const { definitions } = compileSkill({ id: 'g1', name: '关羽' }, plainKill('枭斩'), 'g1');
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).not.toHaveProperty('awakening');
    expect(definitions[0]).not.toHaveProperty('limitKey');
  });

  it('分流开关认这一位：觉醒技进问答路；打了强制发动的留在自动路', () => {
    const { definitions: asked } = compileSkill({ id: 'g1', name: '关羽' }, awakeningKill('单骑'), 'g1');
    expect(defersToReactionQueue(asked[0])).toBe(true);
    const { definitions: forced } = compileSkill(
      { id: 'g1', name: '关羽' }, awakeningKill('单骑', { forced: true }), 'g1');
    expect(forced[0]).toMatchObject({ awakening: true, forced: true });
    expect(defersToReactionQueue(forced[0])).toBe(false);
  });

  it('「在场即生效」那一支点名跳过：觉醒要问一次，passive 压根不进事件面', () => {
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '关羽' }, {
      ...(awakeningKill('单骑') as Skill),
      effectMode: 'all',
      effects: [{
        id: 'e1', trigger: { type: 'passive' },
        runtime: { type: 'MODIFY_STAT', stat: 'MELEE_ATK', modifyMode: 'delta', value: 1, target: 'SELF' },
      }],
    }, 'g1');
    expect(definitions).toEqual([]);
    expect(skipped.map(s => s.reason)).toEqual(['AWAKENING_PASSIVE_CONFLICT']);
  });

  it('「选择其一」那一组点名跳过：择一窗没有"不觉醒"这个出口', () => {
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '关羽' }, {
      ...(awakeningKill('单骑') as Skill),
      effectMode: 'choice',
    }, 'g1');
    expect(definitions).toEqual([]);
    expect(skipped.map(s => s.reason)).toEqual(
      ['AWAKENING_CHOICE_UNSUPPORTED', 'AWAKENING_CHOICE_UNSUPPORTED']);
  });

  it('普查钉子：今天两个锚池里没有任何一枚技能挂「觉醒技」⇒锚结构上不动', () => {
    const taggedIn = (pool: readonly General[]) => pool.filter(general =>
      (general.skills ?? []).some(skill => tagsOf(skill).includes('觉醒技')));
    expect(taggedIn(allGenerals).map(g => g.name)).toEqual([]);
    expect(taggedIn(DIY_FIXTURE_GENERALS).map(g => g.name)).toEqual([]);
  });
});

// ── ② 问答面：达成条件那一刻开格、问谁、两个出口、额度 ──

describe('觉醒技 · 达成条件当场问（用户 2026-10-08 裁「觉醒达成条件当场问」）', () => {
  it('击杀那一刻开一格：问的是击杀者那一席，卡面此刻还没长出新技能', () => {
    const { engine, firstKill } = sceneWithKill([awakeningKill('单骑')]);
    expect(firstKill.filter(e => e.type === 'DEATH')).toHaveLength(1);
    const ask = getReactionAsk(engine.state);
    expect(ask).not.toBeNull();
    expect(ask?.playerId).toBe(1);
    expect(ask?.generalId).toBe('g1');
    expect(ask?.sourceEvent.type).toBe('DEATH');
    expect(ask?.options.map(o => o.skillName)).toEqual(['单骑']);
    expect(skillsOf(engine.state, 1, 'g1').map(s => s.name)).toEqual(['单骑']);
    // 自动路一字不动：这趟里没有半点觉醒的产物（问而不响）。
    expect(firstKill.some(e => e.type === 'SKILL_GAINED')).toBe(false);
    expect(firstKill.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
  });

  it('格开着＝世界冻结：欠答那一席连"过一手"都过不去', () => {
    const { engine } = sceneWithKill([awakeningKill('单骑')]);
    const events = engine.dispatch(createAction('END_TURN', 1));
    expect(events.some(e => e.type === 'ACTION_REJECTED'
      && (e.data as { reason?: string }).reason === 'REACTION_PENDING')).toBe(true);
    // 拒了就是没动：这一格还挂着，等那一句表态。
    expect(getReactionAsk(engine.state)?.options.map(o => o.skillName)).toEqual(['单骑']);
  });

  it('点头⇒一张「获得技能」＋一笔额度账，卡面当场长出屯田', () => {
    const { engine } = sceneWithKill([awakeningKill('单骑')]);
    const ask = getReactionAsk(engine.state)!;
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(events.filter(e => e.type === 'SKILL_GAINED')).toHaveLength(1);
    expect(events.some(e => e.type === 'REACTION_ANSWERED')).toBe(true);
    expect(events.some(e => e.type === 'SKILL_ACTIVATED'
      && (e.data as { limitKey?: string }).limitKey === 'g1:单骑')).toBe(true);
    expect(skillsOf(engine.state, 1, 'g1').map(s => s.name)).toEqual(['单骑', '屯田']);
    expect(quotaEntries(engine.state).map(q => q.limitKey)).toContain('g1:单骑');
    // 问完就收格：世界解冻，且这一格不再挂着。
    expect(getReactionAsk(engine.state)).toBeNull();
  });

  /**
   * 用户 2026-10-08 补裁的第 2 条原文＝「失去体力上限这一点前面已经裁定过，体力会上限
   * 一起跟着削到3点」。这一档不重做那条算术（它住在 `statModifierEvents.clampToMaxHp`，
   * 2.8 刀4 起就在），只钉**觉醒这一路真的走到它**：点头之后上限少 1、当前体力跟着落到
   * 新上限，并且卡面那个印刷值一个字不改（改数与改卡分开）。
   */
  it('点头之后削掉的那 1 点上限：当前体力跟着削到新上限（裁决「体力会上限一起跟着削」）', () => {
    const { engine } = sceneWithKill([awakeningKill('单骑')]);
    const ask = getReactionAsk(engine.state)!;
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    const fg = (engine.state.players[0].fieldGenerals as any[])
      .find(f => f?.general?.id === 'g1');
    expect(fg.maxHp).toBe(8);                               // 卡面印刷值一字不改（改数走账本）
    expect(effectiveMaxHp(engine.state.statModifiers, { playerId: 1, generalId: 'g1' }, fg)).toBe(7);
    expect(fg.currentHp).toBe(7);                            // 当前体力跟着截回来
    // 截断不是伤害：这一趟里没有半点打到 g1 身上的 DAMAGE。
    expect(events.some(e => e.type === 'DAMAGE'
      && (e.data as { targetId?: string }).targetId === 'g1')).toBe(false);
  });

  it('摇头＝不算发动、不落账，同一声击杀照旧再问一遍（裁决③「摇头不扣额度」）', () => {
    const { engine, firstKill } = sceneWithKill([awakeningKill('单骑')]);
    const ask = getReactionAsk(engine.state)!;
    const events = engine.dispatch(createAction('SKIP_REACTION', ask.playerId, { nodeKey: ask.nodeKey }));
    expect(events.some(e => e.type === 'REACTION_ANSWERED')).toBe(true);
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
    expect(quotaEntries(engine.state)).toEqual([]);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(limitedQuotaAvailable(engine.state, ask.options[0].definition)).toBe(true);

    // "下一声还问不问"喂的是**这一趟已经记进事件流的那一条真 DEATH**（不是编出来的
    // 输入、也不是造一个行动类型去凑第二刀）：扫描器是纯函数 of（state，事件序列），
    // 同一条声在额度还在时必须再开一格。
    expect(syncReactionQueue(engine.state, [deathEventOf(firstKill)]).queue?.nodes).toHaveLength(1);
  });

  it('一局只觉醒一次：点头用掉之后，同一声击杀压根不再开格', () => {
    const { engine, firstKill } = sceneWithKill([awakeningKill('单骑')]);
    const ask = getReactionAsk(engine.state)!;
    engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(limitedQuotaAvailable(engine.state, ask.options[0].definition)).toBe(false);
    expect(syncReactionQueue(engine.state, [deathEventOf(firstKill)]).queue).toBeNull();
    // 问答路没有"置灰列出"的形状（v2.8.32 的如实账：能列出的就是能答的），所以
    // 「本局已用尽」在这一族的表现＝**不再问**；那句文案仍由回合结束那条路消费。
    expect(LIMIT_EXHAUSTED_TEXT).toBe('本局已用尽');
  });

  it('强制发动的觉醒技照旧到点自动响、不开格', () => {
    const { engine, firstKill } = sceneWithKill([awakeningKill('单骑', { forced: true })]);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(firstKill.some(e => e.type === 'SKILL_GAINED')).toBe(true);
    expect(skillsOf(engine.state, 1, 'g1').map(s => s.name)).toEqual(['单骑', '屯田']);
  });

  it('AI 与玩家同一队列：欠答那一席的合法动作就是「发动」＋「跳过」两个出口', () => {
    const { engine } = sceneWithKill([awakeningKill('单骑')]);
    const mine = engine.legalActions(1).map(a => a.type);
    expect(mine).toEqual(['ACTIVATE_SKILL', 'SKIP_REACTION']);
    // 不欠答的那一席：世界冻结期间压根没有动作可挑（司机因此不会绕过问窗）。
    expect(engine.legalActions(2)).toEqual([]);
  });

  it('对照组＝锚不动的证人：没挂徽章的同型击杀技照旧自动响、不开格', () => {
    const { engine, firstKill } = sceneWithKill([plainKill('枭斩')]);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.pendingReaction ?? null).toBeNull();
    expect(firstKill.some(e => e.type === 'DRAW')).toBe(true);
  });
});

// ── ③ 刀C 门槛：那三格击杀形状决定"这一刻到底问不问" ──

/**
 * 魏关羽「单骑」原文那三格（你**近战**击杀**战场区域**的角色后，若**所在区域及战场区域内
 * 没有其他己方角色**）的结构化形状。大白话↔结构那一半由 `skillGateText.test.ts` 钉，
 * 这里钉的是"门槛不过＝连那一格都不开"——问窗与自动路同读定义级 conditions 那一句。
 */
const SOLO_KILL_GATES: SkillCondition[] = [
  { metric: 'KILL_BY_MELEE', op: 'EQ', value: 1 },
  { metric: 'VICTIM_IN_BATTLE_AREA', op: 'EQ', value: 1 },
  { metric: 'ALLY_NEAR_OR_BATTLE_COUNT', op: 'EQ', value: 0 },
];

const gatedSingleRider = () => [awakeningKill('单骑', { conditions: SOLO_KILL_GATES })];

const noAsk = (engine: GameEngine) => {
  expect(getReactionAsk(engine.state)).toBeNull();
  expect(engine.state.pendingReaction ?? null).toBeNull();
};

describe('觉醒技 · 刀C 门槛（近战击杀战场角色且身边没有己方，才当场问那一次）', () => {
  it('链式一组继承整组门槛：三格落在定义级 conditions（不落在效果上＝没人读）', () => {
    const { definitions, skipped } = compileSkill(
      { id: 'g1', name: '关羽' }, awakeningKill('单骑', { conditions: SOLO_KILL_GATES }), 'g1');
    expect(skipped).toEqual([]);
    expect(definitions[0].conditions).toEqual(SOLO_KILL_GATES);
    // 对照组：没写门槛的链式定义仍是 undefined⇒既有编译产物逐字不变。
    expect(compileSkill({ id: 'g1', name: '关羽' }, awakeningKill('单骑'), 'g1').definitions[0].conditions)
      .toBeUndefined();
  });

  it('击杀那一声当场记下近战与死者所在区域⇒三格全中，问一次', () => {
    const { engine, firstKill } = sceneWithKill(gatedSingleRider(), { victimZone: 'battle' });
    expect(deathEventOf(firstKill).data).toMatchObject({ ranged: false, targetZone: 'battle' });
    expect(getReactionAsk(engine.state)?.options.map(o => o.skillName)).toEqual(['单骑']);
  });

  it('差"近战"这一格就不问：同一块战场改成远程击杀（射手站自家营地，隔一格才够得着）', () => {
    const { engine, firstKill } = sceneWithKill(gatedSingleRider(), { killerZone: 'camp', victimZone: 'battle', ranged: true });
    expect(deathEventOf(firstKill).data).toMatchObject({ ranged: true, targetZone: 'battle' });
    noAsk(engine);
    expect(firstKill.some(e => e.type === 'SKILL_GAINED')).toBe(false);
  });

  it('差"在战场"这一格就不问：死者与击杀者都站前线（夹具默认那一副）', () => {
    const { engine, firstKill } = sceneWithKill(gatedSingleRider());
    expect(deathEventOf(firstKill).data).toMatchObject({ ranged: false, targetZone: 'front' });
    noAsk(engine);
  });

  it('差"身边没有己方"这一格就不问：同席还有一员将站在战场', () => {
    const { engine, firstKill } = sceneWithKill(gatedSingleRider(), { victimZone: 'battle', allies: 1 });
    expect(deathEventOf(firstKill).type).toBe('DEATH');
    noAsk(engine);
  });

  it('门槛不过是"没到那一刻"，不是"这一枚坏了"：摇头那一格与额度都不受影响', () => {
    // 三格全中⇒问；摇头⇒不落账（刀B 裁决③），同一声击杀再扫一次照旧开格。
    const { engine, firstKill } = sceneWithKill(gatedSingleRider(), { victimZone: 'battle' });
    const ask = getReactionAsk(engine.state)!;
    engine.dispatch(createAction('SKIP_REACTION', ask.playerId, { nodeKey: ask.nodeKey }));
    expect(quotaEntries(engine.state)).toEqual([]);
    expect(syncReactionQueue(engine.state, [deathEventOf(firstKill)]).queue?.nodes).toHaveLength(1);
  });

  it('没有门槛的同一条链式技能照旧"任何击杀都问一次"＝门槛是加上去的那一层，不是换掉的一层', () => {
    const { engine } = sceneWithKill([awakeningKill('单骑')]);
    expect(getReactionAsk(engine.state)?.options.map(o => o.skillName)).toEqual(['单骑']);
  });
});
