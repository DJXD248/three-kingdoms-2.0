import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { probeSeatActions } from '../store/engineExecutionBridge';
import { applyCanonicalAction } from '../store/applyCanonicalAction';
import { getActiveRoom, receiveSeatMap, setHostActionSink, subscribeNetRoom, type ActiveRoom } from '../network/netRoom';
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
        hasGuests: () => (bound?.connection.state.peers ?? []).some((p) => p.role === 'guest'),
        send: (view) => room.connection.send({
          t: 'snapshot',
          from: room.connection.state.selfId,
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
      bc.flush();
      auth.syncNow();
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
        bc?.flush();
        auth?.syncNow();
      }
    };

    const unsubscribeStore = useGameStore.subscribe(() => {
      bc?.notifyChange();
      auth?.notifyChange();
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
