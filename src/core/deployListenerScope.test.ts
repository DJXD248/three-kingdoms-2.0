/**
 * v2.9.13（按需池第一刀·甲档）「登场时 × 我听谁」的对账钉子。
 *
 * 用户口径逐字（2026-10-18）：其他角色＝自身以外；己方角色＝包括自身的己方玩家的
 * 角色；敌方角色＝己方玩家外的所有玩家的角色。三档都按**席位**那一维算，不是魏蜀吴
 * 群那种势力（§H9 第七轮② 早已把"己方"更正为席位，本刀沿用同一根键）。
 *
 * 本文件同时钉住一条实测出来的老洞（v2.8.21 遗留）：部署步的补注册重放把已经喂给
 * 派发前那条链的登场事件**又喂了一遍**，于是挂了扩面档的登场技在别人登场那一步响
 * 两遍。`self` 档靠身份键天然撞不上别人的登场，所以两锚一直看不见它。修法＝
 * 「重放只让这一步刚上册的监听听」（core/TransitionCore.ts）。
 * 下面这张表每格都是**恰好**的声数，出现 2 就是双响复发。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine';
import { type EnginePlayer, type EngineState } from './GameState';
import type { GameEvent } from './Event';
import { createAction } from '../action/ActionTypes';
import { allGenerals, type General, type ListenerScope, type Skill } from '../data/generals';
import { syncPlayerSkills } from '../skills/skillCompiler';

const COST = (id: string) => ({ id, name: '粮草', type: '粮草' });

function makeGeneral(id: string, skills: Skill[]): General {
  return { ...allGenerals[0], id, name: '登场钉' + id, skills };
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
      { id: 'deck_1', name: '粮草', type: '粮草' }, { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' }, { id: 'deck_4', name: '粮草', type: '粮草' },
      { id: 'deck_5', name: '粮草', type: '粮草' }, { id: 'deck_6', name: '粮草', type: '粮草' },
    ],
    discardPile: [], drawState: null,
  };
}

/** 登场时＋某一档「我听谁」，效果＝摸一张牌（摸上来的牌归发动者那一席＝玩家）。 */
function deploySkill(scope?: ListenerScope): Skill {
  const trigger = scope ? { type: 'onDeploy' as const, listenerScope: scope } : { type: 'onDeploy' as const };
  return {
    name: '听登场', description: '钉子。',
    trigger,
    effects: [{ id: 'e1', trigger, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  };
}

function drawCount(events: GameEvent[]): number {
  return events.filter(event => event.type === 'DRAW'
    && String((event.data as Record<string, unknown>)?.skillId ?? '').includes('听登场')).length;
}

/**
 * 两步登场：第一步席1 派出带着这枚监听技的那一员将，第二步派另一员
 * （`mateSeat=true`＝同一席位的别的将，否则＝别的席位）。
 * 返回两步各自响的声数。
 */
function runTwoDeploys(scope?: ListenerScope, mateSeat = true): [number, number] {
  const listener = makeGeneral('钉甲', [deploySkill(scope)]);
  const mate = makeGeneral('钉乙', []);
  const foe = makeGeneral('钉丙', []);
  const state: EngineState = makeState([
    makePlayer(1, { fieldGenerals: [], hand: [listener, mate, COST('c1'), COST('c2')] }),
    makePlayer(2, { fieldGenerals: [], hand: [foe, COST('c3'), COST('c4')] }),
  ]);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, engine.state);
  const first = engine.dispatch(createAction('DEPLOY_GENERAL', 1, {
    general: listener, slot: 0, consumeCards: [COST('c1')],
  }));
  syncPlayerSkills(engine, engine.state);
  // 第二步＝`mateSeat` 那一席派出自己手里的那一员将（同席别的将 or 别的席位）。
  const seat = mateSeat ? 1 : 2;
  engine.state.currentPlayerId = seat;
  const second = engine.dispatch(createAction('DEPLOY_GENERAL', seat, {
    general: mateSeat ? mate : foe, slot: mateSeat ? 2 : 0,
    consumeCards: [mateSeat ? COST('c2') : COST('c3')],
  }));
  return [drawCount(first), drawCount(second)];
}

describe('登场时 × 我听谁（v2.9.13 甲档）', () => {
  it('缺省不填＝只听自己：自己登场响一次、同席别的将登场一声不响（扩面前逐字行为）', () => {
    expect(runTwoDeploys(undefined, true)).toEqual([1, 0]);
    expect(runTwoDeploys(undefined, false)).toEqual([1, 0]);
  });

  it('自己登场那一步（新上册的监听经补注册重放，恰好一次）', () => {
    const SELF_DEPLOY: Record<ListenerScope, number> = {
      self: 1, allySeat: 1, others: 0, enemySeat: 0, field: 1,
    };
    for (const scope of Object.keys(SELF_DEPLOY) as ListenerScope[]) {
      expect(runTwoDeploys(scope, true)[0], scope).toBe(SELF_DEPLOY[scope]);
    }
  });

  it('别的席位登场那一步：其他角色／敌方角色／听场上各一次，只听自己与己方席位不响', () => {
    const OTHER_SEAT: Record<ListenerScope, number> = {
      self: 0, allySeat: 0, others: 1, enemySeat: 1, field: 1,
    };
    for (const scope of Object.keys(OTHER_SEAT) as ListenerScope[]) {
      expect(runTwoDeploys(scope, false)[1], scope).toBe(OTHER_SEAT[scope]);
    }
  });

  it('同席位别的将登场：己方角色（含自身）／其他角色（自身以外）／听场上各一次', () => {
    const SAME_SEAT: Record<ListenerScope, number> = {
      self: 0, allySeat: 1, others: 1, enemySeat: 0, field: 1,
    };
    for (const scope of Object.keys(SAME_SEAT) as ListenerScope[]) {
      expect(runTwoDeploys(scope, true)[1], scope).toBe(SAME_SEAT[scope]);
    }
  });

  it('绝不双响：任何一档听同一声最多一次（v2.8.21 部署重放洞的回归线）', () => {
    for (const scope of ['self', 'allySeat', 'others', 'enemySeat', 'field'] as ListenerScope[]) {
      for (const mateSeat of [true, false]) {
        const counts = runTwoDeploys(scope, mateSeat);
        expect(counts, `${scope} mateSeat=${mateSeat}`).toEqual([counts[0], counts[1]]);
        expect(Math.max(...counts), `${scope} mateSeat=${mateSeat} → ${counts.join('/')}`)
          .toBeLessThanOrEqual(1);
      }
    }
  });
});
