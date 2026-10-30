/**
 * 联机切片⑤·腿3（v2.9.25）派单第 4 条要的**三方证人**（更正轮起是四方）：同一份真 store 材料上，
 * 几个口径不许说两套——
 *
 * ㈠「热座那句／那颗钮」＝真渲染 `components/GeneralDraft.tsx`，读它 DOM 上那颗钮的字面与灰不灰；
 * ㈡「客人那一帧那句」＝房主出帧那一路（`draftListFactsOf` → `buildDraftListFrame`）的 `instruction` 与 `canConfirm`；
 * ㈢「房主重判的结论」＝`judgeDraftConfirm` 拿着**自己发过的那一帧**加当下的 facts 算出来的那一条；
 * ㈣（更正轮㈠要的）「客人那颗钮的字面」＝真渲染 `NetDraftListPanel`，读它那颗「确认征召」灰着时写的什么。
 *
 * ㈣为什么单独立一条：腿3 交回的那一版里，客人那颗钮灰着时写的是界面自己拼的
 * `选择${total}名将领（群势力1-3名，还没凑够）`，而 `canConfirm` 为假有三种成因，其中两种
 * （10 名里 0 颗群牌、10 名里 4 颗群牌）**恰恰是人数早就凑够了**——那一屏于是说一句假话。
 * 现在那颗钮直接画 `frame.instruction`，于是 ㈠＝㈡＝㈣ 逐字，界面上一个字也不另写。
 *
 * 数量那一档今天从 `GeneralDraft.tsx` 搬进了 `domain/draftQuota`（更正轮㈡，分支逐字未改），
 * 所以热座那颗钮与房主的重判读的是同一把尺；下面那组"逐颗比对"量的就是这件事——
 * 而**身份锁那一半仍只在热座面板**（它要读数据层的 identity 机器），那是登记在册的已知差异，不是"两边一致"。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import GeneralDraft from './GeneralDraft';
import { NetDraftListPanel } from './NetDraftListPanel';
import { useGameStore } from '../store/gameStore';
import type { Player } from '../store/gameStoreTypes';
import { buildDraftListFrame, draftListFactsOf, judgeDraftConfirm, judgeDraftPick } from '../network/netDraftList';

/** 两座、两个势力：与隐私证人同一副材料（群那一格真发得出牌，才凑得出"群 1-3"那条闸）。 */
const twoSeats = (): Player[] => [
  { id: 1, name: '玩家1', faction: '魏', seatOrder: 0, generalPool: [] },
  { id: 2, name: '玩家2', faction: '蜀', seatOrder: 1, generalPool: [] },
] as unknown as Player[];

/** 热座面板上那颗「确认征召」／说"还差什么"的钮：那张桌上只有它带这两句字样。 */
function buttonLabeled(scope: ParentNode, ...needles: string[]): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((b) => needles.some((n) => b.textContent?.includes(n)));
  if (!found) throw new Error(`那颗钮没找到（要找的字样：${needles.join('／')}）——这一场的比对少了一边`);
  return found as HTMLButtonElement;
}

const hotSeatCardButtons = (scope: ParentNode): HTMLButtonElement[] =>
  [...scope.querySelectorAll('button.relative')] as HTMLButtonElement[];

/** 摆一份真材料：分发候选 → 按 store 自己那颗勾几名 → 出帧 → 渲染热座 → 房主重判 → 再把客人那一格也摆出来。 */
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
  const hotView = render(<GeneralDraft />);
  // ㈠先读，㈣后读：`hotSeatButton` 扫的是整张文档，客人那一格那时还没摆上来。
  const hot = buttonLabeled(hotView.container, '确认征召', '群势力1-3名');
  const guestView = render(<NetDraftListPanel frame={frame} onPick={() => {}} onConfirm={() => {}} />);
  const guest = buttonLabeled(guestView.container, '确认征召', '群势力1-3名', '选择10名将领');
  const verdict = judgeDraftConfirm(facts, frame, seat);
  return { state, facts, frame, seat, hot, guest, hotContainer: hotView.container, verdict };
}

/** 热座那两格候选按 DOM 顺序摆（本势力一批、随后群一批），与帧上的位置号是同一段下标：
 *  所以逐颗比对**按下标**对，不按名字对（真名会重复，按名字找会认错人）。这里顺手把"对错位"钉住。 */
function hotSeatCardClickable(sc: ReturnType<typeof scenario>, key: string): boolean {
  const isQun = key.startsWith('q');
  const idx = Number(key.slice(1));
  const card = isQun ? sc.state.draftQunGenerals[idx] : sc.state.draftGenerals[idx];
  const buttons = hotSeatCardButtons(sc.hotContainer);
  const button = buttons[isQun ? sc.state.draftGenerals.length + idx : idx];
  if (!button || !button.textContent?.includes(card.name)) {
    throw new Error(`位置号 ${key} 对不上热座屏上那颗牌（比对少了一边，不许空跑）`);
  }
  // 牌那颗钮变暗的唯一路径：`GeneralDraft.tsx` 里 `!isSelected && !isSelectable` 那一路给 `cursor-not-allowed`。
  return !button.className.includes('cursor-not-allowed');
}

/** 这一场里每一颗候选的位置号（与帧上那两份名单同一套编号规则，住 `draftListFactsOf`）。 */
const everyKey = (state: ReturnType<typeof scenario>['state']): string[] => [
  ...state.draftGenerals.map((_, i) => `m${i}`),
  ...state.draftQunGenerals.map((_, j) => `q${j}`),
];

afterEach(() => cleanup());

const resetTable = () =>
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

describe('⑤d 三方证人：热座那颗钮、客人那一帧那句、房主重判的结论，同一份材料上不许说两套', () => {
  beforeEach(resetTable);

  it('没凑够（4 名、群 2）⇒ 热座那句与客人那一帧那句逐字同一句，两边都灰着，房主也判"还不行"', () => {
    const { state, frame, hot, guest, verdict } = scenario(2, 2);
    expect(frame.instruction).toBe('选择10名将领（群势力1-3名，当前2名）');
    expect(hot.textContent).toBe(frame.instruction); // ㈠与㈡逐字相同
    expect(guest.textContent).toBe(frame.instruction); // ㈣照抄，一个字也不另写
    expect(guest.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('还没凑够');
    expect(hot.disabled).toBe(true);
    expect(frame.canConfirm).toBe(false); // ㈡那个布尔跟着同一笔账
    expect(verdict.ok).toBe(false); // ㈢重判的结论同向
    expect((verdict as { reason: string }).reason).toContain('现在 4/10 名、群势力 2 名');
    expect(state.selectedDraftGenerals.filter((g) => g.faction === '群')).toHaveLength(2);
  });

  it('凑够 10 名、群 1 ⇒ 热座那颗按得下去（✓ 确认征召），客人那一帧也说够了，房主重判放行', () => {
    const { frame, hot, guest, verdict } = scenario(9, 1);
    expect(hot.textContent).toBe('✓ 确认征召');
    expect(hot.disabled).toBe(false);
    expect(guest.textContent).toBe('✓ 确认征召'); // ㈣够了才换成这一句，两边同一个字面
    expect(guest.disabled).toBe(false);
    expect(frame.canConfirm).toBe(true);
    expect(frame.instruction).toContain('名单凑够了 10 名（群势力 1 名）');
    expect(frame.instruction).toContain('确认征召'); // ㈢放行时，㈡那句说的就是"可以按这颗"
    expect(verdict).toEqual({ ok: true });
  });

  /** ⚠️ 这一场是更正轮㈠ 逮到的那句假话：人数**早就凑够了**，卡的是群势力一名也没有。
   *  改之前那颗钮灰着时自己拼一句"还没凑够"，正是在这里说的假话。 */
  it('10 名里一颗群牌也没有 ⇒ 三处一起说"不行"，且热座与客人说的是同一句（当前0名）', () => {
    const { frame, hot, guest, verdict } = scenario(10, 0);
    expect(hot.textContent).toBe('选择10名将领（群势力1-3名，当前0名）');
    expect(hot.textContent).toBe(frame.instruction);
    expect(guest.textContent).toBe(frame.instruction); // ㈣与㈠㈡逐字同一句：报数、不下判断
    expect(guest.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('还没凑够'); // 10 名已经勾满了，这句是假话
    expect(frame.canConfirm).toBe(false);
    expect(hot.disabled).toBe(true);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('现在 10/10 名、群势力 0 名');
  });

  /** 同上：这一场的 10 名里 4 颗是群牌，人数那一档同样早就够了。 */
  it('群超过 3 名（10 名里 4 颗群）⇒ 人数够了也不算：三处同向，那句里的"当前4名"两边一个数', () => {
    const { frame, hot, guest, verdict } = scenario(6, 4);
    expect(hot.textContent).toBe('选择10名将领（群势力1-3名，当前4名）');
    expect(hot.textContent).toBe(frame.instruction);
    expect(guest.textContent).toBe(frame.instruction);
    expect(guest.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('还没凑够');
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

/**
 * 更正轮㈡ 要的**逐颗**比对：热座那颗牌点得动吗 ⇔ 房主重判放行吗。
 * 派单逐字把这三个形状点了名——群 3 名时的第 4 颗群牌、已勾满 10 颗时再点一颗、9 主 0 群时的第 10 颗主牌。
 *
 * ⚠️ 这一条只比**数量**那一档：身份锁那一半仍只在热座面板（`GeneralDraft.tsx` 的 `lockConflicts`，
 * 它要读数据层那台 identity 机器，`network/netDraftList` 这一层不 import 数据层）。
 * 所以每一场都先拿正面凭据钉住"这一场没有身份冲突"——否则两边比的不是同一把尺，是登记在册的已知差异。
 */
describe('更正轮㈡ 逐颗比对：同一份真材料上，热座点不动的那一颗，房主重判也不许放行', () => {
  beforeEach(resetTable);

  /** 摆好材料，再把每一颗候选的两个读数一次取齐。 */
  function compare(selectMain: number, selectQun: number) {
    const sc = scenario(selectMain, selectQun);
    // 正面凭据：这一场压根没有身份冲突（那句提示只有 `conflictCount > 0` 才渲染），
    // 于是"热座点不动"这一侧剩下的成因只有数量那一档，比对才不是拿两把尺对。
    expect(document.body.textContent).not.toContain('身份冲突');
    const rows = everyKey(sc.state).map((key) => {
      const picked = sc.frame.picked.includes(key);
      const verdict = judgeDraftPick(sc.facts, sc.frame, sc.seat, key);
      return { key, picked, clickable: hotSeatCardClickable(sc, key), allowed: verdict.ok, reason: (verdict as { reason?: string }).reason };
    });
    return { ...sc, rows };
  }

  /** 两边逐颗同向；被拒的那一颗必有那句人话（不许走到"什么都没发"那一步）。 */
  const sameDirection = (sc: ReturnType<typeof compare>): void => {
    for (const r of sc.rows) {
      const label = `${r.key}（已勾 ${sc.frame.picked.length}/10、群 ${sc.rows.filter((x) => x.picked && x.key.startsWith('q')).length} 名）`;
      expect(r.allowed, label).toBe(r.clickable);
      if (!r.allowed) expect(r.reason, `${label} 被拒却一句话也不说`).toBeTruthy();
    }
  };

  it('群势力已经 3 名 ⇒ 第 4 颗群牌：热座那颗是暗的，房主重判也拒，拒话说的是那一条闸', () => {
    const sc = compare(5, 3); // 8 颗勾着：人数还差 2 颗，挡下第 4 颗群牌的只可能是群上限
    expect(sc.frame.picked).toHaveLength(8);
    expect(sc.rows.filter((r) => r.picked && r.key.startsWith('q'))).toHaveLength(3);
    sameDirection(sc);
    const fourth = sc.rows.find((r) => r.key === 'q3');
    if (!fourth) throw new Error('那份材料没发出第 4 颗群牌（候选不足 4 张），这一场比不了');
    expect(fourth.clickable).toBe(false);
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toContain('群势力最多 3 名');
  });

  it('已经勾满 10 颗 ⇒ 再点一颗没勾的：热座点不动，房主重判也拒，且那句不是"还没凑够"', () => {
    const sc = compare(9, 1); // 9 主 + 1 群 = 10 颗；m9 是名单上唯一还没勾的那颗主牌
    expect(sc.frame.picked).toHaveLength(10);
    expect(sc.frame.canConfirm).toBe(true); // 正面凭据：人数与群都够了，挡下 `m9` 的只是"满 10"这一条
    sameDirection(sc);
    const extra = sc.rows.find((r) => r.key === 'm9');
    if (!extra) throw new Error('那份材料只发得出 9 颗本势力候选，比不了"满 10 再点一颗"');
    expect(extra.picked).toBe(false);
    expect(extra.clickable).toBe(false);
    expect(extra.allowed).toBe(false);
    expect(extra.reason).toContain('已经勾满 10 颗');
    expect(extra.reason).not.toContain('还没凑够');
  });

  it('9 主 0 群 ⇒ 第 10 颗主牌：热座点不动（得给群留一颗），房主重判拒的也是这一条', () => {
    const sc = compare(9, 0); // 三档上限里这一场撞的是"主牌最多 9 颗"那一条
    expect(sc.frame.picked).toHaveLength(9);
    expect(sc.frame.canConfirm).toBe(false); // 那颗确认钮本来就按不下去（群 0 名）
    sameDirection(sc);
    const tenth = sc.rows.find((r) => r.key === 'm9');
    if (!tenth) throw new Error('那份材料只发得出 9 颗本势力候选，比不了"9 主 0 群时的第 10 颗主牌"');
    expect(tenth.picked).toBe(false);
    expect(tenth.clickable).toBe(false);
    expect(tenth.allowed).toBe(false);
    expect(tenth.reason).toContain('得给群势力留一颗位置');
    // 同一片屏上，那颗群牌两边都点得动：拒的不是"群"这个字，是这一颗加进去之后的数。
    const firstQun = sc.rows.find((r) => r.key === 'q0');
    expect(firstQun?.clickable).toBe(true);
    expect(firstQun?.allowed).toBe(true);
  });

  it('已勾的那一颗：两边都永远点得动（"已勾的恒可退"这一条不随人数变）', () => {
    const sc = compare(9, 1); // 满 10 颗那一场：加不进去，但每一颗已勾的还能退
    sameDirection(sc);
    for (const r of sc.rows.filter((x) => x.picked)) {
      expect(r.clickable, `${r.key} 已勾着，热座那颗不该变暗`).toBe(true);
      expect(r.allowed, `${r.key} 已勾着，房主不该拦退这一颗`).toBe(true);
    }
    expect(sc.rows.filter((r) => r.picked)).toHaveLength(10);
  });
});
