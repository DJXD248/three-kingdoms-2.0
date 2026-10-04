/**
 * v2.8.32 限定技额度刀——「一局一次」的四条裁决逐条钉死（用户 2026-10-04 原话）：
 *  ① 每枚技能各一局一次（一个将两枚限定技就能各用一次）；
 *  ② 用完后照常列出、置灰写明「本局已用尽」；
 *  ③ 被无效不退——账本没有任何回退入口，这一条结构性成立（这里钉"没有回退"）；
 *  ④ 没发动成功不消耗（宁可不发，绝不空耗）。
 *
 * 同时钉本刀的另一半：**发动记录三条路共用同一个生产点**。回合结束路今天照旧每
 * 回合落一笔；响应问答路与自动触发路只对**带额度**的定义多落这一笔，所以既有内容
 * 的事件流一字未变（最后一格用不带徽章的对照组钉住这一点）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createInitialEngineState } from '../core/GameState';
import type { EnginePlayer, EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { createAction } from '../action/ActionTypes';
import { resolveTriggerChain } from '../core/EngineDispatchFlow';
import { compileSkill, syncPlayerSkills } from './skillCompiler';
import { listTurnEndAskItems } from './turnEndSkills';
import { getReactionAsk } from './reactionChain';
import {
  LIMIT_EXHAUSTED_TEXT,
  limitedActivationEvent,
  limitedQuotaAvailable,
  skillActivatedEvent,
} from './skillQuota';
import type { General, Skill } from '../data/generals';

// ── 夹具（与 reactionChain.test.ts 同一副形状：真攻击、真事件流） ──

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id, name: '限定将' + id, faction: '魏', hp: 8, type: '武将',
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

function makeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    players: [makePlayer(1, { fieldGenerals: [] }), makePlayer(2, { fieldGenerals: [] })],
    currentPlayerId: 1, turn: 1, round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
      { id: 'deck_4', name: '粮草', type: '粮草' },
      { id: 'deck_5', name: '材料', type: '材料' },
    ],
    discardPile: [], drawState: null,
    ...overrides,
  } as EngineState;
}

const COST_1 = { id: 'cost_1', name: '粮草', type: '粮草' };
const COST_2 = { id: 'cost_2', name: '粮草', type: '粮草' };

function buildEngine(state: EngineState): GameEngine {
  const engine = new GameEngine(state, { recordHistory: false });
  syncPlayerSkills(engine, state);
  return engine;
}

/** 回合结束那一型的限定技。 */
function limitedTurnEnd(name: string, extra: Partial<Skill> = {}): Skill {
  return {
    name, description: `${name}：一局一次，回合结束时摸一张牌`,
    tags: ['限定技'],
    effects: [{
      id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
    ...extra,
  } as Skill;
}

/** 「受到伤害后摸一张牌」，可指定挂徽章／强制发动。 */
function hurtDraw(name: string, extra: Partial<Skill> = {}): Skill {
  return {
    name, description: `${name}：受到伤害后摸一张牌`,
    effects: [{
      id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
    ...extra,
  } as Skill;
}

/** p1 的两员将各打一次 p2 的那一员（第二次用来验"额度已经见底"）。 */
function attackTwice(victim: General): GameEngine {
  const state = makeState({
    players: [
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1, 0), makeFieldGeneral(makeGeneral('g1b', []), 1, 1)],
        hand: [COST_1, COST_2],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ],
  });
  const engine = buildEngine(state);
  engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: COST_1 }));
  return engine;
}

function secondAttack(engine: GameEngine): GameEvent[] {
  return engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1b', targetId: 'g2', ranged: false, consumeCard: COST_2 }));
}

function handOf(engine: GameEngine, playerId: number): number {
  return (engine.state.players.find(p => p.id === playerId)?.hand ?? []).length;
}

// ── ① 编译器：徽章译成额度键 ──

describe('skillCompiler · 限定技徽章译成额度键（裁决①的形状）', () => {
  it('带徽章的单效果定义落 limitKey＝<将领实例>:<技能名>', () => {
    const { definitions } = compileSkill({ id: 'g1', name: '甲' }, limitedTurnEnd('守夜'), 'g1');
    expect(definitions).toHaveLength(1);
    expect(definitions[0].limitKey).toBe('g1:守夜');
  });

  it('不带徽章的定义连键都没有（既有编译产物逐字不变的构造保证）', () => {
    const { definitions } = compileSkill({ id: 'g1', name: '甲' }, limitedTurnEnd('守夜', { tags: undefined, tag: undefined }));
    expect('limitKey' in definitions[0]).toBe(false);
  });

  it('一枚技能编出多个定义时共用同一个键⇒整枚技能只有一次', () => {
    const multi: Skill = {
      name: '双鸣',
      tags: ['限定技'],
      effects: [
        { id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        { id: 'e2', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
      ],
    };
    const { definitions } = compileSkill({ id: 'g1', name: '甲' }, multi, 'g1');
    expect(definitions).toHaveLength(2);
    expect(definitions.map(d => d.id).sort()).toEqual(['g1:双鸣:e1', 'g1:双鸣:e2']);
    expect(new Set(definitions.map(d => d.limitKey)).size).toBe(1);
    expect(definitions[0].limitKey).toBe('g1:双鸣');
  });

  it('同一员将的两枚限定技各有各的键（一个将两枚限定技就能各用一次）', () => {
    const { definitions } = compileGeneralDefinitions([limitedTurnEnd('甲技'), limitedTurnEnd('乙技')]);
    expect(new Set(definitions.map(d => d.limitKey))).toEqual(new Set(['g1:甲技', 'g1:乙技']));
  });

  it('择一组（effectMode choice）继承同一个键：整组择一＝一次发动', () => {
    const group: Skill = {
      name: '取舍',
      tags: ['限定技'],
      effectMode: 'choice',
      effects: [
        { id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        { id: 'e2', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
      ],
    };
    const { definitions } = compileSkill({ id: 'g1', name: '甲' }, group, 'g1');
    expect(definitions).toHaveLength(1);
    expect(definitions[0].choiceMode).toBe(true);
    expect(definitions[0].limitKey).toBe('g1:取舍');
  });

  it('在场即生效那一型不落键——持续生效没有"发动一次"的时刻，落键只会假装管住了它', () => {
    const { definitions } = compileSkill({ id: 'g1', name: '甲' }, {
      name: '常驻',
      tags: ['限定技'],
      effects: [{ id: 'e1', trigger: { type: 'passive' }, runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' } }],
    } as Skill, 'g1');
    expect(definitions).toHaveLength(1);
    expect(definitions[0].passive).toBe(true);
    expect('limitKey' in definitions[0]).toBe(false);
  });
});

function compileGeneralDefinitions(skills: Skill[]) {
  const definitions = skills.flatMap(skill => compileSkill({ id: 'g1', name: '甲' }, skill, 'g1').definitions);
  return { definitions };
}

// ── ② 判据与记账形状（纯函数层） ──

describe('skillQuota · 判据单点与发动账形状', () => {
  const def = { ...skillActivatedFixtureDef() };

  it('不带额度恒为真；带额度时账上同键的任意一笔即为止', () => {
    const state = createInitialEngineState();
    expect(limitedQuotaAvailable(state, { id: 'a', limitKey: undefined } as never)).toBe(true);
    state.consumedSkills = [{ stableId: '3:a', skillId: 'a', turn: 3, playerId: 1, limitKey: 'g:x' }];
    expect(limitedQuotaAvailable(state, { id: 'a', limitKey: 'g:x' } as never)).toBe(false);
    // 跨回合查同一枚技能＝额度的本义：那一笔记在第 3 回合，此刻第 9 回合也一样见底
    state.turn = 9;
    expect(limitedQuotaAvailable(state, { id: 'a', limitKey: 'g:x' } as never)).toBe(false);
    // 别的技能的账不牵连（裁决①的另一半）
    expect(limitedQuotaAvailable(state, { id: 'b', limitKey: 'g:y' } as never)).toBe(true);
  });

  it('链内已用集合：账本还没落、但这条链里已经响过⇒不再第二次放行', () => {
    const state = createInitialEngineState();
    const spent = new Set(['g:x']);
    expect(limitedQuotaAvailable(state, { id: 'a', limitKey: 'g:x' } as never, spent)).toBe(false);
    expect(limitedQuotaAvailable(state, { id: 'b', limitKey: 'g:y' } as never, spent)).toBe(true);
    // 不带额度的定义连这一层都不看
    expect(limitedQuotaAvailable(state, { id: 'c' } as never, spent)).toBe(true);
  });

  it('发动账的形状只有一份：键序与 v2.8.31 逐字一致，带额度才多一个 limitKey', () => {
    const plain = skillActivatedEvent(def, { playerId: 1, generalId: 'g1', turn: 5 });
    expect(Object.keys(plain.data as object)).toEqual(
      ['skillId', 'skillName', 'effectId', 'generalId', 'playerId', 'stableId'],
    );
    expect(plain.data).toMatchObject({ stableId: '5:g1:守夜:e1', effectId: 'e1', playerId: 1 });

    const withQuota = skillActivatedEvent({ ...def, limitKey: 'g1:守夜' }, { playerId: 1, generalId: 'g1', turn: 5 });
    expect(Object.keys(withQuota.data as object)).toEqual(
      ['skillId', 'skillName', 'effectId', 'generalId', 'playerId', 'stableId', 'limitKey'],
    );
  });

  it('该不该落账的两条豁免（裁决④＝什么都没产出就不消耗）', () => {
    const ctx = { playerId: 1, generalId: 'g1', turn: 5 };
    expect(limitedActivationEvent(def, ctx, 1)).toBeNull();
    expect(limitedActivationEvent({ ...def, limitKey: 'g1:守夜' }, ctx, 0)).toBeNull();
    expect(limitedActivationEvent({ ...def, limitKey: 'g1:守夜' }, ctx, 2)?.type).toBe('SKILL_ACTIVATED');
  });
});

function skillActivatedFixtureDef() {
  const { definitions } = compileSkill({ id: 'g1', name: '甲' }, limitedTurnEnd('守夜'), 'g1');
  // 对照组要的是"同一枚定义但不带额度"，所以剥掉键而不是另编一枚（键名相同才比得出形状）
  return { ...definitions[0], limitKey: undefined };
}

// ── ③ 回合结束路 ──

describe('回合结束路 · 一局一次（裁决①②③④全在这一格）', () => {
  function turnEndEngine(skills: Skill[], turn = 5): GameEngine {
    const state = makeState({
      turn,
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g_watch', skills), 1)] }),
        makePlayer(2, { fieldGenerals: [] }),
      ],
    });
    return buildEngine(state);
  }

  const SKILL_ID = 'g_watch:限·守夜:e1';
  const LIMITED = limitedTurnEnd('限·守夜');

  it('发动一笔落 limitKey；同一回合再用＝本回合已发动过；换到下一回合再用＝本局已用尽', () => {
    const engine = turnEndEngine([LIMITED]);
    const act = () => engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: SKILL_ID, generalId: 'g_watch' }));

    expect(act().some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(engine.state.consumedSkills).toEqual([
      { stableId: `5:${SKILL_ID}`, skillId: SKILL_ID, turn: 5, playerId: 1, limitKey: 'g_watch:限·守夜' },
    ]);

    expect(act().some(e => e.type === 'ACTION_REJECTED')).toBe(true);
    engine.state.turn = 6;
    const later = act();
    expect(later.some(e => e.type === 'ACTION_REJECTED' && (e.data as { reason?: string }).reason === 'SKILL_LIMIT_EXHAUSTED')).toBe(true);
    // 台账不回退、也不重复落笔（裁决③：没有任何退额度的入口）
    expect(engine.state.consumedSkills).toHaveLength(1);
  });

  it('对照：不带徽章的同一枚技能下一回合照样能发动（旧行为一字未变）', () => {
    const engine = turnEndEngine([limitedTurnEnd('限·守夜', { tags: undefined, tag: undefined })]);
    const act = () => engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: SKILL_ID, generalId: 'g_watch' }));
    expect(act().some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    engine.state.turn = 6;
    expect(act().some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(engine.state.consumedSkills).toHaveLength(2);
  });

  it('用尽之后：合法集合里消失、完整模式照常列出但置灰写明「本局已用尽」', () => {
    const state = makeState({
      turn: 6,
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g_watch', [LIMITED]), 1)] }),
        makePlayer(2, { fieldGenerals: [] }),
      ],
      consumedSkills: [{
        stableId: `5:${SKILL_ID}`, skillId: SKILL_ID, turn: 5, playerId: 1, limitKey: 'g_watch:限·守夜',
      }],
    });
    const items = listTurnEndAskItems(state, 1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ activatable: false, disabledReason: LIMIT_EXHAUSTED_TEXT });
    expect(buildEngine(state).legalActions(1).some(a => a.type === 'ACTIVATE_SKILL')).toBe(false);
  });

  it('刚在**本回合**用掉：置灰说「本局已用尽」而不是「本回合已发动过」（闸③更正）', () => {
    // 两句话此刻都真，但说轻的那一句会把"到终局都没有"讲成"下一回合还有"。
    const state = makeState({
      turn: 5,
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g_watch', [LIMITED]), 1)] }),
        makePlayer(2, { fieldGenerals: [] }),
      ],
      consumedSkills: [{
        stableId: `5:${SKILL_ID}`, skillId: SKILL_ID, turn: 5, playerId: 1, limitKey: 'g_watch:限·守夜',
      }],
    });
    const items = listTurnEndAskItems(state, 1);
    expect(items[0]).toMatchObject({ activatable: false, disabledReason: LIMIT_EXHAUSTED_TEXT });
  });

  it('同一枚技能编出的两个定义共用一份额度：用了 e1，e2 也不再可发动（裁决①）', () => {
    const multi: Skill = {
      name: '双鸣',
      tags: ['限定技'],
      effects: [
        { id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        { id: 'e2', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
      ],
    };
    const engine = turnEndEngine([multi]);
    expect(engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: 'g_watch:双鸣:e1', generalId: 'g_watch' }))
      .some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    engine.state.turn = 6;
    const second = engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: 'g_watch:双鸣:e2', generalId: 'g_watch' }));
    expect(second.some(e => e.type === 'ACTION_REJECTED' && (e.data as { reason?: string }).reason === 'SKILL_LIMIT_EXHAUSTED')).toBe(true);
  });
});

// ── ④ 响应问答路 ──

describe('响应问答路 · 发动也进同一本账（本刀更正的那半句旧口径）', () => {
  it('点头＝SKILL_ACTIVATED＋REACTION_ANSWERED＋效果，账上带 limitKey', () => {
    const engine = attackTwice(makeGeneral('g2', [hurtDraw('限·奸雄', { tags: ['限定技'] })]));
    const ask = getReactionAsk(engine.state)!;
    expect(ask.options.map(o => o.skillId)).toEqual(['g2:限·奸雄:e1']);

    const events = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(events.some(e => e.type === 'REACTION_ANSWERED')).toBe(true);
    const activation = events.find(e => e.type === 'SKILL_ACTIVATED');
    expect(activation?.data).toMatchObject({
      skillId: 'g2:限·奸雄:e1', skillName: '限·奸雄', playerId: 2,
      stableId: '1:g2:限·奸雄:e1', limitKey: 'g2:限·奸雄',
    });
    expect(engine.state.consumedSkills).toHaveLength(1);
    expect(handOf(engine, 2)).toBe(1);
  });

  it('用过之后下一格不再被问、也不再摸牌；合法动作里没有它', () => {
    const engine = attackTwice(makeGeneral('g2', [hurtDraw('限·奸雄', { tags: ['限定技'] })]));
    const ask = getReactionAsk(engine.state)!;
    engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));

    const before = handOf(engine, 2);
    const events = secondAttack(engine);
    // 第二刀的伤照旧落（受击方hp下降），只是那一格压根不开：候选枚举在门槛处就把
    // 额度见底的定义跳掉了。
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
    expect(handOf(engine, 2)).toBe(before);
  });

  it('跳过不消耗额度（不发动就不是"发动了一次技能"）——下一格照旧被问', () => {
    const engine = attackTwice(makeGeneral('g2', [hurtDraw('限·奸雄', { tags: ['限定技'] })]));
    const ask = getReactionAsk(engine.state)!;
    const skipped = engine.dispatch(createAction('SKIP_REACTION', ask.playerId, { nodeKey: ask.nodeKey }));
    expect(skipped.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);

    const events = secondAttack(engine);
    expect(getReactionAsk(engine.state)).not.toBeNull();
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
  });

  it('对照：不带徽章的响应技仍然一字不记 SKILL_ACTIVATED（既有事件流不动）', () => {
    const engine = attackTwice(makeGeneral('g2', [hurtDraw('奸雄')]));
    const ask = getReactionAsk(engine.state)!;
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);
  });
});

// ── ⑤ 自动触发路 ──

describe('自动触发路 · 一局一次', () => {
  const forcedLimited = () => hurtDraw('限·刚烈', { tags: ['限定技'], forced: true });

  it('第一声自动响＝SKILL_ACTIVATED＋效果，账上带 limitKey', () => {
    const engine = attackTwice(makeGeneral('g2', [forcedLimited()]));
    expect(engine.state.consumedSkills).toEqual([
      expect.objectContaining({ skillId: 'g2:限·刚烈:e1', limitKey: 'g2:限·刚烈' }),
    ]);
    expect(handOf(engine, 2)).toBe(1);
  });

  it('第二声不再响（跨 dispatch 读账本）', () => {
    const engine = attackTwice(makeGeneral('g2', [forcedLimited()]));
    const before = handOf(engine, 2);
    const events = secondAttack(engine);
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
    expect(handOf(engine, 2)).toBe(before);
    expect(engine.state.consumedSkills).toHaveLength(1);
  });

  it('对照：不带徽章的强制技照旧每一声都响、也不落账', () => {
    const engine = attackTwice(makeGeneral('g2', [hurtDraw('刚烈', { forced: true })]));
    const firstHand = handOf(engine, 2);
    expect(firstHand).toBe(1);
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);
    secondAttack(engine);
    expect(handOf(engine, 2)).toBe(2);
  });
});

// ── ⑥ 链级守卫（合成输入：钉的是这条链的守卫本身，不是某条真实流程） ──

describe('同一条触发链内两声命中只结一次', () => {
  /** 合成输入的如实说明：真实内容里今天还没有"同一批两声 INJURY 打在同一员将身上"
   *  的那条流程，所以这一格直接喂 `resolveTriggerChain` 两声。它钉的是"展开期间读的是
   *  落账前的同一个 state"这一处守卫，不是流程可达性。 */
  function injury(targetId: string, seq: number): GameEvent {
    return {
      id: `inj_${seq}`,
      type: 'INJURY',
      data: {
        targetPlayerId: 2, targetId, sourcePlayerId: 1, sourceGeneralId: 'g1',
        damageType: 'attack', value: 1, hpLost: 1, armorLost: 0,
      },
    };
  }

  it('两声命中同一枚限定技⇒只落一笔发动账、只结一次效果', () => {
    const state = makeState({
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)] }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [hurtDraw('限·刚烈', { tags: ['限定技'], forced: true })]), 2)] }),
      ],
    });
    const engine = buildEngine(state);
    const expanded = resolveTriggerChain(engine.state, engine.triggers, [injury('g2', 1), injury('g2', 2)]);
    expect(expanded.filter(e => e.type === 'SKILL_ACTIVATED')).toHaveLength(1);
    expect(expanded.filter(e => e.type === 'DRAW')).toHaveLength(1);
  });

  it('不带额度的同一枚技能在两声里各结一次（守卫只拦带额度的）', () => {
    const state = makeState({
      players: [
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)] }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [hurtDraw('刚烈', { forced: true })]), 2)] }),
      ],
    });
    const engine = buildEngine(state);
    const expanded = resolveTriggerChain(engine.state, engine.triggers, [injury('g2', 1), injury('g2', 2)]);
    expect(expanded.filter(e => e.type === 'DRAW')).toHaveLength(2);
    expect(expanded.filter(e => e.type === 'SKILL_ACTIVATED')).toHaveLength(0);
  });
});
