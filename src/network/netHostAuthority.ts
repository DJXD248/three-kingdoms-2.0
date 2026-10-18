/**
 * 房主那台机器上的**把关与执行**（J4，v2.9.11）。
 *
 * 契约只有一句：「客人发请求、房主验合法性（非法退回并说明）」。这一格就是那句
 * "验"落在代码上的位置。它做的三件事没有一件是"信客人"：
 *
 *  1. **发席位表**：谁坐哪一席由房主当下的局面与名册现算（`buildSeatMap`），客人只照抄，
 *     同一份表另抄给房主自己的屏幕（`seatMapSink`）——算的人不该是唯一看不见这张表的人。
 *  2. **发清单**：逐位客人算一次"这一席此刻能走哪些步"（只读探针 `probe`），
 *     线上只跑编号与人读的那句话，**动作本体一个字节也不上线**。
 *  3. **收请求**：客人交回一个编号 ⇒ 房主按**自己当下**的局面重算那一席的清单，
 *     编号对得上才拿**自己那份**动作去执行（`execute`，与 AI 司机同一条翻译路）。
 *     对不上就退回并说清为什么（`actno`），绝不照着客人送来的字节改牌桌。
 *
 * 所以这里没有缓存的"客人认为合法"，也没有半执行：客人那台机器上的任何判断都不作数，
 * 清单一刷新，旧编号自动作废（＝"这一步已经不成立"）。
 */
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import {
  MOVE_REFUSAL,
  buildSeatMap,
  buildSeatMoves,
  capSeatMoves,
  findSeatMoveIndex,
  sameMoveLists,
  sameSeatRows,
  type SeatMoveList,
} from './netSeat';
import type { NetEnvelope, NetPeer, NetSeatRow } from './netProtocol';

/** 客人交回来的那一条：谁发的、点哪一席、哪个编号。 */
export type IncomingAction = { peer: string; seat: number; key: string };

export type HostAuthorityDeps = {
  /** 房主连线里自己的那个 id（三份信封的发话人）。 */
  selfId: () => string;
  /** 房主那份名册（顺序＝进房顺序，绑座就按它）。 */
  peers: () => NetPeer[];
  /** 房主当下的局面（真值只在这一处）。 */
  readState: () => EngineState;
  /** 只读探针：那一席此刻能走哪些步（不动牌桌、不进录像）。 */
  probe: (seat: number) => GameAction[];
  /** 命中之后执行（走 store 那条唯一的翻译路，与本机热座同一个出口）。 */
  execute: (seat: number, action: GameAction) => boolean;
  /** 交给传话线；返回 false＝线没开着。 */
  send: (envelope: NetEnvelope) => boolean;
  /**
   * 把刚算出来的席位表**同时抄一份给房主自己的屏幕**。
   * 不接这一根，房主那边只有"发出去"这条路，自己那屏反而看不见谁坐哪一席——
   * 而这张表的内容本来就是房主算的，抄过去不多一个字、不少一个字。
   */
  seatMapSink?: (rows: NetSeatRow[]) => void;
};

export type HostAuthority = {
  /** 局面每变一次调一次；引用没动＝只是界面在动，不重算也不重发。 */
  notifyChange: () => void;
  /** 名册变了（有人进来、有人走了）⇒ 立刻对齐一次，不等下一次牌动。 */
  syncNow: () => void;
  /** 收到客人交回来的编号：当场重算，命中才执行，其余一律退回并说明。 */
  handleAction: (msg: IncomingAction) => void;
};

export function startHostAuthority(deps: HostAuthorityDeps): HostAuthority {
  let lastStateRef: EngineState | null = null;
  let lastSeatMap: NetSeatRow[] | null = null;
  /** 每一位客人最后一次真正发出去的清单（内容没动就别再发一遍，也别让界面重画）。 */
  const sentTo = new Map<string, SeatMoveList>();

  /** 席位表现算：AI 席根本不进这张表，绑不到人的那一格是 `peer:null`（＝本机还在点）。 */
  const seatMapOf = (state: EngineState): NetSeatRow[] => {
    const roster = deps.peers();
    const host = roster.find((p) => p.role === 'host');
    if (!host) return [];
    return buildSeatMap({
      seats: state.players.map((p) => ({ seat: Number(p.id), isAi: p.isAi === true, label: String(p.name ?? '') })),
      host: { id: host.id, name: host.name },
      guests: roster.filter((p) => p.role === 'guest').map((p) => ({ id: p.id, name: p.name })),
    });
  };

  const publish = (force: boolean) => {
    const state = deps.readState();
    if (!force && state === lastStateRef) return;
    lastStateRef = state;

    const rows = seatMapOf(state);
    // 房主自己那屏也要看得见这张表（开局前桌上还没有席位，那就一张也不抄）。
    if (rows.length > 0) deps.seatMapSink?.(rows);
    const selfId = deps.selfId();
    const bound = rows.filter((r) => r.peer !== null && r.peer !== selfId);
    if (bound.length === 0) {
      sentTo.clear();
      return;
    }

    if (!sameSeatRows(lastSeatMap, rows)) {
      if (deps.send({ t: 'seatmap', from: selfId, seats: rows })) lastSeatMap = rows;
    }
    const stillHere = new Set(bound.map((r) => r.peer as string));
    for (const peer of [...sentTo.keys()]) if (!stillHere.has(peer)) sentTo.delete(peer);

    for (const row of bound) {
      const peer = row.peer as string;
      const moves = buildSeatMoves(state, deps.probe(row.seat));
      const capped = capSeatMoves(moves);
      const list: SeatMoveList = { seat: row.seat, items: capped.sent, omitted: capped.omitted };
      if (sameMoveLists(sentTo.get(peer) ?? null, list)) continue;
      if (deps.send({ t: 'moves', from: selfId, to: peer, seat: row.seat, items: list.items, omitted: list.omitted })) {
        sentTo.set(peer, list);
      }
    }
  };

  const refuse = (peer: string, key: string, reason: string) => {
    deps.send({ t: 'actno', from: deps.selfId(), to: peer, key, reason });
  };

  return {
    notifyChange: () => publish(false),
    syncNow: () => {
      lastStateRef = null;
      publish(true);
    },
    handleAction: ({ peer, seat, key }) => {
      const state = deps.readState();
      const row = seatMapOf(state).find((r) => r.seat === seat);
      if (!row) {
        // 这张表上根本没有这一格 ⇒ 那是 AI 席（AI 席不上表），或者是一个编出来的号。
        refuse(peer, key, MOVE_REFUSAL.aiSeat);
        return;
      }
      if (row.peer === null) {
        refuse(peer, key, MOVE_REFUSAL.notBound);
        return;
      }
      if (row.peer !== peer) {
        refuse(peer, key, MOVE_REFUSAL.boundToOther);
        return;
      }
      // 合法性＝房主这一刻重算出来的那一批编号，与客人送来的一比。
      // 探针给空＝这一席现在动不了（没轮到、或者已经走到下一步），那是另一种话。
      const actions = deps.probe(seat);
      if (actions.length === 0) {
        refuse(peer, key, MOVE_REFUSAL.notMyTurn);
        return;
      }
      const index = findSeatMoveIndex(buildSeatMoves(state, actions), key);
      if (index < 0) {
        refuse(peer, key, MOVE_REFUSAL.stale);
        return;
      }
      if (!deps.execute(seat, actions[index])) {
        refuse(peer, key, MOVE_REFUSAL.notExecuted);
        return;
      }
      // 执行完立刻按新局面重发清单：牌桌动了，旧编号全部作废这件事要马上让人看见。
      // store 订阅那边通常已经先算过一遍，这里再兜一次——内容一样时只会安静跳过，
      // 但绝不能让一份旧清单在客人屏幕上站着。
      publish(true);
    },
  };
}
