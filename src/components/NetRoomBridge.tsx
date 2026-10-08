import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { getActiveRoom, subscribeNetRoom, type ActiveRoom } from '../network/netRoom';
import { startSnapshotBroadcaster, type SnapshotBroadcaster } from '../network/snapshotBroadcaster';

/**
 * 房主侧的发快照接线（J2）。住在 App 上而不是大厅弹窗里——房主要关掉大厅去开局，
 * 连线不能跟着弹窗一起没。它不含任何规则：读房主当下的局面、交给遮蔽层、交给传话线。
 */
export default function NetRoomBridge() {
  useEffect(() => {
    let bc: SnapshotBroadcaster | null = null;
    let bound: ActiveRoom | null = null;
    let guestCount = 0;

    const stop = () => {
      bc?.stop();
      bc = null;
      bound = null;
    };

    const syncRoom = (room: ActiveRoom | null) => {
      const guests = room?.role === 'host'
        ? room.connection.state.peers.filter((p) => p.role === 'guest').length
        : 0;
      if (room?.role !== 'host') {
        stop();
        guestCount = 0;
        return;
      }
      if (bound !== room) {
        bound = room;
        guestCount = guests;
        bc = startSnapshotBroadcaster({
          readState: () => useGameStore.getState().engineState,
          hasGuests: () => (bound?.connection.state.peers ?? []).some((p) => p.role === 'guest'),
          send: (view) => room.connection.send({
            t: 'snapshot',
            from: room.connection.state.selfId,
            state: view as unknown as Record<string, unknown>,
          }),
        });
        // 房主连着大厅没动牌、客人却已经进来了 ⇒ 先给一份当下的，别让人家等下一次变化。
        bc.flush();
      } else if (guests > guestCount) {
        bc?.flush();
      }
      guestCount = guests;
    };

    const unsubscribeStore = useGameStore.subscribe(() => bc?.notifyChange());
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
