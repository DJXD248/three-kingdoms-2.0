/**
 * 房间这一格的证人：连线与"客人最后看到的局面"住在这里而不是某个弹窗里，
 * 所以关掉联网大厅去开局，房主那边还在发、客人那边还在收。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachRoom,
  bumpNetRoom,
  detachRoom,
  getActiveRoom,
  getGuestSnapshot,
  getNetStatus,
  receiveGuestSnapshot,
  receiveNetStatus,
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
