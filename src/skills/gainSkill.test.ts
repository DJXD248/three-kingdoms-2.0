/**
 * 2.9.3 刀A：新原语「获得技能」（GAIN_SKILL）的端到端证人。
 *
 * 这一档钉的是**真链路**——录入的名字 ⇒ 唯一解析点 ⇒ 编译进定义 ⇒ 一张桥接事件
 * ⇒ 卡面技能表真的长出一枚 ⇒ 下一次发动听得见它。单层测试（编译面 / Excel 面）
 * 抓不到的是中间掉链子那一类：定义里有、事件里没、落了却没重编译、重编译了却没账。
 *
 * 与相邻几档的分工：`skillNameIndex.test.ts` 钉"名字查得出/查不出"，
 * `skillExcelFormat.test.ts` 钉"那一格读得对不对、读不懂点名"，这一档钉结算侧。
 * 成对写"拿到了 / 没拿到"：没拿到那一半逐字等于刀前行为（名字查不到⇒一条点名的
 * skipped⇒事件流一字不多），这正是两锚不换名的结构保证。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type { General, Skill } from '../data/generals';
import { allGenerals } from '../data/generals';
import { compileSkill, syncPlayerSkills } from './skillCompiler';
import { __resetSkillNameIndexForTests, __setSkillNameRosterForTests } from './skillNameIndex';
import { getRuntimeCardId } from '../utils/runtimeIdentity';

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id, name: '测试将' + id, faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
  };
}

function makeFieldGeneral(general: General, ownerId: number, slot = 0, zone: 'camp' | 'front' | 'battle' = 'front') {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [],
    isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone, slot, areaOwnerId: 1 },
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  } as EnginePlayer;
}

function makeState(players: EnginePlayer[]): EngineState {
  const deck = Array.from({ length: 12 }, (_, i) => ({ id: `deck_${i + 1}`, name: '粮草', type: '粮草' as const }));
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck, discardPile: [], drawState: null,
  } as EngineState;
}

function buildEngine(players: EnginePlayer[]): GameEngine {
  const state = makeState(players);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  return engine;
}

/** 觉醒那一句的最小形状：回合开始时把名册里那枚添到自己卡面上。 */
function awaken(name: string, skillName: string, extra: Partial<Skill> = {}): Skill {
  return {
    name,
    description: `失去1点体力上限并获得技能「${skillName}」`,
    effects: [{
      id: 'e1',
      trigger: { type: 'onTurnStart' },
      runtime: { type: 'GAIN_SKILL', skillName, target: 'SELF' },
    }],
    ...extra,
  };
}

function skillsOf(state: EngineState, playerId: number, generalId: string): Skill[] {
  const fg = (state.players.find(p => p.id === playerId)?.fieldGenerals as any[] | undefined)
    ?.find(f => getRuntimeCardId(f?.general) === generalId)?.general;
  return (fg?.skills ?? []) as Skill[];
}

function handOf(state: EngineState, playerId: number): number {
  return (state.players.find(p => p.id === playerId)?.hand as any[])?.length ?? 0;
}

/**
 * 一跑到底：玩家 1 结束回合⇒玩家 2 回合开始⇒觉醒响⇒再结束玩家 2 的回合⇒玩家 1 回合
 * 开始⇒最后再结束玩家 1 的回合，让**玩家 2 的回合第二次开始**。
 *
 * 每一趟之前先 `syncPlayerSkills`，这不是测试自己加的胶水：常驻容器就是这条路
 * （`store/engineExecutionBridge.ts:90` 每次派发前全量重推导），`playResidentAll`
 * （`core/transitionEquivalence.test.ts:212`）钉的就是它。这一趟因而真正判的是
 * "卡面长了新技能⇒下一趟就听得见"，中间没有任何技能表缓存可依赖。
 *
 * 第三趟同样不是冗余：新技能是在第一趟中途才长上去的，而被拿的那一枚必须自己站在
 * 事件面上才可能被听见——`onTurnEnd` 那一族**故意不在事件面上**（`skillCompiler.ts:84-88`：
 * 只走 ACTIVATE_SKILL 手动路，防二次发动），所以这里用 `封赏`（回合开始时摸一张）。
 */
function playAwaken(gainedName: string) {
  const bearer = makeGeneral('g2', [awaken('觉醒', gainedName)]);
  const engine = buildEngine([
    makePlayer(1, { fieldGenerals: [] }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(bearer, 2)] }),
  ]);
  const step = (playerId: number): GameEvent[] => {
    syncPlayerSkills(engine, engine.state);
    return engine.dispatch(createAction('END_TURN', playerId));
  };
  const firstDispatch = step(1);
  const handAtGain = handOf(engine.state, 2);
  const secondDispatch = step(2);
  const thirdDispatch = step(1);
  return {
    engine,
    firstDispatch,
    secondDispatch,
    thirdDispatch,
    handGrowthAfterGain: handOf(engine.state, 2) - handAtGain,
    skills: skillsOf(engine.state, 2, 'g2').map(s => s.name),
  };
}

afterEach(() => __resetSkillNameIndexForTests());

describe('获得技能 · 编译面（名字是唯一入口，解析点只有一个）', () => {
  it('名册里查得到：那一枚技能**原样**嵌进定义，目标强制落在自己身上', () => {
    const { definitions, skipped } = compileSkill(
      { id: 'g1', name: '测试将' },
      awaken('觉醒', '屯田'),
      'g1_rt',
    );
    expect(skipped).toEqual([]);
    expect(definitions).toHaveLength(1);
    const printed = allGenerals
      .find(g => (g.skills ?? []).some(s => s.name === '屯田'))!
      .skills!.find(s => s.name === '屯田')!;
    expect(definitions[0].effects[0]).toMatchObject({
      type: 'GAIN_SKILL', target: 'SELF', skillName: '屯田',
    });
    // 嵌进去的就是名册上那一个对象——桥接层与结算侧不再问第二次，也就无从分叉。
    expect(definitions[0].effects[0].gainedSkill).toBe(printed);
  });

  it('四种写歪的形状各有一条点名的跳过，绝不编出半条能响的定义', () => {
    const noName = compileSkill({ id: 'g1', name: '测试将' }, {
      name: '空觉醒',
      effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'GAIN_SKILL', target: 'SELF' } }],
    });
    expect(noName.definitions).toHaveLength(0);
    expect(noName.skipped[0].reason).toBe('GAIN_SKILL_INCOMPLETE');

    const otherTarget = compileSkill({ id: 'g1', name: '测试将' }, {
      name: '给别人',
      effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'GAIN_SKILL', skillName: '屯田', target: 'TARGET' } }],
    });
    expect(otherTarget.skipped[0].reason).toBe('GAIN_SKILL_INCOMPLETE');

    // 「怒斩」＝用户原文里那枚还没进池的技能：不猜、不就近取一枚像的。
    const absent = compileSkill({ id: 'g1', name: '测试将' }, awaken('觉醒', '怒斩'));
    expect(absent.definitions).toHaveLength(0);
    expect(absent.skipped[0].reason).toBe('GAIN_SKILL_UNKNOWN_NAME');

    __setSkillNameRosterForTests([
      makeGeneral('x1', [{ name: '观星', effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] }]),
      makeGeneral('x2', [{ name: '观星', effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' } }] }]),
    ]);
    const ambiguous = compileSkill({ id: 'g1', name: '测试将' }, awaken('觉醒', '观星'));
    expect(ambiguous.definitions).toHaveLength(0);
    expect(ambiguous.skipped[0].reason).toBe('GAIN_SKILL_AMBIGUOUS_NAME');
  });

  it('入口存在性：能力已经在了，官方内容里**还没有一处**用得上它（两件事各有证人）', () => {
    const users = allGenerals.flatMap(g => (g.skills ?? []).flatMap(s => (s.effects ?? [])
      .filter(e => e.runtime?.type === 'GAIN_SKILL')
      .map(() => `${g.name}·${s.name}`)));
    expect(users).toEqual([]);
  });
});

describe('获得技能 · 真链路（卡面长出一枚，下一次发动才听得见）', () => {
  it('发一次落一张 SKILL_GAINED，键法与改数那位同一口径（座次＋将领实例都从 binding 取）', () => {
    const { engine, firstDispatch, skills } = playAwaken('屯田');
    const gained = firstDispatch.filter(e => e.type === 'SKILL_GAINED');
    expect(gained).toHaveLength(1);
    expect(gained[0].data).toMatchObject({ playerId: 2, generalId: 'g2' });
    expect((gained[0].data as any).skill.name).toBe('屯田');
    // 事件上那个 `skillName` 是**给技能的那一枚**（觉醒），不是被拿到那枚——两个键各有其主。
    expect((gained[0].data as any).skillName).toBe('觉醒');
    expect(skills).toEqual(['觉醒', '屯田']);
    // 技能表是**新数组**：原对象没被原地改（名册共用性的证人另开一条）。
    expect(engine.state.players.find(p => p.id === 2)!.fieldGenerals as any[]).toHaveLength(1);
  });

  it('拿到之后，下一趟自己的回合开始真的按新技能摸一张；没拿到那一半一字不多', () => {
    const got = playAwaken('封赏');
    expect(got.thirdDispatch.some(e => e.type === 'DRAW')).toBe(true);
    // 封赏＝回合开始时摸一张；对照那跑（名字查不到⇒什么都没拿到）只多出这一张。
    const control = playAwaken('怒斩');
    expect(control.skills).toEqual(['觉醒']);
    expect(got.handGrowthAfterGain - control.handGrowthAfterGain).toBe(1);
  });

  it('同一枚拿第二次：事件照记、卡面不重复（幂等读的是状态里那张表，不是任何缓存）', () => {
    const { engine } = playAwaken('屯田');
    const state = engine.state;
    const again: GameEvent = {
      type: 'SKILL_GAINED',
      data: { playerId: 2, generalId: 'g2', skill: { name: '屯田', description: '又拿一次' } },
    };
    const next = engine.processor.process(state, [again]);
    expect(skillsOf(next, 2, 'g2').map(s => s.name)).toEqual(['觉醒', '屯田']);
    // 第二枚那份"又拿一次"的定义**没有**进表：同名即视为已有，绝不留两份。
    expect(skillsOf(next, 2, 'g2').find(s => s.name === '屯田')?.description)
      .not.toBe('又拿一次');
  });

  it('人已不在场⇒诚实空操作（事件照记，没东西可改就什么都不改）', () => {
    const { engine } = playAwaken('屯田');
    const ghost: GameEvent = {
      type: 'SKILL_GAINED',
      data: { playerId: 2, generalId: 'g404', skill: { name: '观星' } },
    };
    const next = engine.processor.process(engine.state, [ghost]);
    expect(next).toEqual(engine.state);
    // 缺键（没有将、没有座次、没有技能）同样空操作，绝不猜一个座位落笔。
    for (const bad of [
      { playerId: 2, skill: { name: '观星' } },
      { generalId: 'g2', skill: { name: '观星' } },
      { playerId: 2, generalId: 'g2' },
    ]) {
      expect(engine.processor.process(engine.state, [{ type: 'SKILL_GAINED', data: bad }])).toEqual(engine.state);
    }
  });

  it('绝不动名册：拿到之后，官方那两张邓艾卡上印的技能一字未改', () => {
    const before = allGenerals.filter(g => g.name === '邓艾').map(g => [...(g.skills ?? [])]);
    playAwaken('屯田');
    const after = allGenerals.filter(g => g.name === '邓艾').map(g => [...(g.skills ?? [])]);
    expect(after).toEqual(before);
    expect(after.flat().some(s => s.name === '觉醒')).toBe(false);
  });
});

describe('获得技能 · 拿到的是一枚在场技（那一笔账在获得这一刻补落，只落一笔）', () => {
  const resident: Skill = {
    name: '观澜',
    tags: ['锁定技'],
    effects: [{
      id: 'e1', trigger: { type: 'passive' },
      runtime: { type: 'MODIFY_STAT', stat: 'MELEE_ATK', modifyMode: 'delta', value: 1, target: 'SELF' },
    }],
  };

  it('获得这一刻把在场那笔账落进账本；再拿同一枚不落第二笔', () => {
    __setSkillNameRosterForTests([makeGeneral('x9', [resident])]);
    const { engine } = playAwaken('观澜');
    const ledger = engine.state.statModifiers ?? [];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      key: 'MELEE_ATK', mode: 'delta', value: 1, passive: true, locked: true,
      targetId: 'g2', ownerGeneralId: 'g2', ownerSkillName: '观澜',
    });

    const again: GameEvent = {
      type: 'SKILL_GAINED',
      data: { playerId: 2, generalId: 'g2', skill: resident },
    };
    const next = engine.processor.process(engine.state, [again]);
    expect(next.statModifiers ?? []).toHaveLength(1);
  });

  it('拿到的不是在场技⇒事件流一字不多（在场算术只有一个落点）', () => {
    const { engine, firstDispatch } = playAwaken('屯田');
    expect(firstDispatch.some(e => e.type === 'STAT_MODIFY')).toBe(false);
    expect(engine.state.statModifiers).toBeUndefined();
  });
});
