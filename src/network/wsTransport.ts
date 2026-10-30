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
  // 门外被拒时，浏览器读不到传话程序回的那句原因（握手响应的头与正文都不交给 WebSocket 页面），
  // 只能看见"没连上"这一件事。所以这句必须把"进场字不对"也列进可能原因里——
  // 漏了它，抄错一个字符的人会去查传话程序开没开、网络通不通，而真正的原因一个字也看不见。
  socket.onerror = () => finish('连不上这个地址（传话程序没开、地址填错、网络不通，或是房间码／进场字不对被挡在门外）');

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
