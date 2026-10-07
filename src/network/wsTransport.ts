/** 一层薄薄的 WebSocket 客户端：地址可填 ⇒ A（本机/局域网/Radmin 虚拟网）与 C（中转服务器）只换这一个 URL。 */

export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: (() => void) | null;
};

export type SocketFactory = (url: string) => WebSocketLike;

export type NetLink = {
  send(text: string): boolean;
  close(): void;
};

export type NetLinkHandlers = {
  onOpen: () => void;
  onText: (text: string) => void;
  onClose: (why: string) => void;
};

const OPEN_STATE = 1;

export function openNetLink(
  url: string,
  handlers: NetLinkHandlers,
  socketFactory: SocketFactory = (u) => new WebSocket(u) as unknown as WebSocketLike,
): NetLink {
  let socket: WebSocketLike;
  try {
    socket = socketFactory(url);
  } catch (err) {
    handlers.onClose(err instanceof Error ? err.message : String(err));
    return { send: () => false, close: () => {} };
  }

  let closed = false;
  const finish = (why: string) => {
    if (closed) return;
    closed = true;
    handlers.onClose(why);
  };

  socket.onopen = () => handlers.onOpen();
  socket.onmessage = (ev) => {
    if (typeof ev.data === 'string') handlers.onText(ev.data);
  };
  socket.onclose = (ev) => finish(ev.reason ? ev.reason : '连线已断开');
  socket.onerror = () => finish('连不上这个地址（传话程序没开、地址填错，或网络不通）');

  return {
    send(text) {
      if (closed || socket.readyState !== OPEN_STATE) return false;
      socket.send(text);
      return true;
    },
    close() {
      if (closed) return;
      socket.close();
      finish('已离开房间');
    },
  };
}
