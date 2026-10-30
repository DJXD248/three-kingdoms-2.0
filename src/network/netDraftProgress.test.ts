/**
 * 联机切片⑤b（v2.9.25）征召进度表那笔账的证人。
 *
 * 这张表是"客人看得见开局那一段"的第一块地基，而它的价值全在**它不说什么**：
 * 每一行只有座次、称呼与两个数。这里钉的是那三个数怎么算出来的、什么时候整张表该闭嘴，
 * 以及那个分母（10）与房主自己那把闸是不是同一个数——牌面扫查在 `netDraftProgressPrivacy.test.ts`。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  DRAFT_PICK_TOTAL,
  buildDraftProgressRows,
  sameDraftProgressRows,
  type DraftProgressFacts,
  type DraftSeatFact,
} from './netDraftProgress';
import { MAX_NAME_LENGTH } from './netProtocol';
import { useGameStore } from '../store/gameStore';
import type { General } from '../data/generals';

const seat = (id: number, name: string, poolSize = 0): DraftSeatFact => ({ seat: id, name, poolSize });

const facts = (patch: Partial<DraftProgressFacts> = {}): DraftProgressFacts => ({
  phase: 'generalDraft',
  // 第一席的池子故意写成一个**不等于分母**的数（8）：写成 10 的话，"照着池子抄"与
  // "硬按 10 报"这两种实现长出的表一模一样，这条证人就成了空跑（RTM 反证时实测出来的）。
  seats: [seat(1, '玩家1', 8), seat(2, '假客人'), seat(3, 'AI·平衡')],
  draftPlayerIndex: 1,
  pickedCount: 7,
  ...patch,
});

describe('⑤b 进度表：什么时候有话要说', () => {
  it('掷骰与分势力那几段＝没话要说（不发一帧空表）', () => {
    for (const phase of ['menu', 'lobby', 'createRoom', 'diceRoll', 'factionAssign', 'codex', 'rules', 'settings', 'testArena']) {
      expect(buildDraftProgressRows(facts({ phase }))).toBeNull();
    }
  });

  it('征召进行中：三种状态一席一行，正在挑的那一行的数＝房主当下勾了几名', () => {
    const rows = buildDraftProgressRows(facts());
    expect(rows).toEqual([
      { seat: 1, name: '玩家1', state: 'done', picked: 8, total: DRAFT_PICK_TOTAL },
      { seat: 2, name: '假客人', state: 'picking', picked: 7, total: DRAFT_PICK_TOTAL },
      { seat: 3, name: 'AI·平衡', state: 'waiting', picked: 0, total: DRAFT_PICK_TOTAL },
    ]);
  });

  it('征召翻过去的那几段：表还在，一桌人都是 done，已选那个数照那一席的池子抄（不硬按 10 报）', () => {
    for (const phase of ['drawing', 'playing', 'gameOver']) {
      const rows = buildDraftProgressRows(facts({
        phase,
        seats: [seat(1, '玩家1', 10), seat(2, '假客人', 9), seat(3, 'AI·平衡', 11)],
        draftPlayerIndex: 3,
        pickedCount: 0,
      }));
      expect(rows?.map((r) => [r.state, r.picked])).toEqual([
        ['done', 10], ['done', 9], ['done', 11],
      ]);
    }
  });

  it('桌上还没摆椅子（没建房、或已经清场）＝没话要说，哪怕此刻正写着 generalDraft', () => {
    expect(buildDraftProgressRows(facts({ seats: [] }))).toBeNull();
    expect(buildDraftProgressRows(facts({ phase: 'playing', seats: [] }))).toBeNull();
  });
});

describe('⑤b 进度表：座次与顺序', () => {
  it('行的顺序＝席位号从小到大，与席位表同一把尺', () => {
    const rows = buildDraftProgressRows(facts({
      seats: [seat(4, '玩家4'), seat(1, '玩家1'), seat(3, '玩家3'), seat(2, '玩家2')],
      draftPlayerIndex: 0,
      pickedCount: 0,
    }));
    expect(rows?.map((r) => r.seat)).toEqual([1, 2, 3, 4]);
  });

  it('谁"正在挑"看的是征召的先后（store 的数组下标），不是席位号大小——掷过骰之后这两样会错开', () => {
    // 骰子排完座：房主那台机器上的第 1 顺位是 4 号席，接下来才是 1 号席。
    const rows = buildDraftProgressRows(facts({
      seats: [seat(4, '房主的席'), seat(1, '客人甲'), seat(2, '客人乙')],
      draftPlayerIndex: 1,
      pickedCount: 3,
    }));
    expect(rows?.find((r) => r.state === 'picking')?.seat).toBe(1);
    expect(rows?.find((r) => r.state === 'done')?.seat).toBe(4);
    expect(rows?.find((r) => r.state === 'waiting')?.seat).toBe(2);
  });

  it('最后一席正在挑时没有人排在后面；房主一确认，全桌立刻都是 done（下一帧由接线自己算出来）', () => {
    const last = buildDraftProgressRows(facts({ draftPlayerIndex: 2, pickedCount: 10 }));
    expect(last?.map((r) => r.state)).toEqual(['done', 'done', 'picking']);
    const after = buildDraftProgressRows(facts({ phase: 'drawing', draftPlayerIndex: 3, pickedCount: 0 }));
    expect(after?.every((r) => r.state === 'done')).toBe(true);
  });

  it('名字太长会夹到线上上界（超长那一帧整个会被解析层拒掉，夹住才不会让这张表从此不再更新）', () => {
    const rows = buildDraftProgressRows(facts({
      seats: [seat(1, '一'.repeat(MAX_NAME_LENGTH + 6)), seat(2, '甲\u0001乙')],
    }));
    expect(rows?.[0].name).toBe('一'.repeat(MAX_NAME_LENGTH - 1) + '…');
    expect([...(rows?.[1].name ?? '')].every((c) => c.charCodeAt(0) >= 0x20)).toBe(true);
    expect(rows?.[1].name).toBe('甲乙');
  });
});

describe('⑤b 进度表：没变就不重发', () => {
  it('内容一样但换了新数组 ⇒ 判"一样"（房主每次点将都会重算一遍，多数时候那张表根本没动）', () => {
    expect(sameDraftProgressRows(buildDraftProgressRows(facts()), buildDraftProgressRows(facts()))).toBe(true);
  });

  it('两个 null 才算一样；null 与空表是两句话', () => {
    expect(sameDraftProgressRows(null, null)).toBe(true);
    expect(sameDraftProgressRows([], null)).toBe(false);
    expect(sameDraftProgressRows(null, [])).toBe(false);
  });

  it('差一个数、差一席、换个顺序 ⇒ 都是"变了"', () => {
    const base = buildDraftProgressRows(facts())!;
    expect(sameDraftProgressRows(base, buildDraftProgressRows(facts({ pickedCount: 8 })))).toBe(false);
    expect(sameDraftProgressRows(base, buildDraftProgressRows(facts({ seats: [seat(1, '玩家1', 10)] })))).toBe(false);
    const shuffled = [...base].reverse();
    expect(sameDraftProgressRows(base, shuffled)).toBe(false);
  });
});

/**
 * 那张表的分母只有一个出处（`DRAFT_PICK_TOTAL`），而它必须与**房主自己那把挡人的闸**是同一个数：
 * 两边不一致，客人会看见一句永远凑不满的进度。这里拿 store 那条真的 `selectDraftGeneral` 量一遍。
 */
describe('⑤b 的分母与房主那把闸是同一个数', () => {
  const fakeGeneral = (n: number): General => ({ id: `probe-${n}`, name: `探针${n}`, faction: '群' } as unknown as General);

  beforeEach(() => {
    useGameStore.setState({ selectedDraftGenerals: [] } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('勾到分母那一刻还能勾；多勾一名被 store 自己挡回去——界面上那句「已选 n/10」不会说谎', () => {
    for (let i = 0; i < DRAFT_PICK_TOTAL; i += 1) {
      useGameStore.getState().selectDraftGeneral(fakeGeneral(i));
    }
    expect(useGameStore.getState().selectedDraftGenerals).toHaveLength(DRAFT_PICK_TOTAL);
    useGameStore.getState().selectDraftGeneral(fakeGeneral(99));
    expect(useGameStore.getState().selectedDraftGenerals).toHaveLength(DRAFT_PICK_TOTAL);
  });

  it('正在征召那一行的 `picked` 就取自同一格 store（房主勾一名，线上那张表的这个数跟着走一名）', () => {
    useGameStore.getState().selectDraftGeneral(fakeGeneral(1));
    const rows = buildDraftProgressRows(facts({
      seats: [seat(1, '玩家1'), seat(2, '假客人')],
      draftPlayerIndex: 1,
      pickedCount: useGameStore.getState().selectedDraftGenerals.length,
    }));
    expect(rows?.[1]).toEqual({ seat: 2, name: '假客人', state: 'picking', picked: 1, total: DRAFT_PICK_TOTAL });
  });
});
