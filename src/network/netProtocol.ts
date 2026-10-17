import pkg from '../../package.json';
import { NETWORK_SNAPSHOT_VERSION } from './StateSerializer';

/** 换协议格式就抬这个数：两端不一致 ⇒ 明确拒接，绝不静默半连。 */
export const NET_PROTOCOL_VERSION = 1;

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混的 I O 0 1
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_CODE_LENGTH = 10;
export const MAX_WIRE_BYTES = 512 * 1024;
export const MAX_NAME_LENGTH = 12;

export type VersionStamp = { app: string; proto: number; snapshot: number };
export type NetPeer = { id: string; name: string; role: 'host' | 'guest' };
/** J3 连线表里的一行：房主算出来的，客人只是照抄显示（判定权不在客人手里）。 */
export type NetLinkState = 'online' | 'lost';
export type NetLinkRow = { id: string; name: string; pingMs: number | null; state: NetLinkState };

/** 往返耗时的可信上限：超过就当没量到（对面时钟被改、或攒了很久的一条回话）。 */
export const MAX_TRUSTED_PING_MS = 600_000;

export type NetEnvelope =
  | { t: 'hello'; from: string; name: string; v: VersionStamp }
  | { t: 'welcome'; from: string; to: string; name: string; v: VersionStamp }
  | { t: 'refuse'; from: string; to: string; reason: string }
  | { t: 'roster'; from: string; peers: NetPeer[] }
  /** J2：房主每次局面变化后发的一份**已遮蔽**快照。协议层只当它是未知对象——
   *  看懂它是快照层的事（`isRestorableEngineState` 在客人端把关）。 */
  | { t: 'snapshot'; from: string; state: Record<string, unknown> }
  /** J3：房主探测某个连接。`at`＝房主自己那台机器的发出时刻，客人**原样抄回来**，
   *  往返耗时由房主算——全程只用房主一个时钟，绝不去比两边的表。 */
  | { t: 'ping'; from: string; to: string; at: number }
  | { t: 'pong'; from: string; to: string; at: number }
  /** J3：房主算出来的那张连线表，随探测广播给全桌⇒所有人看同一张表。 */
  | { t: 'netstatus'; from: string; rows: NetLinkRow[] }
  | { t: 'bye'; from: string };

export function ourVersionStamp(): VersionStamp {
  return { app: pkg.version, proto: NET_PROTOCOL_VERSION, snapshot: NETWORK_SNAPSHOT_VERSION };
}

/**
 * 房间码走浏览器自己的随机源，绝不碰引擎那颗对局种子——
 * 掺进对局随机流会打乱"同一局能重演"的基准读数（契约 §G 方法结论 2）。
 */
export function createRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}

export function normalizeRoomCode(raw: string): string | null {
  const code = String(raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length < 4 || code.length > MAX_ROOM_CODE_LENGTH) return null;
  return /^[A-Z0-9]+$/.test(code) ? code : null;
}

/** 地址可填＝A/C 只换这里；返回拒因（人读）而不是抛错，界面照原文显示。 */
export function composeRoomUrl(
  address: string,
  roomCode: string,
): { ok: true; url: string; roomCode: string } | { ok: false; reason: string } {
  const trimmed = String(address ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return { ok: false, reason: '连接地址没填。局域网填 ws://对方IP:8787，中转填 ws://服务器地址:端口' };
  if (!/^wss?:\/\//i.test(trimmed)) return { ok: false, reason: `地址要以 ws:// 或 wss:// 开头，现在填的是「${trimmed}」` };
  const code = normalizeRoomCode(roomCode);
  if (!code) return { ok: false, reason: `房间码得是 4-10 位字母或数字，现在填的是「${roomCode}」` };
  return { ok: true, url: `${trimmed}/${code}`, roomCode: code };
}

export function encodeEnvelope(envelope: NetEnvelope): string {
  return JSON.stringify(envelope);
}

/** 线上证人：解析器只认这九种信封，形状不对/未知类型/超长一律拒（返回 null，不猜）。 */
export function parseEnvelope(text: string): NetEnvelope | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_WIRE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
  /** 心跳那个 `at` 是**发话那台机器自己的钟**：只要求它是个安全的正数，不要求它是"现在"。 */
  const isClock = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
  const isPing = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0;
  const isStamp = (v: unknown): v is VersionStamp => {
    if (!v || typeof v !== 'object') return false;
    const s = v as Record<string, unknown>;
    return typeof s.app === 'string' && typeof s.proto === 'number' && typeof s.snapshot === 'number';
  };

  switch (raw.t) {
    case 'hello':
      return isId(raw.from) && typeof raw.name === 'string' && isStamp(raw.v)
        ? { t: 'hello', from: raw.from, name: raw.name, v: raw.v }
        : null;
    case 'welcome':
      return isId(raw.from) && isId(raw.to) && typeof raw.name === 'string' && isStamp(raw.v)
        ? { t: 'welcome', from: raw.from, to: raw.to, name: raw.name, v: raw.v }
        : null;
    case 'refuse':
      return isId(raw.from) && isId(raw.to) && typeof raw.reason === 'string'
        ? { t: 'refuse', from: raw.from, to: raw.to, reason: raw.reason }
        : null;
    case 'roster': {
      if (!isId(raw.from) || !Array.isArray(raw.peers) || raw.peers.length > 8) return null;
      const peers = (raw.peers as unknown[]).map((p) => {
        if (!p || typeof p !== 'object') return null;
        const o = p as Record<string, unknown>;
        if (!isId(o.id) || typeof o.name !== 'string' || (o.role !== 'host' && o.role !== 'guest')) return null;
        return { id: o.id, name: o.name, role: o.role };
      });
      return peers.every(Boolean) ? { t: 'roster', from: raw.from, peers: peers as NetPeer[] } : null;
    }
    case 'bye':
      return isId(raw.from) ? { t: 'bye', from: raw.from } : null;
    case 'snapshot': {
      if (!isId(raw.from)) return null;
      const state = raw.state;
      if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
      return { t: 'snapshot', from: raw.from, state: state as Record<string, unknown> };
    }
    case 'ping':
      return isId(raw.from) && isId(raw.to) && isClock(raw.at)
        ? { t: 'ping', from: raw.from, to: raw.to, at: raw.at }
        : null;
    case 'pong':
      return isId(raw.from) && isId(raw.to) && isClock(raw.at)
        ? { t: 'pong', from: raw.from, to: raw.to, at: raw.at }
        : null;
    case 'netstatus': {
      // 空表也拒：房主那一行永远在表上，收到一张"谁都没有"的表只可能是坏消息，
      // 收下来等于把界面上那张公开的表清空。
      if (!isId(raw.from) || !Array.isArray(raw.rows) || raw.rows.length === 0 || raw.rows.length > 8) return null;
      const rows = (raw.rows as unknown[]).map((r) => {
        if (!r || typeof r !== 'object') return null;
        const o = r as Record<string, unknown>;
        if (!isId(o.id) || typeof o.name !== 'string' || o.name.length === 0 || o.name.length > MAX_NAME_LENGTH) return null;
        if (o.state !== 'online' && o.state !== 'lost') return null;
        if (o.pingMs !== null && (!isPing(o.pingMs) || o.pingMs > MAX_TRUSTED_PING_MS)) return null;
        return { id: o.id, name: o.name, pingMs: (o.pingMs as number | null) ?? null, state: o.state };
      });
      return rows.every(Boolean) ? { t: 'netstatus', from: raw.from, rows: rows as NetLinkRow[] } : null;
    }
    default:
      return null;
  }
}

/**
 * 版本握手：应用版本／协议版本／快照版本三样任一不符 ⇒ 给出一句人读的拒因。
 * 注意这是"不一致就拒"，不是"新旧排序"——联机要求两边同一份文件，没有向下兼容承诺。
 */
export function versionMismatch(theirs: VersionStamp, ours: VersionStamp): string | null {
  if (typeof theirs.proto !== 'number' || theirs.proto !== ours.proto) {
    return `协议版本对不上：对面 ${theirs.proto}，本机 ${ours.proto}——两边请打开同一份游戏文件`;
  }
  if (typeof theirs.app === 'string' && theirs.app !== ours.app) {
    return `游戏版本对不上：对面 V${theirs.app}，本机 V${ours.app}——两边请打开同一份游戏文件`;
  }
  if (theirs.snapshot !== ours.snapshot) {
    return `局面快照版本对不上：对面 ${theirs.snapshot}，本机 ${ours.snapshot}——两边请打开同一份游戏文件`;
  }
  return null;
}

/** 名字是客人自报的 ⇒ 房主校验后回提示，不照收也不静默截断（契约 §G 玩家账户名行）。 */
export function checkPeerName(
  raw: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, reason: '名字不能是空的，请在界面里填一个名字' };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: `名字太长了（${name.length} 个字），最多 ${MAX_NAME_LENGTH} 个` };
  if (/[<>]/.test(name) || [...name].some((c) => c.charCodeAt(0) < 0x20)) {
    return { ok: false, reason: `名字「${name}」里有不能用的字符，请换一个` };
  }
  return { ok: true, name };
}
