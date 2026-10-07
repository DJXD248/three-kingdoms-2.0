import { describe, expect, it, vi } from 'vitest';
import { openNetLink, type NetLinkHandlers, type WebSocketLike } from './wsTransport';

/** 可控的假线：测试只验这层薄皮的规矩，不碰真网络。 */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];
  closeCalls = 0;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  fireOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
}

function linkWith(socket: FakeSocket) {
  const notices: string[] = [];
  const texts: string[] = [];
  const handlers: NetLinkHandlers = {
    onOpen: vi.fn(),
    onText: (text) => texts.push(text),
    onClose: (why) => notices.push(why),
  };
  const link = openNetLink('ws://127.0.0.1:8787/ROOMAA', handlers, () => socket);
  return { link, notices, texts, handlers };
}

describe('传输层薄皮：什么时候算发出去了、什么时候算断了', () => {
  it('线通了才发：open 之前 send 返回 false 且一个字节都不往外送', () => {
    const socket = new FakeSocket();
    const { link } = linkWith(socket);
    expect(link.send('{"t":"hello"}')).toBe(false);
    expect(socket.sent).toEqual([]);

    socket.fireOpen();
    expect(link.send('{"t":"hello"}')).toBe(true);
    expect(socket.sent).toEqual(['{"t":"hello"}']);
  });

  it('建线当场就抛（地址填成非法样子）⇒ 直接把原因报给界面，不留下半个连着的对象', () => {
    const notices: string[] = [];
    const link = openNetLink('not-a-url', { onOpen: () => {}, onText: () => {}, onClose: (why) => notices.push(why) }, () => {
      throw new Error('WebSocket 地址不合法');
    });
    expect(notices).toEqual(['WebSocket 地址不合法']);
    expect(link.send('whatever')).toBe(false);
    expect(() => link.close()).not.toThrow();
  });

  it('认文本、不认二进制：内容不是字符串就当没看见（不猜人家发了什么）', () => {
    const socket = new FakeSocket();
    const { texts } = linkWith(socket);
    socket.fireOpen();
    socket.onmessage?.({ data: new Uint8Array([1, 2, 3]) });
    socket.onmessage?.({ data: '{"t":"bye","from":"x"}' });
    expect(texts).toEqual(['{"t":"bye","from":"x"}']);
  });

  it('先报错再断开（浏览器真会这么发两个事件）⇒ 界面只听见一句原因', () => {
    const socket = new FakeSocket();
    const { notices } = linkWith(socket);
    socket.fireOpen();
    socket.onerror?.();
    socket.onclose?.({ reason: '' });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('连不上这个地址');
  });

  it('断开事件没带原因 ⇒ 兜一句人读的，界面那句话不会空着', () => {
    const socket = new FakeSocket();
    const { notices } = linkWith(socket);
    socket.fireOpen();
    socket.onclose?.({});
    expect(notices).toEqual(['连线已断开']);
  });

  it('主动离开：关掉线、报一次「已离开房间」，之后的 send 全部作废', () => {
    const socket = new FakeSocket();
    const { link, notices } = linkWith(socket);
    socket.fireOpen();
    link.close();
    expect(socket.closeCalls).toBe(1);
    expect(notices).toEqual(['已离开房间']);
    expect(link.send('late')).toBe(false);

    link.close();
    expect(socket.closeCalls).toBe(1);
    expect(notices).toHaveLength(1);
  });
});
