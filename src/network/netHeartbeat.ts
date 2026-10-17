/**
 * 心跳与 ping 的判据（J3＝联机第三刀）。
 *
 * 用户 2026-10-07 定稿原话：「我需要你在房间内左上角列出当前玩家ping值，对所有玩家公开。
 * 判定＝连线断开或心跳超时。阈值：15 秒。」契约（§G 第 12 项·掉线判定行）再钉死一条＝
 * **只有房主能判定，客人不自判、不投票说谁掉了**。所以这一格里压根没有"客人自己算掉线"那条路：
 * 客人只做两件事——收到探测就原样把时刻抄回去、把房主发来的那张表照抄给人看。
 *
 * 这里不含定时器：2 秒探测与 15 秒超时都是"两个时刻一比"，时刻一律由调用方喂进来
 * （测试喂假钟、接线层喂 `Date.now`）⇒ 判据能被逐条钉住，不用靠人等。
 */
import type { NetLinkRow, NetPeer } from './netProtocol';

/** 契约：房主每约 2 秒探测各连接、客人即回。 */
export const HEARTBEAT_PROBE_INTERVAL_MS = 2000;
/** 用户定稿的阈值：15 秒没收到那个人的**任何**消息就算掉线（≈7 次心跳无回应）。 */
export const DISCONNECT_SILENCE_MS = 15000;

export type PeerTrack = {
  id: string;
  name: string;
  /** 跟着名册走：房主那一行永远不探测、也永远不会被判掉线。 */
  role: 'host' | 'guest';
  /** 最后一次收到这个人任何一条来信的时刻（判据原文是"未收到该人任何消息"，不是"未回心跳"）。 */
  lastSeenAt: number;
  /** 最近一次量到的往返毫秒数；还没量到＝null。 */
  pingMs: number | null;
  /** 上一次给这个人发探测的时刻（决定这一轮该不该再探）。 */
  lastProbedAt: number;
};

export type HeartbeatModel = { tracks: PeerTrack[] };

export function emptyHeartbeat(): HeartbeatModel {
  return { tracks: [] };
}

/**
 * 名册是建账的唯一依据：进房的人开课、退房的人销账、改名的人跟着改。
 * 房主自己也在表上（那一行是给全桌看的"房主·本机"，不是给自己看的）。
 */
export function syncTracks(model: HeartbeatModel, peers: NetPeer[], now: number): HeartbeatModel {
  const tracks = peers.map((peer) => {
    const old = model.tracks.find((t) => t.id === peer.id);
    if (old) return old.name === peer.name ? old : { ...old, name: peer.name };
    return { id: peer.id, name: peer.name, role: peer.role, lastSeenAt: now, pingMs: null, lastProbedAt: 0 };
  });
  return { tracks };
}

/** 收到这个人任何一条来信 ⇒ 刷新他的时钟。不认识的人不建账（名册外的消息不算在场）。 */
export function markSeen(model: HeartbeatModel, id: string, now: number): HeartbeatModel {
  if (!model.tracks.some((t) => t.id === id)) return model;
  return { tracks: model.tracks.map((t) => (t.id === id ? { ...t, lastSeenAt: now } : t)) };
}

/** 量到多少毫秒以上就判"这数字不可信"：比掉线阈值再宽十圈，正常机器到不了。 */
const MAX_PING_TO_KEEP = DISCONNECT_SILENCE_MS * 10;

/**
 * 客人把房主发探测那一刻原样抄了回来 ⇒ 往返耗时只用房主一个时钟算。
 * 抄回来的值不可信（对面可以改自己的浏览器）：同一刻算 0、未来时刻与离谱大值**这次不算、
 * 保留上一次那个数**。这一格只保证"客人看得见牌局、改不动牌局"，
 * 防作弊整条不在契约范围内（§G ⑤）。
 */
export function recordPong(model: HeartbeatModel, id: string, echoedAt: number, now: number): HeartbeatModel {
  const elapsed = now - echoedAt;
  const usable = elapsed >= 0 && Number.isFinite(elapsed) && elapsed <= MAX_PING_TO_KEEP;
  return {
    tracks: model.tracks.map((t) => (t.id === id ? { ...t, lastSeenAt: now, pingMs: usable ? Math.round(elapsed) : t.pingMs } : t)),
  };
}

/** 这一轮该探测谁：只有客人、只有距上一次探测已满一个间隔的。 */
export function dueProbes(
  model: HeartbeatModel,
  now: number,
  intervalMs: number = HEARTBEAT_PROBE_INTERVAL_MS,
): string[] {
  return model.tracks
    .filter((t) => t.role === 'guest' && now - t.lastProbedAt >= intervalMs)
    .map((t) => t.id);
}

export function noteProbeSent(model: HeartbeatModel, id: string, now: number): HeartbeatModel {
  return { tracks: model.tracks.map((t) => (t.id === id ? { ...t, lastProbedAt: now } : t)) };
}

/**
 * 算出给人看的那张表。**状态是从"最后一次来信离现在多久"推出来的**，不是贴上去的标签——
 * 所以一个人掉线后又来信，那一行会自动回到在线（这是物理事实，不是新政策；
 * "把座位交回给他"是另一件事，用户 2026-10-07 裁过＝挂起）。
 */
export function linkRows(
  model: HeartbeatModel,
  now: number,
  thresholdMs: number = DISCONNECT_SILENCE_MS,
): NetLinkRow[] {
  return model.tracks.map((t) => {
    const lost = t.role === 'guest' && now - t.lastSeenAt >= thresholdMs;
    return { id: t.id, name: t.name, pingMs: lost ? null : t.pingMs, state: lost ? 'lost' : 'online' };
  });
}

/** 两张表是否同一张：房主据此决定要不要再广播，客人据此决定要不要重画。 */
export function sameRows(a: NetLinkRow[] | null, b: NetLinkRow[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return row.id === other.id && row.name === other.name && row.state === other.state && row.pingMs === other.pingMs;
  });
}

/** 表里掉线的那些人（界面的提示语从这里取，不在界面里再算一遍判据）。 */
export function lostRows(rows: NetLinkRow[]): NetLinkRow[] {
  return rows.filter((row) => row.state === 'lost');
}
