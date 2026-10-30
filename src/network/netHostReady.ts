/**
 * 联机切片⑤a（v2.9.25）房主侧的准备表发布者。
 *
 * 它与 `startHostAuthority`、`startSnapshotBroadcaster` 是同一个形状：住在一间房上，
 * 读房主当下的名册与连线表，算出那张准备表，**变了才发**，同时把同一份抄一格给房主自己那屏
 * （不抄的话，算表的人自己看不见——席位表当初就栽过这一点）。
 *
 * 它不含规则：谁还算数、闸门开不开，全在 `netReady` 那三条判据里；它也不碰局面——
 * 准备是局外那一段的事，跟引擎一格关系也没有（用户裁的机制是"房主先走出数据→传下去"，
 * 这一段唯一从客人流向房主的就只是那一颗布尔）。
 */
import {
  buildReadyRows,
  markReady,
  pruneReadyMarks,
  sameReadyRows,
  type ReadyMarks,
} from './netReady';
import type { NetLinkRow, NetPeer, NetReadyRow } from './netProtocol';

export type HostReady = {
  /** 名册或连线表换了人／换了状态：重算一遍，没变就一条也不发。 */
  syncNow: () => void;
  /** 某位客人交回他那颗钮。（到这里已经只可能是"名册上的客人＋一个布尔"，见 netSession 那条闸。） */
  noteMark: (peer: string, on: boolean) => void;
};

export function startHostReady(deps: {
  peers: () => NetPeer[];
  /** 房主那张连线表（判掉线的唯一出处）；没用心跳时是 null＝没人被判掉线。 */
  links: () => NetLinkRow[] | null;
  /** 上线那一条。信封在这里拼由调用方定：这一格只管"表变了"，不管线怎么接。 */
  send: (rows: NetReadyRow[]) => void;
  /** 同一份抄给房主自己那屏（与席位表的 `seatMapSink` 同一手法）。 */
  tableSink: (rows: NetReadyRow[]) => void;
}): HostReady {
  let marks: ReadyMarks = {};
  let last: NetReadyRow[] | null = null;

  const syncNow = () => {
    const roster = deps.peers();
    marks = pruneReadyMarks(
      marks,
      roster.filter((peer) => peer.role === 'guest').map((peer) => peer.id),
    );
    const rows = buildReadyRows(roster, marks, deps.links());
    if (sameReadyRows(last, rows)) return;
    last = rows;
    // 屋里一位客人都没有 ⇒ 线上一条也不发（没有收件人，也不该凭空多出一次广播）；
    // 房主自己那一格仍要更新——最后一位客人退掉时，闸门正是靠这一笔才当场开。
    if (rows.length > 0) deps.send(rows);
    deps.tableSink(rows);
  };

  return {
    syncNow,
    noteMark: (peer, on) => {
      marks = markReady(marks, peer, on);
      syncNow();
    },
  };
}
