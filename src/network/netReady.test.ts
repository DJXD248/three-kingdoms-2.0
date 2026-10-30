/**
 * 联机切片⑤a（v2.9.25）准备闸门那笔账的证人。用户 2026-10-30 那句需求原文是判据的来源：
 * 「进入房间后，所有客人都需要点准备，所有客人都准备后房主才可以点开始游戏」
 * ＋「客人中途退掉／掉线⇒闸门重算（不许出现"永远等一个已经不在的人"）」。
 *
 * 这一格只算不搬：每条判据都写成一个能独立失败的断言，房主出表与客人抄表读的是同一批函数，
 * 所以这里绿了不等于线上也接上了（那两条在 `netSession.test.ts` 与 `LobbyReadyGate.test.tsx`）。
 */
import { describe, expect, it } from 'vitest';
import type { NetLinkRow, NetPeer, NetReadyRow } from './netProtocol';
import {
  buildReadyRows,
  gateOfReadyRows,
  markReady,
  pruneReadyMarks,
  sameReadyRows,
  type ReadyMarks,
} from './netReady';

const HOST: NetPeer = { id: 'h', name: '房主', role: 'host' };
const A: NetPeer = { id: 'a', name: '客人甲', role: 'guest' };
const B: NetPeer = { id: 'b', name: '客人乙', role: 'guest' };

function link(id: string, state: NetLinkRow['state']): NetLinkRow {
  return { id, name: id, pingMs: null, state };
}

describe('准备表长什么样（只列客人，房主不等自己）', () => {
  it('名册里房主那一行不进表；客人一人一行，顺序就是名册顺序', () => {
    const rows = buildReadyRows([HOST, B, A], {}, null);
    expect(rows).toEqual([
      { peer: 'b', name: '客人乙', on: false, counted: true },
      { peer: 'a', name: '客人甲', on: false, counted: true },
    ]);
  });

  it('屋里没有客人＝一张空表（那是一句真话，不是"还没算"）', () => {
    expect(buildReadyRows([HOST], {}, null)).toEqual([]);
  });

  it('没用心跳（links=null）⇒ 没人被判掉线，全都还算数', () => {
    expect(buildReadyRows([HOST, A], {}, null).every((row) => row.counted)).toBe(true);
    expect(buildReadyRows([HOST, A], {}, []).every((row) => row.counted)).toBe(true);
  });

  it('连线表上写着 lost 的那个人 ⇒ counted:false，但那一行还留着（别人看得见他是掉了，不是没点）', () => {
    const rows = buildReadyRows([HOST, A, B], { a: true }, [link('h', 'online'), link('a', 'online'), link('b', 'lost')]);
    expect(rows).toEqual([
      { peer: 'a', name: '客人甲', on: true, counted: true },
      { peer: 'b', name: '客人乙', on: false, counted: false },
    ]);
  });
});

describe('那一颗钮交回来以后', () => {
  it('点过又取消＝回到没点；原样再来一次＝同一个引用（不该把这张表重发一遍）', () => {
    const marked = markReady({}, A.id, true);
    expect(marked).toEqual({ a: true });
    expect(markReady(marked, A.id, true)).toBe(marked);
    const cancelled = markReady(marked, A.id, false);
    expect(cancelled).toEqual({});
    // 「没点」与"点过又取消"在这笔账里是同一个样子——都不该在表上留下痕迹。
    expect(buildReadyRows([HOST, A], cancelled, null)).toEqual([
      { peer: 'a', name: '客人甲', on: false, counted: true },
    ]);
  });

  it('退掉的人那个"准备过"跟着销账：名册一换，不在册的键不留（再进来是新的一位，得重新点）', () => {
    const marks: ReadyMarks = { a: true, b: true };
    const pruned = pruneReadyMarks(marks, [B.id]);
    expect(pruned).toEqual({ b: true });
    expect(buildReadyRows([HOST, B], pruned, null)).toEqual([
      { peer: 'b', name: '客人乙', on: true, counted: true },
    ]);
    // 一个都没掉时保留同一个引用：房主每次连线状态变化都走这一趟。
    expect(pruneReadyMarks(pruned, [B.id])).toBe(pruned);
  });
});

describe('闸门那句"还等谁"', () => {
  const ROWS: NetReadyRow[] = [
    { peer: 'a', name: '客人甲', on: true, counted: true },
    { peer: 'b', name: '客人乙', on: false, counted: true },
  ];

  it('有点没准备的 ⇒ 不开，并逐字点名（按名册顺序，不排序也不去重）', () => {
    expect(gateOfReadyRows(ROWS)).toEqual({ open: false, waiting: ['客人乙'], gone: [] });
    const two = [
      { peer: 'a', name: '客人甲', on: false, counted: true },
      { peer: 'b', name: '客人乙', on: false, counted: true },
    ];
    expect(gateOfReadyRows(two).waiting).toEqual(['客人甲', '客人乙']);
  });

  it('全点了 ⇒ 开（空 waiting 才是真开了）', () => {
    expect(gateOfReadyRows([ROWS[0], { ...ROWS[1], on: true }])).toEqual({ open: true, waiting: [], gone: [] });
  });

  it('只剩掉线的人没点 ⇒ 闸门照样开：不许出现"永远等一个已经不在的人"', () => {
    const goneOnly: NetReadyRow[] = [
      { peer: 'a', name: '客人甲', on: true, counted: true },
      { peer: 'b', name: '客人乙', on: false, counted: false },
    ];
    expect(gateOfReadyRows(goneOnly)).toEqual({ open: true, waiting: [], gone: ['客人乙'] });
  });

  it('掉线的人后来回来（连线表那一行回到 online）⇒ 他重新进分母，但之前那一次准备不作废', () => {
    const rows = buildReadyRows([HOST, A, B], { a: true }, [link('h', 'online'), link('a', 'online'), link('b', 'online')]);
    expect(gateOfReadyRows(rows)).toEqual({ open: false, waiting: ['客人乙'], gone: [] });
  });

  it('一张空表（没客人）＝开：本地与纯 AI 桌那条路不受这块闸门影响', () => {
    expect(gateOfReadyRows([])).toEqual({ open: true, waiting: [], gone: [] });
  });
});

describe('sameReadyRows（"没变就保留同一个引用"那条格纪律）', () => {
  const ROWS = buildReadyRows([HOST, A], {}, null);

  it('还没收到过（null）与"一张空表"是两件事：null→[] 算变', () => {
    expect(sameReadyRows(null, [])).toBe(false);
    expect(sameReadyRows([], null)).toBe(false);
    expect(sameReadyRows(null, null)).toBe(true);
  });

  it('内容一模一样、换个对象再来＝没变；点没点、算不算数、条数、顺序、任一个名字换了＝算变', () => {
    expect(sameReadyRows(ROWS, ROWS.map((row) => ({ ...row })))).toBe(true);
    expect(sameReadyRows(ROWS, [{ peer: 'a', name: '客人甲', on: true, counted: true }])).toBe(false);
    expect(sameReadyRows(ROWS, [{ peer: 'a', name: '客人甲', on: false, counted: false }])).toBe(false);
    expect(sameReadyRows(ROWS, [])).toBe(false);
    expect(sameReadyRows(ROWS, [{ ...ROWS[0], name: '换了个名' }])).toBe(false);
    expect(sameReadyRows(ROWS, [ROWS[0], { peer: 'z', name: '生人', on: false, counted: true }])).toBe(false);
  });
});
