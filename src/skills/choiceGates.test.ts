/**
 * v2.8.11 刀2「选择其一」的门槛 — 两级门槛在选择路上的端到端行为。
 *
 * 用户 2026-09-29 口径：①不过门槛的选项**置灰可见并写明原因**（技能信息本来
 * 就应该对玩家完全公开）；③**先判整组门槛、再判逐项门槛**；条件择一（罪论/
 * 父荫那种）也走弹窗（A 案），不自动替玩家定分支。
 *
 * 本文件只走唯一真链（syncPlayerSkills → 桥接层 → canonical 动作 → 解析器），
 * 不旁路引擎；RNG 一律零消费（择定步才结算）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createInitialEngineState } from '../core/GameState';
import type { EngineState } from '../core/GameState';
import { createAction } from '../action/ActionTypes';
import { syncPlayerSkills } from '../skills/skillCompiler';
import type { General, Skill, SkillEffect } from '../data/generals';

const OWNER_GENERAL_ID = 'g_gate';
const CHOICE_ID = `${OWNER_GENERAL_ID}:演練・择一门槛:choice`;

const handEq = (value: number): SkillEffect['conditions'] => [{ metric: 'HAND_COUNT', subject: 'SELF', op: 'EQ', value }];
const handGte = (value: number): SkillEffect['conditions'] => [{ metric: 'HAND_COUNT', subject: 'SELF', op: 'GTE', value }];

function choiceSkill(effects: SkillEffect[], groupGate?: Skill['conditions']): Skill {
  return {
    name: '演練・择一门槛',
    description: '回合结束时二选一',
    effectMode: 'choice',
    conditions: groupGate,
    effects,
  };
}

const SELF_TURN = { type: 'onTurnEnd', turnSubType: 'selfTurn' } as const;

function generalWith(skill: Skill): General {
  return {
    id: OWNER_GENERAL_ID, instanceId: OWNER_GENERAL_ID, name: '门槛将', faction: '魏',
    hp: 3, type: '武将', meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [skill],
  } as unknown as General;
}

function fieldOf(general: General, ownerId: number) {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [], isArming: false,
    hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone: 'camp', slot: 0, areaOwnerId: ownerId },
  };
}

/** 手牌张数由用例决定；牌堆 4 张（守恒校验用）。 */
function makeState(handSize: number, skill: Skill, overrides: Partial<EngineState> = {}): EngineState {
  const state = createInitialEngineState();
  const general = generalWith(skill);
  state.players = [
    {
      id: 1, name: 'P1', fieldGenerals: [fieldOf(general, 1)],
      hand: Array.from({ length: handSize }, (_, i) => ({ id: `h${i}`, name: '手令', type: '材料' })),
    } as never,
    { id: 2, name: 'P2', hand: [], fieldGenerals: [] } as never,
  ];
  state.currentPlayerId = 1;
  state.phase = 'playing';
  state.timelinePhase = 'ACTION';
  state.turn = 5;
  state.round = 2;
  state.deck = [
    { id: 'd1', name: '粮草', type: '粮草' },
    { id: 'd2', name: '材料', type: '材料' },
    { id: 'd3', name: '军备', type: '军备' },
    { id: 'd4', name: '粮草', type: '粮草' },
  ];
  return { ...state, ...overrides };
}

function engineFor(handSize: number, skill: Skill, overrides: Partial<EngineState> = {}): GameEngine {
  const state = makeState(handSize, skill, overrides);
  const engine = new GameEngine(state, { recordHistory: false });
  syncPlayerSkills(engine, state);
  return engine;
}

const activate = (engine: GameEngine) =>
  engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: CHOICE_ID, generalId: OWNER_GENERAL_ID }));

describe('刀2 · 选择其一的逐项门槛（置灰可见）', () => {
  const mixed = () => choiceSkill([
    { id: 'a', description: '空手才摸牌', trigger: SELF_TURN, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' }, conditions: handEq(0) },
    { id: 'b', description: '有牌才拆装备', trigger: SELF_TURN, runtime: { type: 'EQUIP_STRIP', value: 1, target: 'TARGET' }, conditions: handGte(1) },
  ]);

  it('手牌=0：两项都列出，不过门槛的那项标 enabled=false 并带大白话原因', () => {
    const engine = engineFor(0, mixed());
    const events = activate(engine);
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
    const required = events.find(e => e.type === 'CHOICE_REQUIRED');
    const options = (required?.data as never as { options: Record<string, unknown>[] }).options;
    expect(options).toHaveLength(2);
    // 过门槛的选项：一个多余键都不加（无门槛组的录像态形状逐字不变）
    expect(Object.keys(options[0]).sort()).toEqual(['events', 'label']);
    // 不过门槛的选项：仍在原位、仍可见，只是灰的
    expect(options[1]).toMatchObject({ label: '有牌才拆装备', enabled: false, gateText: '手牌≥1' });
  });

  it('置灰项不是合法动作：legalActions 只枚举可选项，硬点灰项被解析器拒绝', () => {
    const engine = engineFor(0, mixed());
    activate(engine);
    const pending = engine.state.pendingChoice!;
    expect(pending.options[1].enabled).toBe(false);

    const debtor = engine.legalActions(1);
    expect(debtor.map(a => (a.payload as never as { optionIndex: number }).optionIndex)).toEqual([0]);

    const grey = engine.dispatch(createAction('CHOOSE_OPTION', 1, { choiceKey: pending.key, optionIndex: 1 }));
    expect((grey.find(e => e.type === 'ACTION_REJECTED')?.data as never as { reason: string }).reason)
      .toContain('CHOICE_OPTION_LOCKED');
    // 拒收不动账：债还在、世界仍冻结，玩家还能择可选项
    expect(engine.state.pendingChoice).toMatchObject({ key: pending.key });
  });

  it('择定可选项照常结算（灰项不影响活项）', () => {
    const engine = engineFor(0, mixed());
    activate(engine);
    const pending = engine.state.pendingChoice!;
    const before = structuredClone(engine.state.rngState);
    const events = engine.dispatch(createAction('CHOOSE_OPTION', 1, { choiceKey: pending.key, optionIndex: 0 }));
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
    expect(engine.state.pendingChoice).toBeNull();
    expect(engine.state.rngState).toEqual(before); // 开账与清账本身零随机
    expect(engine.state.players[0].hand).toHaveLength(1);
  });

  it('全部门槛都不过⇒不开窗，也绝不白扣这一次发动（防死桌/防空转）', () => {
    const allFail = choiceSkill([
      { id: 'a', description: '至少2张', trigger: SELF_TURN, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' }, conditions: handGte(2) },
      { id: 'b', description: '至少3张', trigger: SELF_TURN, runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' }, conditions: handGte(3) },
    ]);
    const engine = engineFor(0, allFail);
    const events = activate(engine);
    expect(events.some(e => e.type === 'CHOICE_REQUIRED')).toBe(false);
    expect((events.find(e => e.type === 'ACTION_REJECTED')?.data as never as { reason: string }).reason)
      .toContain('SKILL_CONDITION_UNMET');
    // 没有"发动了却什么都没发生"的账
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);
    expect(engine.state.pendingChoice ?? null).toBeNull();
    // 上一条单独看是半恒真（字段缺席也过），所以补一枚会咬人的判据：
    // 再点一次必须拿到**同一句**拒绝。若第一次真被记账，第二次会换成
    // SKILL_ALREADY_ACTIVATED（解析器第 56 行那道门在门槛门之前）。
    const again = activate(engine);
    const againReason = (again.find(e => e.type === 'ACTION_REJECTED')?.data as never as { reason: string }).reason;
    expect(againReason).toContain('SKILL_CONDITION_UNMET');
    expect(againReason).not.toContain('SKILL_ALREADY_ACTIVATED');
  });

  it('没有门槛的选择组：选项形状与 v2.8.10 逐字一致（无 enabled/gateText）', () => {
    const ungated = choiceSkill([
      { id: 'a', description: '摸一张', trigger: SELF_TURN, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
      { id: 'b', description: '回复一点', trigger: SELF_TURN, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
    ]);
    const engine = engineFor(0, ungated);
    activate(engine);
    const pending = engine.state.pendingChoice!;
    expect(pending.options.every(o => o.enabled === undefined && o.gateText === undefined)).toBe(true);
    expect(engine.legalActions(1)).toHaveLength(2);
  });
});

describe('刀2 · 整组门槛先判、逐项门槛后判', () => {
  const groupGate = [{ metric: 'GENERAL_HP', subject: 'SELF', op: 'LTE', value: 0 }] as Skill['conditions'];

  it('整组门槛不过⇒这一刻连窗都不开（逐项根本不参与）', () => {
    const gated = choiceSkill([
      { id: 'a', description: '摸一张', trigger: SELF_TURN, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
      { id: 'b', description: '回复一点', trigger: SELF_TURN, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
    ], groupGate);
    const engine = engineFor(0, gated);
    const events = activate(engine);
    expect(events.some(e => e.type === 'CHOICE_REQUIRED')).toBe(false);
    expect((events.find(e => e.type === 'ACTION_REJECTED')?.data as never as { reason: string }).reason)
      .toContain('SKILL_CONDITION_UNMET');
  });

  it('整组门槛过＋逐项全不过⇒仍不开窗（两级都在场，顺序不影响结论）', () => {
    const gated = choiceSkill([
      { id: 'a', description: '至少2张', trigger: SELF_TURN, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' }, conditions: handGte(2) },
      { id: 'b', description: '至少3张', trigger: SELF_TURN, runtime: { type: 'HEAL', value: 1, target: 'SELF' }, conditions: handGte(3) },
    ], [{ metric: 'FIELD_GENERAL_COUNT', subject: 'SELF', op: 'GTE', value: 1 }]);
    const engine = engineFor(0, gated);
    const events = activate(engine);
    expect(events.some(e => e.type === 'CHOICE_REQUIRED')).toBe(false);
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);
  });

  it('整组门槛过、只有一项过⇒开窗且灰掉那一项（灰的不是删）', () => {
    const gated = choiceSkill([
      { id: 'a', description: '至少2张', trigger: SELF_TURN, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' }, conditions: handGte(2) },
      { id: 'b', description: '空手才回复', trigger: SELF_TURN, runtime: { type: 'HEAL', value: 1, target: 'SELF' }, conditions: handEq(0) },
    ], [{ metric: 'FIELD_GENERAL_COUNT', subject: 'SELF', op: 'GTE', value: 1 }]);
    const engine = engineFor(0, gated);
    activate(engine);
    const pending = engine.state.pendingChoice!;
    expect(pending.options.map(o => o.enabled)).toEqual([false, undefined]);
    expect(pending.options[0].gateText).toBe('手牌≥2');
    // 可选项只剩 1 个：合法动作也只有一条
    expect(engine.legalActions(1).map(a => (a.payload as never as { optionIndex: number }).optionIndex)).toEqual([1]);
  });
});
