/**
 * 房间里那条线的**唯一持有者**。
 *
 * J1 时连接建在大厅弹窗里，关掉弹窗就断线；J2 要"房主每次局面变化都发出去"，
 * 房主那边得离开大厅去开局，客人那边得一直看着牌桌——所以连接不能住在任何
 * 一屏里。这一格只做三件事：收着一份当前连接、收着客人最新看到的那份局面、
 * 变了就通知订阅者。没有规则、没有状态转移。
 */
import type { EngineState } from '../core/GameState';
import type { NetLinkRow } from './netProtocol';
import type { NetRole, RoomConnection } from './netSession';
import { isRestorableEngineState } from '../store/gameStateAdapter';
import { sameRows } from './netHeartbeat';

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
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function attachRoom(room: ActiveRoom): void {
  if (active && active !== room) active.connection.leave();
  active = room;
  guestSnapshot = null;
  netStatus = null;
  notify();
}

/** 离开房间：连线交给它自己道别（bye），这里只松手。 */
export function detachRoom(): void {
  active = null;
  guestSnapshot = null;
  netStatus = null;
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

/**
 * 收下这张表。内容一模一样时保留原来那个引用并返回 false——界面上每秒都在重画
 * 一张没变的表是白费劲（`useSyncExternalStore` 也要求"没变就得给同一个引用"）。
 */
export function receiveNetStatus(rows: NetLinkRow[]): boolean {
  if (sameRows(netStatus, rows)) return false;
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

/** 名册或连线状态变了（谁进来、谁走了）⇒ 让房主侧的接线重新对齐。这里不搬运局面。 */
export function bumpNetRoom(): void {
  notify();
}
