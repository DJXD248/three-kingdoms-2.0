import {
  checkPeerName,
  encodeEnvelope,
  ourVersionStamp,
  parseEnvelope,
  versionMismatch,
  type NetEnvelope,
  type NetDraftListFrame,
  type NetDraftProgressRow,
  type NetLinkRow,
  type NetMoveItem,
  type NetPeer,
  type NetReadyRow,
  type NetSeatRow,
} from './netProtocol';
import type { IncomingReady } from './netReady';
import {
  DISCONNECT_SILENCE_MS,
  HEARTBEAT_PROBE_INTERVAL_MS,
  dueProbes,
  emptyHeartbeat,
  linkRows,
  markSeen,
  noteProbeSent,
  recordPong,
  sameRows,
  syncTracks,
  type HeartbeatModel,
} from './netHeartbeat';
import { openNetLink, type NetLink, type SocketFactory } from './wsTransport';
import { randomPeerId } from './netRandom';

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

/** stepSession 的产出：要发出去的信封，加上刚收到的房主局面快照／房主连线表。 */
export type StepResult = {
  state: SessionState;
  sends: NetEnvelope[];
  snapshot?: Record<string, unknown>;
  /** J3：房主发来的那张连线表（客人只照抄，判定权在房主）。 */
  table?: NetLinkRow[];
  /**
   * J3：这一趟解析成功的那条来信是谁发的。心跳那一头要按它刷新"最后一次收到他的消息"
   * 那一刻——契约的判据原文是**15 秒未收到该人任何消息**，不是"未回心跳"，
   * 所以快照、名册、回话、任何一条都算数。
   */
  saw?: { from: string; kind: NetEnvelope['t']; at?: number };
  /**
   * J4（客人侧）：房主宣布的席位表。客人照抄，自己不在这里绑座——绑定只有房主能算，
   * 客人算出来的那份会让两边读着不同的座次动手。
   */
  seatMap?: NetSeatRow[];
  /** J4（客人侧）：房主当场算给**我这一席**的那张清单。指名发给别人的不收。 */
  moves?: { seat: number; items: NetMoveItem[]; omitted: number };
  /** J4（客人侧）：房主没让走那一步，附的那句话。 */
  refusal?: { key: string; reason: string };
  /** J4（房主侧）：某位客人交回来的一步。这里只搬运，合法性由接线那头当场重算再判。 */
  action?: { peer: string; seat: number; key: string };
  /**
   * 切片⑤a（房主侧）：某位客人交回的那一颗准备钮。与上面那条同一手法——这里只搬运，
   * "谁还算数、闸门开不开"由接线那头的 `startHostReady` 当场重算再判（它还得看名册与连线表）。
   */
  ready?: IncomingReady;
  /** 切片⑤a（客人侧）：房主算好的那张准备表。客人照抄，自己不在这里判谁还算数。 */
  readyTable?: NetReadyRow[];
  /**
   * 切片⑤b（客人侧）：房主算好的那张征召进度表——只有第几席、走到哪一步、几名/该几名，
   * **一张牌也不在这张表里**（用户 2026-10-30 裁：「和热座一样」不延伸到别人那几格的私有信息）。
   */
  draftProgress?: NetDraftProgressRow[];
  /**
   * 切片⑤c（客人侧）：房主算给**我这一席**的那一格候选名单（＋我勾了哪几颗＋这一席该做什么的那句人话）。
   * 指名发给别人的那一帧在这里丢掉——用户 2026-10-30 那句「每个玩家只能看到自己的候选将领和已选将领，
   * 而不是能看到全部」在客人端就落成这一句：不是我的那一格，一个字也不采纳。
   */
  draftList?: NetDraftListFrame;
};

export function newPeerId(): string {
  return randomPeerId();
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
): StepResult {
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
  const saw =
    envelope.t === 'ping' || envelope.t === 'pong'
      ? { from: envelope.from, kind: envelope.t, at: envelope.at }
      : { from: envelope.from, kind: envelope.t };

  if (state.role === 'host') return { ...hostStep(state, envelope), saw };

  if (envelope.t === 'welcome') {
    if (envelope.to !== state.selfId) return { state, sends: [], saw };
    const mismatch = versionMismatch(envelope.v, ourVersionStamp());
    if (mismatch) return { state: { ...state, phase: 'refused', note: mismatch }, sends: [], saw };
    return {
      state: { ...state, phase: 'in-room', note: `已连上房主「${envelope.name}」` },
      sends: [],
      saw,
    };
  }
  if (envelope.t === 'refuse') {
    if (envelope.to !== state.selfId) return { state, sends: [], saw };
    return { state: { ...state, phase: 'refused', note: envelope.reason }, sends: [], saw };
  }
  if (envelope.t === 'roster') {
    return { state: { ...state, peers: envelope.peers }, sends: [], saw };
  }
  if (envelope.t === 'ping') {
    // 探测是指名发给某个人的（传话线也会把这条递给房间里其他人）⇒ 只对得上自己名字的回复，
    // 别人的探测绝不代答。回话只做一件事：把房主那个时刻**原样抄回去**——
    // 客人自己不算耗时、更不判掉线（契约：判定只有房主能做）。
    if (envelope.to !== state.selfId) return { state, sends: [], saw };
    return {
      state,
      sends: [{ t: 'pong', from: state.selfId, to: envelope.from, at: envelope.at }],
      saw,
    };
  }
  if (envelope.t === 'netstatus') {
    // 连线表同样只认房主发来的那一份（把关判据与下面 snapshot 那一条同形）。
    const fromHost = state.peers.some((p) => p.id === envelope.from && p.role === 'host');
    if (!fromHost) {
      return { state: { ...state, note: '收到不是房主发来的连线表，已忽略' }, sends: [], saw };
    }
    return { state, sends: [], table: envelope.rows, saw };
  }
  if (envelope.t === 'snapshot') {
    // "牌由房主那台机器算"在客人端落成一句可执行的判据：只认名册里那位房主发来的
    // 局面。别人（包括另一个客人）发来的一律不采纳，也不报错——房间里的传话线
    // 本来就收得到所有人的消息。
    const fromHost = state.peers.some((p) => p.id === envelope.from && p.role === 'host');
    if (!fromHost) {
      return { state: { ...state, note: '收到不是房主发来的局面，已忽略' }, sends: [], saw };
    }
    // 切片③（v2.9.25）：按席位各出的那一份是指名发给某一席的（传话线也会把它递给屋里
    // 其他人）⇒ 不是指名给我的那份就丢掉，绝不拿别人的私有视图画自己这一席。
    // 没带 `to` 的是全桌通用的观战那份 ⇒ 照旧采纳。
    if (envelope.to !== undefined && envelope.to !== state.selfId) return { state, sends: [], saw };
    return { state, sends: [], snapshot: envelope.state, saw };
  }
  // ── J4：客人这边收到三样，全部只认房主那一份 ──
  if (envelope.t === 'seatmap') {
    const fromHost = state.peers.some((p) => p.id === envelope.from && p.role === 'host');
    if (!fromHost) {
      return { state: { ...state, note: '收到不是房主发来的席位表，已忽略' }, sends: [], saw };
    }
    return { state, sends: [], seatMap: envelope.seats, saw };
  }
  if (envelope.t === 'moves') {
    const fromHost = state.peers.some((p) => p.id === envelope.from && p.role === 'host');
    // 清单是指名发给某一席的（传话线也会把它递给房间里其他人）⇒ 不是给我的那份就丢掉，
    // 绝不拿别人的清单去点别人的座。
    if (!fromHost || envelope.to !== state.selfId) return { state, sends: [], saw };
    return { state, sends: [], moves: { seat: envelope.seat, items: envelope.items, omitted: envelope.omitted }, saw };
  }
  if (envelope.t === 'actno') {
    const fromHost = state.peers.some((p) => p.id === envelope.from && p.role === 'host');
    if (!fromHost || envelope.to !== state.selfId) return { state, sends: [], saw };
    return { state, sends: [], refusal: { key: envelope.key, reason: envelope.reason }, saw };
  }
  // ── 切片⑤a：准备表同样只认房主那一份。客人不自算"谁还算数"──
  if (envelope.t === 'readytable') {
    const fromHost = state.peers.some((p) => p.id === envelope.from && p.role === 'host');
    if (!fromHost) {
      return { state: { ...state, note: '收到不是房主发来的准备表，已忽略' }, sends: [], saw };
    }
    return { state, sends: [], readyTable: envelope.rows, saw };
  }
  // ── 切片⑤b：征召进度表同样只认房主那一份。客人不自算"谁征召到哪儿了"──
  if (envelope.t === 'draftprogress') {
    const fromHost = state.peers.some((p) => p.id === envelope.from && p.role === 'host');
    if (!fromHost) {
      return { state: { ...state, note: '收到不是房主发来的征召进度表，已忽略' }, sends: [], saw };
    }
    return { state, sends: [], draftProgress: envelope.rows, saw };
  }
  // ── 切片⑤c：那一格候选名单是指名发的（传话线按 `to` 只投那一条，但客人这边照样自己把关一遍）──
  if (envelope.t === 'draftlist') {
    const fromHost = state.peers.some((p) => p.id === envelope.from && p.role === 'host');
    if (!fromHost) {
      // 有人冒充房主往房间里发候选名单 ⇒ 说一句（与 seatmap／readytable／draftprogress 同一判据：
      // 让人对着不动的界面猜"是不是我这侧出了问题"是最坏的一种安静）。
      return { state: { ...state, note: '收到不是房主发来的候选名单，已忽略' }, sends: [], saw };
    }
    // 指名给别人的那一格：安静丢掉（`moves`／`actno` 同一条判据——不是我的那一份，一个字也不采纳）。
    if (envelope.to !== state.selfId) return { state, sends: [], saw };
    return {
      state,
      sends: [],
      draftList: {
        seat: envelope.seat, total: envelope.total, instruction: envelope.instruction,
        main: envelope.main, qun: envelope.qun, picked: envelope.picked,
      },
      saw,
    };
  }
  return { state, sends: [], saw };
}

function hostStep(state: SessionState, envelope: NetEnvelope): StepResult {
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

  // J4：客人交回来的一步。房主这边只做两句把关——这条是指名发给我的、发信人确实在名册里
  // 是位客人——**合法性一个字也不在这里判**（那是接线那头拿房主当下的局面当场重算的事，
  // 见 components/NetRoomBridge）。客人字节里那句"我认为这是合法的"不作数。
  if (envelope.t === 'act') {
    if (envelope.to !== state.selfId) return { state, sends: [] };
    if (!state.peers.some((p) => p.id === envelope.from && p.role === 'guest')) return { state, sends: [] };
    return { state, sends: [], action: { peer: envelope.from, seat: envelope.seat, key: envelope.key } };
  }

  // 切片⑤a：客人那一颗准备钮。把关的两句与上面一模一样（这条是发给我的、发信人确实是名册上的
  // 一位客人），交回来的就是一个布尔——**他不能替别人点**。至于这个人还算不算数（掉线？退了？），
  // 那是 `startHostReady` 拿着名册与连线表当场算的事，不在这里。
  if (envelope.t === 'ready') {
    if (envelope.to !== state.selfId) return { state, sends: [] };
    if (!state.peers.some((p) => p.id === envelope.from && p.role === 'guest')) return { state, sends: [] };
    return { state, sends: [], ready: { peer: envelope.from, on: envelope.on } };
  }

  // 客人之间互发的消息、以及发给别人的 welcome/refuse/roster，房主一概不当名册用。
  return { state, sends: [] };
}

export type RoomConnection = {
  state: SessionState;
  leave: () => void;
  /** 房主往房间里推一条信封（J2 的局面快照走这里）。线没开着就返回 false、
   *  不排队也不重试——快照是"现在是什么样"，攒着旧的一起发反而更错。 */
  send: (envelope: NetEnvelope) => boolean;
};

/**
 * J3 心跳接线的注入项。时刻与定时器都从外面进来（与 `snapshotBroadcaster` 同一手法），
 * 这样"15 秒"那条判据能被假钟当场钉住，而不是让测试真等 15 秒。
 */
export type HeartbeatDeps = {
  /** 只有房主这一个钟：往返耗时＝房主发出探测的时刻与收到回话的时刻之差，**绝不两边对表**。 */
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  probeIntervalMs?: number;
  thresholdMs?: number;
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
    /** 客人端：每收到一份房主发来的局面快照回调一次（内容已由协议层认出是对象）。 */
    onSnapshot?: (snapshot: Record<string, unknown>) => void;
    /**
     * J3：给了这一格＝这条连线用心跳那一套（房主探测并按 15 秒判掉线；客人只回话与照抄表）。
     * 不给＝完全不发探测，J1/J2 的老调用方与老测试不必跟着改。
     */
    heartbeat?: HeartbeatDeps;
    /** 连线表变了回调一次：房主那边是自己算出来的，客人那边是房主发来的那一份。 */
    onTable?: (rows: NetLinkRow[]) => void;
    /**
     * J4（房主侧）：某位客人交回来的一步。到这里为止线上传的只有"席位＋编号"，
     * 接线那头拿房主当下的局面**当场重算**这张清单，对得上才走，对不上退回并说明。
     */
    onAction?: (msg: { peer: string; seat: number; key: string }) => void;
    /** J4（客人侧）：房主宣布的席位表（我坐哪一席、别人坐哪一席）。 */
    onSeatMap?: (rows: NetSeatRow[]) => void;
    /** J4（客人侧）：房主算给**我这一席**的那张清单（含"还有几条没列出来"那个数）。 */
    onMoves?: (msg: { seat: number; items: NetMoveItem[]; omitted: number }) => void;
    /** J4（客人侧）：房主退回那一步时附的那句话。 */
    onRefusal?: (msg: { key: string; reason: string }) => void;
    /**
     * 切片⑤a（房主侧）：某位客人交回的那一颗准备钮（只有一个布尔）。
     * 与 `onAction` 同一手法：这里只搬运，闸门那笔账由接线那头的 `startHostReady` 当场重算。
     */
    onReadyMark?: (msg: IncomingReady) => void;
    /**
     * 切片⑤a：那张准备表。房主那边是自己算出来的（抄一格给自己那屏），客人那边是房主发来的那一份
     * ——两边都只住 `netRoom` 那一格，界面照抄，与席位表一个纪律。
     */
    onReadyTable?: (rows: NetReadyRow[]) => void;
    /**
     * 切片⑤b（客人侧）：房主算好的那张征召进度表（全桌广播，不指名）。
     * 与准备表同一格纪律：客人只照抄进 `netRoom`，自己不在这里算进度。
     */
    onDraftProgress?: (rows: NetDraftProgressRow[]) => void;
    /**
     * 切片⑤c（客人侧）：房主算给**我这一席**的那一格候选名单。与 ⑤b 那张进度表各存一格：
     * 这一格是发给一个人的私有信息，那张表是全桌的进度，界面读的那一格换了内容不代表另一格也该重画。
     */
    onDraftList?: (frame: NetDraftListFrame) => void;
  },
  onChange: (state: SessionState) => void,
): RoomConnection {
  const selfId = args.selfId ?? newPeerId();
  let state = initialSessionState(args.role, selfId, args.name, args.roomCode);
  const publish = () => onChange(state);
  publish();

  const hb = args.heartbeat;
  const hbNow = hb?.now ?? (() => Date.now());
  const hbSchedule = hb?.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const hbCancel = hb?.cancel ?? ((handle) => clearTimeout(handle));
  const probeIntervalMs = hb?.probeIntervalMs ?? HEARTBEAT_PROBE_INTERVAL_MS;
  const thresholdMs = hb?.thresholdMs ?? DISCONNECT_SILENCE_MS;

  let model: HeartbeatModel = emptyHeartbeat();
  let lastRows: NetLinkRow[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  let link: NetLink | null = null;

  /** 算表→比一下→才广播。客人那边不发（判定权不在它手里），只把表交给界面。 */
  const publishTable = () => {
    const rows = linkRows(model, hbNow(), thresholdMs);
    if (sameRows(rows, lastRows)) return;
    lastRows = rows;
    if (state.role === 'host') link?.send(encodeEnvelope({ t: 'netstatus', from: selfId, rows }));
    args.onTable?.(rows);
  };

  /** 按名册建账→到点的探测发出去→推表。有任何来信也走这一趟，判定因此最多晚一个间隔露相。 */
  const heartbeatTick = () => {
    if (!hb || state.role !== 'host') return;
    const at = hbNow();
    model = syncTracks(model, state.peers, at);
    for (const id of dueProbes(model, at, probeIntervalMs)) {
      const sentAt = hbNow();
      model = noteProbeSent(model, id, sentAt);
      link?.send(encodeEnvelope({ t: 'ping', from: selfId, to: id, at: sentAt }));
    }
    publishTable();
  };

  const armNextTick = () => {
    if (!hb || state.role !== 'host') return;
    timer = hbSchedule(() => {
      timer = null;
      heartbeatTick();
      armNextTick();
    }, probeIntervalMs);
  };

  const stopHeartbeat = () => {
    if (timer !== null) {
      hbCancel(timer);
      timer = null;
    }
  };

  const apply = (event: WireEvent) => {
    const next = stepSession(state, event);
    state = next.state;
    for (const envelope of next.sends) link?.send(encodeEnvelope(envelope));
    if (event.type === 'close') stopHeartbeat();
    // 房主侧的记账：来信任意一条都刷新那个人的时钟（判据原文＝15 秒未收到该人**任何**消息）。
    // 这一步也顺带证明"那台机器还活着"——客人动手比心跳更硬，掉线判定因此只会更早露相。
    if (hb && state.role === 'host' && next.saw) {
      const at = hbNow();
      model = next.saw.kind === 'pong' && next.saw.at !== undefined
        ? recordPong(model, next.saw.from, next.saw.at, at)
        : markSeen(model, next.saw.from, at);
    }
    heartbeatTick();
    publish();
    if (next.snapshot) args.onSnapshot?.(next.snapshot);
    if (next.table) args.onTable?.(next.table);
    // J4：席位表与清单都是房主算好发出来的，客人这边照抄进注册表；动手那一步交给接线重算。
    if (next.seatMap) args.onSeatMap?.(next.seatMap);
    if (next.moves) args.onMoves?.(next.moves);
    if (next.refusal) args.onRefusal?.(next.refusal);
    if (next.action) args.onAction?.(next.action);
    // 切片⑤a：客人那颗钮递给房主那台机器上的准备发布者（只有房主那台机器会收到那一条）；
    // 准备表两边都递进同一格——房主那份是自己算的，客人那份是房主发来的。
    if (next.ready) args.onReadyMark?.(next.ready);
    if (next.readyTable) args.onReadyTable?.(next.readyTable);
    // 切片⑤b：那张进度表只有客人会收到（发的人正是房主自己）。
    if (next.draftProgress) args.onDraftProgress?.(next.draftProgress);
    // 切片⑤c：那一格候选名单同理——而且能走到这一行的，已经是"房主发的、收件人是我"的那一份。
    if (next.draftList) args.onDraftList?.(next.draftList);
  };

  link = openNetLink(args.url, {
    onOpen: () => apply({ type: 'open' }),
    onText: (text) => apply({ type: 'text', text }),
    onClose: (why) => apply({ type: 'close', why }),
  }, args.socketFactory);
  if (hb && state.role === 'host') {
    heartbeatTick();
    armNextTick();
  }

  return {
    get state() {
      return state;
    },
    send: (envelope) => link?.send(encodeEnvelope(envelope)) ?? false,
    leave: () => {
      stopHeartbeat();
      link?.send(encodeEnvelope({ t: 'bye', from: selfId }));
      link?.close();
      state = { ...state, phase: 'left', note: '已离开房间' };
      publish();
    },
  };
}
