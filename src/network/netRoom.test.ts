/**
 * 房间这一格的证人：连线与"客人最后看到的局面"住在这里而不是某个弹窗里，
 * 所以关掉联网大厅去开局，房主那边还在发、客人那边还在收。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachRoom,
  bumpNetRoom,
  clearRefusal,
  deliverHostDraft,
  deliverHostReady,
  detachRoom,
  getActiveRoom,
  getDraftList,
  getDraftProgress,
  getGuestSnapshot,
  getMyNetSeat,
  getNetStatus,
  getReadyTable,
  getRefusal,
  getSeatMap,
  getSeatMoves,
  getStartGate,
  receiveDraftList,
  receiveDraftProgress,
  receiveGuestSnapshot,
  receiveNetStatus,
  receiveReadyTable,
  receiveRefusal,
  receiveSeatMap,
  receiveSeatMoves,
  setHostDraftSink,
  setHostReadySink,
  subscribeNetRoom,
} from './netRoom';
import type { IncomingDraft } from './netDraftList';
import type { NetDraftListFrame } from './netProtocol';
import { joinRoom } from './netSession';

const VALID = {
  version: 1,
  phase: 'turn',
  players: [{ id: 1, name: '甲' }],
  currentPlayerId: 1,
  turn: 3,
  round: 2,
  deck: [],
  discardPile: [],
};

function fakeConnection() {
  return {
    state: { role: 'host', selfId: 'h', name: '房主', roomCode: 'ROOMAA', phase: 'in-room', note: '', peers: [] },
    leave: vi.fn(),
    send: vi.fn(() => true),
  };
}

afterEach(() => {
  detachRoom();
});

describe('netRoom：连接与客人快照的唯一持有者', () => {
  it('没进房就是空的，快照也是空的', () => {
    expect(getActiveRoom()).toBeNull();
    expect(getGuestSnapshot()).toBeNull();
  });

  it('attach 之后能读到同一份连接，detach 之后清干净（连快照一起）', () => {
    const connection = fakeConnection();
    attachRoom({ role: 'host', name: '房主', roomCode: 'ROOMAA', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/ROOMAA', connection: connection as never });
    expect(getActiveRoom()?.connection).toBe(connection);

    receiveGuestSnapshot(VALID);
    expect(getGuestSnapshot()).not.toBeNull();

    detachRoom();
    expect(getActiveRoom()).toBeNull();
    expect(getGuestSnapshot()).toBeNull();
  });

  it('换房时上一根线自己道别（不留后台幽灵）', () => {
    const first = fakeConnection();
    const second = fakeConnection();
    attachRoom({ role: 'host', name: '甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: first as never });
    attachRoom({ role: 'host', name: '乙', roomCode: 'B', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/B', connection: second as never });
    expect(first.leave).toHaveBeenCalledTimes(1);
    expect(getActiveRoom()?.name).toBe('乙');
  });

  it('形状不对的局面直接丢，不进快照位（不猜、不半收）', () => {
    expect(receiveGuestSnapshot({ nope: 1 })).toBe(false);
    expect(getGuestSnapshot()).toBeNull();
    expect(receiveGuestSnapshot(VALID)).toBe(true);
  });

  it('订阅者能收到 attach／detach／bump／新快照四类通知', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);

    attachRoom({ role: 'guest', name: '甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
    receiveGuestSnapshot(VALID);
    bumpNetRoom();
    unsubscribe();
    detachRoom();

    expect(seen).toHaveBeenCalledTimes(3);
    detachRoom(); // 取消订阅不影响状态照清
    expect(getActiveRoom()).toBeNull();
  });

  it('真接一条线：leave 走的是连接自己（发 bye 那一条）', async () => {
    const socket = {
      readyState: 1,
      onopen: null as (() => void) | null,
      onmessage: null as ((ev: { data: unknown }) => void) | null,
      onclose: null as ((ev: { code?: number; reason?: string }) => void) | null,
      onerror: null as (() => void) | null,
      send: vi.fn(),
      close: vi.fn(),
    };
    const connection = joinRoom(
      { role: 'guest', name: '甲', url: 'ws://x/A', roomCode: 'A', socketFactory: () => socket as never },
      () => {},
    );
    socket.onopen?.();
    attachRoom({ role: 'guest', name: '甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection });
    await new Promise((resolve) => setTimeout(resolve, 0));

    getActiveRoom()?.connection.leave();
    detachRoom();
    // 客人一连上就先报版本（hello），道别是最后那一条
    const lastCall = socket.send.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(lastCall).t).toBe('bye');
  });
});

describe('J3 连线表也住这一格（房主关了大厅、客人只开牌桌，表还得在）', () => {
  const ROWS = [
    { id: 'h', name: '房主', pingMs: null, state: 'online' as const },
    { id: 'g', name: '客人甲', pingMs: 42, state: 'online' as const },
  ];
  const LOST = [
    { id: 'h', name: '房主', pingMs: null, state: 'online' as const },
    { id: 'g', name: '客人甲', pingMs: null, state: 'lost' as const },
  ];

  it('没收到表＝空（界面据此什么都不画，不画一张猜出来的表）', () => {
    expect(getNetStatus()).toBeNull();
  });

  it('收下房主那份并通知订阅者；内容一模一样时保留原引用、说"没变"', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);
    expect(receiveNetStatus(ROWS)).toBe(true);
    expect(getNetStatus()).toBe(ROWS);
    // 同一张表换个对象再来一次：判据是内容，不是引用（房主每两秒算一次，界面无谓重画＝白费）。
    expect(receiveNetStatus(ROWS.map((r) => ({ ...r })))).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(receiveNetStatus(LOST)).toBe(true);
    expect(getNetStatus()).toEqual(LOST);
    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('attach／detach 把表一起清掉：换房不能留着上一屋那张', () => {
    receiveNetStatus(ROWS);
    attachRoom({ role: 'host', name: '甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
    expect(getNetStatus()).toBeNull();
    receiveNetStatus(ROWS);
    detachRoom();
    expect(getNetStatus()).toBeNull();
  });
});

/**
 * J4 那三格也住这一格：房主离开大厅去开局、客人一直盯着牌桌，席位表与清单就得在。
 * 纪律与连线表那一格一模一样——**内容没变就保留同一个引用并说"没变"**，
 * 因为房主每次局面变化都会把这两份重发一遍，而多数时候它们根本没动。
 */
describe('J4 席位表、清单与退回说明也住这一格', () => {
  const SEATS = [
    { peer: 'h', seat: 1, name: '房主' },
    { peer: 'g', seat: 2, name: '客人甲' },
  ];
  const SEATS_AFTER = [
    { peer: 'h', seat: 1, name: '房主' },
    { peer: null, seat: 2, name: '空位' },
  ];
  const MOVES = { seat: 2, items: [{ key: '0-END_TURN:aa', label: '⏭️结束回合' }], omitted: 0 };
  const REFUSAL = { key: '0-END_TURN:aa', reason: '这一步已经不成立' };

  it('没收过就是空的：界面据此什么都不画，不画一份猜出来的席位表', () => {
    expect(getSeatMap()).toBeNull();
    expect(getSeatMoves()).toBeNull();
    expect(getRefusal()).toBeNull();
  });

  it('同一份内容换个对象再来＝没变（不重绘、不换引用）；真变了才通知', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);

    expect(receiveSeatMap(SEATS)).toBe(true);
    expect(getSeatMap()).toBe(SEATS);
    expect(receiveSeatMap(SEATS.map((r) => ({ ...r })))).toBe(false);
    expect(getSeatMap()).toBe(SEATS);
    expect(seen).toHaveBeenCalledTimes(1);

    expect(receiveSeatMap(SEATS_AFTER)).toBe(true);
    expect(getSeatMap()).toEqual(SEATS_AFTER);
    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('清单：换座、换条数、换任一个编号或句子、封顶数字变了都算变；原样重发不算', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);

    expect(receiveSeatMoves(MOVES)).toBe(true);
    expect(getSeatMoves()).toBe(MOVES);
    expect(receiveSeatMoves({ seat: 2, items: MOVES.items.map((i) => ({ ...i })), omitted: 0 })).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);

    expect(receiveSeatMoves({ seat: 3, items: MOVES.items, omitted: 0 })).toBe(true);
    expect(receiveSeatMoves({ seat: 3, items: MOVES.items, omitted: 4 })).toBe(true);
    expect(receiveSeatMoves({ seat: 3, items: [{ key: '1-ATTACK:bb', label: '🏹攻击' }], omitted: 4 })).toBe(true);
    expect(seen).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('退回说明是一次性告示：原样再来不重绘，清掉它才算翻篇', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);

    expect(receiveRefusal(REFUSAL)).toBe(true);
    expect(getRefusal()).toBe(REFUSAL);
    expect(receiveRefusal({ ...REFUSAL })).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);

    clearRefusal();
    expect(getRefusal()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
    // 已经空了再清一次不该再惊动界面。
    expect(receiveRefusal(null)).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('attach／detach 把这三格一起清掉：换房不能留着上一屋的座位与人', () => {
    receiveSeatMap(SEATS);
    receiveSeatMoves(MOVES);
    receiveRefusal(REFUSAL);
    attachRoom({ role: 'guest', name: '甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
    expect(getSeatMap()).toBeNull();
    expect(getSeatMoves()).toBeNull();
    expect(getRefusal()).toBeNull();

    receiveSeatMap(SEATS);
    detachRoom();
    expect(getSeatMap()).toBeNull();
  });
});

/**
 * 视角轴取数（联机切片⑤，v2.9.25）：牌桌「哪一营画在正下方」问的就是这一格。
 *
 * 用户 2026-10-30 裁的第 1 条在这里钉死：**本地热座那帧画面逐字不许变**——本地没有房间，
 * 所以取数必须是 `null`，牌桌才退回"跟着轮到谁转"。第 2 条（联机＝看的人自己那一席
 * 一直在下面）由房主与客人问同一句话保证：两边都只照抄那张表里绑到自己号的那一行，
 * 谁都不自己排第二遍座次。
 */
describe('getMyNetSeat：我这台机器坐第几席（视角轴唯一取数点）', () => {
  const SEATS = [
    { peer: 'h', seat: 1, name: '房主' },
    { peer: 'g', seat: 2, name: '客人甲' },
  ];

  it('本地游戏（没进房）＝null ⇒ 牌桌沿用本地形状，一位不动', () => {
    detachRoom();
    receiveSeatMap(SEATS);
    // 表都在了但没有房间这根线 ⇒ 仍然 null：视角不跟着一张无主的座位表转。
    expect(getMyNetSeat()).toBeNull();
  });

  it('房主那台机器问出自己那一席；客人那台机器问出自己那一席（同一张表、同一句话）', () => {
    attachRoom({ role: 'host', name: '房主', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
    expect(getMyNetSeat()).toBeNull();
    receiveSeatMap(SEATS);
    // fakeConnection 的 selfId 是 'h'：房主读出第 1 席。
    expect(getMyNetSeat()).toBe(1);

    const guestConn = { ...fakeConnection(), state: { ...fakeConnection().state, role: 'guest', selfId: 'g' } };
    attachRoom({ role: 'guest', name: '客人甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: guestConn as never });
    receiveSeatMap(SEATS);
    expect(getMyNetSeat()).toBe(2);
  });

  it('椅子被收回（那一行改成空位）⇒ 立刻回 null，不抱着旧席位看', () => {
    attachRoom({ role: 'host', name: '房主', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
    receiveSeatMap(SEATS);
    expect(getMyNetSeat()).toBe(1);
    receiveSeatMap([{ peer: null, seat: 1, name: '空位' }, { peer: 'g', seat: 2, name: '客人甲' }]);
    expect(getMyNetSeat()).toBeNull();
  });

  it('退房把视角一起收干净：下一屋没绑到我之前，画面退回本地形状', () => {
    attachRoom({ role: 'host', name: '房主', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
    receiveSeatMap(SEATS);
    expect(getMyNetSeat()).toBe(1);
    detachRoom();
    expect(getMyNetSeat()).toBeNull();
  });

  it('订阅者看得见它跟着席位表变（界面靠同一个通知重取，不自算）', () => {
    attachRoom({ role: 'guest', name: '客人甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: { ...fakeConnection(), state: { ...fakeConnection().state, role: 'guest', selfId: 'g' } } as never });
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);
    expect(getMyNetSeat()).toBeNull();
    receiveSeatMap(SEATS);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getMyNetSeat()).toBe(2);
    // 原样重发＝没变：不惊动界面，视角读数也还是同一个数。
    receiveSeatMap(SEATS.map((r) => ({ ...r })));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getMyNetSeat()).toBe(2);
    unsubscribe();
  });
});

/**
 * 切片⑤a（v2.9.25）：那张准备表与从它派生出来的"还等谁"也住这一格。
 *
 * 三个判据各自有证人：㈠内容没变＝同一个引用（房主每两秒一次心跳惊不动那屏）；
 * ㈡闸门只认房主那台机器——本地桌、纯 AI 桌、客人那侧一律 `applicable:false`，
 * 今天那颗「开始游戏」什么形状，它们就还是什么形状；
 * ㈢表还没上墙时不锁死房主（刚连线那一瞬读名册，屋里没客人就直接放行）。
 */
describe('⑤a 准备表与开始闸门也住这一格', () => {
  const GUEST_A = { id: 'a', name: '客人甲', role: 'guest' as const };
  const GUEST_B = { id: 'b', name: '客人乙', role: 'guest' as const };
  const ONE = [{ peer: 'a', name: '客人甲', on: false, counted: true }];
  const ONE_READY = [{ peer: 'a', name: '客人甲', on: true, counted: true }];
  const TWO = [ONE[0], { peer: 'b', name: '客人乙', on: false, counted: true }];

  /** 房主那台机器，名册上挂着 `guests` 这几位客人。 */
  function hostWith(guests: unknown[]) {
    const connection = { ...fakeConnection(), state: { ...fakeConnection().state, peers: guests } };
    attachRoom({ role: 'host', name: '房主', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: connection as never });
  }
  function guestSide() {
    const connection = { ...fakeConnection(), state: { ...fakeConnection().state, role: 'guest', selfId: 'a', peers: [{ id: 'h', name: '房主', role: 'host' }, GUEST_A] } };
    attachRoom({ role: 'guest', name: '客人甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: connection as never });
  }

  it('没进房（本地桌、纯 AI 桌）＝闸门不适用而且开着：那颗钮今天的形状一个字不许变', () => {
    expect(getReadyTable()).toBeNull();
    expect(getStartGate()).toEqual({ applicable: false, open: true, waiting: [], gone: [] });
  });

  it('不适用那三种（没进房／客人那侧／退房）互换，引用仍是同一个——界面不会因为"换了个不适用"就重绘', () => {
    const before = getStartGate();
    hostWith([]);
    const openRoom = getStartGate();
    guestSide();
    const asGuest = getStartGate();
    detachRoom();
    expect(before).toBe(openRoom);
    expect(openRoom).toBe(asGuest);
    expect(asGuest).toBe(getStartGate());
    expect(getStartGate().applicable).toBe(false);
  });

  it('房里一个客人都没有＝也不适用（纯 AI 桌照样直接开局），表一到就按表说话', () => {
    hostWith([]);
    expect(getStartGate().applicable).toBe(false);
    expect(getStartGate().open).toBe(true);
    receiveReadyTable(ONE);
    expect(getStartGate().applicable).toBe(true);
    expect(getStartGate().open).toBe(false);
    expect(getStartGate().waiting).toEqual(['客人甲']);
  });

  it('客人进了房、表还没算出来（刚连线那一瞬）＝按"还没齐"挡着，但一个名字也不编', () => {
    hostWith([GUEST_A]);
    expect(getReadyTable()).toBeNull();
    expect(getStartGate().applicable).toBe(true);
    expect(getStartGate().open).toBe(false);
    expect(getStartGate().waiting).toEqual([]);
    expect(getStartGate().gone).toEqual([]);
  });

  it('表原样重发＝没变：不换引用、不通知；内容真变了才两样都动', () => {
    hostWith([GUEST_A]);
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);
    const gate = getStartGate();

    expect(receiveReadyTable(ONE)).toBe(true);
    expect(getReadyTable()).toBe(ONE);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getStartGate()).not.toBe(gate);
    const derived = getStartGate();

    // 房主每次连线心跳、每次名册抖动都会把同一张表再算一遍——内容一致就该一声不响。
    expect(receiveReadyTable(ONE.map((r) => ({ ...r })))).toBe(false);
    expect(getReadyTable()).toBe(ONE);
    expect(getStartGate()).toBe(derived);
    expect(seen).toHaveBeenCalledTimes(1);

    expect(receiveReadyTable(ONE_READY)).toBe(true);
    expect(getStartGate()).not.toBe(derived);
    expect(getStartGate().open).toBe(true);
    expect(getStartGate().waiting).toEqual([]);
    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('房主每两秒一次的心跳惊不动那屏：bump 时表与名册都没动＝派生品不换引用', () => {
    hostWith([GUEST_A]);
    receiveReadyTable(ONE);
    const derived = getStartGate();
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);
    bumpNetRoom();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getStartGate()).toBe(derived);
    unsubscribe();
  });

  it('空表是一句真话：表上没人＝没人在等，闸门开着（与 netstatus／seatmap 拒空反着来的一处）', () => {
    hostWith([]);
    expect(receiveReadyTable([])).toBe(true);
    expect(getReadyTable()).toEqual([]);
    expect(getStartGate().applicable).toBe(true);
    expect(getStartGate().open).toBe(true);
    expect(getStartGate().waiting).toEqual([]);
  });

  it('房主判成掉线那位不占分母：闸门开着，但他仍留在"已经不算在内"那份名单里让人看见', () => {
    hostWith([GUEST_A, GUEST_B]);
    receiveReadyTable([{ peer: 'a', name: '客人甲', on: true, counted: true }, { peer: 'b', name: '客人乙', on: false, counted: false }]);
    expect(getStartGate().open).toBe(true);
    expect(getStartGate().waiting).toEqual([]);
    expect(getStartGate().gone).toEqual(['客人乙']);
  });

  it('客人中途退掉：名册与表一起缩，那句"还等谁"跟着重算，不会永远等一个已经不在的人', () => {
    hostWith([GUEST_A, GUEST_B]);
    receiveReadyTable(TWO);
    expect(getStartGate().waiting).toEqual(['客人甲', '客人乙']);

    hostWith([GUEST_A]);
    expect(getStartGate().applicable).toBe(true);
    expect(getStartGate().open).toBe(false);
    receiveReadyTable(ONE);
    expect(getStartGate().waiting).toEqual(['客人甲']);

    hostWith([]);
    receiveReadyTable([]);
    expect(getStartGate().open).toBe(true);
  });

  it('客人那台机器不适用——它没有"开始游戏"这颗钮，也不该自己判一次闸门', () => {
    guestSide();
    receiveReadyTable(TWO);
    expect(getReadyTable()).toBe(TWO);
    expect(getStartGate().applicable).toBe(false);
    expect(getStartGate().open).toBe(true);
  });

  it('attach／detach 把表与闸门一起清掉：换房不能抱着上一屋那几个人准备', () => {
    hostWith([GUEST_A]);
    receiveReadyTable(ONE);
    attachRoom({ role: 'host', name: '乙', roomCode: 'B', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/B', connection: fakeConnection() as never });
    expect(getReadyTable()).toBeNull();
    expect(getStartGate().applicable).toBe(false);
    receiveReadyTable(ONE);
    detachRoom();
    expect(getReadyTable()).toBeNull();
    expect(getStartGate().applicable).toBe(false);
  });

  it('客人那颗钮要递给房主那台机器上的发布者：没挂上＝原样丢掉（他说"点了没反应"是有出处的），挂上＝只递一次', () => {
    const got: { peer: string; on: boolean }[] = [];
    expect(deliverHostReady({ peer: 'a', on: true })).toBe(false);
    expect(got).toEqual([]);

    setHostReadySink((msg) => got.push(msg));
    expect(deliverHostReady({ peer: 'a', on: true })).toBe(true);
    expect(got).toEqual([{ peer: 'a', on: true }]);

    setHostReadySink(null);
    expect(deliverHostReady({ peer: 'a', on: false })).toBe(false);
    expect(got).toEqual([{ peer: 'a', on: true }]);
  });
});

describe('⑤b 征召进度表也住这一格（房主算、客人照抄，两边读同一格）', () => {
  const SEAT1 = { seat: 1, name: '玩家1', state: 'picking' as const, picked: 3, total: 10 };
  const SEAT2 = { seat: 2, name: '玩家2', state: 'waiting' as const, picked: 0, total: 10 };
  const TWO_ROWS = [SEAT1, SEAT2];

  /** 房主／客人两侧各建一间屋（连线是那枚假的，进度表这一段不碰连线）。 */
  function side(role: 'host' | 'guest') {
    const connection = {
      ...fakeConnection(),
      state: { ...fakeConnection().state, role, selfId: role === 'host' ? 'h' : 'a', name: role === 'host' ? '房主' : '客人甲' },
    };
    attachRoom({ role, name: connection.state.name, roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: connection as never });
  }

  it('没进房＝这一格是空的（本地桌、纯 AI 桌从来不有一张征召进度表）', () => {
    expect(getDraftProgress()).toBeNull();
  });

  it('同一张表原样重发＝没变：不换引用、不通知界面（房主每勾一名都会问一遍，多数时候表没动）', () => {
    side('host');
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);
    expect(receiveDraftProgress(TWO_ROWS)).toBe(true);
    expect(getDraftProgress()).toBe(TWO_ROWS);
    expect(seen).toHaveBeenCalledTimes(1);

    expect(receiveDraftProgress(TWO_ROWS.map((r) => ({ ...r })))).toBe(false);
    expect(getDraftProgress()).toBe(TWO_ROWS);
    expect(seen).toHaveBeenCalledTimes(1);

    // 勾到第 4 名：内容真变了 ⇒ 换引用 + 通知一次
    expect(receiveDraftProgress([{ ...SEAT1, picked: 4 }, SEAT2])).toBe(true);
    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('「还没开始征召」是一句真话：null 收得下，再收一次 null 不惊动界面', () => {
    side('host');
    receiveDraftProgress(TWO_ROWS);
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);
    expect(receiveDraftProgress(null)).toBe(true);
    expect(getDraftProgress()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(receiveDraftProgress(null)).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('客人那侧照抄房主发来的一份，自己不算第二遍', () => {
    side('guest');
    expect(receiveDraftProgress(TWO_ROWS)).toBe(true);
    expect(getDraftProgress()).toEqual(TWO_ROWS);
  });

  it('attach／detach 把这张表一起清掉：换房不能抱着上一屋的征召进度', () => {
    side('host');
    receiveDraftProgress(TWO_ROWS);
    side('guest');
    expect(getDraftProgress()).toBeNull();
    receiveDraftProgress(TWO_ROWS);
    detachRoom();
    expect(getDraftProgress()).toBeNull();
  });
});

/**
 * 切片⑤c（v2.9.25）：我自己那一席的候选名单也住这一格，但与上面那张全桌表**分开一格**。
 * 分开放的理由就一条：那张表换了，我这一格可以一个字没动（反之也是）——
 * 界面读的那一格换了内容不代表另一格也该重画。
 */
describe('⑤c 我自己那一席的候选名单也住这一格（与那张全桌表各走各的）', () => {
  const ITEM = { key: 'm0', name: '夏侯惇', faction: '魏', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: ['刚勇'] };
  const FRAME: NetDraftListFrame = {
    seat: 2, total: 10, instruction: '选择10名将领（群势力1-3名，当前0名）', main: [ITEM], qun: [], picked: [], canConfirm: false,
  };
  const TWO_ROWS = [{ seat: 1, name: '玩家1', state: 'picking' as const, picked: 3, total: 10 }];

  function side(role: 'host' | 'guest') {
    const connection = {
      ...fakeConnection(),
      state: { ...fakeConnection().state, role, selfId: role === 'host' ? 'h' : 'a', name: role === 'host' ? '房主' : '客人甲' },
    };
    attachRoom({ role, name: connection.state.name, roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: connection as never });
  }

  it('没进房＝这一格是空的（本地桌、纯 AI 桌从来不有一张指名发给我的名单）', () => {
    expect(getDraftList()).toBeNull();
  });

  it('同一帧原样重发＝没变：不换引用、不通知界面（房主每勾一名都会重发我这一格，多数时候内容没动）', () => {
    side('guest');
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);
    expect(receiveDraftList(FRAME)).toBe(true);
    expect(getDraftList()).toBe(FRAME);
    expect(seen).toHaveBeenCalledTimes(1);

    expect(receiveDraftList({ ...FRAME, main: [{ ...ITEM }] })).toBe(false);
    expect(getDraftList()).toBe(FRAME);
    expect(seen).toHaveBeenCalledTimes(1);

    // 房主那边勾了一颗 ⇒ 内容真变了：换引用 + 通知一次
    expect(receiveDraftList({ ...FRAME, picked: ['m0'] })).toBe(true);
    expect(getDraftList()).not.toBe(FRAME);
    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('与那张全桌进度表互不牵扯：表换了不许动我这格的引用，我这格换了也不许动表', () => {
    side('guest');
    receiveDraftProgress(TWO_ROWS);
    receiveDraftList(FRAME);
    const listBefore = getDraftList();

    expect(receiveDraftProgress([{ ...TWO_ROWS[0], picked: 7 }])).toBe(true);
    expect(getDraftList()).toBe(listBefore);

    const rowsBefore = getDraftProgress();
    expect(receiveDraftList({ ...FRAME, instruction: '你这一席的征召已经完成了（你那份池子已经定下来）' })).toBe(true);
    expect(getDraftProgress()).toBe(rowsBefore);
  });

  it('attach／detach 把这一格一起清掉：换房不能抱着上一屋里别人发给我的名单', () => {
    side('guest');
    receiveDraftList(FRAME);
    side('host');
    expect(getDraftList()).toBeNull();
    receiveDraftList(FRAME);
    detachRoom();
    expect(getDraftList()).toBeNull();
  });
});

/**
 * 切片⑤d（v2.9.25）：客人交回来的那两下走的是同一格，而他屏上那句"为什么不让你走"
 * 也挤在同一格里——所以这一格的去重判据必须认得出"只有那一行字换了"。
 * 认不出的话，界面就会照旧画着上一秒那句该做什么，人点了没反应还一句也不给他。
 */
describe('⑤d 拒话与交回来的那两下也住这一格', () => {
  const ITEM = { key: 'm0', name: '夏侯惇', faction: '魏', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: ['刚勇'] };
  const FRAME: NetDraftListFrame = {
    seat: 1, total: 10, instruction: '选择10名将领（群势力1-3名，当前0名）',
    main: [ITEM], qun: [], picked: [], canConfirm: false,
  };

  function guestSide() {
    const connection = {
      ...fakeConnection(),
      state: { ...fakeConnection().state, role: 'guest' as const, selfId: 'a', name: '客人甲' },
    };
    attachRoom({ role: 'guest', name: '客人甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: connection as never });
  }

  it('只有那一行字换了（名单与"已选"一字未动）⇒ 算一次变化：换引用、通知界面（拒话不是"没动"）', () => {
    guestSide();
    receiveDraftList(FRAME);
    const before = getDraftList();
    const seen = vi.fn();
    const unsubscribe = subscribeNetRoom(seen);

    const refused = { ...FRAME, instruction: '这一颗不在我发给你的那份名单上，这一条不认。' };
    expect(receiveDraftList(refused)).toBe(true);
    expect(getDraftList()).not.toBe(before);
    expect(getDraftList()!.main).toEqual([ITEM]); // 那句拒话不许把他的名单一起改掉
    expect(getDraftList()!.picked).toEqual([]);
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('只有那个「凑够了没有」的布尔换了 ⇒ 也算一次变化（判据不靠"这两个字段一定一起动"的推导）', () => {
    guestSide();
    receiveDraftList(FRAME);
    expect(receiveDraftList({ ...FRAME, canConfirm: true })).toBe(true);
    expect(getDraftList()!.canConfirm).toBe(true);
  });

  it('客人交回来的那一颗点将钮要递给房主那台机器上的发布者：没挂上＝原样丢掉，挂上＝只递一次', () => {
    const got: IncomingDraft[] = [];
    expect(deliverHostDraft({ kind: 'pick', peer: 'a', key: 'm0' })).toBe(false);
    expect(got).toEqual([]);

    setHostDraftSink((msg) => got.push(msg));
    expect(deliverHostDraft({ kind: 'pick', peer: 'a', key: 'm0' })).toBe(true);
    expect(deliverHostDraft({ kind: 'confirm', peer: 'a' })).toBe(true);
    expect(got).toEqual([{ kind: 'pick', peer: 'a', key: 'm0' }, { kind: 'confirm', peer: 'a' }]);

    setHostDraftSink(null);
    expect(deliverHostDraft({ kind: 'pick', peer: 'a', key: 'm1' })).toBe(false);
    expect(got).toHaveLength(2);
  });
});
