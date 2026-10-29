/**
 * J2 房主侧接线证人：房主这边每次**局面**变化就发一份遮蔽过的快照，
 * 界面自己动一下不算变化；离开房间后不再发。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import NetRoomBridge from './NetRoomBridge';
import { attachRoom, bumpNetRoom, deliverHostAction, detachRoom, getSeatMap, type ActiveRoom } from '../network/netRoom';
import type { RoomConnection } from '../network/netSession';
import type { EngineState } from '../core/GameState';
import { useGameStore, type Player } from '../store/gameStore';

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

/** 按信封类型挑出线上的那几条。J2 那四条证人原本直接数 `sent` 的总条数，
 *  v2.9.25 起房主接上那一刻**除了快照还会发一份席位表**（客人重进房时看不到
 *  "还没收到席位表"就是靠它），所以这里按类型数——快照那条断言的强度一字不降。 */
const wire = (sent: Record<string, unknown>[], type: string) => sent.filter((e) => e.t === type);
const snapshots = (sent: Record<string, unknown>[]) => wire(sent, 'snapshot');

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

    expect(snapshots(sent)).toHaveLength(1); // 刚接上就补发一份当下的，不让客人干等
    // 切片③之后线上第一条是**席位表**（快照要按席位各出一份，得先有那张表），
    // 所以这里读的是第一条快照，不再读第一条消息——遮蔽那条断言的强度一字不降。
    const first = snapshots(sent)[0];
    expect(JSON.stringify(first)).not.toContain('暗牌一号');
    expect((first.state as EngineState).players[0].hand).toHaveLength(1);

    setEngine(engineState('b'));
    await wait(300); // 没满间隔的那一笔 ⇒ 到点补发当下这份
    expect(snapshots(sent)).toHaveLength(2);
    expect((snapshots(sent)[1].state as EngineState).round).toBe(3);

    setEngine(engineState('c'));
    await wait(300);
    expect(snapshots(sent)).toHaveLength(3);
    expect((snapshots(sent)[2].state as EngineState).round).toBe(2);
  });

  it('只是界面在动（engineState 引用没换）⇒ 一条快照都不发', async () => {
    const { room, sent } = fakeRoom(true);
    const fixed = engineState('a');
    setEngine(fixed);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(snapshots(sent)).toHaveLength(1);

    act(() => {
      useGameStore.setState({ currentRound: 9 });
    });
    act(() => {
      useGameStore.setState({ engineState: fixed });
    });
    await wait(300);
    expect(snapshots(sent)).toHaveLength(1);
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
    expect(snapshots(sent)).toHaveLength(1);
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
    expect(snapshots(sent)).toHaveLength(1);
  });
});

/**
 * J4 的接线证人：两把椅子（房主坐第一席、客人坐第二席）时，房主这边除了快照，
 * 还要发得出席位表与清单；客人拿**房主自己发出去的那个编号**交回来，牌桌真的动。
 * 编号是从线上取回来的（不是测试自己算的），所以这两条证的是一整条路，不只是拼装。
 */
function twoSeatEngine(): EngineState {
  const seat = (id: number, name: string) => ({
    id, name, faction: '蜀', isAlive: true, isAi: false,
    hand: [], generalPool: [], fieldGenerals: [], graveyard: [], baseHp: 6, baseMaxHp: 6, statuses: [],
  });
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [seat(1, '房主甲'), seat(2, '客人甲')],
    currentPlayerId: 2,
    turn: 3,
    round: 2,
    deck: [],
    discardPile: [],
    drawState: null,
    rngState: { s: 4242 },
    metadata: { roomId: 'ROOMAA' },
  } as unknown as EngineState;
}

/**
 * 摆一张真的轮到第二席的牌桌。按生产镜像口径装（`gameStoreRecovery.test.ts` 同一条：
 * 展示 `players` 与 `engineState` 同一份引用、游标指到第二席）——
 * 因为 `endTurn()` 认的是 store 那一侧的当前玩家，两边必须一致，否则证的是假桌。
 */
function installTwoSeatTable() {
  const engineState = twoSeatEngine();
  act(() => {
    useGameStore.setState({
      phase: 'playing',
      turnPhase: 'main',
      playerCount: 2,
      engineState,
      players: engineState.players as unknown as Player[],
      currentPlayerIndex: 1,
      currentRound: engineState.round,
      turnEndAsk: null,
      reactionWindow: null,
      pendingTurnTransition: null,
      drawContext: null,
      revealedDrawCards: [],
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });
  return engineState;
}

describe('NetRoomBridge：J4 席位表、清单与客人交回来的一步', () => {
  it('两把椅子 ⇒ 接上那一刻除了快照，还发出席位表与指名给客人的清单', async () => {
    const { room, sent } = fakeRoom(true);
    installTwoSeatTable();
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    expect(wire(sent, 'snapshot')).toHaveLength(1);
    expect(wire(sent, 'seatmap')).toEqual([
      { t: 'seatmap', from: 'host-1', seats: [{ peer: 'host-1', seat: 1, name: '房主甲' }, { peer: 'g-1', seat: 2, name: '客人甲' }] },
    ]);
    const lists = wire(sent, 'moves');
    expect(lists).toHaveLength(1);
    expect(lists[0].to).toBe('g-1');
    expect(lists[0].seat).toBe(2);
    expect(JSON.stringify(lists[0].items)).toContain('结束回合');
  });

  it('第二席还没排到人 ⇒ 席位表照样发出去，而且只发一次（2026-10-28 两台机器实测：重进房的客人看到"还没收到席位表"）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a')); // 桌上只有一把能坐人的椅子，且绑的是房主自己
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    // 老代码把补发挡在"这一席有没有绑到客人"后面：客人一席都没绑 ⇒ 一条都不发，
    // 那一屏就同时写着"还没收到席位表"和"椅子还没排到你"。表本身是真的，必须照发。
    expect(wire(sent, 'seatmap')).toEqual([
      { t: 'seatmap', from: 'host-1', seats: [{ peer: 'host-1', seat: 1, name: '房主甲' }] },
    ]);

    // 发过一次就按人头记账：牌动一下（表还是那张表）不该再追着人补发。
    setEngine(engineState('b'));
    await wait(300);
    expect(wire(sent, 'seatmap')).toHaveLength(1);
  });

  it('客人点房主发出去的那个编号 ⇒ 走房主自己那份动作，牌桌真的动了', async () => {
    const { room, sent } = fakeRoom(true);
    installTwoSeatTable();
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    const items = wire(sent, 'moves')[0].items as { key: string; label: string }[];
    const endTurn = items.find((i) => i.label === '⏭️结束回合');
    expect(endTurn).toBeTruthy();

    act(() => {
      expect(deliverHostAction({ peer: 'g-1', seat: 2, key: endTurn!.key })).toBe(true);
    });
    await wait(30);

    expect(wire(sent, 'actno')).toHaveLength(0);
    expect(useGameStore.getState().engineState.currentPlayerId).toBe(1);
    // 牌桌动了 ⇒ 清单换新那一份（旧编号作废这件事要马上发出去）。
    expect(wire(sent, 'moves').length).toBeGreaterThan(1);
  });

  it('客人报了个房主这边算不出的编号 ⇒ 退回并说明，牌桌一字节也不动', async () => {
    const { room, sent } = fakeRoom(true);
    installTwoSeatTable();
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    const before = JSON.stringify(useGameStore.getState().engineState);
    act(() => {
      deliverHostAction({ peer: 'g-1', seat: 2, key: '0-END_TURN:ffffffff' });
    });
    await wait(30);

    const back = wire(sent, 'actno');
    expect(back).toHaveLength(1);
    expect(back[0].to).toBe('g-1');
    expect(String(back[0].reason)).toContain('已经不成立');
    expect(JSON.stringify(useGameStore.getState().engineState)).toBe(before);
  });

  it('客人坐的那一席不是他（房主自己那一格）⇒ 拒绝，并说明是别人坐着的', async () => {
    const { room, sent } = fakeRoom(true);
    installTwoSeatTable();
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    act(() => {
      deliverHostAction({ peer: 'g-1', seat: 1, key: 'whatever-key' });
    });
    await wait(30);
    const back = wire(sent, 'actno');
    expect(String(back[0].reason)).toContain('绑的是别人');
    expect(useGameStore.getState().engineState.currentPlayerId).toBe(2);
  });

  it('房主那屏也看得见这张席位表，而且就是发出去的那一份（真机实测发现算表的人自己看不见）', async () => {
    const { room, sent } = fakeRoom(true);
    installTwoSeatTable();
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    expect(getSeatMap()).toEqual(wire(sent, 'seatmap')[0].seats);

    // 客人走了一步 ⇒ 表还是那张表（谁坐哪一席没动），引用不该换、界面不该重画。
    const items = wire(sent, 'moves')[0].items as { key: string; label: string }[];
    const before = getSeatMap();
    act(() => {
      deliverHostAction({ peer: 'g-1', seat: 2, key: items.find((i) => i.label === '⏭️结束回合')!.key });
    });
    await wait(30);
    expect(getSeatMap()).toBe(before);
  });

  it('切片③：发给客人那一条是指名的，而且放开的正是他那一席的牌', async () => {
    const { room, sent } = fakeRoom(true);
    installTwoSeatTable();
    // 两席各装一张手牌与一员征召候选：放开谁、遮谁，一眼分得开。
    act(() => {
      const engine = useGameStore.getState().engineState;
      useGameStore.setState({
        engineState: {
          ...engine,
          players: engine.players.map((p) => ({
            ...p,
            hand: [{ id: `c-${p.id}`, name: `手牌-${p.id}` }],
            generalPool: [{ id: `g-${p.id}`, name: `候选-${p.id}` }],
          })),
        } as EngineState,
      });
    });
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    const shot = wire(sent, 'snapshot');
    expect(shot).toHaveLength(1);
    expect(shot[0].to).toBe('g-1'); // 指名给屋里那位客人（他坐第 2 席）
    const payload = JSON.stringify(shot[0].state);
    expect(payload).toContain('手牌-2');
    expect(payload).toContain('候选-2');
    expect(payload).not.toContain('手牌-1'); // 房主那一席对他而言也是"别人"
    expect(payload).not.toContain('候选-1');
  });

  it('退房时把接走的活也放下（不再有人递请求过来）', async () => {
    const { room, sent } = fakeRoom(true);
    installTwoSeatTable();
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    detachRoom();

    expect(deliverHostAction({ peer: 'g-1', seat: 2, key: '0-END_TURN:ffffffff' })).toBe(false);
    expect(wire(sent, 'actno')).toHaveLength(0);
  });
});
