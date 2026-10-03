/**
 * 既定规则（用户 2026-10-03 确认，裁决原文与判据＝`PROJECT_HANDOFF.md` §12-100）：
 * 将领被击杀的那一刀，它的「受到伤害后」与「成为目标时」两类技能**都不响应本次攻击／技能**。
 * 机制：响应链的问答是在整次结算之后才开的（`TransitionCore` 的结算后扫描），候选只扫在场的将
 * （`collectListeners`）⇒ 离场的将压根不在被问之列。两条时机同判据，不是漏一条补一条。
 * 范围边界（下面第二个 describe）＝这条只管**会停下来问人**的那些定义；勾了「强制发动」的走自动路、
 * 在结算链内当场响完，同一切换掐不到它——2026-10-03 现场量出来的，不是从名字推的。
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
 * 「强制发动」那一型**不在这条规则的覆盖范围内**（2026-10-03 现场量出来的边界，不是推论）：
 * 它压根不进问答队列，而是在结算链内当场响完⇒死者"离场"发生在它响过之后，掐不到它。
 * 下面两例钉的是**今日实际行为**：勾了强制发动的这两型，即使这一刀把它打死，效果照样落地。
 * 若今后要把同一条判据也加到自动路，这两例会当场变红⇒那是一次**玩法改判**，须用户先给话。
 */
describe('边界：勾了「强制发动」的同一型，被致命这一刀打死也照样响', () => {
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

  it('受击那一型·打死：反伤那 1 点照样落到来时（问人那一型同局只掉 1 点＝上面第三例）', () => {
    const { engine, events } = attack([forcedCounter('刚·烈')], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(events.filter(e => e.type === 'DAMAGE')).toHaveLength(2);
    const attackers = (engine.state.players[0]?.fieldGenerals ?? []) as { currentHp: number }[];
    expect(attackers[0]?.currentHp).toBe(3);
  });

  it('受伤那一型·打死：牌照样摸进手（问人那一型同局手牌为 0＝上面第四例）', () => {
    const { engine, events } = attack([forcedHurtDraw('奸·雄')], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.players[1].hand).toHaveLength(1);
  });
});
