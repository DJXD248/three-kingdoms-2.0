/**
 * 房间里那条线的**唯一持有者**。
 *
 * J1 时连接建在大厅弹窗里，关掉弹窗就断线；J2 要"房主每次局面变化都发出去"，
 * 房主那边得离开大厅去开局，客人那边得一直看着牌桌——所以连接不能住在任何
 * 一屏里。这一格只做三件事：收着一份当前连接、收着客人最新看到的那份局面、
 * 变了就通知订阅者。没有规则、没有状态转移。
 */
import type { EngineState } from '../core/GameState';
import type { NetLinkRow, NetSeatRow } from './netProtocol';
import type { NetRole, RoomConnection } from './netSession';
import type { IncomingAction } from './netHostAuthority';
import { isRestorableEngineState } from '../store/gameStateAdapter';
import { sameRows } from './netHeartbeat';
import { seatOfPeer, sameMoveLists, sameSeatRows, type SeatMoveList } from './netSeat';

export type ActiveRoom = {
  role: NetRole;
  name: string;
  roomCode: string;
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
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function attachRoom(room: ActiveRoom): void {
  if (active && active !== room) active.connection.leave();
  active = room;
  guestSnapshot = null;
  netStatus = null;
  seatMap = null;
  seatMoves = null;
  refusal = null;
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

/** 名册或连线状态变了（谁进来、谁走了）⇒ 让房主侧的接线重新对齐。这里不搬运局面。 */
export function bumpNetRoom(): void {
  notify();
}
