/**
 * 联机切片⑤a（v2.9.25）准备闸门的那笔账——**只算，不搬**。
 *
 * 三条判据全住在这里，房主出表与客人抄表读的是同一份口径（与 `netSeat` 那两条 `same*` 同一手法）：
 *
 * ㈠分母＝**现在还在被等的客人**。退掉的人当场不再有一行（表逐行按名册生成，不在册就点不出来），
 *   被房主判成掉线的人留着那一行但 `counted:false`——用户 2026-10-30 那句
 *   「客人中途退掉／掉线⇒闸门重算（不许出现"永远等一个已经不在的人"）」就落在这个布尔上：
 *   不进分母，但也不抹掉（那一行留在桌上，别人才看得见他是掉了、不是没点）。
 * ㈡闸门只认 `counted` 的那些行：他们全点了才算开。
 * ㈢内容没变＝同一个引用：房主每次名册、每次连线表变化都会重算一遍，而多数时候那张表根本没动。
 *
 * 这里不分房主与客人：谁拿到这张表都能问出同一句话，两边因此不会读着不同的口径开局。
 * 判定"掉没掉线"仍然只有房主那台机器会做（这张表只是把它判出来的那个数抄过来）。
 */
import type { NetLinkRow, NetPeer, NetReadyRow } from './netProtocol';

/** 房主记着的那一小把布尔：谁点过准备。没点与点过又取消在这里是同一个样子。 */
export type ReadyMarks = Record<string, boolean>;

/**
 * 客人交回的那一条翻成内存里的样子：只有"谁"与"点没点"。
 * 线上、reducer、接线三处都读这一个形状，免得同一句话写三份、改一处漏两处。
 */
export type IncomingReady = { peer: string; on: boolean };

export type ReadyGate = { open: boolean; waiting: string[]; gone: string[] };

export function markReady(marks: ReadyMarks, peer: string, on: boolean): ReadyMarks {
  if ((marks[peer] === true) === on) return marks;
  const next: ReadyMarks = { ...marks };
  if (on) next[peer] = true;
  else delete next[peer];
  return next;
}

/**
 * 名册一换，不在册的那几个"准备过"跟着销账：他中途退掉过，再进来就是新的一位，得重新点。
 * 没掉东西时保留同一个引用（每次连线状态变化都会走这一趟，不能每次都换个对象）。
 */
export function pruneReadyMarks(marks: ReadyMarks, peersOnRoster: readonly string[]): ReadyMarks {
  const roster = new Set(peersOnRoster);
  const stale = Object.keys(marks).filter((peer) => !roster.has(peer));
  if (stale.length === 0) return marks;
  const next: ReadyMarks = { ...marks };
  for (const peer of stale) delete next[peer];
  return next;
}

/**
 * 房主出那张表：只列客人，一人一行，顺序就是名册顺序（房主自己那一席不进分母）。
 * `links` 是房主那张连线表；没用心跳的老调用方给 null ⇒ 没人被判掉线，全都还算数。
 */
export function buildReadyRows(
  peers: readonly NetPeer[],
  marks: ReadyMarks,
  links: readonly NetLinkRow[] | null,
): NetReadyRow[] {
  const lost = new Set((links ?? []).filter((row) => row.state === 'lost').map((row) => row.id));
  return peers
    .filter((peer) => peer.role === 'guest')
    .map((peer) => ({
      peer: peer.id,
      name: peer.name,
      on: marks[peer.id] === true,
      counted: !lost.has(peer.id),
    }));
}

/** 内容口径与 `sameSeatRows` 一样逐字段比；两边都是 null 才算一样。 */
export function sameReadyRows(a: NetReadyRow[] | null, b: NetReadyRow[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return row.peer === other.peer && row.name === other.name && row.on === other.on && row.counted === other.counted;
  });
}

/**
 * 那句人话的出处：`waiting`＝还在等的（按名册顺序），`gone`＝房主判成掉线、已经不等的。
 * 两个名单都留着一行，是为了界面能说清"这两个不点也没关系"跟"这两个还等着"是两回事。
 */
export function gateOfReadyRows(rows: readonly NetReadyRow[]): ReadyGate {
  const waiting = rows.filter((row) => row.counted && !row.on).map((row) => row.name);
  const gone = rows.filter((row) => !row.counted).map((row) => row.name);
  return { open: waiting.length === 0, waiting, gone };
}
