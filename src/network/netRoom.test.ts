/**
 * 房间这一格的证人：连线与"客人最后看到的局面"住在这里而不是某个弹窗里，
 * 所以关掉联网大厅去开局，房主那边还在发、客人那边还在收。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachRoom,
  bumpNetRoom,
  clearRefusal,
  detachRoom,
  getActiveRoom,
  getGuestSnapshot,
  getNetStatus,
  getRefusal,
  getSeatMap,
  getSeatMoves,
  receiveGuestSnapshot,
  receiveNetStatus,
  receiveRefusal,
  receiveSeatMap,
  receiveSeatMoves,
  subscribeNetRoom,
} from './netRoom';
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
    attachRoom({ role: 'host', name: '房主', roomCode: 'ROOMAA', address: 'ws://x', url: 'ws://x/ROOMAA', connection: connection as never });
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
    attachRoom({ role: 'host', name: '甲', roomCode: 'A', address: 'ws://x', url: 'ws://x/A', connection: first as never });
    attachRoom({ role: 'host', name: '乙', roomCode: 'B', address: 'ws://x', url: 'ws://x/B', connection: second as never });
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

    attachRoom({ role: 'guest', name: '甲', roomCode: 'A', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
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
    attachRoom({ role: 'guest', name: '甲', roomCode: 'A', address: 'ws://x', url: 'ws://x/A', connection });
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
    attachRoom({ role: 'host', name: '甲', roomCode: 'A', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
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
    attachRoom({ role: 'guest', name: '甲', roomCode: 'A', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection() as never });
    expect(getSeatMap()).toBeNull();
    expect(getSeatMoves()).toBeNull();
    expect(getRefusal()).toBeNull();

    receiveSeatMap(SEATS);
    detachRoom();
    expect(getSeatMap()).toBeNull();
  });
});
