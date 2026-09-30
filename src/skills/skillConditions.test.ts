/**
 * 2.7.3 自定义条件门槛谓词首批六枚（非内容刀：只立词汇与求值、内置零转正）。
 *
 * 十二格表见 PROJECT_ARCH_MAP §F。条件=纯门槛谓词：零事件、零状态写、零随机，
 * 叠在身份面之后回答"这条监听到底该不该响"；任一度量解析不出即 fail-closed
 * （不响=诚实，凭无法验证的前提响=发明玩法）。
 *
 * 接线两路共用同一实现（skills/skillConditions.ts，全库唯此一份）：
 *   ① 触发路 SkillTriggerBridge.buildCondition（10 枚触发键同一道闸）；
 *   ② 决策路 turnEndSkills.listTurnEndSkillCandidates 过滤候选 + TurnEndSkillResolver
 *      独立再求值并给诚实拒因 SKILL_CONDITION_UNMET。
 *
 * 本文件的探针方式仍是编译 seam（vi.mock 包住 compileGeneralSkills），理由是它要
 * 逐条验证两路求值的语义，与录入面无关。v2.8.3 起门槛已有录入面：数据层
 * SkillEffect.conditions + SkillEditor 门槛栏 + Excel 效果组「门槛」列（第七列），
 * 文本↔结构互译在 skills/skillGateText.ts，编译器逐效果透传（见 skillCompiler
 * 门槛透传测试）。"接线≠可配"的旧预防针只对 2.7.3 当时的树成立，不再适用于当前版本。
 */
import { describe, it, expect, vi } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { createAction } from '../action/ActionTypes';
import type { General, Skill } from '../data/generals';
import type { GameCard } from '../data/cards';
import type { DataSkillDefinition, SkillCondition } from './dataTypes';
import { evaluateSkillCondition, evaluateSkillConditions } from './skillConditions';
import type { SkillConditionFacts } from './skillConditions';
import { listAllTurnEndDefinitions, listTurnEndSkillCandidates } from './turnEndSkills';
import { compileGeneralSkills } from './skillCompiler';

/** 编译 seam：给 sc_actor 的编译产物挂上门槛——本文件用它逐条钉两路求值语义，
 *  不依赖录入面（v2.8.3 起数据层/编辑器/Excel 已可写门槛，透传由 skillCompiler 测试守）。 */
const probe = vi.hoisted(() => ({ conditions: undefined as SkillCondition[] | undefined }));

vi.mock('./skillCompiler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./skillCompiler')>();
  return {
    ...actual,
    compileGeneralSkills: (
      general: Parameters<typeof actual.compileGeneralSkills>[0],
      runtimeGeneralId?: string,
    ) => {
      const result = actual.compileGeneralSkills(general, runtimeGeneralId);
      if (!probe.conditions || general.id !== 'sc_actor') return result;
      return {
        ...result,
        definitions: result.definitions.map(d => ({ ...d, conditions: probe.conditions })),
      };
    },
  };
});

function makeGeneral(id: string, name: string, hp: number, meleeAtk = 2): General {
  return {
    id, instanceId: id, name, faction: '魏', hp, type: '武将',
    meleeAtk, rangedAtk: 1, armor: 0, skills: [],
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
    armorCards: [] as GameCard[],
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
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
    ...overrides,
  };
}

function makeState(players: EnginePlayer[], overrides: Partial<EngineState> = {}): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: [
      { id: 'sc_deck_1', name: '粮草', type: '粮草' },
      { id: 'sc_deck_2', name: '材料', type: '材料' },
    ],
    discardPile: [], drawState: null,
    ...overrides,
  };
}

function makeCard(id: string): GameCard {
  return { id, name: '粮草', type: '粮草' } as GameCard;
}

function factsWithEvent(data: Record<string, unknown>): SkillConditionFacts {
  return { state: factsTable(), ownerId: 1, sourceGeneralId: 'sc_a', event: makeEvent(data) };
}

function makeEvent(data: Record<string, unknown>): GameEvent {
  return { id: 'sc_ev_1', type: 'DAMAGE', data, timestamp: 0 } as GameEvent;
}

/** 场面：座 1 持甲（手 1 张、护甲 2 点、血 5），座 2 持乙丙丁三将（手空）。 */
function factsTable(): EngineState {
  const armor = makeFieldGeneral(makeGeneral('sc_a', '甲', 5), 1, 0);
  armor.currentArmor = 2;
  return makeState([
    makePlayer(1, { hand: [makeCard('sc_h_1')], fieldGenerals: [armor] }),
    makePlayer(2, { fieldGenerals: [
      makeFieldGeneral(makeGeneral('sc_b', '乙', 3), 2, 0),
      makeFieldGeneral(makeGeneral('sc_c', '丙', 3), 2, 1),
      makeFieldGeneral(makeGeneral('sc_d', '丁', 3), 2, 2),
    ] }),
  ]);
}

const gate = (condition: SkillCondition, facts: SkillConditionFacts) =>
  evaluateSkillCondition(condition, facts);

describe('v2.7.3 纯求值：六度量 × 三主体 × 五算子 · fail-closed', () => {
  it('SELF 轴各读各的账：手牌数 / 在场将数 / 牌堆数 / 本体血 / 护甲点', () => {
    const state = factsTable();
    const facts: SkillConditionFacts = { state, ownerId: 1, sourceGeneralId: 'sc_a' };
    expect(gate({ metric: 'HAND_COUNT', op: 'EQ', value: 1 }, facts)).toBe(true);
    expect(gate({ metric: 'FIELD_GENERAL_COUNT', op: 'EQ', value: 1 }, facts)).toBe(true);
    expect(gate({ metric: 'DECK_COUNT', op: 'LTE', value: 2 }, facts)).toBe(true);
    expect(gate({ metric: 'GENERAL_HP', op: 'EQ', value: 5 }, facts)).toBe(true);
    expect(gate({ metric: 'ARMOR_POINTS', op: 'GTE', value: 2 }, facts)).toBe(true);
    // 换座位=换一套账（贞烈/节命类代价门槛的主体轴）
    expect(gate({ metric: 'HAND_COUNT', op: 'EQ', value: 0 }, { ...facts, ownerId: 2 })).toBe(true);
    expect(gate({ metric: 'FIELD_GENERAL_COUNT', op: 'EQ', value: 3 }, { ...facts, ownerId: 2 })).toBe(true);
  });

  it('GENERAL_HP / ARMOR_POINTS 认本体将：无 sourceGeneralId 或该将不在场=闭', () => {
    const state = factsTable();
    expect(gate({ metric: 'GENERAL_HP', op: 'EQ', value: 5 }, { state, ownerId: 1 })).toBe(false);
    expect(gate({ metric: 'ARMOR_POINTS', op: 'EQ', value: 2 }, { state, ownerId: 1, sourceGeneralId: 'nope' })).toBe(false);
    // 座位级度量不依赖具体将
    expect(gate({ metric: 'HAND_COUNT', op: 'GTE', value: 1 }, { state, ownerId: 1 })).toBe(true);
  });

  it('TARGET 轴三级寻址（targetId/target/victimId），无将可寻退 targetPlayerId，两头都空=闭', () => {
    expect(gate({ metric: 'GENERAL_HP', subject: 'TARGET', op: 'EQ', value: 3 },
      factsWithEvent({ targetId: 'sc_c' }))).toBe(true);
    expect(gate({ metric: 'GENERAL_HP', subject: 'TARGET', op: 'EQ', value: 3 },
      factsWithEvent({ target: 'sc_c' }))).toBe(true);
    expect(gate({ metric: 'GENERAL_HP', subject: 'TARGET', op: 'EQ', value: 3 },
      factsWithEvent({ victimId: 'sc_c' }))).toBe(true);
    // 将寻不到，但座位寻得到→座位级度量仍可读
    expect(gate({ metric: 'HAND_COUNT', subject: 'TARGET', op: 'EQ', value: 1 },
      factsWithEvent({ victimId: 'no_such', targetPlayerId: 1 }))).toBe(true);
    // 两头皆空：连 GTE 0 都不成立（fail-closed 不是"取零"）
    expect(gate({ metric: 'HAND_COUNT', subject: 'TARGET', op: 'GTE', value: 0 },
      factsWithEvent({}))).toBe(false);
  });

  it('ATTACKER 轴四级寻址（含嵌套 action.payload.attackerId），与 choice 枚举的 isAlive 出局互不干涉', () => {
    expect(gate({ metric: 'GENERAL_HP', subject: 'ATTACKER', op: 'EQ', value: 5 },
      factsWithEvent({ attackerId: 'sc_a' }))).toBe(true);
    expect(gate({ metric: 'HAND_COUNT', subject: 'ATTACKER', op: 'EQ', value: 1 },
      factsWithEvent({ action: { payload: { attackerId: 'sc_a' } } }))).toBe(true);
    expect(gate({ metric: 'HAND_COUNT', subject: 'ATTACKER', op: 'EQ', value: 1 },
      factsWithEvent({ sourceGeneralId: 'sc_a' }))).toBe(true);
    // 座位阵亡但将仍在场：度量读的是在场账（isAlive 只用于候选枚举）
    const dead = factsTable();
    dead.players[0].isAlive = false;
    expect(gate({ metric: 'GENERAL_HP', subject: 'ATTACKER', op: 'GTE', value: 5 }, {
      state: dead, ownerId: 2, sourceGeneralId: 'sc_b', event: makeEvent({ attackerId: 'sc_a' }),
    })).toBe(true);
  });

  it('EVENT_VALUE：value 优先、count 次之，非数即闭；无事件（ACTIVATE_SKILL 路）恒闭', () => {
    expect(gate({ metric: 'EVENT_VALUE', op: 'GTE', value: 2 }, factsWithEvent({ value: 2 }))).toBe(true);
    expect(gate({ metric: 'EVENT_VALUE', op: 'EQ', value: 3 }, factsWithEvent({ count: 3 }))).toBe(true);
    expect(gate({ metric: 'EVENT_VALUE', op: 'EQ', value: 2 }, factsWithEvent({ value: 2, count: 9 }))).toBe(true);
    expect(gate({ metric: 'EVENT_VALUE', op: 'GTE', value: 0 }, factsWithEvent({ value: 'two' }))).toBe(false);
    expect(gate({ metric: 'EVENT_VALUE', op: 'GTE', value: 0 },
      { state: factsTable(), ownerId: 1 })).toBe(false);
  });

  it('五算子边界逐字：LT/LTE/EQ/GTE/GT 在 3 的两侧各得其所', () => {
    const facts: SkillConditionFacts = { state: factsTable(), ownerId: 2 }; // 座 2 三将在场
    const ops = ['LT', 'LTE', 'EQ', 'GTE', 'GT'] as const;
    expect(ops.map(op => gate({ metric: 'FIELD_GENERAL_COUNT', op, value: 3 }, facts)))
      .toEqual([false, true, true, true, false]);
    expect(ops.map(op => gate({ metric: 'FIELD_GENERAL_COUNT', op, value: 2 }, facts)))
      .toEqual([false, false, false, true, true]);
    expect(ops.map(op => gate({ metric: 'FIELD_GENERAL_COUNT', op, value: 4 }, facts)))
      .toEqual([true, true, false, false, false]);
  });

  it('compareTo：右端换度量（伤逝差值形态）、缺省沿左端主体、优先于 value、右端解析不出即闭', () => {
    const facts: SkillConditionFacts = { state: factsTable(), ownerId: 1, sourceGeneralId: 'sc_a' };
    expect(gate({ metric: 'GENERAL_HP', op: 'GT', compareTo: { metric: 'HAND_COUNT' } }, facts)).toBe(true);
    // 右端主体显式换 target（血 5 vs 丙的血 3）
    expect(gate({ metric: 'GENERAL_HP', op: 'GT', compareTo: { metric: 'GENERAL_HP', subject: 'TARGET' } },
      factsWithEvent({ targetId: 'sc_c' }))).toBe(true);
    expect(gate({ metric: 'GENERAL_HP', op: 'LTE', compareTo: { metric: 'GENERAL_HP', subject: 'TARGET' } },
      factsWithEvent({ targetId: 'sc_c' }))).toBe(false);
    // compareTo 优先：value 那条本该成立，右端（座 2 手牌 0）不成立⇒整条闭
    expect(gate({ metric: 'HAND_COUNT', op: 'EQ', value: 1, compareTo: { metric: 'DECK_COUNT' } },
      { state: factsTable(), ownerId: 1 })).toBe(false);
    expect(gate({ metric: 'HAND_COUNT', op: 'GT', compareTo: { metric: 'EVENT_VALUE' } }, facts)).toBe(false);
  });

  it('AND 数组语义 + 空数组/缺省=无闸（内置零载荷⇒v2.7.2 之前行为逐字不变的结构性保证）', () => {
    const facts: SkillConditionFacts = { state: factsTable(), ownerId: 1, sourceGeneralId: 'sc_a' };
    expect(evaluateSkillConditions(undefined, facts)).toBe(true);
    expect(evaluateSkillConditions([], facts)).toBe(true);
    expect(evaluateSkillConditions([
      { metric: 'HAND_COUNT', op: 'GTE', value: 1 },
      { metric: 'GENERAL_HP', op: 'LTE', value: 5 },
      { metric: 'DECK_COUNT', op: 'GTE', value: 0 },
    ], facts)).toBe(true);
    expect(evaluateSkillConditions([
      { metric: 'HAND_COUNT', op: 'GTE', value: 1 },
      { metric: 'GENERAL_HP', op: 'GTE', value: 6 }, // 一枚不成立=整条不成立
    ], facts)).toBe(false);
  });

  it('fail-closed 全谱：未知度量 / 缺右端 / 非有限数 / 座位不存在 / 未知算子，一律不响', () => {
    const facts: SkillConditionFacts = { state: factsTable(), ownerId: 404 };
    expect(gate({ metric: 'NOT_A_METRIC' as never, op: 'GTE', value: 0 }, facts)).toBe(false);
    expect(gate({ metric: 'HAND_COUNT', op: 'GTE' } as never, facts)).toBe(false);
    expect(gate({ metric: 'HAND_COUNT', op: 'GTE', value: NaN }, facts)).toBe(false);
    expect(gate({ metric: 'HAND_COUNT', op: 'GTE', value: Infinity }, facts)).toBe(false);
    expect(gate({ metric: 'HAND_COUNT', op: 'BETWEEN' as never, value: 1 }, facts)).toBe(false);
    expect(gate({ metric: 'HAND_COUNT', op: 'GTE', value: 0 }, { state: factsTable(), ownerId: 1 })).toBe(true);
    expect(gate({ metric: 'GENERAL_HP', op: 'GTE', value: 0 }, facts)).toBe(false);
  });

  it('纯函数钉：直接调求值前后 state 逐字节一致（零事件、零状态写、零随机）', () => {
    const state = factsTable();
    const before = JSON.stringify(state);
    const conditions: SkillCondition[] = [
      { metric: 'HAND_COUNT', op: 'GTE', value: 1 },
      { metric: 'GENERAL_HP', subject: 'TARGET', op: 'LTE', value: 3 },
      { metric: 'EVENT_VALUE', op: 'GTE', value: 1 },
      { metric: 'HAND_COUNT', op: 'GT', compareTo: { metric: 'GENERAL_HP' } },
    ];
    for (const condition of conditions) {
      evaluateSkillCondition(condition, { state, ownerId: 1, sourceGeneralId: 'sc_a', event: makeEvent({ targetId: 'sc_b', value: 2 }) });
    }
    evaluateSkillConditions(conditions, { state, ownerId: 1, sourceGeneralId: 'sc_a' });
    expect(JSON.stringify(state)).toBe(before);
    expect(state.rngState).toBeUndefined();
  });
});

/** 触发路探针：条件只存在于编译模型层，唯一入口=engine.registerPlayerSkills。 */
function gatedTurnStart(overrides: Partial<DataSkillDefinition> = {}): DataSkillDefinition {
  return {
    id: 'sc_turn_1', name: '闸·手牌', trigger: 'onTurnStart',
    description: '手牌数达门槛才摸一张',
    effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    sourceGeneralId: 'sc_gate_self',
    ...overrides,
  };
}

/** 座 2 的 onTurnStart 技能：座 1 结束回合即触发；返回派发前快照供纯度对比。 */
function condTable(conds: SkillCondition[] | undefined, hand: GameCard[] = []) {
  const engine = new GameEngine(makeState([
    makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('sc_plain', '路人', 4), 1, 0)] }),
    makePlayer(2, {
      hand: [...hand],
      fieldGenerals: [makeFieldGeneral(makeGeneral('sc_gate_self', '闸主', 4), 2, 0)],
    }),
  ]));
  engine.registerPlayerSkills(2, [gatedTurnStart({ conditions: conds })]);
  const before = JSON.stringify(engine.state);
  const events = engine.dispatch(createAction('END_TURN', 1));
  return { engine, events, before };
}

const GATE_DRAW = (events: GameEvent[]) => events.filter(e =>
  e.type === 'DRAW' && (e.data as Record<string, unknown>).skillId === 'sc_turn_1');

describe('v2.7.3 触发路接线：真引擎门槛闸（身份面之后、效果翻译之前）', () => {
  it('门槛不过=零事件、不锁桌、回合照常推进；过了才见技能 DRAW', () => {
    const closed = condTable([{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }]);
    expect(GATE_DRAW(closed.events)).toHaveLength(0);
    expect(closed.engine.state.currentPlayerId).toBe(2);
    expect(closed.engine.state.players[1].hand).toHaveLength(0);

    const open = condTable([{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }], [makeCard('sc_hand_1')]);
    expect(GATE_DRAW(open.events)).toHaveLength(1);
    expect(open.engine.state.players[1].hand).toHaveLength(2);
  });

  it('闸不碰事实：闭闸派发后手牌/牌堆/弃堆/rngState 分毫未动，回合照常推进', () => {
    const { engine, events, before } = condTable([{ metric: 'DECK_COUNT', op: 'GT', value: 99 }]);
    expect(GATE_DRAW(events)).toHaveLength(0);
    const snapshot = JSON.parse(before) as EngineState;
    const live = engine.state;
    expect(JSON.stringify(live.players[1].hand)).toBe(JSON.stringify(snapshot.players[1].hand));
    expect(JSON.stringify(live.deck)).toBe(JSON.stringify(snapshot.deck));
    expect(live.discardPile).toEqual(snapshot.discardPile);
    expect(live.rngState).toEqual(snapshot.rngState);
    expect(live.pendingChoice ?? null).toBeNull();
    expect(live.turn).toBe(snapshot.turn + 1); // 唯一变化=回合事实，与门槛无关
  });

  it('fail-closed 在真链上成立：TARGET 主体在 TURN_START（无目标事实）上永不响', () => {
    const { events } = condTable(
      [{ metric: 'HAND_COUNT', subject: 'TARGET', op: 'GTE', value: 0 }],
      [makeCard('sc_hand_1')],
    );
    expect(GATE_DRAW(events)).toHaveLength(0);
  });

  it('EVENT_VALUE 读真伤害账：门槛=实际伤值则反伤，门槛=伤值+1 则静默且挨打的血照旧', () => {
    const attackTable = (conds: SkillCondition[] | undefined) => {
      const engine = new GameEngine(makeState([
        makePlayer(1, {
          fieldGenerals: [makeFieldGeneral(makeGeneral('sc_strong', '大力', 6), 1, 0)],
          hand: [makeCard('sc_cost_1'), makeCard('sc_cost_2')],
        }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('sc_victim', '靶', 6), 2, 0)] }),
      ]));
      engine.registerPlayerSkills(2, [{
        id: 'sc_riposte_1', name: '闸·反伤', trigger: 'onDamageTaken',
        description: '伤害达门槛才反弹 1 点',
        effects: [{ type: 'DAMAGE', value: 1, target: 'ATTACKER' }],
        sourceGeneralId: 'sc_victim', conditions: conds,
        // v2.8.22 (#71)：本测钉的是**触发路上**的门槛闸。非 forced 的受击/受伤
        // 两型已搬进问答队列（不在触发链上），故这里显式 forced=true 留在自动路；
        // 问答路上的同一道闸由 skills/reactionChain.test.ts 钉。
        forced: true,
      }]);
      const events = engine.dispatch(createAction('ATTACK', 1, {
        attackerId: 'sc_strong', targetId: 'sc_victim', ranged: false, consumeCard: makeCard('sc_cost_1'),
      }));
      return { engine, events };
    };
    const ripostes = (events: GameEvent[]) => events.filter(e =>
      e.type === 'DAMAGE' && (e.data as Record<string, unknown>).skillId === 'sc_riposte_1');
    const hpOf = (state: EngineState, id: string) => {
      for (const p of state.players) {
        const fg = (p.fieldGenerals ?? []).find(
          f => (f as { general?: { id?: string } }).general?.id === id,
        ) as { currentHp?: number } | undefined;
        if (fg) return fg.currentHp;
      }
      return undefined;
    };

    const plain = attackTable(undefined);
    const incoming = plain.events.filter(e => e.type === 'DAMAGE'
      && (e.data as Record<string, unknown>).damageType === 'attack');
    expect(incoming).toHaveLength(1);
    const damage = Number((incoming[0].data as Record<string, unknown>).value);
    expect(damage).toBeGreaterThan(0);
    expect(ripostes(plain.events).length).toBeGreaterThan(0);

    expect(ripostes(attackTable([{ metric: 'EVENT_VALUE', op: 'GTE', value: damage }]).events).length)
      .toBeGreaterThan(0);
    const unmet = attackTable([{ metric: 'EVENT_VALUE', op: 'GTE', value: damage + 1 }]);
    expect(ripostes(unmet.events)).toHaveLength(0);
    // 门不过时挨的打一分不少：闸只掐技能，掐不掉事实
    expect(hpOf(unmet.engine.state, 'sc_victim')).toBe(hpOf(plain.engine.state, 'sc_victim'));
    expect(hpOf(unmet.engine.state, 'sc_strong')).toBe(6);
  });

  it('闸在要约之前：门槛不过时连 CHOICE_REQUIRED 都不开（v2.7.2 生产者面）', () => {
    const producerTable = (conds: SkillCondition[] | undefined, hand: GameCard[]) => {
      const engine = new GameEngine(makeState([
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('sc_plain', '路人', 4), 1, 0)] }),
        makePlayer(2, {
          hand: [...hand],
          fieldGenerals: [makeFieldGeneral(makeGeneral('sc_prod', '择主', 4), 2, 0)],
        }),
      ]));
      engine.registerPlayerSkills(2, [{
        id: 'sc_prod_1', name: '闸·择弃', trigger: 'onTurnStart',
        description: '手牌够多才择一张弃', choiceMode: true, choiceSource: 'HAND_CARD',
        effects: [{ type: 'DISCARD', value: 1, target: 'SELF', description: '弃置所选手牌' }],
        sourceGeneralId: 'sc_prod', conditions: conds,
      }]);
      return { engine, events: engine.dispatch(createAction('END_TURN', 1)) };
    };
    const closed = producerTable([{ metric: 'HAND_COUNT', op: 'GTE', value: 2 }], [makeCard('sc_p_1')]);
    expect(closed.events.some(e => e.type === 'CHOICE_REQUIRED')).toBe(false);
    expect(closed.engine.state.pendingChoice ?? null).toBeNull();

    const open = producerTable([{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }], [makeCard('sc_p_1')]);
    const offers = open.events.filter(e => e.type === 'CHOICE_REQUIRED');
    expect(offers).toHaveLength(1);
    expect((offers[0].data as Record<string, unknown>).chooserPlayerId).toBe(2);
  });

  it('回归钉：conditions 缺省与显式 undefined 的事件流+终态逐字节一致', () => {
    const scrub = (text: string) => text
      .replace(/"id":"[0-9a-f-]{36}"/g, '"id":"_u"')
      .replace(/"timestamp":\d+/g, '"timestamp":"_t"')
      .replace(/"rootEventId":"[^"]*"/g, '"rootEventId":"_v"')
      .replace(/"id":"action_[^"]*"/g, '"id":"_a"');
    const normalize = (e: GameEvent) => scrub(JSON.stringify({ type: e.type, data: e.data }));
    const run = (conds: SkillCondition[] | undefined) => {
      const { engine, events } = condTable(conds, [makeCard('sc_hand_1')]);
      return { stream: events.map(normalize).join('\n'), final: scrub(JSON.stringify(engine.state)) };
    };
    expect(run(undefined).stream).toBe(run([]).stream);
    expect(run(undefined).final).toBe(run([]).final);
  });
});

/** 决策路探针：onTurnEnd 定义经编译 seam 挂上门槛。 */
const TURN_END_SKILL: Skill = {
  name: '闸·守夜',
  description: '回合结束时：满足门槛则摸一张牌',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};

function actorGeneral(): General {
  return {
    id: 'sc_actor', instanceId: 'sc_actor', name: '守夜将', faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [TURN_END_SKILL],
  } as unknown as General;
}

const ACTOR_SKILL_ID = 'sc_actor:闸·守夜:e1';

function decisionTable(hand: GameCard[]): EngineState {
  return makeState([
    makePlayer(1, { hand: [...hand], fieldGenerals: [makeFieldGeneral(actorGeneral(), 1, 0)] }),
    makePlayer(2, { fieldGenerals: [] }),
  ]);
}

function activate(engine: GameEngine): GameEvent[] {
  return engine.dispatch(createAction('ACTIVATE_SKILL', 1, {
    skillId: ACTOR_SKILL_ID, generalId: 'sc_actor',
  }));
}

const rejectReason = (events: GameEvent[]) =>
  String((events.find(e => e.type === 'ACTION_REJECTED')?.data as Record<string, unknown>)?.reason ?? '');

describe('v2.7.3 决策路接线：候选过滤 + 诚实拒因（编译 seam 探针）', () => {
  it('门槛不过=根本不当候选：候选枚举与 legalActions 同口径消失，账本视图仍如实披露', () => {
    probe.conditions = [{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }];
    const state = decisionTable([]);
    expect(listTurnEndSkillCandidates(state, 1)).toHaveLength(0);
    expect(new GameEngine(structuredClone(state)).legalActions(1)
      .some(a => a.type === 'ACTIVATE_SKILL')).toBe(false);
    // 诚实披露面不过滤：定义仍存在（"不响"是门槛判出来的，不是把技能抹掉了）
    expect(listAllTurnEndDefinitions(state, 1).map(d => d.id)).toEqual([ACTOR_SKILL_ID]);

    expect(listTurnEndSkillCandidates(decisionTable([makeCard('sc_h_2')]), 1)).toHaveLength(1);
    const opened = new GameEngine(structuredClone(decisionTable([makeCard('sc_h_2')])));
    expect(opened.legalActions(1).some(a => a.type === 'ACTIVATE_SKILL')).toBe(true);
  });

  it('resolver 独立再求值：枚举与派发之间场面变了=SKILL_CONDITION_UNMET，不静默空转、账不落', () => {
    probe.conditions = [{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }];
    const engine = new GameEngine(decisionTable([makeCard('sc_h_3')]));
    expect(engine.legalActions(1).some(a => a.type === 'ACTIVATE_SKILL')).toBe(true);
    (engine.state.players[0].hand as GameCard[]).length = 0; // 枚举之后手牌被弃光
    const events = activate(engine);
    expect(rejectReason(events)).toContain('SKILL_CONDITION_UNMET');
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
    expect(events.some(e => e.type === 'DRAW')).toBe(false);
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);
  });

  it('门槛不过≠覆盖既有拒因：先身份、后欠账、再门槛的次序逐字钉住', () => {
    probe.conditions = [{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }];
    const stranger = new GameEngine(decisionTable([makeCard('sc_h_4')]));
    expect(rejectReason(stranger.dispatch(createAction('ACTIVATE_SKILL', 1, {
      skillId: ACTOR_SKILL_ID, generalId: 'no_such_general',
    })))).toContain('GENERAL_NOT_CONTROLLED');

    const spent = new GameEngine(decisionTable([makeCard('sc_h_4')]));
    spent.state.consumedSkills = [{
      stableId: `1:${ACTOR_SKILL_ID}`, skillId: ACTOR_SKILL_ID, turn: 1, playerId: 1,
    }];
    expect(rejectReason(activate(spent))).toContain('SKILL_ALREADY_ACTIVATED');

    const missing = new GameEngine(decisionTable([makeCard('sc_h_4')]));
    expect(rejectReason(missing.dispatch(createAction('ACTIVATE_SKILL', 1, {
      skillId: 'no_such:skill:e1', generalId: 'sc_actor',
    })))).toContain('TURN_END_SKILL_NOT_FOUND');
  });

  it('门槛过了=正常开账：SKILL_ACTIVATED + 效果落账，且与旧行为逐字一致', () => {
    probe.conditions = [{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }];
    const met = new GameEngine(decisionTable([makeCard('sc_h_5')]));
    const events = activate(met);
    expect(rejectReason(events)).toBe('');
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(met.state.consumedSkills).toHaveLength(1);

    probe.conditions = undefined;
    const plain = new GameEngine(decisionTable([makeCard('sc_h_5')]));
    const plainEvents = activate(plain);
    expect(rejectReason(plainEvents)).toBe('');
    expect(plainEvents.some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(JSON.stringify(plain.state)).toBe(JSON.stringify(met.state));
  });

  it('四路对账同一结论（候选枚举 / legalActions / resolver 派发 / 直接求值）且条件从不进状态', () => {
    const verdicts = (state: EngineState, facts: SkillConditionFacts) => [
      evaluateSkillConditions(probe.conditions, facts),
      listTurnEndSkillCandidates(state, 1).length > 0,
      new GameEngine(structuredClone(state)).legalActions(1).some(a => a.type === 'ACTIVATE_SKILL'),
      !new GameEngine(structuredClone(state)).dispatch(createAction('ACTIVATE_SKILL', 1, {
        skillId: ACTOR_SKILL_ID, generalId: 'sc_actor',
      })).some(e => e.type === 'ACTION_REJECTED'),
    ];

    probe.conditions = [{ metric: 'FIELD_GENERAL_COUNT', op: 'GTE', value: 2 }];
    const closed = decisionTable([makeCard('sc_h_6')]); // 座 1 只 1 名在场将
    expect(verdicts(closed, { state: closed, ownerId: 1, sourceGeneralId: 'sc_actor' }))
      .toEqual([false, false, false, false]);

    probe.conditions = [{ metric: 'FIELD_GENERAL_COUNT', op: 'LTE', value: 2 }];
    const open = decisionTable([makeCard('sc_h_6')]);
    expect(verdicts(open, { state: open, ownerId: 1, sourceGeneralId: 'sc_actor' }))
      .toEqual([true, true, true, true]);

    expect(JSON.stringify(new GameEngine(decisionTable([makeCard('sc_h_6')])).state))
      .not.toContain('conditions');
    expect(JSON.stringify(open)).not.toContain('FIELD_GENERAL_COUNT');
    probe.conditions = undefined;
  });

  it('数据层没写门槛 → 编译产物不带 conditions（缺省行为逐字不变，未被点名的将领走真实编译路径）', () => {
    probe.conditions = [{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }];
    // sc_plain_actor 与 sc_actor 技能逐字同构、只差 id：探针按 id 精准命中，
    // 未被点名的将领走的仍是真实编译路径。
    const twin = { ...actorGeneral(), id: 'sc_plain_actor', instanceId: 'sc_plain_actor' } as General;
    const compiled = compileGeneralSkills(twin, 'sc_plain_actor').definitions;
    expect(compiled.map(d => d.id)).toEqual(['sc_plain_actor:闸·守夜:e1']);
    expect(compiled[0].conditions).toBeUndefined();
    probe.conditions = undefined;
  });
});
