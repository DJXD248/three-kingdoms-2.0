/**
 * 房间里那条线的**唯一持有者**。
 *
 * J1 时连接建在大厅弹窗里，关掉弹窗就断线；J2 要"房主每次局面变化都发出去"，
 * 房主那边得离开大厅去开局，客人那边得一直看着牌桌——所以连接不能住在任何
 * 一屏里。这一格只做三件事：收着一份当前连接、收着客人最新看到的那份局面、
 * 变了就通知订阅者。没有规则、没有状态转移。
 * （切片⑤a 起这里还多收着房主算好的那张准备表，以及从它派生出来的那句"还等谁"——
 *  派生物单独占一格的存在理由只有一个：界面要一个稳定的引用，每次现算就会每次都说"变了"。）
 * （切片⑤b 起再多收一张征召进度表：还是那句"房主算、客人抄"，表里只有数量，没有牌。）
 * （切片⑤c 起再多收**我自己那一席的候选名单**：这一格是私有的——一台机器只有一个身份号，
 *  所以这里存的必然是"发给我的那一份"，别人那一格从来没有到过这一格。）
 * （切片⑤d 起这里还多挂**房主侧的第三个挂钩**（客人点的那一颗递回房主那台机器）；存的那一格形状没变，
 *  只是帧里多了房主算好的那个「凑够了没有」——客人屏上那颗确认钮读的就是它，本机不重算那条上下限。）
 */
import type { EngineState } from '../core/GameState';
import type { NetDraftListFrame, NetDraftProgressRow, NetLinkRow, NetReadyRow, NetSeatRow } from './netProtocol';
import type { NetRole, RoomConnection } from './netSession';
import type { IncomingAction } from './netHostAuthority';
import type { IncomingReady, ReadyGate } from './netReady';
import { gateOfReadyRows, sameReadyRows } from './netReady';
import { sameDraftProgressRows } from './netDraftProgress';
import { sameDraftListFrames, type IncomingDraft } from './netDraftList';
import { isRestorableEngineState } from '../store/gameStateAdapter';
import { sameRows } from './netHeartbeat';
import { seatOfPeer, sameMoveLists, sameSeatRows, type SeatMoveList } from './netSeat';

export type ActiveRoom = {
  role: NetRole;
  name: string;
  roomCode: string;
  /**
   * 防作弊·第一档（v2.9.27）那一串进场字（归一化后的 12 个字符）。
   * 房主那份是自己生成的（屏幕上要给客人抄），客人那份是他填进来的——两边都只在这一格留一份，
   * 重开这个弹窗时还能把"要填的三样"原样告诉用户；它绝不上线当消息内容，只在那一次握手网址里出现。
   */
  ticket: string;
  /** 原样留着填进来的那个地址（重开这个窗时还能告诉客人要填什么）；url 是拼好的完整线址。 */
  address: string;
  url: string;
  connection: RoomConnection;
};

let active: ActiveRoom | null = null;
let guestSnapshot: EngineState | null = null;
/**
 * J3：房间里左上角那张连线表（名字＋ping＋状态）。
 * 房主那份是自己算的、客人那份是房主发来的——两边都只住这一格，界面照抄，不再各算一遍。
 */
let netStatus: NetLinkRow[] | null = null;
/**
 * J4 那三格客人侧看得见的事实：谁坐哪一席、房主算给我这一席的清单、上一次被退回的那句话。
 * 三样都是**房主发来的**，客人这边一律不自算（座位绑定与合法性只有房主那台机器说得准）。
 */
let seatMap: NetSeatRow[] | null = null;
let seatMoves: SeatMoveList | null = null;
let refusal: { key: string; reason: string } | null = null;
/**
 * 房主那颗「开始游戏」按不按得下去（切片⑤a）。`applicable:false`＝这格闸门管不着这台机器：
 * 本地热座（没开联机房）、这台机器是客人、刚退房——三种都照今天的样子直接放行，
 * 用户 2026-10-30 裁的是"联机时客人都要点准备"，本地那一套形状一个字不许动。
 * `waiting`／`gone` 是界面那句话的两个名单（还在等的／房主判成掉线、已经不等的）。
 */
export type StartGate = ReadyGate & { applicable: boolean };
const NO_GATE: StartGate = { applicable: false, open: true, waiting: [], gone: [] };
/**
 * 切片⑤a（v2.9.25）那两格：那张准备表，与从它派生出来的那句"还等谁"。
 *
 * 表与派生品分两格存是有原因的：界面（房主那颗「开始游戏」）要的是**一个稳定的引用**——
 * `useSyncExternalStore` 认的是引用，每次现算就会每次都说"变了"，那屏会一直重画。
 * 所以派生品只在**输入真换了**的时候重造（`syncStartGate` 比的是表那个引用与名册里的客人条数），
 * 房主每两秒一次的心跳惊不动它。
 */
let readyTable: NetReadyRow[] | null = null;
let startGate: StartGate = NO_GATE;
let gateRows: NetReadyRow[] | null = null;
let gateGuests = -1;
/**
 * 切片⑤b（v2.9.25）：那张征召进度表。房主那份是自己算出来抄进来的，客人那份是房主发来的——
 * 与准备表同一格纪律（内容没变就保留同一个引用）。`null`＝这一格现在没话要说：
 * 掷骰、分势力那几段还没有进度可报，不是"报了一张空表"。
 */
let draftProgress: NetDraftProgressRow[] | null = null;
/**
 * 切片⑤c（v2.9.25）：**我自己这一席**的候选名单那一格（房主指名发给我的那一份）。
 * 与上面那张进度表分开放的理由就是"私有／全桌"这一刀：进度表换了，我这一格可以一个字没动，
 * 反之也是——房主每勾一名都会重发我这一格，而那张全桌表只是那个数字在动。
 * `null`＝还没收到属于我这一格的那一帧（没开联机房、这台机器是房主、刚连线、或刚退房）。
 */
let draftList: NetDraftListFrame | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * 重算那句"还等谁"。不适用时给同一个常量对象（三种不适用互相换＝引用也不动）。
 * 适用时，表还没上墙（房主刚连线、接线那头还没算出第一遍）才退回名册里数客人：
 * 屋里还有客人就按"还没齐"处理，一个客人都没有就直接放行——
 * 纯 AI 桌与本地桌因此一位不动，也不会出现"表没到就把房主永远锁在门外"。
 */
function syncStartGate(): void {
  const applicable = active !== null && active.role === 'host';
  if (!applicable || !active) {
    if (startGate !== NO_GATE) {
      startGate = NO_GATE;
      gateRows = null;
      gateGuests = -1;
    }
    return;
  }
  const rows = readyTable;
  const guests = active.connection.state.peers.filter((p) => p.role === 'guest').length;
  if (rows === gateRows && guests === gateGuests) return;
  gateRows = rows;
  gateGuests = guests;
  if (rows === null) {
    startGate = guests === 0 ? NO_GATE : { applicable: true, open: false, waiting: [], gone: [] };
    return;
  }
  const gate = gateOfReadyRows(rows);
  startGate = { applicable: true, open: gate.open, waiting: gate.waiting, gone: gate.gone };
}

export function attachRoom(room: ActiveRoom): void {
  if (active && active !== room) active.connection.leave();
  active = room;
  guestSnapshot = null;
  netStatus = null;
  seatMap = null;
  seatMoves = null;
  refusal = null;
  readyTable = null;
  draftProgress = null;
  draftList = null;
  syncStartGate();
  notify();
}

/** 离开房间：连线交给它自己道别（bye），这里只松手。 */
export function detachRoom(): void {
  active = null;
  guestSnapshot = null;
  netStatus = null;
  seatMap = null;
  seatMoves = null;
  refusal = null;
  readyTable = null;
  draftProgress = null;
  draftList = null;
  syncStartGate();
  notify();
}

export function getActiveRoom(): ActiveRoom | null {
  return active;
}

export function getGuestSnapshot(): EngineState | null {
  return guestSnapshot;
}

export function getNetStatus(): NetLinkRow[] | null {
  return netStatus;
}

export function getSeatMap(): NetSeatRow[] | null {
  return seatMap;
}

/**
 * 我这台机器坐第几席＝**视角轴**的唯一来源（联机切片⑤，v2.9.25）。
 *
 * 房主与客人问的是同一句话：那张表里绑到我这个号的那一行。不自算第二遍座次——
 * 客人自己排一遍，两边就会读着不同的席位看牌（与 J4 那三格同一个纪律）。
 *
 * 四种"没有"都返回 `null`：没开联机房（本地游戏）、房主还没发表、表里没绑到我
 * （椅子没排到／全桌都是电脑在打）、刚退房。`null` 传进牌桌＝退回"哪一营画在下面
 * 跟着轮到谁走"，也就是本地热座今天那帧画面，一字不差（用户 2026-10-30 裁：本地形状不许变）。
 */
export function getMyNetSeat(): number | null {
  if (!active || seatMap === null) return null;
  return seatOfPeer(seatMap, active.connection.state.selfId);
}

export function getSeatMoves(): SeatMoveList | null {
  return seatMoves;
}

export function getRefusal(): { key: string; reason: string } | null {
  return refusal;
}

/**
 * J4 三格的纪律与连线表那一格一模一样：**内容没变就保留同一个引用**并返回 false。
 * 房主每次局面变化都会重发席位表与清单，而多数时候表就是那张表——照单全收会让
 * 客人那屏每次都在重画一份没动的东西，还会让 `useSyncExternalStore` 读到"变了"。
 * 「怎么算一样」住在 netSeat：房主发之前比一次、客人收之后比一次，用的是同一份口径。
 */
export function receiveSeatMap(rows: NetSeatRow[]): boolean {
  if (sameSeatRows(seatMap, rows)) return false;
  seatMap = rows;
  notify();
  return true;
}

export function receiveSeatMoves(msg: SeatMoveList): boolean {
  if (sameMoveLists(seatMoves, msg)) return false;
  seatMoves = msg;
  notify();
  return true;
}

/**
 * 退回那句话与上面两格反着来：它是一次性的告示，不是状态。
 * 换新清单时随手 `clearRefusal`——"上一次为什么没走成"只在它对应的那张清单
 * 还站着的时候才有意义，清单都换了还挂着那句话＝让人误读。
 */
export function receiveRefusal(msg: { key: string; reason: string } | null): boolean {
  if (msg === null) {
    if (refusal === null) return false;
    refusal = null;
    notify();
    return true;
  }
  if (refusal && refusal.key === msg.key && refusal.reason === msg.reason) return false;
  refusal = msg;
  notify();
  return true;
}

/** 清单换新（房主重发）⇒ 旧的那句退回说明跟着作废。 */
export function clearRefusal(): void {
  receiveRefusal(null);
}

/**
 * 切片⑤a：那张准备表。房主那份是自己算出来抄进来的，客人那份是房主发来的——
 * 与席位表同一格纪律：**内容没变就保留同一个引用并返回 false**（房主每次名册、
 * 每次连线表变化都会重发一遍，而多数时候那张表根本没动）。
 * 空表在这里是一句真话（屋里没客人＝没人在等），不像 netstatus／seatmap 那样拒空。
 */
export function receiveReadyTable(rows: NetReadyRow[]): boolean {
  if (sameReadyRows(readyTable, rows)) return false;
  readyTable = rows;
  syncStartGate();
  notify();
  return true;
}

export function getReadyTable(): NetReadyRow[] | null {
  return readyTable;
}

/**
 * 切片⑤b：那张征召进度表。与准备表一个纪律——内容没变就保留同一个引用并返回 false。
 * 这里**接受 null**（＝这一格现在没话要说），因为发的那一侧在掷骰、分势力那几段真的无话可说；
 * 客人那边则只会收到房主算出来的实表（`netSession` 那道闸只认房主，解析层不认空表）。
 */
export function receiveDraftProgress(rows: NetDraftProgressRow[] | null): boolean {
  if (sameDraftProgressRows(draftProgress, rows)) return false;
  draftProgress = rows;
  notify();
  return true;
}

export function getDraftProgress(): NetDraftProgressRow[] | null {
  return draftProgress;
}

/**
 * 切片⑤c：我自己那一席的候选名单。与进度表同一格纪律——内容没变就保留同一个引用并返回 false
 * （房主每次点将、每次界面重绘都会问一遍，而多数时候我这一格根本没动）。
 * 这里**不收 null**：线上传的那一帧永远是个对象（"没轮到你"也是带着空名单的一帧，见 `netDraftList`），
 * 清空只由换房／退房那一两条路做。
 */
export function receiveDraftList(frame: NetDraftListFrame): boolean {
  if (sameDraftListFrames(draftList, frame)) return false;
  draftList = frame;
  notify();
  return true;
}

export function getDraftList(): NetDraftListFrame | null {
  return draftList;
}

/**
 * 房主那颗「开始游戏」现在的读数（唯一取数点，界面不自算第二遍——与 `getMyNetSeat` 一样）。
 * 返回的是**缓存下来的那个对象**：没换输入就不换引用，`useSyncExternalStore` 才不会白重绘。
 */
export function getStartGate(): StartGate {
  return startGate;
}

/**
 * 收下这张表。内容一模一样时保留原来那个引用并返回 false——界面上每秒都在重画
 * 一张没变的表是白费劲（`useSyncExternalStore` 也要求"没变就得给同一个引用"）。
 */
export function receiveNetStatus(rows: NetLinkRow[]): boolean {  if (sameRows(netStatus, rows)) return false;
  netStatus = rows;
  notify();
  return true;
}

/**
 * 客人端唯一进门的那道闸：形状不合法的局面快照直接丢掉（不猜、不半收）。
 * 返回是否收下，调用方据此决定要不要通知界面。
 */
export function receiveGuestSnapshot(state: unknown): boolean {
  if (!isRestorableEngineState(state)) return false;
  guestSnapshot = state;
  notify();
  return true;
}

export function subscribeNetRoom(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * J4：客人交回来的那一条要递给房主那台机器上的把关者，而连线是在大厅里建的、
 * 把关者住在 App 上——两边碰不到对方，就在这里挂一句话。没有挂上＝没人接手，
 * 这条请求原样丢掉（客人那边表现为"点了没反应"，下一次清单刷新会把它顶掉）。
 */
let hostActionSink: ((msg: IncomingAction) => void) | null = null;

export function setHostActionSink(sink: ((msg: IncomingAction) => void) | null): void {
  hostActionSink = sink;
}

export function deliverHostAction(msg: IncomingAction): boolean {
  if (!hostActionSink) return false;
  hostActionSink(msg);
  return true;
}

/**
 * 切片⑤a：与上面那格一模一样的一根线——客人交回的那颗准备钮要递给房主那台机器上的准备发布者，
 * 而连线是在大厅里建的、发布者住在 App 上，两边碰不到对方。没有挂上＝这条原样丢掉
 * （那位客人表现为"点了没反应"，而下一次名册或连线表变化会把这张表整个重算一遍）。
 */
let hostReadySink: ((msg: IncomingReady) => void) | null = null;

export function setHostReadySink(sink: ((msg: IncomingReady) => void) | null): void {
  hostReadySink = sink;
}

export function deliverHostReady(msg: IncomingReady): boolean {
  if (!hostReadySink) return false;
  hostReadySink(msg);
  return true;
}

/**
 * 切片⑤d（v2.9.25）：客人交回来的那一颗点将钮／那一次确认要递给房主那台机器上的名单发布者，
 * 而连线是在大厅里建的、发布者住在 App 上（`NetRoomBridge`）——两边碰不到对方，所以又是这里挂一句话。
 * 没有挂上＝这条原样丢掉（那位客人表现为"点了这一颗没反应"——房主那侧根本没接到过这一条，
 * 连那句"为什么不让你走"都没处说）。判合法性与执行一律在 `netHostDraftList.handleIncoming`，这一格只搬运。
 * ⚠️ 这一格与上面两格不同，没有"下一次变化会顺带补算"这条路（点将是即时动作）：客人那侧每一次动手都等两样回音之一——
 * 名单里那颗「已选」动了，或者"这一席该做什么"那一行换成房主回他的那句拒话。
 */
let hostDraftSink: ((msg: IncomingDraft) => void) | null = null;

export function setHostDraftSink(sink: ((msg: IncomingDraft) => void) | null): void {
  hostDraftSink = sink;
}

export function deliverHostDraft(msg: IncomingDraft): boolean {
  if (!hostDraftSink) return false;
  hostDraftSink(msg);
  return true;
}

/** 名册或连线状态变了（谁进来、谁走了）⇒ 让房主侧的接线重新对齐。这里不搬运局面。 */
export function bumpNetRoom(): void {
  // 准备表还没上墙时，闸门那句"还等谁"读的就是名册——名册一动它得跟着动（房主侧接线随后会把表算出来）。
  syncStartGate();
  notify();
}
