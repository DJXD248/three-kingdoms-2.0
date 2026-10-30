/**
 * 联机切片⑤a（v2.9.25）「开始游戏」那颗钮的界面证人。
 *
 * 用户 2026-10-30 裁的是判据㈠那一句话的形状：全员准备前**钮还在、但按不下去**，
 * 并且要有一句人话说明在等谁——不是把钮藏起来。这里逐条钉住：
 * ㈠钮存在且 `disabled`（`aria-disabled` 同步给读屏软件）＋那句话点名；
 * ㈡按下去不触发开局（不是"看着按不动、其实走进了 store"）；
 * ㈢客人退掉／判成掉线 ⇒ 闸门当场重算，不出现"永远等一个已经不在的人"；
 * ㈣本地热座与客人那台机器**一个字都不受影响**——那颗钮照旧一按就走。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Lobby from './Lobby';
import type { NetPeer, NetReadyRow } from '../network/netProtocol';
import { attachRoom, detachRoom, receiveReadyTable, type ActiveRoom } from '../network/netRoom';
import { useGameStore } from '../store/gameStore';

const HOST_ID = 'host-1';
const GUEST_A: NetPeer = { id: 'a', name: '客人甲', role: 'guest' };
const GUEST_B: NetPeer = { id: 'b', name: '客人乙', role: 'guest' };

function room(role: 'host' | 'guest', peers: NetPeer[]): ActiveRoom {
  const connection = {
    state: { role, selfId: role === 'host' ? HOST_ID : 'a', name: '甲', roomCode: 'ROOMAA', phase: 'in-room', note: '', peers },
    leave: vi.fn(),
    send: vi.fn(() => true),
  };
  return {
    role,
    name: '甲',
    roomCode: 'ROOMAA',
    address: 'ws://x',
    url: 'ws://x/ROOMAA',
    connection: connection as never,
  };
}

const startButton = () => screen.getByRole('button', { name: /开始游戏/ });
const body = () => document.body.textContent ?? '';

afterEach(() => {
  cleanup();
  detachRoom();
  useGameStore.setState({ phase: 'menu' });
});

describe('本地热座（没开联机房）：那颗钮的形状一个字不许变', () => {
  it('钮是亮的、点了就进掷骰，而且一句关于准备的话都不冒出来', () => {
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    expect(startButton().hasAttribute('disabled')).toBe(false);
    expect(startButton().getAttribute('aria-disabled')).toBe('false');
    expect(body()).not.toContain('还在等');
    expect(body()).not.toContain('我准备好了');

    fireEvent.click(startButton());
    expect(useGameStore.getState().phase).toBe('diceRoll');
  });

  it('本地那套即使残留着一张别人的准备表也不算闸门（没房间这根线＝不适用）', () => {
    receiveReadyTable([{ peer: 'a', name: '客人甲', on: false, counted: true }]);
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    expect(startButton().hasAttribute('disabled')).toBe(false);
    fireEvent.click(startButton());
    expect(useGameStore.getState().phase).toBe('diceRoll');
  });
});

describe('房主那台机器：客人没点齐 ⇒ 钮按不下去，但话说清楚了在等谁', () => {
  const NONE_READY: NetReadyRow[] = [
    { peer: 'a', name: '客人甲', on: false, counted: true },
    { peer: 'b', name: '客人乙', on: false, counted: true },
  ];

  it('钮**存在**而且被按住：不是藏起来（判据㈠的正半句）', () => {
    attachRoom(room('host', [GUEST_A, GUEST_B]));
    receiveReadyTable(NONE_READY);
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    const button = startButton();
    expect(button).toBeTruthy();
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('那句话把还没点的人一个个数出来，顺序就是名册顺序', () => {
    attachRoom(room('host', [GUEST_A, GUEST_B]));
    receiveReadyTable(NONE_READY);
    render(<Lobby />);
    expect(body()).toContain('还在等');
    expect(body()).toContain('客人甲、客人乙');
    expect(body()).toContain('他们点完这颗钮才会亮');
  });

  it('按下去 store 一格也不动（不是"看着按不动、其实走进了开局"）', () => {
    attachRoom(room('host', [GUEST_A]));
    receiveReadyTable([{ peer: 'a', name: '客人甲', on: false, counted: true }]);
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    fireEvent.click(startButton());
    expect(useGameStore.getState().phase).toBe('lobby');
  });

  it('点齐了 ⇒ 同一颗钮立刻亮，点了就进掷骰', () => {
    attachRoom(room('host', [GUEST_A, GUEST_B]));
    receiveReadyTable(NONE_READY);
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    expect(startButton().hasAttribute('disabled')).toBe(true);

    act(() => {
      receiveReadyTable([
        { peer: 'a', name: '客人甲', on: true, counted: true },
        { peer: 'b', name: '客人乙', on: true, counted: true },
      ]);
    });
    expect(startButton().hasAttribute('disabled')).toBe(false);
    expect(body()).toContain('可以开始');
    expect(body()).not.toContain('还在等');

    fireEvent.click(startButton());
    expect(useGameStore.getState().phase).toBe('diceRoll');
  });

  it('客人中途退掉＝那一行跟着没了：剩下那位一点准备就亮，不会永远等已经不在的人', () => {
    attachRoom(room('host', [GUEST_A, GUEST_B]));
    receiveReadyTable(NONE_READY);
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    expect(startButton().hasAttribute('disabled')).toBe(true);

    // 乙退房：名册少一位，房主重算的那张表里没有他那行了。
    act(() => { attachRoom(room('host', [GUEST_A])); });
    act(() => {
      receiveReadyTable([{ peer: 'a', name: '客人甲', on: false, counted: true }]);
    });
    expect(body()).toContain('客人甲');
    expect(body()).not.toContain('客人乙');
    expect(startButton().hasAttribute('disabled')).toBe(true);

    act(() => {
      receiveReadyTable([{ peer: 'a', name: '客人甲', on: true, counted: true }]);
    });
    expect(startButton().hasAttribute('disabled')).toBe(false);
  });

  it('房主判成掉线那位不挡路：钮亮着，而且界面说他"已经不算在内"，不是假装他点了', () => {
    attachRoom(room('host', [GUEST_A, GUEST_B]));
    act(() => {
      receiveReadyTable([
        { peer: 'a', name: '客人甲', on: true, counted: true },
        { peer: 'b', name: '客人乙', on: false, counted: false },
      ]);
    });
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    expect(startButton().hasAttribute('disabled')).toBe(false);
    expect(body()).toContain('客人乙');
    expect(body()).toContain('房主判成掉线');
    expect(body()).not.toContain('还在等');
  });

  it('表还没上墙（刚连线那一瞬）＝挡住，但绝不编出"在等谁"那份名单', () => {
    attachRoom(room('host', [GUEST_A, GUEST_B]));
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    expect(startButton().hasAttribute('disabled')).toBe(true);
    expect(body()).toContain('准备名单还在算');
    expect(body()).not.toContain('客人甲');
    expect(body()).not.toContain('已经不算在内');
  });

  it('屋里只剩纯 AI 桌那种"一个客人也没有"＝直接放行，不摆一句等谁的话', () => {
    attachRoom(room('host', []));
    act(() => { receiveReadyTable([]); });
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    expect(startButton().hasAttribute('disabled')).toBe(false);
    expect(body()).toContain('屋里没有客人');
    expect(body()).not.toContain('还在等');
  });
});

describe('客人那台机器：闸门不是他的事（他没有"开始游戏"这颗钮的管辖权）', () => {
  it('即使照抄来的表上有人没准备，客人这侧的钮照旧亮、照旧点得动', () => {
    attachRoom(room('guest', [GUEST_A, GUEST_B]));
    receiveReadyTable([{ peer: 'a', name: '客人甲', on: false, counted: true }]);
    useGameStore.setState({ phase: 'lobby' });
    render(<Lobby />);
    expect(startButton().hasAttribute('disabled')).toBe(false);
    expect(body()).not.toContain('还在等');
    fireEvent.click(startButton());
    expect(useGameStore.getState().phase).toBe('diceRoll');
  });
});
