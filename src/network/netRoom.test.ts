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
  receiveGuestSnapshot,
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
