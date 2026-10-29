import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISCONNECT_SILENCE_MS,
  HEARTBEAT_PROBE_INTERVAL_MS,
} from './netHeartbeat';
import {
  encodeEnvelope,
  ourVersionStamp,
  parseEnvelope,
  type NetEnvelope,
  type NetLinkRow,
  type NetMoveItem,
  type NetSeatRow,
  type VersionStamp,
} from './netProtocol';
import { initialSessionState, joinRoom, newPeerId, stepSession, type SessionState } from './netSession';

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
  /** 建过的每一根线都留着：J3 的实测要把某一人的线单独掐掉（他不再回任何一条消息）。 */
  readonly created: FakeSocket[] = [];
  readonly factory = (url: string) => {
    const socket = new FakeSocket(url, this);
    this.sockets.add(socket);
    this.created.push(socket);
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
  /** 掐掉这个人往外发的所有消息（线还开着、他还能听见，就是他不再回话）＝J3 的掉线场景。 */
  silent = false;
  readonly sent: string[] = [];
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
    if (!this.open || this.silent) return;
    this.sent.push(data);
    this.relay.forward(this, data);
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

  // ── 切片③（v2.9.25）：快照按席位各出一份 ⇒ 信封上多了一个"这一份是算给谁的" ──
  it('指名发给我的那一份 ⇒ 收下', () => {
    const inRoom = guestState({ phase: 'in-room', peers: [HOST, GUEST, { id: OTHER, name: '客人乙', role: 'guest' }] });
    const step = stepSession(inRoom, text({ t: 'snapshot', from: HOST.id, to: GUEST.id, state: VIEW as never }));
    expect(step.snapshot).toEqual(VIEW);
    expect(step.state).toBe(inRoom);
  });

  it('指名发给别人的那一份 ⇒ 不采纳（别人的私有视图绝不画在自己这一席上），但仍算"收到过房主的消息"', () => {
    const inRoom = guestState({ phase: 'in-room', peers: [HOST, GUEST, { id: OTHER, name: '客人乙', role: 'guest' }] });
    const step = stepSession(inRoom, text({ t: 'snapshot', from: HOST.id, to: OTHER, state: VIEW as never }));
    expect(step.snapshot).toBeUndefined();
    expect(step.state).toBe(inRoom);
    // 掉线判定的口径是"15 秒未收到该人任何消息"，所以丢掉别人的那份不等于没看见过房主。
    expect(step.saw).toEqual({ from: HOST.id, kind: 'snapshot' });
  });

  it('房主手滑把收件人写成了空串 ⇒ 协议层整条拒掉，客人这边退回"看不懂"而不是半收', () => {
    const inRoom = guestState({ phase: 'in-room', peers: [HOST, GUEST] });
    const step = stepSession(inRoom, text({ t: 'snapshot', from: HOST.id, to: '', state: VIEW as never }));
    expect(step.snapshot).toBeUndefined();
    expect(step.state.note).toContain('看不懂');
  });

  it('接上假传话线：一份局面里三个人，只有被点名的那位采纳', async () => {
    const relay = new FakeRelay();
    const mine: Record<string, unknown>[] = [];
    const theirs: Record<string, unknown>[] = [];
    const host = joinRoom(
      { role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id, socketFactory: relay.factory },
      () => {},
    );
    const guest = joinRoom(
      {
        role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA',
        selfId: GUEST.id, socketFactory: relay.factory, onSnapshot: (s) => mine.push(s),
      },
      () => {},
    );
    const other = joinRoom(
      {
        role: 'guest', name: '客人乙', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA',
        selfId: OTHER, socketFactory: relay.factory, onSnapshot: (s) => theirs.push(s),
      },
      () => {},
    );
    await nextTick();
    expect(host.state.peers).toHaveLength(3);

    // 传话程序只认房间不认人：发给别人的那一条照样会递到我这里，采纳与否是我这边判的。
    expect(host.send({ t: 'snapshot', from: HOST.id, to: OTHER, state: { who: '别人的那一份' } })).toBe(true);
    await nextTick();
    expect(mine).toEqual([]);
    expect(theirs).toEqual([{ who: '别人的那一份' }]);

    expect(host.send({ t: 'snapshot', from: HOST.id, to: GUEST.id, state: { who: '我的那一份' } as never })).toBe(true);
    await nextTick();
    expect(mine).toEqual([{ who: '我的那一份' }]);
    expect(theirs).toHaveLength(1);

    host.leave();
    guest.leave();
    other.leave();
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

/** J3 客人侧：只做两件事——原样抄回时刻、照抄房主发来的表。判定权一条也不在客人手里。 */
describe('J3 客人只回话、只照抄，绝不自判', () => {
  const TABLE: NetLinkRow[] = [
    { id: HOST.id, name: HOST.name, pingMs: null, state: 'online' },
    { id: GUEST.id, name: GUEST.name, pingMs: 42, state: 'online' },
  ];
  const inRoom = () => guestState({ phase: 'in-room', peers: [HOST, GUEST] });

  it('指名发给我的探测 ⇒ 只回一条 pong，时刻原样抄回去（客人这边一个数也不算）', () => {
    const before = inRoom();
    const step = stepSession(before, text({ t: 'ping', from: HOST.id, to: GUEST.id, at: 1_700_000_000_123 }));
    expect(step.sends).toEqual([{ t: 'pong', from: GUEST.id, to: HOST.id, at: 1_700_000_000_123 }]);
    expect(step.state).toBe(before);
  });

  it('发给别人的探测绝不代答（两个人同名也不能互相顶缸）', () => {
    const step = stepSession(inRoom(), text({ t: 'ping', from: HOST.id, to: 'guest-2', at: 10 }));
    expect(step.sends).toEqual([]);
  });

  it('房主发来的连线表照抄交出去，名册与状态都不动（掉线是房主算好的，不是客人算的）', () => {
    const before = inRoom();
    const step = stepSession(before, text({ t: 'netstatus', from: HOST.id, rows: TABLE }));
    expect(step.table).toEqual(TABLE);
    expect(step.state).toBe(before);
    expect(step.sends).toEqual([]);
  });

  it('不是房主发来的表不当真（客人也可以往房间里发"某某掉线了"，那条必须无效）', () => {
    const withTwo = guestState({ phase: 'in-room', peers: [HOST, GUEST, { id: 'guest-2', name: '客人乙', role: 'guest' }] });
    const step = stepSession(withTwo, text({ t: 'netstatus', from: 'guest-2', rows: TABLE }));
    expect(step.table).toBeUndefined();
    expect(step.state.note).toContain('不是房主发来');
  });

  it('还没进房（名册里根本没有房主）时收到的表也不收：没有"谁算的是准的"就没有可抄的', () => {
    const step = stepSession(guestState(), text({ t: 'netstatus', from: HOST.id, rows: TABLE }));
    expect(step.table).toBeUndefined();
  });

  it('房主一侧完全不采纳连线表（他自己那张是算出来的，不需要别人告诉他）', () => {
    const withGuest = hostState({ phase: 'in-room', peers: [HOST, GUEST] });
    const step = stepSession(withGuest, text({ t: 'netstatus', from: GUEST.id, rows: TABLE }));
    expect(step.table).toBeUndefined();
    expect(step.state).toBe(withGuest);
    expect(step.sends).toEqual([]);
  });

  it('任何一条解析成功的来信都带出"是谁发的"，pong 还带上那个时刻（房主据此刷新时钟）', () => {
    const withGuest = hostState({ phase: 'in-room', peers: [HOST, GUEST] });
    expect(stepSession(withGuest, text({ t: 'bye', from: GUEST.id })).saw).toEqual({ from: GUEST.id, kind: 'bye' });
    expect(stepSession(withGuest, text({ t: 'pong', from: GUEST.id, to: HOST.id, at: 777 })).saw)
      .toEqual({ from: GUEST.id, kind: 'pong', at: 777 });
    // 看不懂的一条不产生"saw"：坏消息不能把一个人的时钟刷新。
    expect(stepSession(withGuest, { type: 'text', text: '{"t":"mystery"}' }).saw).toBeUndefined();
  });
});

/** 假钟＋手动跳格：判据用时刻一比，测试绝不真等十五秒，也不靠真定时器碰运气。 */
function fakeClock(start = 1_700_000_000_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

function manualTicks() {
  const queue: Array<{ id: number; fn: () => void }> = [];
  let seq = 0;
  return {
    deps: {
      schedule: (fn: () => void) => {
        seq += 1;
        queue.push({ id: seq, fn });
        return seq as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: (handle: ReturnType<typeof setTimeout>) => {
        const id = handle as unknown as number;
        const i = queue.findIndex((item) => item.id === id);
        if (i >= 0) queue.splice(i, 1);
      },
    },
    /** 走一跳＝房主那台机器上的一个探测时刻到了。 */
    tick: () => {
      const item = queue.shift();
      if (!item) return false;
      item.fn();
      return true;
    },
    pending: () => queue.length,
  };
}

/** 把某根线上发过的信封挑出来（判"谁发过什么"要看线上证人，不能只看界面）。 */
function framesFrom(socket: FakeSocket | undefined, type: string): NetEnvelope[] {
  if (!socket) return [];
  return socket.sent.map((text) => parseEnvelope(text)).filter((e): e is NetEnvelope => e !== null && e.t === type);
}

/** 这根线最后发出去的那张连线表（表上写了什么＝房主判出来什么）。 */
function lastTable(socket: FakeSocket | undefined): NetLinkRow[] {
  if (!socket) return [];
  let rows: NetLinkRow[] = [];
  for (const sent of socket.sent) {
    const envelope = parseEnvelope(sent);
    if (envelope?.t === 'netstatus') rows = envelope.rows;
  }
  return rows;
}

describe('J3 两端接线：房主探测＋算毫秒＋广播表，客人回话＋照抄', () => {
  it('握手完成后房主开始探测，客人回话，全桌拿到同一张表（数字只用房主一个钟算）', async () => {
    const relay = new FakeRelay();
    const clock = fakeClock();
    const ticks = manualTicks();
    const guestTables: NetLinkRow[][] = [];

    const host = joinRoom(
      {
        role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id,
        socketFactory: relay.factory, heartbeat: { now: clock.now, schedule: ticks.deps.schedule, cancel: ticks.deps.cancel },
      },
      () => {},
    );
    await nextTick();
    const guest = joinRoom(
      {
        role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: GUEST.id,
        socketFactory: relay.factory, onTable: (rows) => guestTables.push(rows),
      },
      () => {},
    );
    await nextTick();

    const hostSocket = relay.created[0];
    const guestSocket = relay.created[1];
    // 客人一进门，房主就探一次（第一跳在握手时已经发出去了）。
    expect(framesFrom(hostSocket, 'ping').length).toBeGreaterThan(0);
    expect(framesFrom(guestSocket, 'ping')).toHaveLength(0);
    expect(framesFrom(guestSocket, 'netstatus')).toHaveLength(0);
    expect(framesFrom(guestSocket, 'pong').length).toBeGreaterThan(0);

    ticks.tick();
    await nextTick();

    const last = lastTable(hostSocket);
    expect(last).toEqual([
      { id: HOST.id, name: HOST.name, pingMs: null, state: 'online' },
      { id: GUEST.id, name: GUEST.name, pingMs: 0, state: 'online' },
    ]);
    expect(guestTables[guestTables.length - 1]).toEqual(last);

    // 客人这一侧确实照抄到了掉线之前那张表，且一条探测/连线表也没发过。
    expect(guestTables.length).toBeGreaterThan(0);
    expect(framesFrom(guestSocket, 'netstatus')).toHaveLength(0);

    guest.leave();
    host.leave();
    expect(ticks.pending()).toBe(0);
  });

  it('客人不再回任何一条消息 ⇒ 满 15 秒后房主把他判成掉线，全桌同一张表都看得见；名册照旧不动', async () => {
    const relay = new FakeRelay();
    const clock = fakeClock();
    const ticks = manualTicks();
    const guestTables: NetLinkRow[][] = [];

    const host = joinRoom(
      {
        role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id,
        socketFactory: relay.factory, heartbeat: { now: clock.now, schedule: ticks.deps.schedule, cancel: ticks.deps.cancel },
      },
      () => {},
    );
    await nextTick();
    const guest = joinRoom(
      {
        role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: GUEST.id,
        socketFactory: relay.factory, onTable: (rows) => guestTables.push(rows),
      },
      () => {},
    );
    await nextTick();
    const guestSocket = relay.created[1];
    guestSocket.silent = true;

    const hostSocket = relay.created[0];
    // 差一毫秒不算：判据两边都测，免得阈值被改成 > 也照样绿。
    clock.advance(DISCONNECT_SILENCE_MS - 1);
    ticks.tick();
    await nextTick();
    expect(lastTable(hostSocket).find((r) => r.id === GUEST.id)?.state).toBe('online');

    clock.advance(1);
    ticks.tick();
    await nextTick();
    const last = lastTable(hostSocket);
    expect(last.find((r) => r.id === GUEST.id)).toEqual({ id: GUEST.id, name: GUEST.name, pingMs: null, state: 'lost' });
    expect(last.find((r) => r.id === HOST.id)?.state).toBe('online');
    expect(guestTables[guestTables.length - 1]).toEqual(last);
    // 摘人＝J4（座位绑定），本刀只做到"看得见"，名单一个也不动。
    expect(host.state.peers.map((p) => p.id)).toEqual([HOST.id, GUEST.id]);

    // 他又来信 ⇒ 那一行自己回到在线（不需要新政策，也没有粘住的标签）。
    guestSocket.silent = false;
    clock.advance(HEARTBEAT_PROBE_INTERVAL_MS);
    ticks.tick();
    await nextTick();
    expect(lastTable(hostSocket).find((r) => r.id === GUEST.id)?.state).toBe('online');

    guest.leave();
    host.leave();
  });

  it('没用心跳的老调用方：一条探测、一张连线表都不发（J1/J2 的行为不许被本刀带跑）', async () => {
    const relay = new FakeRelay();
    const tables: NetLinkRow[][] = [];
    const host = joinRoom(
      { role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id, socketFactory: relay.factory },
      () => {},
    );
    await nextTick();
    const guest = joinRoom(
      { role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: GUEST.id, socketFactory: relay.factory, onTable: (rows) => tables.push(rows) },
      () => {},
    );
    await nextTick();

    expect(framesFrom(relay.created[0], 'ping')).toHaveLength(0);
    expect(framesFrom(relay.created[0], 'netstatus')).toHaveLength(0);
    expect(framesFrom(relay.created[1], 'pong')).toHaveLength(0);
    expect(tables).toHaveLength(0);

    guest.leave();
    host.leave();
  });

  it('客人自己离开（发 bye）⇒ 表上那一行跟着销账，不是留在原地喊他掉线', async () => {
    const relay = new FakeRelay();
    const clock = fakeClock();
    const ticks = manualTicks();
    const host = joinRoom(
      {
        role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id,
        socketFactory: relay.factory, heartbeat: { now: clock.now, schedule: ticks.deps.schedule, cancel: ticks.deps.cancel },
      },
      () => {},
    );
    await nextTick();
    const guest = joinRoom(
      { role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: GUEST.id, socketFactory: relay.factory },
      () => {},
    );
    await nextTick();

    guest.leave();
    await nextTick();
    expect(lastTable(relay.created[0]).map((r) => r.id)).toEqual([HOST.id]);

    host.leave();
  });
});

/**
 * J4 的会话层证人。这一层只回答一个问题：**这三样谁该收、那一条谁该理**。
 * 合法性不在这里判（那要拿房主当下的局面当场重算，是接线那头的活），
 * 所以这里能钉死的全是"谁的份"：客人只认房主那三份、而且只认指名给自己的那两份；
 * 房主只把"指名给我＋发信人是名册里的客人"的请求交给接线。
 */
describe('J4 座位与请求：各人的份各人收', () => {
  const SEATS: NetSeatRow[] = [
    { peer: HOST.id, seat: 1, name: HOST.name },
    { peer: GUEST.id, seat: 2, name: GUEST.name },
  ];
  const ITEMS: NetMoveItem[] = [{ key: '0-END_TURN:3f2a1c9d', label: '⏭️结束回合' }];
  const OTHER = 'guest-2';
  const inRoom = () => guestState({ phase: 'in-room', peers: [HOST, GUEST] });
  const twoGuests = () => guestState({ phase: 'in-room', peers: [HOST, GUEST, { id: OTHER, name: '客人乙', role: 'guest' }] });
  const hostWithGuest = () => hostState({ phase: 'in-room', peers: [HOST, GUEST] });

  it('房主的席位表照抄交出去：名册、状态一个也不动（谁坐哪一席是房主定的，客人只负责显示）', () => {
    const before = inRoom();
    const step = stepSession(before, text({ t: 'seatmap', from: HOST.id, seats: SEATS }));
    expect(step.seatMap).toEqual(SEATS);
    expect(step.state).toBe(before);
    expect(step.sends).toEqual([]);
  });

  it('清单与退回说明只认指名给我那一份（传话线也会把别人的那份递到我这儿，拿去点就串座了）', () => {
    const before = twoGuests();
    const forOther = stepSession(before, text({ t: 'moves', from: HOST.id, to: OTHER, seat: 3, items: ITEMS, omitted: 0 }));
    expect(forOther.moves).toBeUndefined();
    expect(forOther.state).toBe(before);
    const mine = stepSession(before, text({ t: 'moves', from: HOST.id, to: GUEST.id, seat: 2, items: ITEMS, omitted: 17 }));
    expect(mine.moves).toEqual({ seat: 2, items: ITEMS, omitted: 17 });

    const refusalToOther = stepSession(before, text({ t: 'actno', from: HOST.id, to: OTHER, key: 'k', reason: '这一步已经不成立' }));
    expect(refusalToOther.refusal).toBeUndefined();
    const refusalToMe = stepSession(before, text({ t: 'actno', from: HOST.id, to: GUEST.id, key: 'k', reason: '这一步已经不成立' }));
    expect(refusalToMe.refusal).toEqual({ key: 'k', reason: '这一步已经不成立' });
  });

  it('客人冒充房主发席位表 ⇒ 不收并且写清为什么没动静；冒充发清单／退回 ⇒ 安静丢掉', () => {
    const before = twoGuests();
    const fakeSeat = stepSession(before, text({ t: 'seatmap', from: OTHER, seats: [{ peer: OTHER, seat: 1, name: '客人乙' }] }));
    expect(fakeSeat.seatMap).toBeUndefined();
    expect(fakeSeat.state.note).toContain('不是房主发来');
    // 清单与退回这两格不写那句话：它们本来就是指名通信，收不到是常态，写出来只会刷屏。
    const fakeMoves = stepSession(before, text({ t: 'moves', from: OTHER, to: GUEST.id, seat: 2, items: ITEMS, omitted: 0 }));
    expect(fakeMoves.moves).toBeUndefined();
    expect(fakeMoves.state).toBe(before);
    const fakeRefusal = stepSession(before, text({ t: 'actno', from: OTHER, to: GUEST.id, key: 'k', reason: 'r' }));
    expect(fakeRefusal.refusal).toBeUndefined();
    expect(fakeRefusal.state).toBe(before);
  });

  it('还没进房（名册里根本没有房主）时收到的席位表也不收——没有"谁说的算"就没有可抄的', () => {
    const step = stepSession(guestState(), text({ t: 'seatmap', from: HOST.id, seats: SEATS }));
    expect(step.seatMap).toBeUndefined();
  });

  it('收到清单不回话、不确认（动手是界面上那一次点击的事，不是"收到清单"的事）', () => {
    const step = stepSession(inRoom(), text({ t: 'moves', from: HOST.id, to: GUEST.id, seat: 2, items: ITEMS, omitted: 0 }));
    expect(step.sends).toEqual([]);
  });

  it('房主把来路对得上的 act 交给接线，自己一个字节也不改（合法性这里一个字也不判）', () => {
    const before = hostWithGuest();
    const step = stepSession(before, text({ t: 'act', from: GUEST.id, to: HOST.id, seat: 2, key: '0-END_TURN:3f2a1c9d' }));
    expect(step.action).toEqual({ peer: GUEST.id, seat: 2, key: '0-END_TURN:3f2a1c9d' });
    expect(step.state).toBe(before);
    expect(step.sends).toEqual([]);
  });

  it('发给别人的、不认识的、以及房主自己发的 act ⇒ 房主一概不理', () => {
    const before = hostWithGuest();
    expect(stepSession(before, text({ t: 'act', from: GUEST.id, to: OTHER, seat: 2, key: 'k' })).action).toBeUndefined();
    expect(stepSession(before, text({ t: 'act', from: 'ghost', to: HOST.id, seat: 2, key: 'k' })).action).toBeUndefined();
    // 名册里那位房主自己不算"客人交回来的请求"（他要动手走的是本机点击那条路）。
    // "发信人是不是那一席绑着的人"这一条归接线——席位表只有它手里有。
    expect(stepSession(before, text({ t: 'act', from: HOST.id, to: HOST.id, seat: 1, key: 'k' })).action).toBeUndefined();
    expect(stepSession(before, text({ t: 'act', from: GUEST.id, to: HOST.id, seat: 2, key: 'k' })).state).toBe(before);
  });

  it('房主一侧不采纳席位表／清单／退回（那三份是给客人看的，房主自己就是出处）', () => {
    const before = hostWithGuest();
    const step = stepSession(before, text({ t: 'seatmap', from: GUEST.id, seats: SEATS }));
    expect(step.seatMap).toBeUndefined();
    expect(step.state).toBe(before);
    expect(stepSession(before, text({ t: 'moves', from: GUEST.id, to: HOST.id, seat: 1, items: ITEMS, omitted: 0 })).moves).toBeUndefined();
  });

  it('接上假传话线：房主发席位表与清单 ⇒ 客人那两头收到；客人发 act ⇒ 房主的 onAction 收到', async () => {
    const relay = new FakeRelay();
    const maps: NetSeatRow[][] = [];
    const movesIn: { seat: number; items: NetMoveItem[]; omitted: number }[] = [];
    const acts: { peer: string; seat: number; key: string }[] = [];

    const host = joinRoom(
      {
        role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: HOST.id,
        socketFactory: relay.factory, onAction: (a) => acts.push(a),
      },
      () => {},
    );
    await nextTick();
    const guest = joinRoom(
      {
        role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', selfId: GUEST.id,
        socketFactory: relay.factory, onSeatMap: (r) => maps.push(r), onMoves: (m) => movesIn.push(m),
      },
      () => {},
    );
    await nextTick();

    expect(host.send({ t: 'seatmap', from: HOST.id, seats: SEATS })).toBe(true);
    expect(host.send({ t: 'moves', from: HOST.id, to: GUEST.id, seat: 2, items: ITEMS, omitted: 3 })).toBe(true);
    await nextTick();
    expect(maps).toEqual([SEATS]);
    expect(movesIn).toEqual([{ seat: 2, items: ITEMS, omitted: 3 }]);

    expect(guest.send({ t: 'act', from: GUEST.id, to: HOST.id, seat: 2, key: '0-END_TURN:3f2a1c9d' })).toBe(true);
    await nextTick();
    expect(acts).toEqual([{ peer: GUEST.id, seat: 2, key: '0-END_TURN:3f2a1c9d' }]);

    guest.leave();
    host.leave();
  });
});

/**
 * 非安全上下文那一档（v2.9.25）。2026-10-28 两台机器实测：客人对着 `http://<一串 IP>`
 * 点「进房间」一声不响——那个上下文里没有 `crypto.randomUUID`，取号当场抛异常，
 * **一根线都没拨出去**。J1–J4 的实测全是"同机＋localhost"，而 `localhost` 算安全上下文，
 * 所以这条线从没被盖到过。
 *
 * 这里的正面断言不是"没抛异常"，是那两步真事实：号码领到了（`length>0` 且在协议的 64 字符硬界内）
 * ＋握手真走完（房主名册收下这个人、客人那侧 `phase` 到 `in-room`）。
 */
describe('没有 crypto.randomUUID 的机器：拨号照样发得出去', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('演成"连 crypto 都没有"⇒ newPeerId 仍给得出一个能上线的号（非空、不超 64 字符）', () => {
    vi.stubGlobal('crypto', null);
    const id = newPeerId();
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('房主与客人都不自带号 ⇒ 两边各领一个兜底号，握手走完、名册对上（不是"没报错"，是真进房）', async () => {
    vi.stubGlobal('crypto', null);
    const relay = new FakeRelay();
    const host = joinRoom(
      { role: 'host', name: '房主', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', socketFactory: relay.factory },
      () => {},
    );
    await nextTick();

    const guest = joinRoom(
      { role: 'guest', name: '客人甲', url: 'ws://127.0.0.1:8787/ROOMAA', roomCode: 'ROOMAA', socketFactory: relay.factory },
      () => {},
    );
    await nextTick();

    expect(host.state.selfId).not.toBe(guest.state.selfId);
    expect(host.state.peers.map((p) => p.id)).toEqual([host.state.selfId, guest.state.selfId]);
    expect(guest.state.phase).toBe('in-room');
    expect(guest.state.peers.map((p) => p.id)).toEqual([host.state.selfId, guest.state.selfId]);

    guest.leave();
    host.leave();
  });

  it('同一页连领两次不重号（名册按 id 认人，重号＝第二个人被当成第一个）', () => {
    vi.stubGlobal('crypto', null);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(newPeerId()).not.toBe(newPeerId());
  });
});
