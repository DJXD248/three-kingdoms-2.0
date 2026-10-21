/**
 * 「营地受到伤害时」这一格的结算面。
 *
 * 它听的不是新事件＝`INJURY`（这一席血量真的降了才由
 * `core/eventProcessors/chainedConsequences.ts` 派生，带 `isBase:true`），
 * 所以"只有真掉血才算受到伤害"在营地这一侧同样是结构性成立。
 *
 * 两族的分界是这里的重点：**营地掉血只有「营地受到伤害时」响，将领的
 * 「受到伤害后」一律不响；反过来也一样**。后者要靠 `skillEventMatch.ts` 里
 * 那句 `isBase` 守卫撑着——`others`／`field`／`enemySeat` 三档不比将那一层，
 * 去掉守卫，自家营地掉血就会误触发选了这几档的受伤技（下面第 4 条用例钉它）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { General, Skill, SkillTriggerConfig } from '../data/generals';
import { triggerTypeLabels } from '../data/generals';
import { compileSkill, syncPlayerSkills } from './skillCompiler';
import { readTriggerCell, triggerToStr, buildTriggerOptionStrings } from './skillExcelFormat';
import { parseSkillText } from './skillTextParse';
import { getReactionAsk } from './reactionChain';
import { matchesSkillEvent } from './skillEventMatch';
import { eventsHeardBy, TRIGGER_EVENTS } from './reactionTriggers';
import type { DataSkillDefinition } from './dataTypes';

const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' };

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id, name: '测试将' + id, faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
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

/** 站进对面区域的前线将——近战打对方营地唯一够得着的摆法（见 listenerScope.test 同型用例）。 */
function makeBaseRusher(general: General, ownerId: number, targetOwnerId: number) {
  const fg = makeFieldGeneral(general, ownerId);
  fg.position = { zone: 'front', slot: 0, areaOwnerId: targetOwnerId };
  return fg;
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  };
}

function makeState(players: EnginePlayer[]): EngineState {
  return {
    version: 1, phase: 'playing', currentPlayerId: players[0]?.id ?? null,
    timelinePhase: 'ACTION', players, turn: 1, round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
    ],
    discardPile: [], drawState: null,
  };
}

function buildEngine(players: EnginePlayer[]): GameEngine {
  const state = makeState(players);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  return engine;
}

/** 「营地受到伤害时」摸一张。`forced` 留真＝钉自动路；问答侧另有专门一条。 */
function drawWhenBaseHurt(sub?: SkillTriggerConfig['damageSubType']): Skill {
  return {
    name: '守营',
    forced: true,
    effects: [{
      id: 'e1',
      trigger: { type: 'onBaseDamaged', ...(sub ? { damageSubType: sub } : {}) },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
  };
}

/** 受伤摸一张（问答路形态＝不打「强制发动」），用来钉"营地那一格照样开问窗"。 */
function askWhenBaseHurt(): Skill {
  return { ...drawWhenBaseHurt(), forced: false };
}

function handOf(engine: GameEngine, playerId: number): number {
  return engine.state.players.find(p => p.id === playerId)!.hand!.length;
}

/** 玩家 2 的前线将 g2 挂 skill，玩家 1 的 g1 打**玩家 2 的营地**。 */
function attackOwnBaseWith(skill: Skill) {
  const engine = buildEngine([
    makePlayer(1, {
      fieldGenerals: [makeBaseRusher(makeGeneral('g1', []), 1, 2)],
      hand: [ATTACK_COST],
    }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [skill]), 2)] }),
  ]);
  const events = engine.dispatch(
    createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }),
  );
  const base = engine.state.players.find(p => p.id === 2)!;
  return { engine, events, drew: events.some(e => e.type === 'DRAW' && (e.data as any).playerId === 2), handSize: handOf(engine, 2), baseHp: base.baseHp };
}

/** 同一把手，把靶换成玩家 2 场上那一员将（营地一格血没动）。
 *  攻击方站回自家区域：`makeBaseRusher` 那种"插进对面区域"的站位只用来够营地，
 *  拿它打将那一刀会被规则判非法⇒证人空转（实测：那样 `currentHp` 还是满的 4）。 */
function attackOwnGeneralWith(skill: Skill) {
  const engine = buildEngine([
    makePlayer(1, {
      fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)],
      hand: [ATTACK_COST],
    }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [skill]), 2)] }),
  ]);
  engine.dispatch(
    createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
  );
  return {
    engine,
    handSize: handOf(engine, 2),
    baseHp: engine.state.players.find(p => p.id === 2)!.baseHp,
    // 这一手必须**真的打中了人**，否则"营地技不响"就是空转出来的假证人。
    generalHp: (engine.state.players.find(p => p.id === 2)!.fieldGenerals as any[])[0]?.currentHp,
  };
}

/** 营地掉血派生的那一声（`chainedConsequences` 的载荷形状，逐键照抄）。 */
function baseInjury(overrides: Record<string, unknown> = {}) {
  return {
    type: 'INJURY' as const,
    data: {
      targetPlayerId: 2,
      targetId: 'base_2',
      sourcePlayerId: 1,
      damageType: 'attack',
      value: 1,
      hpLost: 1,
      armorLost: 0,
      isBase: true,
      ...overrides,
    },
  };
}

function campDefinition(trigger: SkillTriggerConfig): DataSkillDefinition {
  const skill: Skill = {
    name: '守营',
    forced: true,
    effects: [{ id: 'e1', trigger, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  };
  const { definitions, skipped } = compileSkill({ id: 'g2', name: '测试将g2' }, skill);
  expect(skipped).toHaveLength(0);
  expect(definitions).toHaveLength(1);
  return definitions[0];
}

describe('营地受到伤害时 · 真链路（打自己营地）', () => {
  it('营地被打掉 1 点血⇒挂「营地受到伤害时」的在场将摸一张', () => {
    const r = attackOwnBaseWith(drawWhenBaseHurt());
    expect(r.baseHp).toBe(9);
    expect(r.drew).toBe(true);
    expect(r.handSize).toBe(1);
  });

  it('同一枚技能，打的是那一席的将（营地没掉血）⇒不响', () => {
    const r = attackOwnGeneralWith(drawWhenBaseHurt());
    expect(r.generalHp).toBe(2); // 先证明这一刀真打中了人（4−2）
    expect(r.baseHp).toBe(10);
    expect(r.handSize).toBe(0);
  });

  it('打的是**别人**的营地⇒这一席的营地技不响（席位层不比将，靠的还是"事件里的营地是谁的"）', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeBaseRusher(makeGeneral('g1', []), 1, 3)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [drawWhenBaseHurt()]), 2)] }),
      makePlayer(3, { fieldGenerals: [] }),
    ]);
    engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_3', ranged: false, consumeCard: ATTACK_COST }),
    );
    expect(engine.state.players.find(p => p.id === 3)!.baseHp).toBe(9);
    expect(handOf(engine, 2)).toBe(0);
  });

  it('分界另一半：挂「受到伤害后」并选了「听场上」的将，**不会**被自家营地掉血误触发', () => {
    const hurtWide: Skill = {
      name: '护院',
      forced: true,
      effects: [{
        id: 'e1',
        trigger: { type: 'onDamageTaken', listenerScope: 'field' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    };
    const r = attackOwnBaseWith(hurtWide);
    expect(r.baseHp).toBe(9);
    expect(r.handSize).toBe(0);
  });

  it('营地那一格也**停下来问人**（v2.9.16 询问制：问不问由技能自己定，与时机是哪一族无关），且绝不"又响又被问"', () => {
    const r = attackOwnBaseWith(askWhenBaseHurt());
    // 问窗开着、这一趟里一个字没落＝"又响又被问"这条路结构上不存在：自动路压根不
    // 注册没打「强制发动」的定义（`SkillTriggerBridge.defersToReactionQueue` 单点）。
    expect(r.handSize).toBe(0);
    const ask = getReactionAsk(r.engine.state);
    expect(ask?.trigger).toBe('onBaseDamaged');
    expect(ask?.playerId).toBe(2);
    expect(ask?.generalId).toBe('g2');
    expect(ask?.options.map(o => o.skillName)).toEqual(['守营']);
    // 点头之后才摸，且只摸一次。
    const answered = r.engine.dispatch(createAction('ACTIVATE_SKILL', 2, {
      skillId: ask!.options[0].skillId, generalId: ask!.generalId,
    }));
    expect(answered.filter(e => e.type === 'DRAW' && (e.data as any).playerId === 2)).toHaveLength(1);
    expect(handOf(r.engine, 2)).toBe(1);
    expect(getReactionAsk(r.engine.state)).toBeNull();
  });

  it('同一枚勾上「强制发动」＝回到自动路：当场自己响、连格都不开', () => {
    const forced = { ...drawWhenBaseHurt(), forced: true };
    const r = attackOwnBaseWith(forced);
    expect(r.drew).toBe(true);
    expect(r.handSize).toBe(1);
    expect(getReactionAsk(r.engine.state)).toBeNull();
  });
});

describe('营地受到伤害时 · 单点判据（matchesSkillEvent）', () => {
  it('只听自家席位：`targetPlayerId` 不是我的⇒不响；缺这个键⇒不响', () => {
    const def = campDefinition({ type: 'onBaseDamaged' });
    const binding = { ownerId: 2, skill: def };
    expect(matchesSkillEvent('onBaseDamaged', binding, baseInjury() as never)).toBe(true);
    expect(matchesSkillEvent('onBaseDamaged', binding, baseInjury({ targetPlayerId: 3 }) as never)).toBe(false);
    expect(matchesSkillEvent('onBaseDamaged', binding, baseInjury({ targetPlayerId: undefined }) as never)).toBe(false);
    // 换成将领掉血那一身（没有 isBase）⇒营地型不响。
    expect(matchesSkillEvent('onBaseDamaged', binding, baseInjury({ isBase: undefined, targetId: 'g9' }) as never)).toBe(false);
  });

  it('伤害类型细分照用：只写攻击⇒技能那一身不响，反之亦然', () => {
    const attackOnly = campDefinition({ type: 'onBaseDamaged', damageSubType: 'attackDamage' });
    const skillOnly = campDefinition({ type: 'onBaseDamaged', damageSubType: 'skillDamage' });
    const binding = { ownerId: 2, skill: attackOnly };
    expect(matchesSkillEvent('onBaseDamaged', binding, baseInjury({ damageType: 'attack' }) as never)).toBe(true);
    expect(matchesSkillEvent('onBaseDamaged', binding, baseInjury({ damageType: 'skill' }) as never)).toBe(false);
    const binding2 = { ownerId: 2, skill: skillOnly };
    expect(matchesSkillEvent('onBaseDamaged', binding2, baseInjury({ damageType: 'skill' }) as never)).toBe(true);
    expect(matchesSkillEvent('onBaseDamaged', binding2, baseInjury({ damageType: 'attack' }) as never)).toBe(false);
    // 不选细分＝两种都算（与「受到伤害后」同一句缺省）。
    expect(matchesSkillEvent('onBaseDamaged', { ownerId: 2, skill: campDefinition({ type: 'onBaseDamaged' }) },
      baseInjury({ damageType: 'skill' }) as never)).toBe(true);
  });

  it('「我听谁」这一栏压根不给营地这一型（界面上不出现＝`supportsListenerScope` false）', () => {
    expect(matchesSkillEvent('onBaseDamaged',
      { ownerId: 2, skill: campDefinition({ type: 'onBaseDamaged' }) },
      baseInjury({ targetPlayerId: 3 }) as never)).toBe(false);
  });
});

describe('营地受到伤害时 · 编译与词源', () => {
  it('细分写进卡面就编成伤害类型钥匙（与「受到伤害后」同一份映射）', () => {
    expect(campDefinition({ type: 'onBaseDamaged', damageSubType: 'attackDamage' }).damageTypeFilter).toBe('attack');
    expect(campDefinition({ type: 'onBaseDamaged', damageSubType: 'skillDamage' }).damageTypeFilter).toBe('skill');
    expect(campDefinition({ type: 'onBaseDamaged', damageSubType: 'allDamage' }).damageTypeFilter).toBeUndefined();
  });

  it('从 Excel／旧存档塞进来的「我听谁」＝点名拒绝，绝不悄悄当"只听自家"（记录而未消费＝假账）', () => {
    const skill: Skill = {
      name: '守营',
      effects: [{
        id: 'e1',
        trigger: { type: 'onBaseDamaged', listenerScope: 'field' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    };
    const { definitions, skipped } = compileSkill({ id: 'g2', name: '测试将g2' }, skill);
    expect(definitions).toHaveLength(0);
    expect(skipped[0]?.reason).toBe('TRIGGER_SUBTYPE_UNSUPPORTED');
  });

  it('这一型听的是**已经存在的那一声**＝INJURY，没有新事件类型（两条路同读一张表）', () => {
    expect(eventsHeardBy('onBaseDamaged')).toEqual(['INJURY']);
    expect(TRIGGER_EVENTS.onBaseDamaged).toBe(eventsHeardBy('onBaseDamaged'));
    expect(Object.values(TRIGGER_EVENTS).flat()).not.toContain('BASE_INJURY');
  });

  it('卡面那句话由同一份时机词表生成，本刀不新增第二套说法', () => {
    expect(triggerTypeLabels.onBaseDamaged).toBe('营地受到伤害时');
  });
});

describe('营地受到伤害时 · 录入面与词源（Excel 那一格与大白话那一路都吃公共表）', () => {
  it('Excel 那一格：写出→读回逐字同一结构，旧写法「本营受到伤害时」照样认得', () => {
    expect(readTriggerCell('营地受到伤害时→攻击伤害').trigger)
      .toEqual({ type: 'onBaseDamaged', damageSubType: 'attackDamage' });
    expect(readTriggerCell('本营受到伤害时→技能伤害').trigger)
      .toEqual({ type: 'onBaseDamaged', damageSubType: 'skillDamage' });
    expect(triggerToStr({ type: 'onBaseDamaged', damageSubType: 'allDamage' }))
      .toBe('营地受到伤害时→所有伤害类型');
    expect(readTriggerCell('营地受到伤害时→攻击').unreadable).toBe('营地受到伤害时→攻击');
    expect(buildTriggerOptionStrings()).toContain('营地受到伤害时→所有伤害类型');
  });

  it('大白话那一路自动认得，且"今天还不会响"那句提示随接线自行消失', () => {
    const draft = parseSkillText('营地受到伤害时，摸一张牌。');
    expect(draft.issues).toHaveLength(0);
    expect(draft.effects[0]?.trigger?.type).toBe('onBaseDamaged');
    expect(draft.notices.join('')).not.toMatch(/不会响/);
  });
});
