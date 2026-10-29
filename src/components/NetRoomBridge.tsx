import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { probeSeatActions } from '../store/engineExecutionBridge';
import { applyCanonicalAction } from '../store/applyCanonicalAction';
import { getActiveRoom, getSeatMap, receiveSeatMap, setHostActionSink, subscribeNetRoom, type ActiveRoom } from '../network/netRoom';
import { startSnapshotBroadcaster, type SnapshotBroadcaster } from '../network/snapshotBroadcaster';
import { startHostAuthority, type HostAuthority } from '../network/netHostAuthority';

/**
 * 房主侧的接线（J2 发快照 ＋ J4 席位表／清单／把关）。住在 App 上而不是大厅弹窗里——
 * 房主要关掉大厅去开局，连线不能跟着弹窗一起没。它不含任何规则：读房主当下的局面，
 * 一份交给遮蔽层发快照，一份交给房主权威算席位与清单、并把客人交回来的编号验一遍。
 *
 * 每根线一套接线：`bc` 与 `auth` 都闭包着建它们时那一间的 `room.connection`，
 * 换了房间必须整套重建，否则下一间房的快照会发进上一间的线里。
 */
export default function NetRoomBridge() {
  useEffect(() => {
    let bc: SnapshotBroadcaster | null = null;
    let auth: HostAuthority | null = null;
    let bound: ActiveRoom | null = null;
    let rosterKey = '';

    const stop = () => {
      bc?.stop();
      bc = null;
      auth = null;
      bound = null;
      rosterKey = '';
      setHostActionSink(null);
    };

    const start = (room: ActiveRoom) => {
      bound = room;
      rosterKey = room.connection.state.peers.map((p) => p.id).join('|');
      bc = startSnapshotBroadcaster({
        readState: () => useGameStore.getState().engineState,
        // 切片③（v2.9.25）：屋里每位客人各拿一份**指名给他**的局面。他坐哪一席从席位表读
        // （那张表由 auth 算好、同时抄进 netRoom），还没绑上的（开局前、纯来看牌的）拿
        // 全遮那份＝观战面。席位号就是引擎的 playerId，与 buildSeatMap 同一口径。
        recipients: () => {
          const rows = getSeatMap();
          return (bound?.connection.state.peers ?? [])
            .filter((p) => p.role === 'guest')
            .map((p) => ({ peer: p.id, seat: rows?.find((r) => r.peer === p.id)?.seat ?? null }));
        },
        send: (view, to) => room.connection.send({
          t: 'snapshot',
          from: room.connection.state.selfId,
          to,
          state: view as unknown as Record<string, unknown>,
        }),
      });
      auth = startHostAuthority({
        selfId: () => room.connection.state.selfId,
        peers: () => room.connection.state.peers,
        readState: () => useGameStore.getState().engineState,
        probe: (seat) => probeSeatActions(useGameStore.getState(), seat),
        execute: (seat, action) => applyCanonicalAction(useGameStore.getState(), seat, action),
        send: (envelope) => room.connection.send(envelope),
        // 同一份席位表抄一份给房主那屏（右上角那张）。不抄的话，算表的人自己看不见。
        seatMapSink: receiveSeatMap,
      });
      setHostActionSink((msg) => auth?.handleAction(msg));
      // 房主连着大厅没动牌、客人却已经进来了 ⇒ 先各给一份当下的，别让人家等下一次变化。
      // 顺序是 auth 先、bc 后：bc 要按席位各出一份，而席位表正是 auth 算出来抄进 netRoom 的
      // ——反过来的话，新进来那位第一次拿到的是"还没绑上"的全遮那份。
      auth.syncNow();
      bc.flush();
    };

    const syncRoom = (room: ActiveRoom | null) => {
      if (room?.role !== 'host') {
        stop();
        return;
      }
      if (room !== bound) {
        // 换房先拆掉上一间的接线：老节流器那枚待补发的定时器不停的话，
        // 它会把下一间房的快照发进上一间的那根线里。
        if (bound) stop();
        start(room);
        return;
      }
      // 名册变了（有人进来、有人走了）⇒ 座次要重排，不等下一次牌动。
      const key = room.connection.state.peers.map((p) => p.id).join('|');
      if (key !== rosterKey) {
        rosterKey = key;
        // 同 start：先把席位表算出来，再按新座次逐人发私有视图。
        auth?.syncNow();
        bc?.flush();
      }
    };

    // 局面每变一次：先让 auth 重算席位表与清单（并抄进 netRoom），bc 才读得到当下这份座次
    // 去按席位各出一私有视图。反了一序，视图会慢一整拍地跟着旧座次走。
    const unsubscribeStore = useGameStore.subscribe(() => {
      auth?.notifyChange();
      bc?.notifyChange();
    });
    const unsubscribeRoom = subscribeNetRoom(() => syncRoom(getActiveRoom()));
    syncRoom(getActiveRoom());

    return () => {
      unsubscribeStore();
      unsubscribeRoom();
      stop();
    };
  }, []);

  return null;
}
