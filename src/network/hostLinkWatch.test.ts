/**
 * 客人这根线的失联判据（2026-11-11 同网真机）。
 *
 * 现场故障：房主关掉浏览器后，中转只把那一格从名册删掉、不广播；连线表本来就是
 * 房主算好发来的，客人只照抄，于是那张表永远停在最后一帧，界面一直停在「等房主动」。
 * 这里只钉判据与接线，判定权仍归房主那张表（netHeartbeat.linkRows 一字未改）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCONNECT_SILENCE_MS } from './netHeartbeat';
import { hostLinkOf, isHostAliveSignal, HOST_SILENCE_MS, HOST_WATCH_TICK_MS } from './hostLinkWatch';

const readSrc = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

describe('客人这根线与房主的通断判据', () => {
  it('阈值沿用 J3 的 15 秒，自查间隔比它短一个量级', () => {
    expect(HOST_SILENCE_MS).toBe(DISCONNECT_SILENCE_MS);
    expect(HOST_WATCH_TICK_MS).toBeLessThan(HOST_SILENCE_MS);
  });

  it('差一毫秒不算掉线，刚满 15 秒就算', () => {
    expect(hostLinkOf(0, DISCONNECT_SILENCE_MS - 1)).toBe('online');
    expect(hostLinkOf(0, DISCONNECT_SILENCE_MS)).toBe('lost');
  });

  it('收到新的来信就自动回到在线，不需要谁去点「恢复」', () => {
    expect(hostLinkOf(10_000, 25_000)).toBe('lost');
    expect(hostLinkOf(25_000, 25_001)).toBe('online');
  });

  it('本机自己发的不算房主来信；认得房主就只认他；名册没到时放宽', () => {
    expect(isHostAliveSignal('guest-1', 'guest-1', 'host-1')).toBe(false);
    expect(isHostAliveSignal('host-1', 'guest-1', 'host-1')).toBe(true);
    expect(isHostAliveSignal('guest-2', 'guest-1', 'host-1')).toBe(false);
    expect(isHostAliveSignal('anyone', 'guest-1', null)).toBe(true);
  });
});

describe('接线证人：失联要真的传到客人那三屏', () => {
  const lobby = readSrc('components', 'OnlineLobby.tsx');
  const room = readSrc('network', 'netRoom.ts');
  const session = readSrc('network', 'netSession.ts');
  const app = readSrc('App.tsx');
  const ping = readSrc('components', 'NetPingPanel.tsx');

  it('连线层客人端启动自查，并把翻转交出去', () => {
    expect(session).toContain("onHostLink?: (state: HostLinkState) => void;");
    expect(session).toContain('armHostWatch();');
    expect(session).toContain("if (state.role === 'guest') setHostLink('lost');");
  });

  it('联网窗口把回调接进房间那一格', () => {
    expect(lobby).toContain('onHostLink: (next) =>');
    expect(lobby).toContain('receiveHostLink(next)');
    expect(room).toContain('export function getHostLink()');
  });

  it('整屏横幅与左上角连线表都读同一格状态', () => {
    expect(app).toContain("activeRoom?.role === 'guest' && hostLink === 'lost'");
    expect(app).toContain('房主已经断线');
    expect(ping).toContain("state: 'lost' as const");
  });
});
