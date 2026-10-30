/**
 * 联机切片⑤·更正轮（㈡）搬完 `GeneralDraft.tsx` 之后要的那一条：**热座那颗牌的行为没变**。
 *
 * 数量闸从 `isSelectable` 里搬进了 `domain/draftQuota`（派单逐字：只许"把已有那段规则原样搬出去、叫它一个名字"）。
 * 所以这里的真值表**写死在测试里**——按搬之前那五行分支手抄一遍期望值，
 * 绝不 import `draftQuotaBlockFor` 来算标准答案（自己对自己是空跑，正是派单点名的那个坑）。
 *
 * 读的是 DOM：一颗候选牌点不点得动＝它那颗钮身上有没有 `cursor-not-allowed`
 * （`GeneralDraft.tsx` 里 `isSelectable` 为假时才有那一串类）。
 * 已勾着的那几颗走的是"退一颗"那排小钮，不在这张表里（那条恒放行，另有一枚证人）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import GeneralDraft from './GeneralDraft';
import { useGameStore } from '../store/gameStore';
import type { Player } from '../store/gameStoreTypes';

const card = (id: string, name: string, faction: '魏' | '群') => ({
  id, name, faction, type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: [],
});

/** 两座、第 1 席（魏）正在挑：候选两格各摆两颗册外假将，名字互不相同 ⇒ 身份锁那一档一颗也不冲突。 */
const MAIN_CANDIDATES = [card('c-m0', '本将甲', '魏'), card('c-m1', '本将乙', '魏')];
const QUN_CANDIDATES = [card('c-q0', '群将甲', '群'), card('c-q1', '群将乙', '群')];

/**
 * 真值表（写死的期望，来源＝搬之前 `GeneralDraft.tsx` 那五行分支逐行手推）：
 * `main`／`qun`＝当下这颗**没勾着**的本势力牌／群牌点不点得动。
 */
const TABLE: { totalCount: number; qunCount: number; main: boolean; qun: boolean; why: string }[] = [
  { totalCount: 0, qunCount: 0, main: true, qun: true, why: '一颗没勾，两边都开' },
  { totalCount: 6, qunCount: 0, main: true, qun: true, why: '本势力还远不到 9 名' },
  { totalCount: 9, qunCount: 0, main: false, qun: true, why: '只剩一颗位置，而群势力一名还没有 ⇒ 本势力那颗点不动、群那颗照点' },
  { totalCount: 10, qunCount: 0, main: false, qun: false, why: '满 10 颗，谁都点不动' },
  { totalCount: 1, qunCount: 1, main: true, qun: true, why: '已有 1 名群，本势力上限回到 9' },
  { totalCount: 9, qunCount: 1, main: true, qun: true, why: '9 颗里 8 主 1 群：还能加一颗主，也还能加群' },
  { totalCount: 10, qunCount: 1, main: false, qun: false, why: '满 10 颗（哪怕形状是合法的 9 主 1 群）' },
  { totalCount: 3, qunCount: 3, main: true, qun: false, why: '群到 3 名上限 ⇒ 第 4 颗群点不动，本势力那颗还能加' },
  { totalCount: 9, qunCount: 3, main: true, qun: false, why: '6 主 3 群：主上限 10-3=7，还差一名' },
  { totalCount: 10, qunCount: 3, main: false, qun: false, why: '满 10 颗' },
  { totalCount: 10, qunCount: 4, main: false, qun: false, why: '10 颗里 4 颗群（这形状热座点不出来，只能按 store 直接摆，摆出来照样谁都点不动）' },
];

function seatWith(totalCount: number, qunCount: number) {
  const mainCount = totalCount - qunCount;
  const selected = [
    ...Array.from({ length: mainCount }, (_, i) => card(`s-m${i}`, `册外主${i}`, '魏')),
    ...Array.from({ length: qunCount }, (_, i) => card(`s-q${i}`, `册外群${i}`, '群')),
  ];
  useGameStore.setState({
    phase: 'generalDraft',
    draftPlayerIndex: 0,
    players: [
      { id: 1, name: '玩家1', faction: '魏', seatOrder: 0, generalPool: [] },
      { id: 2, name: '玩家2', faction: '蜀', seatOrder: 1, generalPool: [] },
    ] as unknown as Player[],
    draftGenerals: MAIN_CANDIDATES,
    draftQunGenerals: QUN_CANDIDATES,
    selectedDraftGenerals: selected,
  } as unknown as Partial<ReturnType<typeof useGameStore.getState>>);
  render(<GeneralDraft />);
  return selected.length;
}

/** 那颗候选牌点不点得动：`isSelectable` 为假时类名里才有那一串 `cursor-not-allowed`。 */
function clickableByName(name: string): boolean {
  const found = [...document.querySelectorAll('button')].find((b) => b.querySelector('h3')?.textContent === name);
  if (!found) throw new Error(`候选牌「${name}」没上屏——这一趟比对少了一颗`);
  return !found.className.includes('cursor-not-allowed');
}

afterEach(() => cleanup());

describe('更正轮㈡：热座那颗牌可点与否，逐行对上搬之前那张真值表', () => {
  beforeEach(() => {
    useGameStore.setState({ selectedDraftGenerals: [], draftGenerals: [], draftQunGenerals: [] } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  for (const row of TABLE) {
    it(`已勾 ${row.totalCount} 颗（其中群 ${row.qunCount} 名）⇒ 本势力那颗${row.main ? '点得动' : '点不动'}、群那颗${row.qun ? '点得动' : '点不动'}：${row.why}`, () => {
      const selected = seatWith(row.totalCount, row.qunCount);
      // 正面凭据：材料真摆成了那一行说的数，而且这一屏没有身份锁冲突（不然下面那两行比的是"锁"而不是"数量"）。
      expect(useGameStore.getState().selectedDraftGenerals).toHaveLength(selected);
      expect(selected).toBe(row.totalCount);
      expect(document.body.textContent).not.toContain('身份冲突');

      expect(clickableByName('本将甲')).toBe(row.main);
      expect(clickableByName('本将乙')).toBe(row.main);
      expect(clickableByName('群将甲')).toBe(row.qun);
      expect(clickableByName('群将乙')).toBe(row.qun);
    });
  }

  it('已经勾着的那颗恒能退：满 10 颗时那排「✕」小钮照样在（与 `always allow deselecting` 同向）', () => {
    seatWith(10, 1);
    const chips = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('✕'));
    expect(chips).toHaveLength(10);
    expect(chips.every((b) => !b.className.includes('cursor-not-allowed'))).toBe(true);
  });
});
