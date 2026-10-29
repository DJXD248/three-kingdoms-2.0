/**
 * J4 房主侧把关的证人（v2.9.11）。
 *
 * 这一格唯一要钉住的是那句话：**客人送来的字节不作数**。所以每条证人都在问同一个问题——
 * 房主是拿"自己当下重算出来的那一批编号"去比，还是拿客人给的什么东西去比。
 * 探针（`probe`）与执行（`execute`）都从外面进来：这里测的是接线，不是引擎。
 */
import { describe, expect, it, vi } from 'vitest';
import { createAction, type GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import { startHostAuthority } from './netHostAuthority';
import { moveKey } from './netSeat';
import type { NetEnvelope, NetPeer, NetSeatRow } from './netProtocol';

const HOST: NetPeer = { id: 'host-1', name: '房主甲', role: 'host' };
const GUEST: NetPeer = { id: 'guest-1', name: '客人甲', role: 'guest' };
const OTHER: NetPeer = { id: 'guest-2', name: '客人乙', role: 'guest' };

type SeatFlag = { id: number; name: string; isAi?: boolean };
const TWO_SEATS: SeatFlag[] = [{ id: 1, name: '房主甲' }, { id: 2, name: '客人甲' }];
const THREE_SEATS: SeatFlag[] = [{ id: 1, name: '房主甲' }, { id: 2, name: '客人甲' }, { id: 3, name: '客人乙' }];

function engine(seats: SeatFlag[] = TWO_SEATS): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: seats.map((s) => ({
      id: s.id, name: s.name, isAi: s.isAi === true, hand: [], fieldGenerals: [], baseHp: 6, isAlive: true,
    })),
    currentPlayerId: 1,
    turn: 3,
    round: 2,
    deck: [],
    discardPile: [],
    metadata: { roomId: 'ROOMAA' },
  } as unknown as EngineState;
}

/** 一桌只有电脑在打：没有一把能坐人的椅子。 */
const ALL_AI: SeatFlag[] = [{ id: 1, name: 'AI 甲', isAi: true }, { id: 2, name: 'AI 乙', isAi: true }];

function frames(sent: NetEnvelope[], type: string): Record<string, unknown>[] {
  return sent.filter((e) => e.t === type) as unknown as Record<string, unknown>[];
}

function setup(opts: {
  peers?: NetPeer[];
  seats?: SeatFlag[];
  probeFor?: (seat: number) => GameAction[];
  execute?: (seat: number, action: GameAction) => boolean;
} = {}) {
  const seats = opts.seats ?? TWO_SEATS;
  const sent: NetEnvelope[] = [];
  /** 抄给房主自己那屏的那一份（每次真正算出非空席位表时进来一次）。 */
  const toScreen: NetSeatRow[][] = [];
  let state = engine(seats);
  const peers = opts.peers ?? [HOST, GUEST];
  const probe = vi.fn(opts.probeFor ?? (() => [createAction('END_TURN', 2)]));
  const execute = vi.fn(opts.execute ?? (() => true));
  const auth = startHostAuthority({
    selfId: () => HOST.id,
    peers: () => peers,
    readState: () => state,
    probe: (seat) => probe(seat),
    execute,
    send: (envelope) => {
      sent.push(envelope);
      return true;
    },
    seatMapSink: (rows) => {
      toScreen.push(rows);
    },
  });
  return {
    auth,
    sent,
    probe,
    execute,
    toScreen,
    frames: (type: string) => frames(sent, type),
    /** 换一份新局面（引用一定变），并通知接线——等价于 store 落了一笔事实。 */
    changeState: () => {
      state = engine(seats);
      auth.notifyChange();
    },
  };
}

describe('发席位表与清单', () => {
  it('客人进房 ⇒ 发一张席位表，并只给客人那一席算清单（房主自己那格是本机点的，不发）', () => {
    const s = setup();
    s.auth.syncNow();
    expect(s.frames('seatmap')).toEqual([
      { t: 'seatmap', from: HOST.id, seats: [{ peer: HOST.id, seat: 1, name: '房主甲' }, { peer: GUEST.id, seat: 2, name: '客人甲' }] },
    ]);
    const moves = s.frames('moves');
    expect(moves).toHaveLength(1);
    expect(moves[0].from).toBe(HOST.id);
    expect(moves[0].to).toBe(GUEST.id);
    expect(moves[0].seat).toBe(2);
    expect(moves[0].omitted).toBe(0);
    expect((moves[0].items as { label: string }[])[0].label).toBe('⏭️结束回合');
  });

  it('房主自己那屏拿到的是线上同一份表（算表的人不该是唯一看不见它的人）', () => {
    const s = setup();
    s.auth.syncNow();
    expect(s.toScreen).toHaveLength(1);
    // 逐字对：抄过去的那一份与发给客人的 seatmap 帧里的 seats 必须完全同一个内容。
    expect(s.toScreen[0]).toEqual(s.frames('seatmap')[0].seats);
  });

  it('桌上全是电脑 ⇒ 这张表压根没有席位，房主那屏也不抄（不给他看一张空表）', () => {
    const s = setup({ seats: ALL_AI });
    s.auth.syncNow();
    expect(s.toScreen).toHaveLength(0);
    expect(s.frames('seatmap')).toHaveLength(0);
  });

  it('局面引用没动（只是界面在动）⇒ 一次也不重算，不重发', () => {
    const s = setup();
    s.auth.syncNow();
    const probes = s.probe.mock.calls.length;
    s.auth.notifyChange();
    s.auth.notifyChange();
    expect(s.probe.mock.calls.length).toBe(probes);
    expect(s.frames('moves')).toHaveLength(1);
  });

  it('局面变了但两份内容一样 ⇒ 发之前先比一次，一个字节也不重发', () => {
    const s = setup();
    s.auth.syncNow();
    s.changeState();
    expect(s.frames('seatmap')).toHaveLength(1);
    expect(s.frames('moves')).toHaveLength(1);
  });

  it('清单真的变了 ⇒ 重发新的那一份，编号跟着换', () => {
    let turnEnd = true;
    const s = setup({ probeFor: () => (turnEnd ? [createAction('END_TURN', 2)] : [createAction('SURRENDER', 2)]) });
    s.auth.syncNow();
    turnEnd = false;
    s.changeState();
    const lists = s.frames('moves');
    expect(lists).toHaveLength(2);
    expect((lists[1].items as { label: string }[])[0].label).toBe('🏳️确认投降');
  });

  it('一位客人离开、房里还有别人 ⇒ 留下的那位收到新席位表，那一格写回"本机在点"', () => {
    const peers = [HOST, GUEST, OTHER];
    const s = setup({ peers, seats: THREE_SEATS });
    s.auth.syncNow();
    peers.splice(2, 1);
    s.auth.syncNow();
    const maps = s.frames('seatmap');
    expect(maps).toHaveLength(2);
    expect((maps[1].seats as NetSeatRow[])[2]).toEqual({ peer: null, seat: 3, name: '客人乙' });
    // 两把椅子先各发了清单；走掉那位不再算，留下那位内容没变也不重发（只有席位表换了）。
    expect(s.frames('moves').map((m) => m.to)).toEqual([GUEST.id, OTHER.id]);
    expect(s.probe.mock.calls.map((c) => c[0])).toEqual([2, 3, 2]);
  });

  it('最后一个客人走了 ⇒ 没人在听，一个字节也不发', () => {
    const peers = [HOST, GUEST];
    const s = setup({ peers });
    s.auth.syncNow();
    const before = s.sent.length;
    peers.splice(1, 1);
    s.auth.syncNow();
    s.changeState();
    expect(s.sent).toHaveLength(before);
  });

  it('房间里没有客人 ⇒ 一份也不发（没客人就别费劲算视图）', () => {
    const s = setup({ peers: [HOST] });
    s.auth.syncNow();
    s.changeState();
    expect(s.sent).toEqual([]);
  });

  it('全是 AI 席 ⇒ 没有可坐的椅子，什么都不发', () => {
    const s = setup({ seats: ALL_AI });
    s.auth.syncNow();
    expect(s.sent).toEqual([]);
  });

  it('客人比椅子多 ⇒ 绑不到席位表上的人拿不到清单（多出来那位只能看）', () => {
    const s = setup({ peers: [HOST, GUEST, OTHER] });
    s.auth.syncNow();
    const maps = s.frames('seatmap');
    expect(maps[0].seats as unknown[]).toHaveLength(2);
    expect(s.frames('moves').map((m) => m.to)).toEqual([GUEST.id]);
  });

  it('新的那位进来、表的内容一个字没变 ⇒ 这张表照样补发到他手上（2026-10-28 两台机器实测）', () => {
    // 现场形状：上一位客人硬断线没发 `bye` ⇒ 第 2 席仍绑着一个已经不存在的身份号，
    // 新的这位排不到椅子 ⇒ 席位表逐字没变。按"内容变没变"去重就永远不再发，
    // 他界面停在「还没收到席位表」，而同局牌桌正在第 2 轮。
    const peers = [HOST, GUEST];
    const s = setup({ peers });
    s.auth.syncNow();
    expect(s.frames('seatmap')).toHaveLength(1);

    peers.push(OTHER);
    s.auth.syncNow();
    const maps = s.frames('seatmap');
    expect(maps).toHaveLength(2);
    // 补发的正是同一张表（不是新算一份别的），且仍只给绑到椅子的那一席算清单。
    expect(maps[1].seats).toEqual(maps[0].seats);
    expect(s.frames('moves').map((m) => m.to)).toEqual([GUEST.id]);
  });

  it('补发过一次就不追着人发（去重换了口径，不是取消去重）', () => {
    const peers = [HOST, GUEST];
    const s = setup({ peers });
    s.auth.syncNow();
    peers.push(OTHER);
    s.auth.syncNow();
    s.auth.syncNow();
    s.changeState();
    expect(s.frames('seatmap')).toHaveLength(2);
  });
});

describe('收请求：拿房主当下重算的编号比，其余一律退回并说明', () => {
  const endTurn = (): GameAction[] => [createAction('END_TURN', 2)];

  it('编号对得上 ⇒ 用房主自己那份动作执行，不发退回', () => {
    const got: Array<{ seat: number; action: GameAction }> = [];
    const s = setup({
      probeFor: endTurn,
      execute: (seat, action) => {
        got.push({ seat, action });
        return true;
      },
    });
    s.auth.syncNow();
    s.auth.handleAction({ peer: GUEST.id, seat: 2, key: moveKey(0, createAction('END_TURN', 2)) });
    expect(got).toHaveLength(1);
    expect(got[0].seat).toBe(2);
    expect(got[0].action.type).toBe('END_TURN');
    expect(s.frames('actno')).toHaveLength(0);
  });

  it('这一席绑的是别人 ⇒ 退回并说明，一次也不执行', () => {
    const s = setup({ peers: [HOST, GUEST, OTHER], seats: THREE_SEATS, probeFor: endTurn });
    s.auth.syncNow();
    s.auth.handleAction({ peer: OTHER.id, seat: 2, key: moveKey(0, createAction('END_TURN', 2)) });
    expect(s.execute).not.toHaveBeenCalled();
    const back = s.frames('actno');
    expect(back).toHaveLength(1);
    expect(back[0].to).toBe(OTHER.id);
    expect(back[0].reason).toContain('绑的是别人');
  });

  it('这一席还归本机在点（没绑给任何人）⇒ 退回那句"没交给你"', () => {
    const s = setup({ peers: [HOST], probeFor: endTurn });
    s.auth.syncNow();
    // 场上只有房主自己：他占第一个非 AI 席，第二席还是本机在点。
    s.auth.handleAction({ peer: GUEST.id, seat: 2, key: moveKey(0, createAction('END_TURN', 2)) });
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.frames('actno')[0].reason).toContain('没交给你');
  });

  it('点的是 AI 那一席（席位表上根本没这一格）⇒ 说清是电脑在打，不含糊', () => {
    const s = setup({ seats: [{ id: 1, name: '房主甲' }, { id: 2, name: 'AI 乙', isAi: true }], probeFor: endTurn });
    s.auth.syncNow();
    s.auth.handleAction({ peer: GUEST.id, seat: 2, key: 'whatever' });
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.frames('actno')[0].reason).toContain('电脑在打');
  });

  it('轮不到这一席动手（探针算出空）⇒ 退回"轮不到"，不去比编号', () => {
    const s = setup({ probeFor: () => [], execute: () => { throw new Error('不该执行'); } });
    s.auth.syncNow();
    s.auth.handleAction({ peer: GUEST.id, seat: 2, key: 'whatever' });
    expect(s.frames('actno')[0].reason).toContain('轮不到这一席');
  });

  it('牌动过了、旧编号作废 ⇒ 退回那句"已经不成立"，不执行', () => {
    const s = setup({ probeFor: endTurn, execute: () => { throw new Error('不该执行'); } });
    s.auth.syncNow();
    s.auth.handleAction({ peer: GUEST.id, seat: 2, key: '0-END_TURN:deadbeef' });
    expect(s.frames('actno')[0].reason).toContain('已经不成立');
  });

  it('引擎当场没收下 ⇒ 也要退回并说明（不能让人以为走成了）', () => {
    const s = setup({ probeFor: endTurn, execute: () => false });
    s.auth.syncNow();
    s.auth.handleAction({ peer: GUEST.id, seat: 2, key: moveKey(0, createAction('END_TURN', 2)) });
    expect(s.frames('actno')[0].reason).toContain('引擎当场没收下');
  });

  it('执行之后立刻按新局面重发清单：旧编号作废这件事要马上让人看见', () => {
    let stage = 0;
    const s = setup({
      probeFor: () => (stage === 0 ? [createAction('END_TURN', 2)] : [createAction('SURRENDER', 2)]),
      execute: () => {
        stage = 1;
        return true;
      },
    });
    s.auth.syncNow();
    expect(s.frames('moves')).toHaveLength(1);
    s.auth.handleAction({ peer: GUEST.id, seat: 2, key: moveKey(0, createAction('END_TURN', 2)) });
    const lists = s.frames('moves');
    expect(lists).toHaveLength(2);
    expect((lists[1].items as { label: string }[])[0].label).toBe('🏳️确认投降');
  });
});
