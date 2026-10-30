/**
 * 联机切片⑤a（v2.9.25）房主侧准备表发布者的证人。
 *
 * 判据㈠（那条最硬的「不许出现"永远等一个已经不在的人"」）在这里才有出处：
 * 分母由**名册**与**房主那张连线表**当场算，退掉的人一行都不留，判成掉线的人留着但 `counted:false`。
 * 其余三条是接线纪律：没变就一条也不发、同一份要抄给房主自己那屏、客人交回的钮只改他那一格。
 */
import { describe, expect, it } from 'vitest';
import type { NetLinkRow, NetPeer, NetReadyRow } from './netProtocol';
import { startHostReady } from './netHostReady';

const HOST: NetPeer = { id: 'h', name: '房主', role: 'host' };
const A: NetPeer = { id: 'a', name: '客人甲', role: 'guest' };
const B: NetPeer = { id: 'b', name: '客人乙', role: 'guest' };

const ONLINE: NetLinkRow[] = [
  { id: 'h', name: '房主', pingMs: null, state: 'online' },
  { id: 'a', name: '客人甲', pingMs: 12, state: 'online' },
  { id: 'b', name: '客人乙', pingMs: 9, state: 'online' },
];
const A_LOST: NetLinkRow[] = [
  { id: 'h', name: '房主', pingMs: null, state: 'online' },
  { id: 'a', name: '客人甲', pingMs: null, state: 'lost' },
  { id: 'b', name: '客人乙', pingMs: 9, state: 'online' },
];

function harness(peers: NetPeer[], links: NetLinkRow[] | null = ONLINE) {
  const sent: NetReadyRow[][] = [];
  const copied: NetReadyRow[][] = [];
  let roster = peers;
  let table: NetLinkRow[] | null = links;
  const ready = startHostReady({
    peers: () => roster,
    links: () => table,
    send: (rows) => sent.push(rows),
    tableSink: (rows) => copied.push(rows),
  });
  return {
    ready,
    sent,
    copied,
    setPeers: (next: NetPeer[]) => { roster = next; },
    setLinks: (next: NetLinkRow[] | null) => { table = next; },
  };
}

describe('⑤a 房主出那张准备表', () => {
  it('一开房就有一张：名册上的客人一人一行、全没点、全都还算数，房主自己不占一行', () => {
    const h = harness([HOST, A, B]);
    h.ready.syncNow();
    expect(h.sent).toEqual([[
      { peer: 'a', name: '客人甲', on: false, counted: true },
      { peer: 'b', name: '客人乙', on: false, counted: true },
    ]]);
    expect(h.sent[0]).toBe(h.copied[0]);
  });

  it('屋里一个客人都没有＝线上一条也不发（没有收件人，不凭空多一次广播），但房主自己那一格仍拿到那张空表', () => {
    const h = harness([HOST]);
    h.ready.syncNow();
    expect(h.sent).toEqual([]);
    expect(h.copied).toEqual([[]]);
  });

  it('最后一位客人退掉＝线上不再多发一条，但那一格当场拿到空表——闸门正是靠这一笔才开得动', () => {
    const h = harness([HOST, A]);
    h.ready.syncNow();
    expect(h.sent).toHaveLength(1);
    h.setPeers([HOST]);
    h.ready.syncNow();
    expect(h.sent).toHaveLength(1);
    expect(h.copied).toHaveLength(2);
    expect(h.copied[1]).toEqual([]);
  });

  it('客人点一下只动他那一格，别行的引用与读数一个也不动', () => {
    const h = harness([HOST, A, B]);
    h.ready.syncNow();
    h.ready.noteMark('a', true);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toEqual([
      { peer: 'a', name: '客人甲', on: true, counted: true },
      { peer: 'b', name: '客人乙', on: false, counted: true },
    ]);
  });

  it('重复点同一颗钮＝没变：一条也不发（客人连点两下、界面上来回抖都不该往线上灌）', () => {
    const h = harness([HOST, A]);
    h.ready.syncNow();
    h.ready.noteMark('a', true);
    const before = h.sent.length;
    h.ready.noteMark('a', true);
    expect(h.sent).toHaveLength(before);
  });

  it('取消准备是回到那一格的另一个读数，不是把人从表上抹掉', () => {
    const h = harness([HOST, A]);
    h.ready.noteMark('a', true);
    h.ready.noteMark('a', false);
    expect(h.sent.at(-1)).toEqual([{ peer: 'a', name: '客人甲', on: false, counted: true }]);
  });

  it('名册与连线表原样重算一遍＝没变：房主每两秒一次心跳惊不出一条消息', () => {
    const h = harness([HOST, A]);
    h.ready.noteMark('a', true);
    const before = h.sent.length;
    h.setLinks(ONLINE.map((r) => ({ ...r, pingMs: r.pingMs === null ? null : 1 })));
    h.ready.syncNow();
    h.setPeers([HOST, { ...A }]);
    h.ready.syncNow();
    expect(h.sent).toHaveLength(before);
  });

  it('客人中途退掉＝那一行当场没了，而且他旧账不抱（再进来是重新点的一位）', () => {
    const h = harness([HOST, A, B]);
    h.ready.noteMark('a', true);
    h.setPeers([HOST, B]);
    h.ready.syncNow();
    expect(h.sent.at(-1)).toEqual([{ peer: 'b', name: '客人乙', on: false, counted: true }]);

    // 他重新进来：名册与连线表都回来了，那一行却是 on:false——上一轮那声"准备好了"不作数。
    h.setPeers([HOST, A, B]);
    h.ready.syncNow();
    expect(h.sent.at(-1)).toEqual([
      { peer: 'a', name: '客人甲', on: false, counted: true },
      { peer: 'b', name: '客人乙', on: false, counted: true },
    ]);
  });

  it('被房主判成掉线那位：留在表上但不进分母——闸门因此不会"永远等一个已经不在的人"', () => {
    const h = harness([HOST, A, B]);
    h.ready.noteMark('b', true);
    h.setLinks(A_LOST);
    h.ready.syncNow();
    const rows = h.sent.at(-1)!;
    expect(rows).toEqual([
      { peer: 'a', name: '客人甲', on: false, counted: false },
      { peer: 'b', name: '客人乙', on: true, counted: true },
    ]);
    // 那句人话读的是同一张表：还在等的只剩"还算数又没点"的人，甲已经不占分母，所以闸门开得动。
    const waiting = rows.filter((r) => r.counted && !r.on).map((r) => r.name);
    expect(waiting).toEqual([]);
    expect(rows.filter((r) => !r.counted).map((r) => r.name)).toEqual(['客人甲']);
  });

  it('掉线的人回来了：那一行重新进分母，他点过的那一声"准备好了"还认（名册从没删过他）', () => {
    const h = harness([HOST, A, B]);
    h.ready.noteMark('a', true);
    h.setLinks(A_LOST);
    h.ready.syncNow();
    expect(h.sent.at(-1)![0]).toEqual({ peer: 'a', name: '客人甲', on: true, counted: false });
    h.setLinks(ONLINE);
    h.ready.syncNow();
    expect(h.sent.at(-1)![0]).toEqual({ peer: 'a', name: '客人甲', on: true, counted: true });
  });

  it('没用心跳的老调用方（links 给 null）＝没人被判掉线，全都还算数', () => {
    const h = harness([HOST, A], null);
    h.ready.syncNow();
    expect(h.sent[0]).toEqual([{ peer: 'a', name: '客人甲', on: false, counted: true }]);
  });

  it('名字跟着名册走：房主给他改了显示名，表上那一行就是新名字，不是缓存里那个旧的', () => {
    const h = harness([HOST, A]);
    h.ready.syncNow();
    h.setPeers([HOST, { ...A, name: '客人甲甲' }]);
    h.ready.syncNow();
    expect(h.sent.at(-1)).toEqual([{ peer: 'a', name: '客人甲甲', on: false, counted: true }]);
  });

  it('每次真变了都同时上线＋抄给房主自己那屏（算表的人自己也得看得见）', () => {
    const h = harness([HOST, A]);
    h.ready.syncNow();
    h.ready.noteMark('a', true);
    expect(h.sent).toHaveLength(2);
    expect(h.copied).toHaveLength(2);
    expect(h.copied[1]).toBe(h.sent[1]);
  });

  it('房主自己交的"我也准备"不改这张表——他不在这张表上，那颗钮本来就是他的开始游戏', () => {
    const h = harness([HOST, A]);
    h.ready.syncNow();
    const before = h.sent.length;
    h.ready.noteMark('h', true);
    expect(h.sent).toHaveLength(before);
    expect(h.sent.at(-1)).toEqual([{ peer: 'a', name: '客人甲', on: false, counted: true }]);
  });
});
