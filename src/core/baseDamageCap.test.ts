/**
 * 「本营单次受到的伤害最多 1 点」＝规则刀（用户 2026-10-03 晚裁「封」，
 * 判据原文见 PROJECT_HANDOFF §12-96）。
 *
 * 这条规则钉的是**两条能打到本营的发射路**，不是结算口：
 *   普攻      → `action/resolvers/AttackResolver.ts`（本就封顶，本刀把它接到同一个常量）
 *   技能伤害  → `skills/SkillTriggerBridge.ts`（本刀新封：卡面写几点都好，打本营只走 1 点）
 * 决斗那一路**结构性打不到本营**：`core/eventProcessors/duelEvents.ts` 的双方由
 * `findDuelParticipant(按将领 id 找人)` 解出，解不出就诚实空转，压根没有"本营"这个选项，
 * 所以这一路不封顶＝没有可打穿的对象，无需钉子。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from './GameState';
import type { General, Skill } from '../data/generals';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { capDamageToBase } from './baseDamage';

function makeGeneral(id: string, skills: Skill[], meleeAtk = 2): General {
  return {
    id,
    name: '测试将' + id,
    faction: '魏',
    hp: 4,
    type: '武将',
    meleeAtk,
    rangedAtk: 1,
    armor: 0,
    skills,
  };
}

function makeFieldGeneral(
  general: General,
  ownerId: number,
  slot = 0,
  zone: 'camp' | 'front' | 'battle' = 'front',
  areaOwnerId: number | null = 1,
) {
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
    position: { zone, slot, areaOwnerId },
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id,
    name: 'Player ' + id,
    hp: 4,
    hand: [],
    generalPool: [],
    fieldGenerals: [],
    graveyard: [],
    baseHp: 10,
    baseMaxHp: 10,
    isAlive: true,
    statuses: [],
    ...overrides,
  };
}

function buildEngine(players: EnginePlayer[]): GameEngine {
  const state: EngineState = {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0]?.id ?? null,
    turn: 1,
    round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
    ],
    discardPile: [],
    drawState: null,
  };
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  return engine;
}

const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' };

/** 一枚"造成攻击伤害后，对受击目标追加 N 点技能伤害"的自建技能（【奋威】形，卡面数值可调）。 */
function followUp(n: number): Skill {
  return {
    name: '样·追击',
    description: `造成攻击伤害后，对受击目标追加${n}点技能伤害。`,
    effects: [
      {
        id: 'e1',
        trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
        runtime: { type: 'DAMAGE', value: n, target: 'TARGET' },
      },
    ],
  };
}

function baseHpOf(engine: GameEngine, playerId: number): number {
  return Number(engine.state.players.find(p => p.id === playerId)?.baseHp ?? -1);
}

function hpOf(engine: GameEngine, playerId: number, generalId: string): number {
  const list = (engine.state.players.find(p => p.id === playerId)?.fieldGenerals as any[] | undefined) ?? [];
  const fg = list.find(f => getRuntimeCardId(f?.general as never) === generalId);
  return Number(fg?.currentHp ?? -1);
}

describe('本营封顶 1 点 · 两条发射路（v2.8.29「封」）', () => {
  it('发射点常量：只封上限，不抬下限（0 与原样、负数原样）', () => {
    expect(capDamageToBase(7)).toBe(1);
    expect(capDamageToBase(1)).toBe(1);
    expect(capDamageToBase(0)).toBe(0);
    expect(capDamageToBase(-2)).toBe(-2);
  });

  it('技能伤害打本营：卡面 3 点 ⇒ 事件里写 1 点、本营只掉 1 点', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', [followUp(3)], 5), 1, 0, 'front', 2)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }),
    );
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);

    const hits = events.filter(e => e.type === 'DAMAGE');
    // 普攻那一笔＋技能追加那一笔：两条都打本营，两条都只带 1 点。
    expect(hits.map(e => [(e.data as any).damageType, (e.data as any).value, (e.data as any).targetId]))
      .toEqual([['attack', 1, 'base_2'], ['skill', 1, 'base_2']]);
    expect(baseHpOf(engine, 2)).toBe(8);
    // 派生侧读的是已落账的真实掉血，跟着一起是 1 点两声（不是卡面上的 3）。
    expect(events.filter(e => e.type === 'INJURY').map(e => [(e.data as any).value, (e.data as any).isBase]))
      .toEqual([[1, true], [1, true]]);
  });

  it('同一枚技能打将领：卡面 3 点照旧 3 点（封顶只管本营那一格）', () => {
    const victim = makeGeneral('g2', []);
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', [followUp(3)], 2), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, {
        fieldGenerals: [{ ...makeFieldGeneral(victim, 2, 0, 'front', 1), currentHp: 9, maxHp: 9 }],
      }),
    ]);

    engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );
    // 普攻 2 点＋技能追加 3 点：将领取的是全额，一点没被那个 1 盖住。
    expect(hpOf(engine, 2, 'g2')).toBe(4);
    expect(baseHpOf(engine, 2)).toBe(10);
  });

  it('普攻那一路同轴对照：近战 7 点打本营仍只走 1 点（本刀没把它改宽也没改窄）', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', [], 7), 1, 0, 'front', 2)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }),
    );
    expect(events.filter(e => e.type === 'DAMAGE').map(e => (e.data as any).value)).toEqual([1]);
    expect(baseHpOf(engine, 2)).toBe(9);
  });

  it('本营已经破了：追加那一笔仍至多 1 点，且不凭空调出一声"受到伤害"', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', [followUp(3)], 5), 1, 0, 'front', 2)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [], baseHp: 1 }),
    ]);

    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }),
    );
    // 普攻 1 点把本营打到 0；追加那一笔卡面写 3，封顶后仍至多 1 点，血量停在 0 不穿负。
    expect(baseHpOf(engine, 2)).toBe(0);
    expect(events.filter(e => e.type === 'DAMAGE').map(e => Number((e.data as any).value))).toEqual([1, 1]);
    // 刀5 口径顺带钉住：第二笔没让血量再降⇒那一声"受到伤害"根本不存在。
    expect(events.filter(e => e.type === 'INJURY')).toHaveLength(1);
  });
});
