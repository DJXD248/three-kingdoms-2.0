/**
 * J2 房主侧接线证人：房主这边每次**局面**变化就发一份遮蔽过的快照，
 * 界面自己动一下不算变化；离开房间后不再发。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import NetRoomBridge from './NetRoomBridge';
import { attachRoom, detachRoom, bumpNetRoom, type ActiveRoom } from '../network/netRoom';
import type { RoomConnection } from '../network/netSession';
import type { EngineState } from '../core/GameState';
import { useGameStore } from '../store/gameStore';

function engineState(marker: string): EngineState {
  return {
    version: 1,
    phase: marker,
    timelinePhase: 'ACTION',
    players: [{ id: 1, name: '房主甲', faction: '蜀', hand: [{ id: 'p1-h1', name: '暗牌一号' }], baseHp: 6, isAlive: true }],
    currentPlayerId: 1,
    turn: 3,
    round: marker === 'b' ? 3 : 2,
    deck: [],
    discardPile: [],
    metadata: { roomId: 'ROOMAA' },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeRoom(withGuest: boolean): { room: ActiveRoom; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  const connection = {
    state: {
      role: 'host' as const,
      selfId: 'host-1',
      name: '房主甲',
      roomCode: 'ROOMAA',
      phase: 'in-room' as const,
      note: '',
      peers: withGuest
        ? [{ id: 'host-1', name: '房主甲', role: 'host' as const }, { id: 'g-1', name: '客人甲', role: 'guest' as const }]
        : [{ id: 'host-1', name: '房主甲', role: 'host' as const }],
    },
    leave: vi.fn(),
    send: (envelope: { t: string; from: string; state: Record<string, unknown> }) => {
      sent.push(envelope as unknown as Record<string, unknown>);
      return true;
    },
  };
  return { room: { role: 'host', name: '房主甲', roomCode: 'ROOMAA', address: 'ws://x', url: 'ws://x/ROOMAA', connection: connection as unknown as RoomConnection }, sent };
}

function setEngine(state: EngineState) {
  act(() => {
    useGameStore.setState({ engineState: state });
  });
}

afterEach(() => {
  detachRoom();
  vi.useRealTimers();
});

describe('NetRoomBridge：房主每次局面变化发一份', () => {
  it('房主连着房间、里面有客人 ⇒ 落一笔新事实就发一条快照，且发的是遮蔽过的', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    expect(sent).toHaveLength(1); // 刚接上就补发一份当下的，不让客人干等
    expect(sent[0].t).toBe('snapshot');
    expect(JSON.stringify(sent[0])).not.toContain('暗牌一号');
    expect((sent[0].state as EngineState).players[0].hand).toHaveLength(1);

    setEngine(engineState('b'));
    await wait(300); // 没满间隔的那一笔 ⇒ 到点补发当下这份
    expect(sent).toHaveLength(2);
    expect((sent[1].state as EngineState).round).toBe(3);

    setEngine(engineState('c'));
    await wait(300);
    expect(sent).toHaveLength(3);
    expect((sent[2].state as EngineState).round).toBe(2);
  });

  it('只是界面在动（engineState 引用没换）⇒ 一条都不发', async () => {
    const { room, sent } = fakeRoom(true);
    const fixed = engineState('a');
    setEngine(fixed);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(sent).toHaveLength(1);

    act(() => {
      useGameStore.setState({ currentRound: 9 });
    });
    act(() => {
      useGameStore.setState({ engineState: fixed });
    });
    await wait(300);
    expect(sent).toHaveLength(1);
  });

  it('房间里没有客人 ⇒ 什么都不发；客人进来那一刻补发当下这一份', async () => {
    const { room, sent } = fakeRoom(false);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(sent).toHaveLength(0);

    // 客人报到 ⇒ 名册变了（bumpNetRoom 由大厅的连线回调发出）
    (room.connection.state.peers as Array<{ id: string; name: string; role: 'host' | 'guest' }>)
      .push({ id: 'g-2', name: '客人乙', role: 'guest' });
    bumpNetRoom();
    await wait(30);
    expect(sent).toHaveLength(1);
  });

  it('退房之后不再发（离开房间不留后台发件人）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    detachRoom();
    setEngine(engineState('b'));
    await wait(300);
    setEngine(engineState('c'));
    await wait(30);
    expect(sent).toHaveLength(1);
  });
});
