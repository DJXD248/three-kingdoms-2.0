/**
 * v2.8.21 监听扩面刀：两把新轴的编译映射＋桥接消费。
 *
 * 这一刀的红线是「缺省档＝扩面前的逐字行为」：官方卡与 DIY 夹具一条都没写
 * 「我听谁」，也没有任何发射器会发出 damageType='skill' 的「成为目标」一声，
 * 所以两个锚池（B12/B11）结构性不动。下面的用例因此成对写：
 *   不填 ⇒ 与今天一致；显式填 ⇒ 才扩响。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { General, Skill, SkillTriggerConfig } from '../data/generals';
import { compileSkill, syncPlayerSkills } from './skillCompiler';

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

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  };
}

function makeState(players: EnginePlayer[]): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
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

/** 受伤摸一张（「我听谁」的载体）。 */
function drawWhenHurt(scope?: SkillTriggerConfig['listenerScope']): Skill {
  return {
    name: '护院',
    effects: [{
      id: 'e1',
      trigger: scope ? { type: 'onDamageTaken', listenerScope: scope } : { type: 'onDamageTaken' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
  };
}

/** 被指名就回刺一击（「成为目标」来源档的载体）。 */
function counterWhenTargeted(sub?: SkillTriggerConfig['targetSubType']): Skill {
  return {
    name: '回刺',
    effects: [{
      id: 'e1',
      trigger: sub ? { type: 'onBecomingTarget', targetSubType: sub } : { type: 'onBecomingTarget' },
      runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' },
    }],
  };
}

describe('监听扩面 · compileSkill 映射', () => {
  const general = { id: 'g1', name: '测试将' };

  const definitionOf = (trigger: SkillTriggerConfig) => {
    const skill: Skill = {
      name: '测试技',
      effects: [{ id: 'e1', trigger, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    };
    const { definitions } = compileSkill(general, skill);
    expect(definitions).toHaveLength(1);
    return definitions[0];
  };

  it('「成为目标时」没选细分＝只算攻击（扩面前的逐字行为）', () => {
    expect(definitionOf({ type: 'onBecomingTarget' }).targetSource).toBe('attack');
    expect(definitionOf({ type: 'onBecomingTarget', targetSubType: 'attackTarget' }).targetSource).toBe('attack');
  });

  it('细分写了技能／两种都算就照记（消费侧已就绪，发射器排在后续刀）', () => {
    expect(definitionOf({ type: 'onBecomingTarget', targetSubType: 'skillTarget' }).targetSource).toBe('skill');
    expect(definitionOf({ type: 'onBecomingTarget', targetSubType: 'anyTarget' }).targetSource).toBe('any');
  });

  it('非「成为目标」的时机不产生来源档', () => {
    expect(definitionOf({ type: 'onDamageTaken' }).targetSource).toBeUndefined();
  });

  it('「我听谁」在认这一栏的时机上逐字透传', () => {
    expect(definitionOf({ type: 'onBecomingTarget' }).listenerScope).toBeUndefined(); // 不填＝没有这档
    expect(definitionOf({ type: 'onDamageTaken', listenerScope: 'field' }).listenerScope).toBe('field');
    expect(definitionOf({ type: 'onCardLost', listenerScope: 'allySeat' }).listenerScope).toBe('allySeat');
  });

  it('不认这一栏的时机：编译侧不凭空收下（录入面根本不给这一栏）', () => {
    expect(definitionOf({ type: 'onTurnEnd', listenerScope: 'field' }).listenerScope).toBeUndefined();
  });

  it('「选择其一」不再跨档合并：只听自己与听场上是两回事', () => {
    const sameScope: Skill = {
      name: '抉择',
      effectMode: 'choice',
      effects: [
        { id: 'e1', trigger: { type: 'onDamageTaken', listenerScope: 'field' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        { id: 'e2', trigger: { type: 'onDamageTaken', listenerScope: 'field' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
      ],
    };
    expect(compileSkill(general, sameScope).definitions).toHaveLength(1); // 同档⇒一组抉择

    const mixedScope: Skill = {
      ...sameScope,
      effects: [sameScope.effects![0], {
        id: 'e2',
        trigger: { type: 'onDamageTaken', listenerScope: 'self' },
        runtime: { type: 'HEAL', value: 1, target: 'SELF' },
      }],
    };
    const mixed = compileSkill(general, mixedScope).definitions;
    expect(mixed).toHaveLength(2); // 不同档⇒各自一条，绝不并列成同一组可选项
    expect(mixed.map(d => d.listenerScope).sort()).toEqual(['field', 'self']);
  });
});

describe('监听扩面 · 桥接消费（真实对局事件）', () => {
  // 玩家 1 的 g1 攻击玩家 3 的 g3；技能挂在玩家 2 的 g2 上。
  // g2 既不挨打也不在同一席位⇒只有"听场上"才该响。
  function attackThirdGeneral(skill: Skill) {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [skill]), 2)] }),
      makePlayer(3, { fieldGenerals: [makeFieldGeneral(makeGeneral('g3', []), 3)] }),
    ]);
    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g3', ranged: false, consumeCard: ATTACK_COST }),
    );
    const p2 = engine.state.players.find(p => p.id === 2)!;
    return { drew: events.some(e => e.type === 'DRAW' && (e.data as any).playerId === 2), handSize: p2.hand!.length };
  }

  it('缺省＝只听自己：别人席位挨打不响（扩面前的行为，钉住不动）', () => {
    const r = attackThirdGeneral(drawWhenHurt());
    expect(r.drew).toBe(false);
    expect(r.handSize).toBe(0);
  });

  it('只听自己：同一个玩家自己那名将被打才响', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, {
        fieldGenerals: [
          makeFieldGeneral(makeGeneral('g2', [drawWhenHurt('self')]), 2, 0),
          makeFieldGeneral(makeGeneral('g3', []), 2, 1),
        ],
      }),
    ]);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g3', ranged: false, consumeCard: ATTACK_COST }));
    expect(engine.state.players.find(p => p.id === 2)!.hand).toHaveLength(0);

    const engine2 = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, {
        fieldGenerals: [
          makeFieldGeneral(makeGeneral('g2', [drawWhenHurt('self')]), 2, 0),
          makeFieldGeneral(makeGeneral('g3', []), 2, 1),
        ],
      }),
    ]);
    engine2.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    expect(engine2.state.players.find(p => p.id === 2)!.hand).toHaveLength(1);
  });

  it('听己方（同一席位）：同席另一名为目标也响', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, {
        fieldGenerals: [
          makeFieldGeneral(makeGeneral('g2', [drawWhenHurt('allySeat')]), 2, 0),
          makeFieldGeneral(makeGeneral('g3', []), 2, 1),
        ],
      }),
    ]);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g3', ranged: false, consumeCard: ATTACK_COST }));
    expect(engine.state.players.find(p => p.id === 2)!.hand).toHaveLength(1);
  });

  it('听场上（所有玩家）：旁人的席位也响；同一条事件下听己方仍不响', () => {
    expect(attackThirdGeneral(drawWhenHurt('field')).handSize).toBe(1);
    expect(attackThirdGeneral(drawWhenHurt('allySeat')).handSize).toBe(0);
  });

  it('「成为目标」的来源档：今天的攻击只算攻击，写了技能就不响', () => {
    const counterEvents = (skill: Skill) => {
      const engine = buildEngine([
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [skill]), 2)] }),
      ]);
      engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
      return (engine.state.players.find(p => p.id === 1)!.fieldGenerals as any[])[0].currentHp;
    };
    expect(counterEvents(counterWhenTargeted())).toBe(3);            // 不选细分＝攻击，照旧响
    expect(counterEvents(counterWhenTargeted('attackTarget'))).toBe(3);
    expect(counterEvents(counterWhenTargeted('anyTarget'))).toBe(3);  // 两种都算⇒攻击也算
    expect(counterEvents(counterWhenTargeted('skillTarget'))).toBe(4); // 只认技能⇒今日无声可响
  });

  it('听场上也不会被"打大本营"的那一声误触发（事件里没有受击方键，判不出参与者就不响）', () => {
    const attackerField = makeFieldGeneral(makeGeneral('g1', []), 1);
    attackerField.position = { zone: 'front', slot: 0, areaOwnerId: 2 }; // 近战规则：站进对面区域打其大本营
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [attackerField], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [counterWhenTargeted('anyTarget')]), 2)] }),
    ]);

    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }));

    expect((engine.state.players.find(p => p.id === 1)!.fieldGenerals as any[])[0].currentHp).toBe(4);
    expect(engine.state.players.find(p => p.id === 2)!.baseHp).toBe(9);
  });
});
