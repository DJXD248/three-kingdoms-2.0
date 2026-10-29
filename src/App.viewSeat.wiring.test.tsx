/**
 * 视角轴接线到底接通了没有——这一份钉的是**真屏幕**（v2.9.25 联机切片⑤）。
 *
 * `GameBoard.viewAxis.test.tsx` 证的是「把 `viewSeat` 交给牌桌，牌桌就只搬下面那一格」；
 * `netRoom.test.ts` 证的是「我这台机器坐第几席」那一句读得对。中间那一节——**没人把它俩连起来**——
 * 正好是本地/联机最容易接错的地方：接线一旦漏掉，牌桌永远收不到视角，客人那屏还是跟着
 * 轮到谁翻转，而两头的测试全都还是绿的。所以这里从 `App` 挂一次，走完整那条路。
 *
 * 三张场景按用户 2026-10-30 的三条读法各一枚：
 *  1. 联机、我这台机器绑在第 1 席、动手的是第 2 席 ⇒ 下面那一格是我的营地，动手轴一位不动；
 *  2. 本地（没开联机房）⇒ 逐字还是今天那帧画面（第 1 条：形状不许变）；
 *  3. 连了房但席位表里还没绑到我 ⇒ 不擅自翻转，照旧是那帧本地画面。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import App from './App';
import { useGameStore, type Player } from './store/gameStore';
import type { General } from './data/generals';
import type { EngineState } from './core/GameState';
import { attachRoom, detachRoom, receiveSeatMap } from './network/netRoom';

function seatPlayer(id: number, name: string, poolSize: number): Player {
  return {
    id, name, faction: '蜀', seatOrder: id, diceRoll: 10 + id,
    generalPool: Array.from({ length: poolSize }, () => ({}) as General),
    hand: [], fieldGenerals: [], graveyard: [],
    baseHp: 6, baseMaxHp: 6, isAlive: true, isSpectating: false, avatarGeneral: null,
    isAi: false,
  } as Player;
}

/** 两把椅子的牌桌，此刻**轮到第 2 席**；第 1 席将领池 2 张、第 2 席 0 张＝动手轴的读数。 */
function installTwoSeatTable() {
  const players = [seatPlayer(1, '房主甲', 2), seatPlayer(2, '客人甲', 0)];
  const engineState = {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: 2,
    turn: 3,
    round: 2,
    deck: [],
    discardPile: [],
    drawState: null,
    rngState: { s: 4242 },
    metadata: { roomId: 'APPVIEWS1' },
  } as unknown as EngineState;
  act(() => {
    useGameStore.setState({
      // AI 司机在这份局面里没有椅子可坐（两席都是人），关掉它是为了这条定时器绝不
      // 在挂载期间替谁走一步——这一刀要看的是画面，不是谁动了。
      isTestMode: true,
      phase: 'playing',
      turnPhase: 'main',
      playerCount: 2,
      engineState,
      players,
      currentPlayerIndex: 1,
      currentRound: engineState.round,
      turnEndAsk: null,
      reactionWindow: null,
      pendingTurnTransition: null,
      drawContext: null,
      revealedDrawCards: [],
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });
}

function attachGuestRoom(selfId: string) {
  const connection = {
    state: { role: 'guest', selfId, name: '客人', roomCode: 'APPVIEWS', phase: 'in-room', note: '', peers: [] },
    leave: vi.fn(),
    send: vi.fn(() => true),
  };
  attachRoom({
    role: 'guest', name: '客人', roomCode: 'APPVIEWS',
    address: 'ws://x', url: 'ws://x/APPVIEWS', connection: connection as never,
  });
  return connection;
}

/** 营地行按 DOM 顺序（先上后下）：最后一个就是画在正下方那一格。 */
function seatRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('span')]
    .map(s => (s.textContent ?? '').trim())
    .filter(t => /^(房主甲|客人甲)\(蜀/.test(t));
}
const poolButton = (container: HTMLElement) =>
  [...container.querySelectorAll('button')].map(b => (b.textContent ?? '').trim())
    .filter(t => t.startsWith('👤将领池(')).at(-1) ?? '';

afterEach(() => {
  cleanup();
  detachRoom();
});

describe('App 把视角轴接到牌桌上（切片⑤）', () => {
  it('联机、我绑在第 1 席：下面那一格换成我的营地，动手轴的读数一位不动', () => {
    installTwoSeatTable();
    attachGuestRoom('guest-1');
    // 把 selfId 绑在第 1 席（动手的是第 2 席）⇒ 两轴分开，这才看得出接线有没有接上。
    receiveSeatMap([
      { peer: 'host-1', seat: 2, name: '房主' },
      { peer: 'guest-1', seat: 1, name: '客人' },
    ]);
    const { container } = render(<App />);
    // 视角轴：第 1 席（房主甲）画在正下方，动手那一席被顶到上面。
    expect(seatRows(container)).toEqual(['客人甲(蜀)', '房主甲(蜀)']);
    // 动手轴：仍跟着第 2 席——这一条就是「两根轴不是一起搬走的」的屏幕级硬证。
    expect(poolButton(container)).toBe('👤将领池(0)');
  });

  it('本地游戏（没开联机房）：逐字还是今天那帧——下面就是动手那一格，那句「你的回合」在', () => {
    installTwoSeatTable();
    const { container } = render(<App />);
    expect(seatRows(container)).toEqual(['房主甲(蜀)', '客人甲(蜀) — 你的回合']);
    expect(poolButton(container)).toBe('👤将领池(0)');
  });

  it('连了房、席位表里还没绑到我：不擅自翻转，照旧是那帧本地画面', () => {
    installTwoSeatTable();
    attachGuestRoom('guest-9');
    receiveSeatMap([
      { peer: 'host-1', seat: 1, name: '房主' },
      { peer: 'guest-1', seat: 2, name: '客人' },
    ]);
    const { container } = render(<App />);
    expect(seatRows(container)).toEqual(['房主甲(蜀)', '客人甲(蜀) — 你的回合']);
  });
});
