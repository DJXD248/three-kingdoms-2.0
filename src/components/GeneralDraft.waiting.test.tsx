/**
 * 2026-11-13 用户口令：「征召页面不要变化，只要下方的征召按钮换成一句『正在等待其他玩家完成征召』」。
 *
 * 这一格专钉**房主屏**那半边：自己那一席交卷之后，store 会把候选／已选／席位名换成下一席的，
 * 整屏必须照自己最后看到的那份画回去，只换底部那颗钮。
 * 同时钉住**本地热座**（`seatLocked` 恒 false）行为一字未变 —— 那一屏本来就该跟着轮次换人。
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../store/gameStoreTypes';
import { useGameStore } from '../store/gameStore';
import GeneralDraft from './GeneralDraft';

afterEach(cleanup);

const card = (id: string, name: string, faction: '魏' | '蜀' | '群') => ({
  id, name, faction, type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: [],
});

const OWN_MAIN = [card('c-m0', '本将甲', '魏'), card('c-m1', '本将乙', '魏')];
const OWN_QUN = [card('c-q0', '群将甲', '群')];
const OTHER_MAIN = [card('o-m0', '客将甲', '蜀')];
const OWN_SELECTED = [
  ...Array.from({ length: 9 }, (_, i) => card(`s-m${i}`, `册外主${i}`, '魏')),
  card('s-q0', '册外群0', '群'),
];

const PLAYERS = [
  { id: 1, name: '玩家1', faction: '魏', seatOrder: 0, generalPool: [] },
  { id: 2, name: '玩家2', faction: '蜀', seatOrder: 1, generalPool: [] },
] as unknown as Player[];

const setState = (over: Record<string, unknown>) => {
  useGameStore.setState(over as Partial<ReturnType<typeof useGameStore.getState>>);
};

const cardButton = (name: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll('button')].find(b => b.querySelector('h3')?.textContent === name);
  if (!found) throw new Error(`候选牌「${name}」没上屏`);
  return found as HTMLButtonElement;
};

describe('房主屏：本席交卷后等别席，整屏不动只换按钮', () => {
  it('换成下一席的候选后，卡片、已选栏、计数、席位名仍是自己那一席的', () => {
    const selectDraftGeneral = vi.fn();
    const confirmDraft = vi.fn();
    setState({
      phase: 'generalDraft', draftPlayerIndex: 0, players: PLAYERS,
      draftGenerals: OWN_MAIN, draftQunGenerals: OWN_QUN, selectedDraftGenerals: OWN_SELECTED,
      selectDraftGeneral, confirmDraft,
    });
    const { rerender, container } = render(<GeneralDraft />);
    // 交卷前：自己这一席、凑够 10 名 ⇒ 那颗钮亮着写「✓ 确认征召」。
    expect((screen.getByRole('button', { name: '✓ 确认征召' }) as HTMLButtonElement).disabled).toBe(false);

    // 一次更新里同时换轮次、换候选、换席位闸（与真机上 confirmDraft 之后 React 批处理的那一帧同形）。
    act(() => {
      setState({
        draftPlayerIndex: 1,
        draftGenerals: OTHER_MAIN, draftQunGenerals: [], selectedDraftGenerals: [],
        selectDraftGeneral, confirmDraft,
      });
      rerender(<GeneralDraft seatLocked />);
    });

    // 画面：候选仍是自己那批、没有换上别人的；已选栏 10 张仍在；计数仍是 10/10；标题仍是玩家1。
    expect(container.textContent).toContain('本将甲');
    expect(container.textContent).not.toContain('客将甲');
    expect(container.textContent).toContain('玩家1');
    expect(container.textContent?.replace(/\s+/g, '')).toContain('已选10/10');
    expect(screen.getByRole('button', { name: /册外主0 ✕/ })).toBeTruthy();

    // 按钮：逐字换成那一句，且灰着。
    const btn = screen.getByRole('button', { name: '正在等待其他玩家完成征召' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.textContent).not.toContain('这一席是别人的');
    expect(container.textContent).not.toContain('✓ 确认征召');
  });

  it('等待期间点卡片、点已选栏都不发车', () => {
    const selectDraftGeneral = vi.fn();
    const confirmDraft = vi.fn();
    setState({
      phase: 'generalDraft', draftPlayerIndex: 0, players: PLAYERS,
      draftGenerals: OWN_MAIN, draftQunGenerals: OWN_QUN, selectedDraftGenerals: OWN_SELECTED,
      selectDraftGeneral, confirmDraft,
    });
    const { rerender } = render(<GeneralDraft />);
    act(() => {
      setState({
        draftPlayerIndex: 1, draftGenerals: OTHER_MAIN, draftQunGenerals: [], selectedDraftGenerals: [],
        selectDraftGeneral, confirmDraft,
      });
      rerender(<GeneralDraft seatLocked />);
    });

    cardButton('本将甲').click();
    screen.getByRole('button', { name: /册外主0 ✕/ }).click();
    expect(selectDraftGeneral).not.toHaveBeenCalled();
    expect(confirmDraft).not.toHaveBeenCalled();
  });

  it('本地热座（席位闸恒关）换人时画面照常跟着换，不被缓存锁住', () => {
    const selectDraftGeneral = vi.fn();
    const confirmDraft = vi.fn();
    setState({
      phase: 'generalDraft', draftPlayerIndex: 0, players: PLAYERS,
      draftGenerals: OWN_MAIN, draftQunGenerals: OWN_QUN, selectedDraftGenerals: [],
      selectDraftGeneral, confirmDraft,
    });
    const { rerender, container } = render(<GeneralDraft />);
    expect(container.textContent).toContain('本将甲');
    act(() => {
      setState({ draftPlayerIndex: 1, draftGenerals: OTHER_MAIN, draftQunGenerals: [], selectedDraftGenerals: [] });
      rerender(<GeneralDraft />);
    });
    expect(container.textContent).toContain('客将甲');
    expect(container.textContent).not.toContain('本将甲');
    expect(screen.queryByRole('button', { name: '正在等待其他玩家完成征召' })).toBeNull();
  });

  it('从没轮到过自己（一上来就被席位闸挡住）不冒充「已完成在等别人」', () => {
    setState({
      phase: 'generalDraft', draftPlayerIndex: 1, players: PLAYERS,
      draftGenerals: OTHER_MAIN, draftQunGenerals: [], selectedDraftGenerals: [],
    });
    render(<GeneralDraft seatLocked />);
    expect(screen.getByRole('button', { name: '这一席是别人的，等他在自己电脑上选' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '正在等待其他玩家完成征召' })).toBeNull();
  });
});
