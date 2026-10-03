/**
 * 既定规则（用户 2026-10-03 两次裁决，原文＝`PROJECT_HANDOFF.md` §12-100 与 §12-101）：
 * 将领被击杀的那一刀，它的「受到伤害后」与「成为目标时」两类技能**都不响应本次攻击／技能**；
 * 而且这条**不分问人还是强制发动**——"将领不在场上不能发动技能，被砍死了不算在场上，
 * 能发动就是空发，就算是『强制发动』不能发动"，判断时刻＝**这一刀整个算完之后**。
 *
 * 机制上有两个执法点，因为两条路的形状不同：
 *  ‧ 问答路：候选在整次结算之后才枚举，且只扫在场的将（`collectListeners`）⇒死者压根不在被问之列。
 *  ‧ 自动路：效果在触发链展开时就生成（那一刻主人通常还在场）、落账却排在来源那一笔之后，
 *    所以发射侧（`SkillTriggerBridge.ownerCanActivate`）与结算侧（`core/ownerOnFieldGate.ts`）
 *    各掐一半；两半合起来才等于乙案。
 * 豁口＝「死亡时发动」那一型（遗言／遗计）：它按定义就在主人离场那一刻发动，两边都放行。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EngineState, EnginePlayer } from '../core/GameState';
import { createAction } from '../action/ActionTypes';
import type { General, Skill } from '../data/generals';
import { syncPlayerSkills } from './skillCompiler';
import { getReactionAsk } from './reactionChain';

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id, name: '阵亡将' + id, faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
  } as unknown as General;
}

function makeFieldGeneral(general: General, ownerId: number, hp: number) {
  return {
    general, currentHp: hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [], isArming: false,
    hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone: 'front' as const, slot: 0, areaOwnerId: 1 },
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
    currentPlayerId: players[0].id, turn: 1, round: 1,
    deck: [{ id: 'deck_1', name: '粮草', type: '粮草' }],
    discardPile: [], drawState: null,
  };
}

const COST = { id: 'cost_1', name: '粮草', type: '粮草' };

/** 「受到伤害后摸一张牌」——受伤那一型（`INJURY`）。 */
function hurtDraw(name: string): Skill {
  return {
    name, description: `${name}：受到伤害后可摸一张牌`,
    effects: [{
      id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
  } as Skill;
}
/** 「成为目标时反伤 1」——受击那一型（`BEFORE_DAMAGE`）。 */
function counterSkill(name: string): Skill {
  return {
    name, description: `${name}：成为目标时对来源造成 1 点伤害`,
    effects: [{
      id: 'e1', trigger: { type: 'onBecomingTarget' },
      runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' },
    }],
  } as Skill;
}

/** p1 的 g1（攻击 2 点）打 p2 的 g2；`victimHp` 决定这一刀致命与否。 */
function attack(victimSkills: Skill[], victimHp: number) {
  const state = makeState([
    makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1, 4)], hand: [COST] }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', victimSkills), 2, victimHp)] }),
  ]);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  const events = engine.dispatch(createAction('ATTACK', 1, {
    attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: COST,
  }));
  return { engine, events };
}

describe('致命那一刀：死者不响应本次攻击（§12-100 规则，非缺陷）', () => {
  it('对照组·没死：受击（成为目标时）照常开格问人', () => {
    const { engine, events } = attack([counterSkill('回刺')], 4);
    expect(events.some(e => e.type === 'DEATH')).toBe(false);
    expect(getReactionAsk(engine.state)?.sourceEvent.type).toBe('BEFORE_DAMAGE');
  });

  it('对照组·没死：受伤（受到伤害后）照常开格问人', () => {
    const { engine } = attack([hurtDraw('奸雄')], 4);
    expect(getReactionAsk(engine.state)?.sourceEvent.type).toBe('INJURY');
  });

  it('这一刀打死它：受击那一问也不开格，效果也没发生', () => {
    const { engine, events } = attack([counterSkill('回刺')], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(engine.state.players[1].fieldGenerals).toHaveLength(0);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.pendingReaction ?? null).toBeNull();
    // 反伤那 1 点没落到来时：全场只有攻击那一刀是伤害事件。
    expect(events.filter(e => e.type === 'DAMAGE')).toHaveLength(1);
  });

  it('这一刀打死它：受伤那一问同样不开格，摸牌也没发生', () => {
    const { engine, events } = attack([hurtDraw('奸雄')], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.players[1].hand).toHaveLength(0);
  });
});

/**
 * v2.8.30 离场不发动执法刀：同一条判据现在也管「强制发动」那一型。
 * 前两例钉"这一刀打死它"⇒效果不落地，形状与上面问答路那两例逐字相同（压根没发生）；
 * 后两例钉**没打死**⇒效果照旧当场落、时刻一字不变——乙案只该改"主人不在场"这一种情形，
 * 绝不许顺手把自动路搬进问答窗（那是第二种玩法，用户没给话）。
 */
describe('强制发动同一判据：这一刀打死它就不落账', () => {
  function forcedCounter(name: string): Skill {
    return {
      name, description: `${name}：成为目标时对来源造成 1 点伤害`, forced: true,
      effects: [{
        id: 'e1', trigger: { type: 'onBecomingTarget' },
        runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' },
      }],
    } as Skill;
  }

  function forcedHurtDraw(name: string): Skill {
    return {
      name, description: `${name}：受到伤害后摸一张牌`, forced: true,
      effects: [{
        id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    } as Skill;
  }

  /** 「死亡时发动摸一张牌」——遗言／遗计那一型（`onDeath`），判据上的豁口。 */
  function deathSpeak(name: string): Skill {
    return {
      name, description: `${name}：阵亡时摸一张牌`, forced: true,
      effects: [{
        id: 'e1', trigger: { type: 'onDeath' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    } as Skill;
  }

  function attackerHp(engine: GameEngine): number | undefined {
    const attackers = (engine.state.players[0]?.fieldGenerals ?? []) as { currentHp: number }[];
    return attackers[0]?.currentHp;
  }

  it('受击那一型·打死：反伤那 1 点不再落到来时（与问人那一型同形＝上面第三例）', () => {
    const { engine, events } = attack([forcedCounter('刚·烈')], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(events.filter(e => e.type === 'DAMAGE')).toHaveLength(1);
    expect(attackerHp(engine)).toBe(4);
  });

  it('受伤那一型·打死：牌照样没摸进手（与问人那一型同形＝上面第四例）', () => {
    const { engine, events } = attack([forcedHurtDraw('奸·雄')], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.players[1].hand).toHaveLength(0);
  });

  it('受击那一型·没打死：反伤照旧当场落，且不进问答窗', () => {
    const { engine, events } = attack([forcedCounter('刚·烈')], 4);
    expect(events.some(e => e.type === 'DEATH')).toBe(false);
    expect(events.filter(e => e.type === 'DAMAGE')).toHaveLength(2);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(attackerHp(engine)).toBe(3);
  });

  it('受伤那一型·没打死：牌照旧当场摸进手，且不进问答窗', () => {
    const { engine, events } = attack([forcedHurtDraw('奸·雄')], 4);
    expect(events.some(e => e.type === 'DEATH')).toBe(false);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.players[1].hand).toHaveLength(1);
  });

  it('豁口：遗言那一型就在主人阵亡这一声上发动，牌照旧摸进手', () => {
    const { engine, events } = attack([deathSpeak('遗计')], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(engine.state.players[1].fieldGenerals).toHaveLength(0);
    expect(engine.state.players[1].hand).toHaveLength(1);
  });
});
