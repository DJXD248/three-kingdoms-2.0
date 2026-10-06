/**
 * 「整备」到底怎么解除——三条路的证人（用户 2026-10-06 裁：把"被打也解除"去掉）。
 *
 * 大白话结论：叠完甲定住之后，**挨打不会把它打掉**，能收掉它的只有三条路——
 * ① 下个回合开始自动解除（已由 `EventProcessor.test.ts` 的 TURN_ACTIONS_RESET 那枚钉子钉住）；
 * ② 这名将领被打死、随离场一起收掉（本文件钉）；
 * ③ 身上军备被拆到一张不剩（已由 `EventProcessor.test.ts` 的「剥空收场」两枚钉子钉住）。
 * 本文件补的是过去没有任何证人挡住的那一格：**打不死的那一刀，整备照旧在**。
 */
import { describe, it, expect } from 'vitest';
import { EventProcessor } from './EventProcessor';
import { createInitialEngineState, type EngineState, type EnginePlayer } from './GameState';
import type { GameEvent } from './Event';

function makeState(fg: Record<string, unknown>): EngineState {
  const player = {
    id: 1, name: '玩家1', hp: 4, hand: [], generalPool: [], graveyard: [],
    baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
    fieldGenerals: [fg],
  } as unknown as EnginePlayer;
  return {
    ...createInitialEngineState(),
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [player],
    currentPlayerId: 1,
    turn: 1,
    round: 1,
  } as EngineState;
}

function armingGeneral(currentHp: number) {
  return {
    general: { id: 'g1', name: '夏侯惇', hp: 4, type: '武将', faction: '魏' },
    currentHp,
    maxHp: 4,
    currentArmor: 2,
    armorCards: [{ id: 'armor_1', name: '军备', type: '军备' }],
    isArming: true,
    hasMoved: false,
    hasAttacked: false,
    hasSupplied: false,
    justDeployed: false,
    ownerId: 1,
    position: { zone: 'camp', slot: 0, areaOwnerId: 1 },
  };
}

const processor = new EventProcessor();

function damageEvent(value: number, extra: Record<string, unknown> = {}): GameEvent {
  return {
    type: 'DAMAGE',
    data: {
      targetPlayerId: 1,
      targetId: 'g1',
      damageType: 'skill',
      value,
      ...extra,
    },
  } as GameEvent;
}

describe('整备的解除只有那三条路', () => {
  it('挨一刀打不死：血掉了、整备还在', () => {
    const state = makeState(armingGeneral(4));
    const result = processor.process(state, [damageEvent(3)]);
    const fg = result.players[0].fieldGenerals?.[0] as any;
    expect(fg.currentHp).toBe(2); // 3 点伤害、2 点护甲：挡掉 1 点 ⇒ 掉 2 点血、护甲见底
    expect(fg.currentArmor).toBe(0);
    expect(fg.isArming).toBe(true);
  });

  it('那一刀被护甲全吃满（一点血没掉）：整备照样还在', () => {
    const state = makeState(armingGeneral(4));
    const result = processor.process(state, [damageEvent(0)]);
    const fg = result.players[0].fieldGenerals?.[0] as any;
    expect(fg.currentHp).toBe(4);
    expect(fg.isArming).toBe(true);
  });

  it('被打死：随离场把整备收掉（第二条路的正面证人）', () => {
    const state = makeState(armingGeneral(1));
    const result = processor.process(state, [damageEvent(9)]);
    expect(result.players[0].fieldGenerals?.length ?? 0).toBe(0);
    const graveyard = result.players[0].graveyard as any[];
    expect(graveyard.length).toBe(1);
    // 离场那一份副本上的整备标记已清——它不再以"定住"状态复活。
    expect((graveyard[0] as any).isArming ?? false).toBe(false);
  });
});
