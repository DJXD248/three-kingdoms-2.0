import { DISCONNECT_SILENCE_MS } from './netHeartbeat';

/**
 * 客人这根线自己能不能感觉到「房主还在」（2026-11-11 同网真机反馈）。
 *
 * 与 `netHeartbeat.linkRows` 的分工要分清楚，用户 2026-10-07 那句裁决
 * 「只有房主能判定，客人不自判、不投票说谁掉了」**仍然成立**：那一格是房主判定桌里
 * 哪位**客人**掉了，涉及席位与判定权；这一格只回答「我（客人）还收不收得到房主的话」，
 * 是这根线自己的物理事实——不对任何人下判定、不碰席位、不投票、不改 `linkRows`
 * 里 `guest-only` 的判据。用户 2026-11-11 新口令「主机断开后客机能及时收到掉线提示」
 * 补的正是这一格。
 *
 * 为什么非补不可：连线表由房主算好广播、客人只照抄；中转在房主断开时只把那一格
 * 从名册删掉、不广播任何「谁走了」。于是房主一关浏览器，既没人再发 ping、也没人再算表，
 * 客人手上的那张表永远停在最后一帧，界面也就一直停在「等房主动」上。
 */
export type HostLinkState = 'online' | 'lost';

/** 沿用 J3 定稿的 15 秒，不另造一个阈值。 */
export const HOST_SILENCE_MS = DISCONNECT_SILENCE_MS;
/** 客人这根线多久自查一次；比阈值短一个量级，最多晚 1 秒露相。 */
export const HOST_WATCH_TICK_MS = 1000;

/**
 * 纯判据：最后一次收到房主消息离现在多久。
 * 时刻一律由调用方喂进来（生产喂 `Date.now`，测试喂假钟），这一格不含定时器。
 */
export function hostLinkOf(
  lastHostMessageAt: number,
  now: number,
  thresholdMs: number = HOST_SILENCE_MS,
): HostLinkState {
  return now - lastHostMessageAt >= thresholdMs ? 'lost' : 'online';
}

/**
 * 一条来信算不算「房主还活着」：本机自己发的不算；名册里认得出房主就只认他，
 * 名册还没到（刚连上、还没收到名单）时放宽为任意一条来自别人的信——房间里
 * 会周期性主动发话的只有房主，且这些信也都经同一条线过来，能证明线还通。
 */
export function isHostAliveSignal(from: string, selfId: string, hostId: string | null): boolean {
  if (from === selfId) return false;
  return hostId === null || from === hostId;
}
