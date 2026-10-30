/**
 * J2 房主侧接线证人：房主这边每次**局面**变化就发一份遮蔽过的快照，
 * 界面自己动一下不算变化；离开房间后不再发。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import NetRoomBridge from './NetRoomBridge';
import { attachRoom, bumpNetRoom, deliverHostAction, deliverHostDraft, deliverHostReady, detachRoom, getDraftList, getDraftProgress, getReadyTable, getSeatMap, getStartGate, type ActiveRoom } from '../network/netRoom';
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

/**
 * 切片⑤a（v2.9.25）的接线证人：那张准备表是**这根接线**发出去的，不是某个弹窗的私事。
 *
 * 要钉住的三句：房主一接上就有一张表上墙（客人不必等谁再动一下）；客人那颗钮经大厅递给
 * 这根接线、算完再上线并同时抄给房主自己那屏；名册一换就重算——「永远等一个已经不在的人」
 * 这一句在接线这一层也留了证人，因为它才是真跑起来的那条路。
 */
const tables = (sent: Record<string, unknown>[]) => wire(sent, 'readytable');

describe('NetRoomBridge：房主那张准备表从这里出', () => {
  it('接上房间那一刻就发一张并抄进那一格：客人不必等谁再动一下牌', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    expect(tables(sent)).toHaveLength(1);
    expect(tables(sent)[0].rows).toEqual([{ peer: 'g-1', name: '客人甲', on: false, counted: true }]);
    expect(getReadyTable()).toEqual([{ peer: 'g-1', name: '客人甲', on: false, counted: true }]);
    expect(getStartGate()).toEqual({ applicable: true, open: false, waiting: ['客人甲'], gone: [] });
  });

  it('客人那颗钮走大厅递给这根接线：算完上线、同时更新那一格，闸门跟着开', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(deliverHostReady({ peer: 'g-1', on: true })).toBe(true);
    await wait(10);

    expect(tables(sent)).toHaveLength(2);
    expect(tables(sent)[1].rows).toEqual([{ peer: 'g-1', name: '客人甲', on: true, counted: true }]);
    expect(getStartGate().open).toBe(true);
    expect(getStartGate().waiting).toEqual([]);
  });

  it('同一个客人把同一颗钮再点一次＝线上一条也不多发', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    deliverHostReady({ peer: 'g-1', on: true });
    await wait(10);
    const before = tables(sent).length;
    deliverHostReady({ peer: 'g-1', on: true });
    bumpNetRoom();
    await wait(30);
    expect(tables(sent)).toHaveLength(before);
  });

  it('客人退掉（名册少一位）⇒ 那一格当场换成空表、闸门当场开：不会永远等一个已经不在的人', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(getStartGate().open).toBe(false);

    // 房主那台机器的名册少了客人甲（真线路上这是 roster 那条消息，接线读的就是连接里的名册）。
    (room.connection.state.peers as Array<{ id: string }>).splice(1);
    bumpNetRoom();
    await wait(30);

    // 屋里已经没有客人可发了 ⇒ 线上不多发一条；房主自己那一格却当场换了——闸门靠这一笔开。
    expect(tables(sent)).toHaveLength(1);
    expect(getReadyTable()).toEqual([]);
    expect(getStartGate()).toEqual({ applicable: true, open: true, waiting: [], gone: [] });
  });

  it('两位客人退掉一位：剩下那位收到的是重算过的那张表，不是抱着旧的那张', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    (room.connection.state.peers as Array<{ id: string; name: string; role: 'host' | 'guest' }>)
      .push({ id: 'g-2', name: '客人乙', role: 'guest' });
    bumpNetRoom();
    await wait(30);
    expect(tables(sent).at(-1)!.rows).toEqual([
      { peer: 'g-1', name: '客人甲', on: false, counted: true },
      { peer: 'g-2', name: '客人乙', on: false, counted: true },
    ]);

    (room.connection.state.peers as Array<{ id: string }>).splice(2, 1); // 客人乙退房
    bumpNetRoom();
    await wait(30);
    expect(tables(sent)).toHaveLength(3);
    expect(tables(sent).at(-1)!.rows).toEqual([{ peer: 'g-1', name: '客人甲', on: false, counted: true }]);
    expect(getStartGate().waiting).toEqual(['客人甲']);
  });

  it('退房以后那颗钮没有去处（接线已经拆了，不往上一间房里递）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    detachRoom();

    expect(deliverHostReady({ peer: 'g-1', on: true })).toBe(false);
    expect(tables(sent)).toHaveLength(1);
  });

  it('换房间＝整套接线重建：上一间房那位客人的准备账不带进下一间', async () => {
    const first = fakeRoom(true);
    setEngine(engineState('a'));
    attachRoom(first.room);
    render(<NetRoomBridge />);
    await wait(30);
    deliverHostReady({ peer: 'g-1', on: true });
    await wait(10);
    expect(getStartGate().open).toBe(true);

    const second = fakeRoom(true);
    attachRoom(second.room);
    await wait(30);

    expect(tables(second.sent)).toHaveLength(1);
    expect(tables(second.sent)[0].rows).toEqual([{ peer: 'g-1', name: '客人甲', on: false, counted: true }]);
    expect(getStartGate().open).toBe(false);
  });
});

const progressFrames = (sent: Record<string, unknown>[]) => wire(sent, 'draftprogress');

/**
 * 切片⑤b 的接线证人：征召那一段**不住在 engineState 里**（候选名单与勾了谁都是 store 那几格），
 * 所以房主侧这根线要读的是 store，不是引擎。这里拿真 store 状态走，发的仍是同一套遮蔽口径——
 * 线上一旦出现任何将名，那格隐私证人（`netDraftProgressPrivacy.test.ts`）会先红。
 */
describe('NetRoomBridge：房主那张征召进度表从这里出', () => {
  /** 把房主那台机器摆成"正在征召、勾了 `picked` 名"（两份道具都是半身的：进度表只读座次、称呼与个数）。 */
  function setDraftTable(picked: number, phase: 'generalDraft' | 'diceRoll' = 'generalDraft') {
    const patch = {
      phase,
      draftPlayerIndex: 0,
      selectedDraftGenerals: Array.from({ length: picked }, (_, i) => ({ id: `wei_00${i}`, name: `将${i}` })),
      players: [
        { id: 1, name: '房主甲', faction: '魏', generalPool: [] },
        { id: 2, name: '客人甲', faction: '蜀', generalPool: [] },
      ],
    } as unknown as Partial<ReturnType<typeof useGameStore.getState>>;
    act(() => {
      useGameStore.setState(patch);
    });
  }

  it('接上那一刻正在征召 ⇒ 立刻发一张并抄进那一格：客人不必等房主再点一名将', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    setDraftTable(3);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    expect(progressFrames(sent)).toHaveLength(1);
    expect(progressFrames(sent)[0].rows).toEqual([
      { seat: 1, name: '房主甲', state: 'picking', picked: 3, total: 10 },
      { seat: 2, name: '客人甲', state: 'waiting', picked: 0, total: 10 },
    ]);
    expect(getDraftProgress()).toEqual(progressFrames(sent)[0].rows);
  });

  it('房主每勾一名 ⇒ 线上一帧跟着动；只是界面重绘（那几格没换）⇒ 一条也不多发', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    setDraftTable(0);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(progressFrames(sent)).toHaveLength(1);

    setDraftTable(1);
    await wait(10);
    setDraftTable(2);
    await wait(10);
    expect(progressFrames(sent)).toHaveLength(3);
    expect(progressFrames(sent).at(-1)!.rows).toMatchObject([
      { seat: 1, picked: 2, state: 'picking' },
      { seat: 2, picked: 0, state: 'waiting' },
    ]);

    // 同样的内容再 setState 一次（store 换了引用、表却没动）：房主每次点将都会问一遍，多数时候不该刷屏
    const same = useGameStore.getState().selectedDraftGenerals.slice();
    act(() => {
      useGameStore.setState({ selectedDraftGenerals: same });
    });
    await wait(10);
    expect(progressFrames(sent)).toHaveLength(3);
  });

  it('掷骰／分势力那一段这张表没话要说 ⇒ 一帧也不发（不发空表让人误以为"征召卡住了"）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    setDraftTable(0, 'diceRoll');
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(progressFrames(sent)).toHaveLength(0);
    expect(getDraftProgress()).toBeNull();

    setDraftTable(1, 'generalDraft');
    await wait(10);
    expect(progressFrames(sent)).toHaveLength(1);
  });

  it('名册变了而这张表一个字没动 ⇒ 照样重发一遍：迟来的那位一进来就得有得看', async () => {
    const { room, sent } = fakeRoom(false);
    setEngine(engineState('a'));
    setDraftTable(4);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(progressFrames(sent)).toHaveLength(1);
    const cell = getDraftProgress();

    (room.connection.state.peers as Array<{ id: string; name: string; role: 'host' | 'guest' }>)
      .push({ id: 'g-1', name: '客人甲', role: 'guest' });
    bumpNetRoom();
    await wait(30);

    expect(progressFrames(sent)).toHaveLength(2);
    expect(progressFrames(sent)[1].rows).toEqual(progressFrames(sent)[0].rows);
    // 重发给的是同一张内容 ⇒ 界面那一格不换引用（客人那屏不会为了一件没变的事重绘）
    expect(getDraftProgress()).toBe(cell);
  });

  it('退房后这张表不再往外发（接线整套拆掉，不往上一间房里递进度）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineState('a'));
    setDraftTable(1);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    detachRoom();

    setDraftTable(2);
    await wait(10);
    expect(progressFrames(sent)).toHaveLength(1);
    expect(getDraftProgress()).toBeNull();
  });
});

const draftLists = (sent: Record<string, unknown>[]) => wire(sent, 'draftlist');

/** 三席的牌桌：第 1 席房主（绑 host-1）、第 2 席那位客人（绑 g-1）；第 3 席先空着，
 *  等名册上真来了第二个人，房主这边按 join 顺序把他绑上去。
 *  ⑤c 那张名单表与 ⑤d 那条进来的路都要它，所以住在模块级（一处摆桌，两处共读）。 */
function engineTwo(): EngineState {
  const base = engineState('a');
  return {
    ...base,
    players: [
      { ...base.players[0] },
      { id: 2, name: '客人甲', faction: '蜀', hand: [{ id: 'p2-h1', name: '暗牌二号' }], baseHp: 6, isAlive: true },
      { id: 3, name: '客人乙', faction: '吴', hand: [{ id: 'p3-h1', name: '暗牌三号' }], baseHp: 6, isAlive: true },
    ],
  } as EngineState;
}

/**
 * 切片⑤c 的接线证人：逐席候选名单**按人各算一帧、指名发**。
 * 这里量的是接线那三件事——席位从哪张表读、`to` 填的是谁、房主自己那屏为什么不抄这一格；
 * 帧里该装什么住 `netDraftList`，"别席漏没漏"住 `netDraftListPrivacy.test.ts`。
 */
describe('NetRoomBridge：逐席候选名单按人指名发从这里出', () => {
  /** 房主那台机器摆成"正在征召第 `draftPlayerIndex` 席、勾了 `picked` 名"（名单里全是本会话编的假将，真名由隐私证人管）。 */
  function setDraftLists(picked: number, draftPlayerIndex = 0, phase: 'generalDraft' | 'diceRoll' = 'generalDraft') {
    const main = Array.from({ length: 2 }, (_, i) => ({ id: `wei_00${i}`, name: `假将${i}`, faction: '魏', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: [{ name: '假技能' }] }));
    const qun = [{ id: 'qun_000', name: '假群将', faction: '群', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: [] }];
    const patch = {
      phase,
      draftPlayerIndex,
      draftGenerals: main,
      draftQunGenerals: qun,
      selectedDraftGenerals: [...main.slice(0, Math.min(picked, 2)), ...(picked > 2 ? qun : [])],
      players: [
        { id: 1, name: '房主甲', faction: '魏', generalPool: [] },
        { id: 2, name: '客人甲', faction: '蜀', generalPool: [] },
        { id: 3, name: '客人乙', faction: '吴', generalPool: [] },
      ],
    } as unknown as Partial<ReturnType<typeof useGameStore.getState>>;
    act(() => {
      useGameStore.setState(patch);
    });
    return { main, qun };
  }

  it('接上那一刻正在征召第 1 席 ⇒ 屋里每位客人各收**指名给他**的一帧；第 2 席那一帧是"还没轮到你"、一张牌也没有', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    setDraftLists(1);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);

    const frames = draftLists(sent);
    expect(frames).toHaveLength(1); // 屋里只有 g-1 这一位客人（房主那一格不经过这条线）
    expect(frames[0].to).toBe('g-1');
    expect(frames[0].from).toBe('host-1');
    expect(frames[0].seat).toBe(2);
    expect(frames[0].main).toEqual([]);
    expect(frames[0].instruction).toContain('还没轮到你这一席');
  });

  it('房主确认到第 2 席 ⇒ 他那一帧真的带上他自己的名单（"名单送到位"就是这一条）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    const { main } = setDraftLists(1);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(draftLists(sent)[0].main).toEqual([]);

    setDraftLists(0, 1);
    await wait(10);
    const last = draftLists(sent).at(-1)!;
    expect(last.to).toBe('g-1');
    expect(last.seat).toBe(2);
    expect((last.main as Array<{ name: string }>).map((i) => i.name)).toEqual([main[0].name, main[1].name]);
  });

  it('房主自己那屏不抄这一格：他是出处，看的是真的征召面板（同一张桌上不许出现两份读数）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    setDraftLists(2);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(draftLists(sent)).toHaveLength(1);
    expect(getDraftList()).toBeNull();
  });

  it('只是界面重绘（store 换了引用、每一格都没换）⇒ 一条也不多发', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    setDraftLists(1);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(draftLists(sent)).toHaveLength(1);

    const same = useGameStore.getState().draftGenerals.slice();
    act(() => {
      useGameStore.setState({ draftGenerals: same });
    });
    await wait(10);
    expect(draftLists(sent)).toHaveLength(1);
  });

  it('掷骰那一段：每位客人各收一句"现在不在征召那一段"，之后一直不发（不是发一张编出来的名单）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    setDraftLists(0, 0, 'diceRoll');
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(draftLists(sent)).toHaveLength(1);
    expect(draftLists(sent)[0].instruction).toContain('现在不在征召那一段');
    expect(draftLists(sent)[0].main).toEqual([]);

    setDraftLists(0, 0, 'diceRoll');
    await wait(10);
    expect(draftLists(sent)).toHaveLength(1);
  });

  it('名册变了而每一帧一字未动 ⇒ 逐人重发一遍：迟来的那位一进来就得看得见自己那一格', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    setDraftLists(1);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    expect(draftLists(sent)).toHaveLength(1);

    (room.connection.state.peers as Array<{ id: string; name: string; role: 'host' | 'guest' }>)
      .push({ id: 'g-2', name: '客人乙', role: 'guest' });
    bumpNetRoom();
    await wait(30);

    const frames = draftLists(sent);
    expect(frames).toHaveLength(3); // g-1 那帧重发一遍 + 新来的那位一帧
    expect(frames[1].to).toBe('g-1');
    expect(frames[2].to).toBe('g-2');
    expect(frames[2].seat).toBe(3);
  });

  it('退房后这一格不再往外发（接线整套拆掉，不往上一间房里递别人的名单）', async () => {
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    setDraftLists(1);
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    detachRoom();

    setDraftLists(0, 1);
    await wait(10);
    expect(draftLists(sent)).toHaveLength(1);
  });
});

/** 腿3（⑤d）那一趟要的接线证人：客人交回来的那一条，最后动的是**房主这台机器上的 store**。
 *  判据住 `netDraftList`、发布者住 `netHostDraftList`，这两处都已经在自己的证人对里量过；
 *  这里只量接线那三件只有拼起来才看得到的事——
 *  ㈠`deliverHostDraft` 真被挂到那位发布者身上（没挂上＝客人点了没反应，连句拒话都没处说）；
 *  ㈡办事用的是 store 自己那颗 `selectDraftGeneral`／`confirmDraft`，落进池子的是**店里那几张对象**；
 *  ㈢没办成的那一条，店里的账一个字节也不动，而回给他的那一帧里带着为什么。 */
describe('NetRoomBridge：客人交回来的点将／确认走的是房主自己那颗', () => {
  /** 摆一份"第 2 席（那位客人绑的席位）正在挑、名单有 `mainN`＋`qunN` 张、勾了 `pickMain`＋`pickQun` 颗"的房主店。 */
  function draftStore(o: { mainN: number; qunN: number; pickMain: number; pickQun: number; draftPlayerIndex?: number }) {
    const main = Array.from({ length: o.mainN }, (_, i) => ({
      id: `wei_${String(i).padStart(3, '0')}`, name: `假将${i}`, faction: '魏', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: [{ name: '假技能' }],
    }));
    const qun = Array.from({ length: o.qunN }, (_, i) => ({
      id: `qun_${String(i).padStart(3, '0')}`, name: `假群${i}`, faction: '群', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: [],
    }));
    act(() => {
      useGameStore.setState({
        phase: 'generalDraft',
        draftPlayerIndex: o.draftPlayerIndex ?? 1, // 默认轮到第 2 席＝那位客人绑的那一席
        draftGenerals: main,
        draftQunGenerals: qun,
        selectedDraftGenerals: [...main.slice(0, o.pickMain), ...qun.slice(0, o.pickQun)],
        players: [
          { id: 1, name: '房主甲', faction: '魏', generalPool: [] },
          { id: 2, name: '客人甲', faction: '蜀', generalPool: [] },
          { id: 3, name: '客人乙', faction: '吴', generalPool: [] },
        ],
      } as unknown as Partial<ReturnType<typeof useGameStore.getState>>);
    });
    return { main, qun };
  }

  /** 接上房主那套接线（屋里只有 g-1 一位客人，他绑第 2 席）。 */
  async function wired() {
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    return { sent };
  }

  it('客人点中自己那一帧上的号 ⇒ 店里真多了那一张（同一个对象），线上多出的那一帧把它标成「已选」', async () => {
    const cards = draftStore({ mainN: 3, qunN: 1, pickMain: 0, pickQun: 0 });
    const { sent } = await wired();
    expect(draftLists(sent).at(-1)!.main).toHaveLength(3); // 正面凭据：他那一格真带着三份候选

    expect(deliverHostDraft({ kind: 'pick', peer: 'g-1', key: 'm2' })).toBe(true);
    await wait(10);
    // ⚠️ 派单第 5 条的硬证：线上传的只有 `m2` 这一个号，落进店里的是 `draftGenerals[2]` 这**一个**对象。
    expect(useGameStore.getState().selectedDraftGenerals).toEqual([cards.main[2]]);
    const last = draftLists(sent).at(-1)!;
    expect(last.to).toBe('g-1');
    expect(last.picked).toEqual(['m2']);
    expect(JSON.stringify(last)).not.toContain('wei_002'); // 档案号压根没上线，也没因为他点了一下就多上线
  });

  it('还没轮到他那一席 ⇒ 店里的账一字不动，回给他的那一帧里写着为什么（拒不得静默）', async () => {
    const cards = draftStore({ mainN: 3, qunN: 1, pickMain: 1, pickQun: 0, draftPlayerIndex: 0 });
    const { sent } = await wired();
    const before = useGameStore.getState().selectedDraftGenerals;

    // 这一格返回的是"房主那侧有没有人接手"（`deliverHostDraft` 与上面那两格同一个口径），不是"这一条办没办"。
    expect(deliverHostDraft({ kind: 'pick', peer: 'g-1', key: 'm0' })).toBe(true);
    await wait(10);
    expect(useGameStore.getState().selectedDraftGenerals).toBe(before);
    expect(useGameStore.getState().draftPlayerIndex).toBe(0);
    const last = draftLists(sent).at(-1)!;
    expect(last.to).toBe('g-1');
    expect(last.instruction).toContain('不是轮到你这一席');
    // 那句拒话只换那一行字：他手上那一帧的名单还在（不许顺手把他的屏清空）。
    expect(last.main).toHaveLength(0); // 第 2 席本来就没轮到，房主发的这一格就是空的——这是既有读数，不是被拒话改掉的
    expect(cards.qun).toHaveLength(1);
  });

  it('那个号不在我发给他的那一帧上 ⇒ 不办事，也不给他补一张牌；那一格里回的是"不在名单上"', async () => {
    draftStore({ mainN: 3, qunN: 1, pickMain: 0, pickQun: 0 });
    const { sent } = await wired();
    expect(deliverHostDraft({ kind: 'pick', peer: 'g-1', key: 'm9' })).toBe(true);
    await wait(10);
    expect(useGameStore.getState().selectedDraftGenerals).toEqual([]);
    expect(draftLists(sent).at(-1)!.instruction).toContain('不在我发给你的那份名单上');
    expect(draftLists(sent).at(-1)!.main).toHaveLength(3);
  });

  it('凑够了才让他交卷：房主自己先把闸算一遍，然后 store 真把这一席的池子定下来、光标走到下一席', async () => {
    const cards = draftStore({ mainN: 9, qunN: 1, pickMain: 9, pickQun: 1 });
    const { sent } = await wired();
    expect(draftLists(sent).at(-1)!.canConfirm).toBe(true); // 正面凭据：房主那句"凑够了"已经上过线

    expect(deliverHostDraft({ kind: 'confirm', peer: 'g-1' })).toBe(true);
    await wait(10);
    const s = useGameStore.getState();
    expect(s.players[1].generalPool).toHaveLength(10);
    expect(s.draftPlayerIndex).toBe(2);
    // 交完卷，他那一格当场换成"已经完成"——不是客人屏自己猜的。
    expect(draftLists(sent).at(-1)!.instruction).toContain('你这一席的征召已经完成了');
    expect(s.players[1].generalPool.map((g) => g.name)).toEqual(
      [...cards.main, ...cards.qun].map((g) => g.name),
    );
  });

  it('没凑够就交卷 ⇒ 房主不转交：池子还是空的，那一格里回的是"还差几名"', async () => {
    draftStore({ mainN: 9, qunN: 1, pickMain: 3, pickQun: 1 });
    const { sent } = await wired();
    expect(draftLists(sent).at(-1)!.canConfirm).toBe(false);

    expect(deliverHostDraft({ kind: 'confirm', peer: 'g-1' })).toBe(true); // 递到了，但房主没办——办的凭据在下面那两行
    await wait(10);
    expect(useGameStore.getState().players[1].generalPool).toEqual([]);
    expect(useGameStore.getState().draftPlayerIndex).toBe(1);
    expect(draftLists(sent).at(-1)!.instruction).toContain('还交不了卷：现在 4/10 名、群势力 1 名');
  });

  it('退房以后那颗钮没有去处（接线拆了＝这一条连递都递不到，不往上一间房的店里写）', async () => {
    draftStore({ mainN: 3, qunN: 1, pickMain: 0, pickQun: 0 });
    const { room, sent } = fakeRoom(true);
    setEngine(engineTwo());
    attachRoom(room);
    render(<NetRoomBridge />);
    await wait(30);
    detachRoom();

    expect(deliverHostDraft({ kind: 'pick', peer: 'g-1', key: 'm0' })).toBe(false);
    expect(useGameStore.getState().selectedDraftGenerals).toEqual([]);
    expect(draftLists(sent)).toHaveLength(1);
  });
});
