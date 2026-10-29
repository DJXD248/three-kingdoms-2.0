/**
 * 视角轴／动手轴在**真组件**上分家的证人（v2.9.25 联机切片②）。
 *
 * `seatLayout.test.ts` 钉的是纯函数；这里钉的是 `GameBoard` 里那几个接点真的接上了：
 *
 *  1. 不传 `viewSeat`（本地热座、房主本机自己点）⇒ 下面那一格还是**正在动手的那一席**，
 *     底部那句话说到底与拆轴前逐字相同。
 *  2. 传 `viewSeat` ⇒ 只有"哪一席画在下面"跟着视角走；将领池、回合标题仍然全部跟着
 *     动手那一席转 ⇒ 两根轴确实分开了，不是一起搬走了。
 *  3. 视角指到桌上没有的席位号 ⇒ 退回动手那一格，画面照常（客人还没收到席位表那一刻）。
 *  4. 底部那句「你的回合」只在"下面这一格正是动手那一席"时才说出口：客人盯着自己的
 *     营地时不会被一句假话骗（§12-112）。
 *
 * 取"下面那一格"的办法：营地行的说明 `span` 按 JSX 渲染顺序出现在 DOM 里（先上后下），
 * 所以最后一个 `{名}({势力}…` 就是底部那一行；不靠 class、不靠内联样式。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import GameBoard from '../GameBoard';
import { useGameStore, type Player } from '../../store/gameStore';
import type { General } from '../../data/generals';
import type { EngineState } from '../../core/GameState';

function seatPlayer(id: number, name: string, poolSize: number): Player {
  return {
    id, name, faction: '蜀', seatOrder: id, diceRoll: 10 + id,
    // 将领池只被按钮读一个长度（展开明细的那个弹层要点了才建），所以这里放占位对象即可：
    // 这一格的数量就是"动手轴现在指的是谁"的读数。
    generalPool: Array.from({ length: poolSize }, () => ({}) as General),
    hand: [], fieldGenerals: [], graveyard: [],
    baseHp: 6, baseMaxHp: 6, isAlive: true, isSpectating: false, avatarGeneral: null,
    isAi: false,
  } as Player;
}

/**
 * 两把椅子的牌桌：**此刻轮到第 2 席**（`currentPlayerIndex: 1`）。
 * 第 1 席的将领池给 2 张、第 2 席给 0 张 ⇒ 「👤将领池(N)」这一个数字就能认出动手轴指谁。
 * `players` 与 `engineState.players` 同一份引用（生产镜像口径，见 `gameStoreRecovery.test.ts`）。
 */
function installTwoSeatTable(actingSeat: 1 | 2 = 2) {
  const players = [seatPlayer(1, '房主甲', 2), seatPlayer(2, '客人甲', 0)];
  const engineState = {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: actingSeat,
    turn: 3,
    round: 2,
    deck: [],
    discardPile: [],
    drawState: null,
    rngState: { s: 4242 },
    metadata: { roomId: 'VIEWAX1' },
  } as unknown as EngineState;
  act(() => {
    useGameStore.setState({
      phase: 'playing',
      turnPhase: 'main',
      playerCount: 2,
      engineState,
      players,
      currentPlayerIndex: actingSeat - 1,
      currentRound: engineState.round,
      turnEndAsk: null,
      reactionWindow: null,
      pendingTurnTransition: null,
      drawContext: null,
      revealedDrawCards: [],
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });
  return { container: document.body };
}

/** 营地行那几枚说明 `span`（DOM 顺序＝渲染顺序：先上后下）。 */
function seatRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('span')]
    .map(s => (s.textContent ?? '').trim())
    .filter(t => /^(房主甲|客人甲)\(蜀/.test(t));
}
const bottomRow = (container: HTMLElement) => seatRows(container).at(-1) ?? '';
const poolButton = (container: HTMLElement) =>
  [...container.querySelectorAll('button')].map(b => (b.textContent ?? '').trim()).filter(t => t.startsWith('👤将领池(')).at(-1) ?? '';
const turnTitle = (container: HTMLElement) =>
  [...container.querySelectorAll('span')].map(s => (s.textContent ?? '').trim()).filter(t => /^(房主甲|客人甲)$/.test(t))[0] ?? '';

afterEach(cleanup);

describe('GameBoard 视角轴：不传 viewSeat ⇒ 本地热座那帧画面一字不差', () => {
  it('下面一格＝动手那一席，那句话说到底与拆轴前逐字相同', () => {
    installTwoSeatTable(2);
    const { container } = render(<GameBoard />);
    expect(seatRows(container)).toEqual(['房主甲(蜀)', '客人甲(蜀) — 你的回合']);
    // 动手轴的读数：将领池取的是第 2 席（0 张），回合标题也是第 2 席。
    expect(poolButton(container)).toBe('👤将领池(0)');
    expect(turnTitle(container)).toBe('客人甲');
  });

  it('对照：动手换到第 1 席 ⇒ 将领池跟着换成 2 张（这个读数不是写死的）', () => {
    installTwoSeatTable(1);
    const { container } = render(<GameBoard />);
    expect(poolButton(container)).toBe('👤将领池(2)');
    expect(turnTitle(container)).toBe('房主甲');
    expect(seatRows(container)).toEqual(['客人甲(蜀)', '房主甲(蜀) — 你的回合']);
  });
});

describe('GameBoard 视角轴：客人视角接上之后', () => {
  it('视角指到第 1 席、动手还在第 2 席 ⇒ 只有"下面那一格"搬走了，动手轴的读数一位不动', () => {
    installTwoSeatTable(2);
    const { container } = render(<GameBoard viewSeat={1} />);
    // 上面＝第 2 席（动手那一席被顶到上面），下面＝第 1 席（客人自己的营地）。
    expect(seatRows(container)).toEqual(['客人甲(蜀)', '房主甲(蜀)']);
    // 这一句是"两轴真分家"的硬证：手牌/将领池/回合标题仍跟着动手那一席。
    expect(poolButton(container)).toBe('👤将领池(0)');
    expect(turnTitle(container)).toBe('客人甲');
  });

  it('下面那一格不是动手那一席时，那句「你的回合」不收口 ⇒ 客人不会被假话骗', () => {
    installTwoSeatTable(2);
    const { container } = render(<GameBoard viewSeat={1} />);
    expect(bottomRow(container)).toBe('房主甲(蜀)');
    expect(seatRows(container).join(' ')).not.toContain('你的回合');
  });

  it('视角那一格恰好也轮到动手 ⇒ 那句话照样说出口（本地与"轮到我"的客人一致）', () => {
    installTwoSeatTable(2);
    const { container } = render(<GameBoard viewSeat={2} />);
    expect(seatRows(container)).toEqual(['房主甲(蜀)', '客人甲(蜀) — 你的回合']);
  });

  it('AI 那一席动手：本地视角（下面就是它）照旧说「AI 出手中…」，客人视角半个字也不说', () => {
    installTwoSeatTable(2);
    act(() => {
      const s = useGameStore.getState();
      const players = s.players.map(p => (p.id === 2 ? { ...p, isAi: true } : p));
      useGameStore.setState({ players, engineState: { ...s.engineState, players } as unknown as EngineState });
    });
    expect(seatRows(render(<GameBoard />).container)).toEqual(['房主甲(蜀)', '客人甲(蜀) — AI 出手中…']);
    // 客人盯着自己那格时：动手那一席在顶上，底部既不说「你的回合」、也不说「AI 出手中…」。
    expect(seatRows(render(<GameBoard viewSeat={1} />).container)).toEqual(['客人甲(蜀)', '房主甲(蜀)']);
  });

  it('席位号在桌上找不到（还没收到席位表）⇒ 退回动手那一格，画面照常', () => {
    installTwoSeatTable(2);
    const { container } = render(<GameBoard viewSeat={99} />);
    expect(seatRows(container)).toEqual(['房主甲(蜀)', '客人甲(蜀) — 你的回合']);
    expect(poolButton(container)).toBe('👤将领池(0)');
  });
});
