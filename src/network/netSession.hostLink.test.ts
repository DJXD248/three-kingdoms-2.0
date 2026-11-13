/**
 * 行为证人：房主关掉浏览器（客人这根线彻底安静）后，客人必须在 15 秒内收到一次
 * 「房主失联」；房主又来信就自动恢复；客人自己这根线断开则立刻提示。
 *
 * 用假线与假钟跑真 `joinRoom`，不靠读源码代替实跑。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeEnvelope } from './netProtocol';
import { joinRoom } from './netSession';
import type { WebSocketLike } from './wsTransport';
import type { HostLinkState } from './hostLinkWatch';

const HOST_ID = 'host-1';
const GUEST_ID = 'guest-1';

function fakeSocket(): WebSocketLike {
  const socket: WebSocketLike = {
    readyState: 1,
    send: () => {},
    close: () => socket.onclose?.({}),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return socket;
}

function hostPingAt(at: number): string {
  return encodeEnvelope({ t: 'ping', from: HOST_ID, to: GUEST_ID, at });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('客人端房主失联自查（真连线 + 假钟）', () => {
  it('15 秒没收到房主任何消息 ⇒ 报一次失联；再来信 ⇒ 自动恢复；线断 ⇒ 立刻报', () => {
    vi.useFakeTimers();
    const states: HostLinkState[] = [];
    let socket: WebSocketLike | null = null;

    const connection = joinRoom(
      {
        role: 'guest',
        name: '客人甲',
        url: 'ws://127.0.0.1:8787/ROOMAA',
        roomCode: 'ROOMAA',
        selfId: GUEST_ID,
        socketFactory: () => (socket = fakeSocket()),
        heartbeat: {},
        onHostLink: (next) => states.push(next),
      },
      () => {},
    );

    socket!.onopen?.();
    socket!.onmessage?.({ data: hostPingAt(Date.now()) });
    expect(states).toEqual([]);

    vi.advanceTimersByTime(14_000);
    expect(states).toEqual([]);

    vi.advanceTimersByTime(2_000);
    expect(states).toEqual(['lost']);

    // 房主又发来一封：状态当场翻回在线，不要求客人重连或点什么。
    socket!.onmessage?.({ data: hostPingAt(Date.now()) });
    expect(states).toEqual(['lost', 'online']);

    // 客人自己这根线断开：不必再等 15 秒。
    socket!.onclose?.({});
    expect(states).toEqual(['lost', 'online', 'lost']);

    connection.leave();
  });

  it('没有接线回调时不启动自查定时器（老调用方零影响）', () => {
    vi.useFakeTimers();
    let socket: WebSocketLike | null = null;
    const connection = joinRoom(
      {
        role: 'guest',
        name: '客人甲',
        url: 'ws://127.0.0.1:8787/ROOMAA',
        roomCode: 'ROOMAA',
        selfId: GUEST_ID,
        socketFactory: () => (socket = fakeSocket()),
        heartbeat: {},
      },
      () => {},
    );
    socket!.onopen?.();
    expect(vi.getTimerCount()).toBe(0);
    connection.leave();
  });
});
