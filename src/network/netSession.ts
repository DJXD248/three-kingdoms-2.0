import {
  checkPeerName,
  encodeEnvelope,
  ourVersionStamp,
  parseEnvelope,
  versionMismatch,
  type NetEnvelope,
  type NetPeer,
} from './netProtocol';
import { openNetLink, type NetLink, type SocketFactory } from './wsTransport';

export type NetRole = 'host' | 'guest';
/** 界面措辞与这几个状态一一对应，别多写一层含义。 */
export type SessionPhase = 'idle' | 'dialing' | 'in-room' | 'refused' | 'left';

export type SessionState = {
  role: NetRole;
  selfId: string;
  name: string;
  roomCode: string | null;
  phase: SessionPhase;
  /** 一句人读的当前情况或拒因，界面原文显示。 */
  note: string;
  peers: NetPeer[];
};

export type WireEvent =
  | { type: 'open' }
  | { type: 'text'; text: string }
  | { type: 'close'; why: string };

export function newPeerId(): string {
  return crypto.randomUUID();
}

export function initialSessionState(role: NetRole, selfId: string, name: string, roomCode: string | null): SessionState {
  return {
    role,
    selfId,
    name,
    roomCode,
    phase: 'idle',
    note: role === 'host' ? '等别人输房间码进来' : '还没连',
    peers: role === 'host' ? [{ id: selfId, name, role: 'host' }] : [],
  };
}

/**
 * 纯 reducer：谁在门口、谁进了房、谁被拒，全在这里算，界面只负责显示。
 * 房主是唯一的名册来源（客人不发 roster），这样名单不会两边各说一套。
 */
export function stepSession(
  state: SessionState,
  event: WireEvent,
): { state: SessionState; sends: NetEnvelope[] } {
  if (event.type === 'close') {
    return { state: { ...state, phase: 'left', note: event.why }, sends: [] };
  }

  if (event.type === 'open') {
    if (state.role === 'host') {
      return { state: { ...state, phase: 'in-room', note: '房间开着，等客人输房间码进来' }, sends: [] };
    }
    return {
      state: { ...state, phase: 'dialing', note: '连上了，正报版本' },
      sends: [{ t: 'hello', from: state.selfId, name: state.name, v: ourVersionStamp() }],
    };
  }

  const envelope = parseEnvelope(event.text);
  if (!envelope) return { state: { ...state, note: '收到看不懂的消息，已忽略（不猜内容）' }, sends: [] };

  if (state.role === 'host') return hostStep(state, envelope);

  if (envelope.t === 'welcome') {
    if (envelope.to !== state.selfId) return { state, sends: [] };
    const mismatch = versionMismatch(envelope.v, ourVersionStamp());
    if (mismatch) return { state: { ...state, phase: 'refused', note: mismatch }, sends: [] };
    return {
      state: { ...state, phase: 'in-room', note: `已连上房主「${envelope.name}」` },
      sends: [],
    };
  }
  if (envelope.t === 'refuse') {
    if (envelope.to !== state.selfId) return { state, sends: [] };
    return { state: { ...state, phase: 'refused', note: envelope.reason }, sends: [] };
  }
  if (envelope.t === 'roster') {
    return { state: { ...state, peers: envelope.peers }, sends: [] };
  }
  return { state, sends: [] };
}

function hostStep(state: SessionState, envelope: NetEnvelope): { state: SessionState; sends: NetEnvelope[] } {
  if (envelope.t === 'hello') {
    const known = state.peers.some((p) => p.id === envelope.from);
    if (known) return { state, sends: [] };

    const nameCheck = checkPeerName(envelope.name);
    if (!nameCheck.ok) {
      return { state, sends: [{ t: 'refuse', from: state.selfId, to: envelope.from, reason: nameCheck.reason }] };
    }
    const mismatch = versionMismatch(envelope.v, ourVersionStamp());
    if (mismatch) {
      return { state, sends: [{ t: 'refuse', from: state.selfId, to: envelope.from, reason: mismatch }] };
    }

    const peers = [...state.peers, { id: envelope.from, name: nameCheck.name, role: 'guest' as const }];
    return {
      state: { ...state, peers, note: `${nameCheck.name} 进房了` },
      sends: [
        { t: 'welcome', from: state.selfId, to: envelope.from, name: state.name, v: ourVersionStamp() },
        { t: 'roster', from: state.selfId, peers },
      ],
    };
  }

  if (envelope.t === 'bye') {
    if (!state.peers.some((p) => p.id === envelope.from)) return { state, sends: [] };
    const peers = state.peers.filter((p) => p.id !== envelope.from);
    return { state: { ...state, peers, note: '有人离开了房间' }, sends: [{ t: 'roster', from: state.selfId, peers }] };
  }

  // 客人之间互发的消息、以及发给别人的 welcome/refuse/roster，房主一概不当名册用。
  return { state, sends: [] };
}

export type RoomConnection = {
  state: SessionState;
  leave: () => void;
};

/** 把传话线与 reducer 接起来；界面只管订阅 state。 */
export function joinRoom(
  args: {
    role: NetRole;
    name: string;
    url: string;
    roomCode: string;
    selfId?: string;
    socketFactory?: SocketFactory;
  },
  onChange: (state: SessionState) => void,
): RoomConnection {
  const selfId = args.selfId ?? newPeerId();
  let state = initialSessionState(args.role, selfId, args.name, args.roomCode);
  const publish = () => onChange(state);
  publish();

  let link: NetLink | null = null;
  const apply = (event: WireEvent) => {
    const next = stepSession(state, event);
    state = next.state;
    for (const envelope of next.sends) link?.send(encodeEnvelope(envelope));
    publish();
  };

  link = openNetLink(args.url, {
    onOpen: () => apply({ type: 'open' }),
    onText: (text) => apply({ type: 'text', text }),
    onClose: (why) => apply({ type: 'close', why }),
  }, args.socketFactory);

  return {
    get state() {
      return state;
    },
    leave: () => {
      link?.send(encodeEnvelope({ t: 'bye', from: selfId }));
      link?.close();
      state = { ...state, phase: 'left', note: '已离开房间' };
      publish();
    },
  };
}
