/**
 * 两拍普攻的证人（用户 2026-10-04 三次裁决，原文＝`PROJECT_HANDOFF.md` §12-100／§12-101
 * 与本轮定稿的 §12-102）。定义封口后的一句话判据：
 *
 *  ‧ **受击＝成为目标**（`onBecomingTarget`）：这一型在**伤害计算之前**发动，所以这一刀
 *    最终会不会把主人打死**与它无关**——被砍死的那一刀里它照样发动。
 *  ‧ **受伤＝受到伤害**（`onDamageTaken`）：必须真的掉了血才成立，所以在**伤害之后**发动，
 *    主人死在这一刀里就不发动（人不在场）。
 *  ‧ **强制发动与手动发动同一条规矩**，区别只在"需不需要玩家自行响应"。
 *  ‧ 追加裁决（**甲**）：受击那一拍的反伤若先把出手的那位扎死⇒**那一刀跟着取消**，
 *    挨打的那位靠反伤自救成功。
 *
 * 机制：一次攻击分两拍（`core/attackBlow.ts`）。declare 那一拍先问"受击这一层有没有人听"
 * （两条路共用 `hasReactionListeners` 那一个推导点）：没人听⇒事件流与 2.3.0 以来逐字相同；
 * 有人听⇒只发 declare，`damage` 那一拍由 `core/TransitionCore` 的续跑环在这一层走完后
 * 对着**新状态**重算，重瞄不成立就整笔取消（甲案是结构性成立，没有一处专门判断"他死没死"）。
 * 执法点也收成一个：发射侧 `SkillTriggerBridge.ownerCanActivate`（v2.8.30 那半把结算侧的闸
 * 与"这一刀整个算完之后"的旧判据一起撤掉——它对受击那一型是错的）。
 * 豁口＝「死亡时发动」那一型（遗言／遗计）：它按定义就在主人离场那一刻发动。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
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

function makeState(players: EngineState['players']): EngineState {
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

const typesOf = (events: GameEvent[]): string[] => events.map(event => event.type);
const damageCount = (events: GameEvent[]): number => events.filter(e => e.type === 'DAMAGE').length;

/** p1 的 g1（近战 2 点）打 p2 的 g2；两个体力值决定这一刀致命与否。 */
function attack(victimSkills: Skill[], victimHp: number, attackerHp = 4) {
  const state = makeState([
    makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1, attackerHp)], hand: [COST] }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', victimSkills), 2, victimHp)] }),
  ]);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  const events = engine.dispatch(createAction('ATTACK', 1, {
    attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: COST,
  }));
  return { engine, events };
}

/** 答一句：发动问句里的第一枚，或跳过。 */
function answer(engine: GameEngine, mode: 'activate' | 'skip'): GameEvent[] {
  const ask = getReactionAsk(engine.state);
  if (!ask) throw new Error('没有待答的响应格');
  return engine.dispatch(mode === 'activate'
    ? createAction('ACTIVATE_SKILL', ask.playerId, { skillId: ask.options[0].skillId, generalId: ask.generalId })
    : createAction('SKIP_REACTION', ask.playerId, { nodeKey: ask.nodeKey }));
}

const fieldOf = (engine: GameEngine, playerId: number) =>
  engine.state.players.find(p => p.id === playerId)?.fieldGenerals ?? [];
const hpOf = (engine: GameEngine, playerId: number): number | undefined =>
  (fieldOf(engine, playerId)[0] as { currentHp?: number } | undefined)?.currentHp;

describe('受击那一型：在被这一刀打死之前就已经发动完了（§12-102）', () => {
  it('问人路·致命一刀：格照样开，而且开在伤害落下**之前**', () => {
    const { engine, events } = attack([counterSkill('回刺')], 1);
    // 这一刀还悬着：伤害没算、没人阵亡、牌也还没被吃掉。
    expect(damageCount(events)).toBe(0);
    expect(events.some(e => e.type === 'DEATH')).toBe(false);
    expect(hpOf(engine, 2)).toBe(1);
    expect(engine.state.players[1].fieldGenerals).toHaveLength(1);
    expect(engine.state.players[0].hand).toHaveLength(1);
    const ask = getReactionAsk(engine.state);
    expect(ask?.sourceEvent.type).toBe('BEFORE_DAMAGE');
    expect((ask?.sourceEvent.data as { attackStage?: string }).attackStage).toBe('declare');
  });

  it('问人路·答"发动"：反伤先落，随后这一刀才落下并打死主人', () => {
    const { engine } = attack([counterSkill('回刺')], 1);
    const events = answer(engine, 'activate');
    expect(typesOf(events)).toContain('REACTION_ANSWERED');
    // 两笔伤害：反伤那 1 点（在来源身上）＋这一刀（打死主人）。
    expect(damageCount(events)).toBe(2);
    expect(hpOf(engine, 1)).toBe(3);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(engine.state.players[1].fieldGenerals).toHaveLength(0);
    expect(getReactionAsk(engine.state)).toBeNull();
    // 挨打的那位死在自己的这一格里⇒「受到伤害后」不再响（它必须真的掉血且主人在场）。
    expect(engine.state.players[1].hand).toHaveLength(0);
  });

  it('问人路·答"跳过"：这一刀直接落下，反伤那 1 点压根没发生', () => {
    const { engine } = attack([counterSkill('回刺')], 1);
    const events = answer(engine, 'skip');
    expect(damageCount(events)).toBe(1);
    expect(hpOf(engine, 1)).toBe(4);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(engine.state.players[1].fieldGenerals).toHaveLength(0);
  });

  it('自动路（强制发动）·致命一刀：反伤当场落，与手动路同一条判据', () => {
    const forced = { ...counterSkill('刚·烈'), forced: true } as Skill;
    const { engine, events } = attack([forced], 1);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(damageCount(events)).toBe(2);
    expect(hpOf(engine, 1)).toBe(3);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(engine.state.players[1].fieldGenerals).toHaveLength(0);
    // 顺序＝受击那一拍在前、这一刀在后（流里第一个 DAMAGE 打的是来源）。
    const firstDamage = events.find(e => e.type === 'DAMAGE')!;
    expect((firstDamage.data as { targetId?: string }).targetId).toBe('g1');
  });

  it('对照·没死：受击（成为目标时）照常开格问人', () => {
    const { engine, events } = attack([counterSkill('回刺')], 4);
    expect(events.some(e => e.type === 'DEATH')).toBe(false);
    expect(getReactionAsk(engine.state)?.sourceEvent.type).toBe('BEFORE_DAMAGE');
  });

  it('对照·强制发动且没死：反伤照旧当场落，且不进问答窗', () => {
    const forced = { ...counterSkill('刚·烈'), forced: true } as Skill;
    const { engine, events } = attack([forced], 4);
    expect(events.some(e => e.type === 'DEATH')).toBe(false);
    expect(damageCount(events)).toBe(2);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(hpOf(engine, 1)).toBe(3);
  });
});

describe('甲案：受击那一拍把出手的那位扎死了⇒那一刀跟着取消', () => {
  it('问人路·答"发动"：那一刀不落，挨打的那位自救成功', () => {
    const { engine } = attack([counterSkill('回刺')], 1, 1);
    const events = answer(engine, 'activate');
    expect(damageCount(events)).toBe(1);            // 只有反伤那 1 点
    expect(engine.state.players[0].fieldGenerals).toHaveLength(0); // 出手的那位阵亡
    expect(hpOf(engine, 2)).toBe(1);                 // 挨打的那位活着
    expect(engine.state.players[1].fieldGenerals).toHaveLength(1);
    // 取消＝整笔不留痕迹：没有落账、没有"攻击完成"、也没有后序那一声。
    expect(typesOf(events)).not.toContain('ATTACK_RESOLVED');
    expect(typesOf(events)).not.toContain('AFTER_DAMAGE');
    // 这一刀的粮草从未被吃掉（出手的那位已经不在场）。
    expect(engine.state.players[0].hand).toHaveLength(1);
    expect(getReactionAsk(engine.state)).toBeNull();
  });

  it('自动路（强制发动）：同一判据，同一形状', () => {
    const forced = { ...counterSkill('刚·烈'), forced: true } as Skill;
    const { engine, events } = attack([forced], 1, 1);
    expect(damageCount(events)).toBe(1);
    expect(engine.state.players[0].fieldGenerals).toHaveLength(0);
    expect(hpOf(engine, 2)).toBe(1);
    expect(engine.state.players[1].fieldGenerals).toHaveLength(1);
    expect(typesOf(events)).not.toContain('ATTACK_RESOLVED');
    expect(engine.state.players[0].hand).toHaveLength(1);
  });

  it('答"跳过"＝不发动反伤⇒那一刀照旧落下（甲案只在反伤真把来源扎死时才生效）', () => {
    const { engine } = attack([counterSkill('回刺')], 1, 1);
    const events = answer(engine, 'skip');
    expect(damageCount(events)).toBe(1);
    expect(hpOf(engine, 1)).toBe(1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(engine.state.players[1].fieldGenerals).toHaveLength(0);
  });
});

describe('受伤那一型：必须真的掉血，所以它在这一刀之后——主人死在这刀里就不响', () => {
  it('问人路·致命一刀：不开格，牌照样没摸进手', () => {
    const { engine, events } = attack([hurtDraw('奸雄')], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.players[1].hand).toHaveLength(0);
  });

  it('自动路（强制发动）·致命一刀：牌照样没摸进手', () => {
    const forced = { ...hurtDraw('奸·雄'), forced: true } as Skill;
    const { engine, events } = attack([forced], 1);
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.players[1].hand).toHaveLength(0);
  });

  it('对照·没死：受伤（受到伤害后）照常开格问人', () => {
    const { engine } = attack([hurtDraw('奸雄')], 4);
    expect(getReactionAsk(engine.state)?.sourceEvent.type).toBe('INJURY');
  });

  it('对照·强制发动且没死：牌照旧当场摸进手，且不进问答窗', () => {
    const forced = { ...hurtDraw('奸·雄'), forced: true } as Skill;
    const { engine, events } = attack([forced], 4);
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

  it('没人听的攻击：两拍紧挨着一次走完，declare 那声不带任何延后标记', () => {
    const { events } = attack([], 4);
    // `INJURY` 那一身是每一刀真实掉血后派生的通知（v2.8 刀5 起就有），与本案无关。
    expect(typesOf(events)).toEqual([
      'ACTION_ACCEPTED', 'BEFORE_DAMAGE', 'DAMAGE', 'ATTACK_RESOLVED', 'AFTER_DAMAGE',
      'INJURY', 'STATE_CHANGED',
    ]);
    expect((events[1].data as { attackStage?: unknown }).attackStage).toBeUndefined();
  });
});
