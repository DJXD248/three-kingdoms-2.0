/**
 * J3 左上角那张公开连线表的证人。
 * 两块分开钉：`NetPingPanel` 只管"房主算出来的东西怎么给人看"，
 * `NetPingOverlay` 管"它住在屏幕上而不是大厅弹窗里"——房主关掉大厅去开局，这张表也得在。
 * 反向证人同样重要：整块不许有一个能按的东西（客人动手＝J4）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import NetPingOverlay, { NetPingPanel } from './NetPingPanel';
import { attachRoom, detachRoom, getNetStatus, receiveNetStatus } from '../network/netRoom';
import type { NetLinkRow } from '../network/netProtocol';
import { joinRoom } from '../network/netSession';

const HOST = 'host-1';
const GUEST = 'guest-1';

const online: NetLinkRow[] = [
  { id: HOST, name: '房主乙', pingMs: null, state: 'online' },
  { id: GUEST, name: '客人甲', pingMs: 37, state: 'online' },
];
const oneLost: NetLinkRow[] = [
  { id: HOST, name: '房主乙', pingMs: null, state: 'online' },
  { id: GUEST, name: '客人甲', pingMs: null, state: 'lost' },
];

const text = () => document.body.textContent ?? '';

afterEach(() => {
  cleanup();
  detachRoom();
});

describe('连线表本身：写什么就是什么，界面上不再算一遍判据', () => {
  it('每人一行：名字、谁在算牌、哪一行是我、多少毫秒', () => {
    render(<NetPingPanel rows={online} selfId={GUEST} hostId={HOST} />);
    expect(text()).toContain('连线情况（2 人·全桌公开）');
    expect(text()).toContain('房主乙');
    expect(text()).toContain('客人甲');
    expect(text()).toContain('房主·算牌');
    expect(text()).toContain('（我）');
    expect(text()).toContain('37 毫秒');
  });

  it('还没量到的写"还没回话"，绝不写成 0 毫秒（没测到和测到 0 是两件事）', () => {
    render(<NetPingPanel rows={[{ id: HOST, name: '房主乙', pingMs: null, state: 'online' }]} selfId={HOST} hostId={HOST} />);
    expect(text()).toContain('还没回话');
    expect(text()).not.toContain('0 毫秒');
  });

  it('掉线那行写"掉线"，并说清是谁、判据是什么、以及那两选一还没做', () => {
    render(<NetPingPanel rows={oneLost} selfId={HOST} hostId={HOST} />);
    expect(text()).toContain('客人甲 掉线了（15 秒没收到他任何一条消息）');
    expect(text()).toContain('J5');
    // 名字取自表里掉线的那些人，界面自己一个新判断也不下。
    expect(text()).not.toContain('37 毫秒');
  });

  it('ping 的如实边界必须写在表旁边（它不是两两延时，也不是卡顿指标）', () => {
    render(<NetPingPanel rows={online} selfId={GUEST} hostId={HOST} />);
    expect(text()).toContain('房主那台机器');
    expect(text()).toContain('不是两人之间的真实延时');
    expect(text()).toContain('也不是卡顿指标');
    // 界面上没有渲染器：写进这段的星号会照原样显示出来（真机实测抓到过一次）。
    expect(text()).not.toContain('**');
  });

  it('这张表里没有任何能按的东西（客人动手＝J4）', () => {
    const { container } = render(<NetPingPanel rows={oneLost} selfId={GUEST} hostId={HOST} />);
    expect(container.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });
});

describe('挂在屏幕左上角的那一份：住在屏幕上，不住在大厅弹窗里', () => {
  it('没进房、或还没收到任何一张表 ⇒ 什么都不画（不画一张猜出来的表）', () => {
    const { container } = render(<NetPingOverlay />);
    expect(container.firstChild).toBeNull();

    act(() => {
      attachRoom({ role: 'guest', name: '甲', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection('guest') });
    });
    render(<NetPingOverlay />);
    expect(getNetStatus()).toBeNull();
    expect(text()).not.toContain('连线情况');
  });

  it('进了房又收到表 ⇒ 左上角固定那一格出现，且整块不挡点击', () => {
    attachRoom({ role: 'host', name: '乙', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection('host') });
    receiveNetStatus(online);
    const { container } = render(<NetPingOverlay />);
    const corner = container.querySelector('div.fixed.left-3.top-3');
    expect(corner?.className).toContain('pointer-events-none');
    expect(corner?.textContent).toContain('连线情况（2 人·全桌公开）');
  });

  it('表一更新，左上角那一格跟着换（订阅的是 netRoom 那份，不是打开弹窗时抓的快照）', () => {
    attachRoom({ role: 'host', name: '乙', roomCode: 'A', ticket: 'TK4TK4TK4TK4', address: 'ws://x', url: 'ws://x/A', connection: fakeConnection('host') });
    receiveNetStatus(online);
    render(<NetPingOverlay />);
    expect(text()).toContain('37 毫秒');

    act(() => {
      receiveNetStatus(oneLost);
    });
    expect(text()).toContain('掉线了');
    expect(text()).not.toContain('37 毫秒');
  });
});

/** 一张真接线：房主侧用心跳，探测发给客人、客人回话，表就从这条线上算出来。 */
function fakeConnection(role: 'host' | 'guest') {
  const socket = {
    readyState: 1,
    onopen: null as (() => void) | null,
    onmessage: null as ((ev: { data: unknown }) => void) | null,
    onclose: null as ((ev: { code?: number; reason?: string }) => void) | null,
    onerror: null as (() => void) | null,
    send: vi.fn(),
    close: vi.fn(),
  };
  return joinRoom({ role, name: role === 'host' ? '乙' : '甲', url: 'ws://x/A', roomCode: 'A', socketFactory: () => socket as never }, () => {});
}
