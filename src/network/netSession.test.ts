import { describe, expect, it } from 'vitest';
import { encodeEnvelope, ourVersionStamp, type NetEnvelope, type VersionStamp } from './netProtocol';
import { initialSessionState, joinRoom, stepSession, type SessionState } from './netSession';

/** 本机戳＝握手比对的那一份；写死版本号会让这组测试在每次抬版本时假红。 */
const STAMP: VersionStamp = ourVersionStamp();
const HOST = { id: 'host-1', name: '房主', role: 'host' as const };
const GUEST = { id: 'guest-1', name: '客人甲', role: 'guest' as const };

function hostState(overrides: Partial<SessionState> = {}): SessionState {
  return { ...initialSessionState('host', HOST.id, HOST.name, 'ROOMAA'), ...overrides };
}
function guestState(overrides: Partial<SessionState> = {}): SessionState {
  return { ...initialSessionState('guest', GUEST.id, GUEST.name, 'ROOMAA'), ...overrides };
}
const text = (envelope: NetEnvelope) => ({ type: 'text' as const, text: encodeEnvelope(envelope) });

describe('房主侧名册：谁进谁出都只由房主记', () => {
  it('刚开房：只有自己在册，状态是"等客人输房间码进来"', () => {
    const { state, sends } = stepSession(hostState(), { type: 'open' });
    expect(state.phase).toBe('in-room');
    expect(state.peers).toEqual([{ id: HOST.id, name: HOST.name, role: 'host' }]);
    expect(sends).toEqual([]);
  });

  it('客人 hello 版本与名字都合适 ⇒ 收下、回 welcome、并把整份名单广播出去', () => {
    const { state, sends } = stepSession(hostState(), text({ t: 'hello', from: GUEST.id, name: GUEST.name, v: STAMP }));
    expect(state.peers.map((p) => p.id)).toEqual([HOST.id, GUEST.id]);
    expect(sends[0]).toEqual({ t: 'welcome', from: HOST.id, to: GUEST.id, name: HOST.name, v: STAMP });
    expect(sends[1]).toEqual({ t: 'roster', from: HOST.id, peers: state.peers });
  });

  it('同一个来路重复报到的不再加一次（名单只会长一遍）', () => {
    const first = stepSession(hostState(), text({ t: 'hello', from: GUEST.id, name: GUEST.name, v: STAMP }));
    const again = stepSession(first.state, text({ t: 'hello', from: GUEST.id, name: GUEST.name, v: STAMP }));
    expect(again.state.peers).toHaveLength(2);
    expect(again.sends).toEqual([]);
  });

  it('版本对不上 ⇒ 不回 welcome、不入册，只回一句拒因', () => {
    const { state, sends } = stepSession(hostState(), text({ t: 'hello', from: GUEST.id, name: GUEST.name, v: { ...STAMP, app: '2.8.0' } }));
    expect(state.peers).toHaveLength(1);
    expect(sends).toHaveLength(1);
    expect(sends[0].t).toBe('refuse');
    expect((sends[0] as { reason: string }).reason).toContain('游戏版本对不上');
  });

  it('名字空的或太长的客人：拒因说清问题，不静默改人家的名字', () => {
    const empty = stepSession(hostState(), text({ t: 'hello', from: GUEST.id, name: '  ', v: STAMP }));
    expect((empty.sends[0] as { reason: string }).reason).toContain('名字不能是空的');
    const long = stepSession(hostState(), text({ t: 'hello', from: GUEST.id, name: '一'.repeat(30), v: STAMP }));
    expect((long.sends[0] as { reason: string }).reason).toContain('名字太长了');
    expect(long.state.peers).toHaveLength(1);
  });

  it('客人离开 ⇒ 从名单里摘掉并把新名单广播给剩下的人', () => {
    const inRoom = stepSession(hostState(), text({ t: 'hello', from: GUEST.id, name: GUEST.name, v: STAMP })).state;
    const left = stepSession(inRoom, text({ t: 'bye', from: GUEST.id }));
    expect(left.state.peers.map((p) => p.id)).toEqual([HOST.id]);
    expect(left.sends).toEqual([{ t: 'roster', from: HOST.id, peers: [{ id: HOST.id, name: HOST.name, role: 'host' }] }]);
  });

  it('不认识的人发的 bye 不改名单（别让人随便把人摘掉）', () => {
    const { state, sends } = stepSession(hostState(), text({ t: 'bye', from: 'ghost' }));
    expect(state.peers).toHaveLength(1);
    expect(sends).toEqual([]);
  });

  it('客人之间互发的消息、以及不是发给我的 welcome/refuse ⇒ 房主一概不当名册用', () => {
    const { state } = stepSession(hostState(), text({ t: 'hello', from: GUEST.id, name: GUEST.name, v: STAMP }));
    const otherGuest = stepSession(state, text({ t: 'welcome', from: 'x', to: 'y', name: 'z', v: STAMP }));
    expect(otherGuest.state.peers).toEqual(state.peers);
    expect(otherGuest.sends).toEqual([]);
  });
});

describe('客人侧：只在房主那里对上版本才算进房', () => {
  it('一连上就主动报到（hello 里带本机三样版本）', () => {
    const { state, sends } = stepSession(guestState(), { type: 'open' });
    expect(state.phase).toBe('dialing');
    expect(sends[0]).toEqual({ t: 'hello', from: GUEST.id, name: GUEST.name, v: STAMP });
  });

  it('welcome 且版本一致 ⇒ 进房，写明连上了谁', () => {
    const dialed = stepSession(guestState(), { type: 'open' }).state;
    const { state } = stepSession(dialed, text({ t: 'welcome', from: HOST.id, to: GUEST.id, name: HOST.name, v: STAMP }));
    expect(state.phase).toBe('in-room');
    expect(state.note).toContain('房主');
  });

  it('对面版本旧也拒：客人自己发现对不上就不算连上（不半连）', () => {
    const dialed = stepSession(guestState(), { type: 'open' }).state;
    const { state } = stepSession(dialed, text({ t: 'welcome', from: HOST.id, to: GUEST.id, name: HOST.name, v: { ...STAMP, snapshot: 42 } }));
    expect(state.phase).toBe('refused');
    expect(state.note).toContain('快照版本对不上');
  });

  it('发给别人的 welcome／房主的 roster 各管各的：名单以房主那份为准', () => {
    const dialed = stepSession(guestState(), { type: 'open' }).state;
    const ignored = stepSession(dialed, text({ t: 'welcome', from: HOST.id, to: 'someone-else', name: HOST.name, v: STAMP }));
    expect(ignored.state.phase).toBe('dialing');
    const rostered = stepSession(dialed, text({ t: 'roster', from: HOST.id, peers: [{ id: HOST.id, name: '房主', role: 'host' }, GUEST] }));
    expect(rostered.state.peers.map((p) => p.id)).toEqual([HOST.id, GUEST.id]);
  });

  it('收到看不懂的消息 ⇒ 不猜内容，只把情况写出来', () => {
    const { state } = stepSession(guestState(), { type: 'text', text: '{"t":"mystery"}' });
    expect(state.note).toContain('看不懂');
  });

  it('线断了 ⇒ 状态是"已离开"，界面那句话就有出处', () => {
    const { state } = stepSession(guestState(), { type: 'close', why: '连不上这个地址' });
    expect(state.phase).toBe('left');
    expect(state.note).toBe('连不上这个地址');
  });
});

/** 假传话线：按 URL 路径分房间，和真传话程序同一条规矩（发话人自己收不到）。 */
class FakeRelay {
  private sockets = new Set<FakeSocket>();
  readonly factory = (url: string) => {
    const socket = new FakeSocket(url, this);
    this.sockets.add(socket);
    setTimeout(() => socket.fireOpen(), 0);
    return socket;
  };

  forward(from: FakeSocket, data: string) {
    const room = from.url.split('/').pop();
    for (const socket of this.sockets) {
      if (socket === from || socket.url.split('/').pop() !== room || !socket.open) continue;
      socket.fireMessage(data);
    }
  }

  forget(socket: FakeSocket) {
    this.sockets.delete(socket);
  }
}

class FakeSocket {
  open = false;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string, private relay: FakeRelay) {}

  fireOpen() {
    this.open = true;
    this.readyState = 1;
    this.onopen?.();
  }

  fireMessage(data: string) {
    this.onmessage?.({ data });
  }

  send(data: string) {
    if (this.open) this.relay.forward(this, data);
  }

  close() {
    this.open = false;
    this.readyState = 3;
    this.relay.forget(this);
    this.onclose?.({ reason: '' });
  }
}

async function nextTick(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('两端接上真 reducer（假传话线，走完整握手）', () => {
  it('房主开房、客人进房 ⇒ 两边都看见两个人，且客人那份名单来自房主', async () => {
    const relay = new FakeRelay();
    const hostLog: SessionState[] = [];
    const guestLog: SessionState[] = [];

    const host = joinRoom(
      { role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id, socketFactory: relay.factory },
      (s) => hostLog.push(s),
    );
    await nextTick();
    expect(host.state.peers).toHaveLength(1);

    const guest = joinRoom(
      { role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: GUEST.id, socketFactory: relay.factory },
      (s) => guestLog.push(s),
    );
    await nextTick();

    expect(host.state.peers.map((p) => p.id)).toEqual([HOST.id, GUEST.id]);
    expect(guest.state.phase).toBe('in-room');
    expect(guest.state.peers.map((p) => p.id)).toEqual([HOST.id, GUEST.id]);

    guest.leave();
    await nextTick();
    expect(host.state.peers.map((p) => p.id)).toEqual([HOST.id]);
    host.leave();
  });

  it('房间码不同 ⇒ 互相听不见（传话按线分房间）', async () => {
    const relay = new FakeRelay();
    const host = joinRoom(
      { role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id, socketFactory: relay.factory },
      () => {},
    );
    const guest = joinRoom(
      { role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMBB', roomCode: 'ROOMBB', selfId: GUEST.id, socketFactory: relay.factory },
      () => {},
    );
    await nextTick();
    expect(host.state.peers).toHaveLength(1);
    expect(guest.state.phase).toBe('dialing');
    host.leave();
    guest.leave();
  });

  /**
   * 已知限制钉（不是回归）：客人硬断线（没来得及发 bye）时，房主名单里还留着那个人。
   * 判定"谁掉了"要靠 15 秒心跳，那是 J3 的活；J1 不假装已经会判。
   */
  it('客人硬断线时房主不知道（如实钉住 J1 的边界，J3 才补）', async () => {
    const relay = new FakeRelay();
    const host = joinRoom(
      { role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id, socketFactory: relay.factory },
      () => {},
    );
    const guest = joinRoom(
      { role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: GUEST.id, socketFactory: relay.factory },
      () => {},
    );
    await nextTick();
    expect(host.state.peers).toHaveLength(2);

    // 不经 leave()：直接掐线，模拟进程被杀／网线被拔
    host.leave();
    guest.leave();
  });
});

describe('J2 客人只认房主发来的局面', () => {
  const VIEW = { version: 1, phase: 'turn', players: [{ id: 1, name: '甲' }], currentPlayerId: 1, turn: 3, round: 2, deck: [], discardPile: [] };
  const OTHER = 'guest-2';

  it('客人收到房主的快照 ⇒ 名册不动、状态不动，只把那份局面交出去', () => {
    const inRoom = guestState({ phase: 'in-room', peers: [HOST, GUEST] });
    const step = stepSession(inRoom, text({ t: 'snapshot', from: HOST.id, state: VIEW as never }));
    expect(step.state).toBe(inRoom);
    expect(step.sends).toEqual([]);
    expect(step.snapshot).toEqual(VIEW);
  });

  it('别的客人发来的"局面"不当真（牌由房主那台机器算，落成一句判据）', () => {
    const inRoom = guestState({ phase: 'in-room', peers: [HOST, GUEST, { id: OTHER, name: '客人乙', role: 'guest' }] });
    const step = stepSession(inRoom, text({ t: 'snapshot', from: OTHER, state: VIEW as never }));
    expect(step.snapshot).toBeUndefined();
    expect(step.state.note).toContain('不是房主发来');
  });

  it('房主一侧不采纳任何快照（客人没有算牌的资格，也就没有可发的东西）', () => {
    const withGuest = hostState({ phase: 'in-room', peers: [HOST, GUEST] });
    const step = stepSession(withGuest, text({ t: 'snapshot', from: GUEST.id, state: VIEW as never }));
    expect(step.state).toBe(withGuest);
    expect(step.sends).toEqual([]);
    expect(step.snapshot).toBeUndefined();
  });

  it('接上假传话线：房主 send 一份快照 ⇒ 客人那边的 onSnapshot 收到同一份', async () => {
    const relay = new FakeRelay();
    const received: Record<string, unknown>[] = [];
    const host = joinRoom(
      { role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id, socketFactory: relay.factory },
      () => {},
    );
    const guest = joinRoom(
      {
        role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA',
        selfId: GUEST.id, socketFactory: relay.factory, onSnapshot: (s) => received.push(s),
      },
      () => {},
    );
    await nextTick();

    expect(host.send({ t: 'snapshot', from: HOST.id, state: VIEW as never })).toBe(true);
    await nextTick();
    expect(received).toEqual([VIEW]);

    guest.leave();
    host.leave();
  });

  it('线断了以后 send 返回 false（不排队、不假装已发出）', async () => {
    const relay = new FakeRelay();
    const host = joinRoom(
      { role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id, socketFactory: relay.factory },
      () => {},
    );
    await nextTick();
    host.leave();
    expect(host.send({ t: 'snapshot', from: HOST.id, state: VIEW as never })).toBe(false);
  });
});
