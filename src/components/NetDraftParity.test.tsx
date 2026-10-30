/**
 * 联机切片⑤·腿3（v2.9.25）派单第 4 条要的**三方证人**：同一份真 store 材料上，
 * 三个口径不许说两套——
 *
 * ㈠「热座那句／那颗钮」＝真渲染 `components/GeneralDraft.tsx`，读它 DOM 上那颗钮的字面与灰不灰；
 * ㈡「客人那一帧那句」＝房主出帧那一路（`draftListFactsOf` → `buildDraftListFrame`）的 `instruction` 与 `canConfirm`；
 * ㈢「房主重判的结论」＝`judgeDraftConfirm` 拿着**自己发过的那一帧**加当下的 facts 算出来的那一条。
 *
 * 这一格本轮**没有改** `GeneralDraft.tsx` 一个字（派单逐字），所以这条证人就是"不改它"的前提：
 * 那条上下限今天界面上有一份（`GeneralDraft.tsx:21`）、线上有两份（那句人话、那颗钮的布尔、那次重判），
 * 四处的读数都出自同一个 `netDraftList.draftTally`——它一旦跟热座那颗闸分家，这里立刻红。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import GeneralDraft from './GeneralDraft';
import { useGameStore } from '../store/gameStore';
import type { Player } from '../store/gameStoreTypes';
import { buildDraftListFrame, draftListFactsOf, judgeDraftConfirm } from '../network/netDraftList';

/** 两座、两个势力：与隐私证人同一副材料（群那一格真发得出牌，才凑得出"群 1-3"那条闸）。 */
const twoSeats = (): Player[] => [
  { id: 1, name: '玩家1', faction: '魏', seatOrder: 0, generalPool: [] },
  { id: 2, name: '玩家2', faction: '蜀', seatOrder: 1, generalPool: [] },
] as unknown as Player[];

/** 热座面板上那颗「确认征召」／说"还差什么"的钮：屏上只有它带这两句字样。 */
function hotSeatButton(): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.includes('确认征召') || b.textContent?.includes('群势力1-3名'),
  );
  if (!found) throw new Error('热座面板上那颗钮没找到——这一场的三方比对没有左边');
  return found as HTMLButtonElement;
}

/** 摆一份真材料：分发候选 → 按 store 自己那颗勾几名 → 出帧 → 渲染热座 → 房主重判。 */
function scenario(selectMain: number, selectQun: number) {
  useGameStore.getState().distributeDraftGenerals();
  const s = useGameStore.getState();
  expect(s.draftGenerals.length).toBeGreaterThanOrEqual(selectMain);
  expect(s.draftQunGenerals.length).toBeGreaterThanOrEqual(selectQun);
  for (const g of s.draftGenerals.slice(0, selectMain)) s.selectDraftGeneral(g);
  for (const g of s.draftQunGenerals.slice(0, selectQun)) s.selectDraftGeneral(g);

  const state = useGameStore.getState();
  // 正面凭据：店里真勾上了这么多颗（`selectDraftGeneral` 有一条"满 10 颗就静默不加"的兜底，
  // 少了这一句，"两边都按 4 颗判"可能其实是"一边 4 颗一边 10 颗"，比对就空跑了）。
  expect(state.selectedDraftGenerals).toHaveLength(selectMain + selectQun);

  const seat = Number(state.players[state.draftPlayerIndex].id);
  const facts = draftListFactsOf(state);
  const frame = buildDraftListFrame(facts, seat);
  if (frame === null) throw new Error(`第 ${seat} 席那一帧算不出来`);
  render(<GeneralDraft />);
  return { state, frame, hot: hotSeatButton(), verdict: judgeDraftConfirm(facts, frame, seat) };
}

afterEach(() => cleanup());

describe('⑤d 三方证人：热座那颗钮、客人那一帧那句、房主重判的结论，同一份材料上不许说两套', () => {
  beforeEach(() => {
    useGameStore.setState({
      players: twoSeats(),
      phase: 'lobby',
      draftPlayerIndex: 0,
      selectedDraftGenerals: [],
      draftGenerals: [],
      draftQunGenerals: [],
      draftDistributed: [],
      generalEdits: {},
      skillEdits: {},
      disabledGenerals: new Set<string>(),
      authoredGenerals: [],
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('没凑够（4 名、群 2）⇒ 热座那句与客人那一帧那句逐字同一句，两边都灰着，房主也判"还不行"', () => {
    const { state, frame, hot, verdict } = scenario(2, 2);
    expect(frame.instruction).toBe('选择10名将领（群势力1-3名，当前2名）');
    expect(hot.textContent).toBe(frame.instruction); // ㈠与㈡逐字相同
    expect(hot.disabled).toBe(true);
    expect(frame.canConfirm).toBe(false); // ㈡那个布尔跟着同一笔账
    expect(verdict.ok).toBe(false); // ㈢重判的结论同向
    expect((verdict as { reason: string }).reason).toContain('现在 4/10 名、群势力 2 名');
    expect(state.selectedDraftGenerals.filter((g) => g.faction === '群')).toHaveLength(2);
  });

  it('凑够 10 名、群 1 ⇒ 热座那颗按得下去（✓ 确认征召），客人那一帧也说够了，房主重判放行', () => {
    const { frame, hot, verdict } = scenario(9, 1);
    expect(hot.textContent).toBe('✓ 确认征召');
    expect(hot.disabled).toBe(false);
    expect(frame.canConfirm).toBe(true);
    expect(frame.instruction).toContain('名单凑够了 10 名（群势力 1 名）');
    expect(frame.instruction).toContain('确认征召'); // ㈢放行时，㈡那句说的就是"可以按这颗"
    expect(verdict).toEqual({ ok: true });
  });

  it('10 名里一颗群牌也没有 ⇒ 三处一起说"不行"，且热座与客人说的是同一句（当前0名）', () => {
    const { frame, hot, verdict } = scenario(10, 0);
    expect(hot.textContent).toBe('选择10名将领（群势力1-3名，当前0名）');
    expect(hot.textContent).toBe(frame.instruction);
    expect(frame.canConfirm).toBe(false);
    expect(hot.disabled).toBe(true);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('现在 10/10 名、群势力 0 名');
  });

  it('群超过 3 名（10 名里 4 颗群）⇒ 人数够了也不算：三处同向，那句里的"当前4名"两边一个数', () => {
    const { frame, hot, verdict } = scenario(6, 4);
    expect(hot.textContent).toBe('选择10名将领（群势力1-3名，当前4名）');
    expect(hot.textContent).toBe(frame.instruction);
    expect(frame.canConfirm).toBe(false);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('群势力 4 名');
  });

  it('那一帧上的位置号与热座那几颗"退一颗"的小钮指的是同样那几张牌（按 store 的下标一一对得上）', () => {
    const { state, frame } = scenario(2, 2);
    // ㈡那一格上的"已选"＝㈠屏上那几颗小钮：两边都是店里 `selectedDraftGenerals` 那几张，
    // 只是㈠画名字、㈡发位置号（`m${i}`＝`draftGenerals[i]`、`q${j}`＝`draftQunGenerals[j]`，编号规则住 `draftListFactsOf`）。
    const keyOf = (k: string): string =>
      (k.startsWith('q') ? state.draftQunGenerals[Number(k.slice(1))] : state.draftGenerals[Number(k.slice(1))]).name;
    const expectKeys = [
      ...state.draftGenerals.slice(0, 2).map((_, i) => `m${i}`),
      ...state.draftQunGenerals.slice(0, 2).map((_, i) => `q${i}`),
    ];
    expect(frame.picked).toEqual(expectKeys);
    const chips = [...document.querySelectorAll('button')]
      .filter((b) => b.textContent?.includes('✕'))
      .map((b) => (b.textContent ?? '').replace(/\s+/g, ''));
    expect(chips).toEqual(expectKeys.map((k) => `${keyOf(k)}✕`));
  });
});
