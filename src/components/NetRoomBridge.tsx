import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { probeSeatActions } from '../store/engineExecutionBridge';
import { applyCanonicalAction } from '../store/applyCanonicalAction';
import { getActiveRoom, getNetStatus, getSeatMap, receiveSeatMap, receiveReadyTable, receiveDraftProgress, setHostActionSink, setHostReadySink, subscribeNetRoom, type ActiveRoom } from '../network/netRoom';
import { startSnapshotBroadcaster, type SnapshotBroadcaster } from '../network/snapshotBroadcaster';
import { startHostAuthority, type HostAuthority } from '../network/netHostAuthority';
import { startHostReady, type HostReady } from '../network/netHostReady';
import { startHostDraftProgress, type HostDraftProgress } from '../network/netHostDraftProgress';
import { draftFactsOf } from '../network/netDraftProgress';

/**
 * 房主侧的接线（J2 发快照 ＋ J4 席位表／清单／把关 ＋ ⑤a 准备表 ＋ ⑤b 征召进度表）。住在 App 上而不是大厅弹窗里——
 * 房主要关掉大厅去开局，连线不能跟着弹窗一起没。它不含任何规则：读房主当下的局面，
 * 一份交给遮蔽层发快照，一份交给房主权威算席位与清单、并把客人交回来的编号验一遍，
 * 还有一份交给准备发布者算"谁还算数、还等谁"（那一条读的是名册与连线表，不读局面），
 * 最后一份交给进度发布者把征召走到哪儿抄成一张只报数量的表（那一条读的是 store 里的征召格，不读引擎）。
 *
 * 每根线一套接线：`bc`、`auth`、`ready` 与 `progress` 都闭包着建它们时那一间的 `room.connection`，
 * 换了房间必须整套重建，否则下一间房的快照会发进上一间的线里。
 */
export default function NetRoomBridge() {
  useEffect(() => {
    let bc: SnapshotBroadcaster | null = null;
    let auth: HostAuthority | null = null;
    let ready: HostReady | null = null;
    let progress: HostDraftProgress | null = null;
    let bound: ActiveRoom | null = null;
    let rosterKey = '';

    const stop = () => {
      bc?.stop();
      bc = null;
      auth = null;
      ready = null;
      progress = null;
      bound = null;
      rosterKey = '';
      setHostActionSink(null);
      setHostReadySink(null);
    };

    const start = (room: ActiveRoom) => {
      bound = room;
      rosterKey = room.connection.state.peers.map((p) => p.id).join('|');
      ready = startHostReady({
        peers: () => room.connection.state.peers,
        // 判掉线只读房主那张连线表（判定的唯一出处；没用心跳时是 null＝没人被判掉线）。
        links: () => getNetStatus(),
        send: (rows) => room.connection.send({ t: 'readytable', from: room.connection.state.selfId, rows }),
        // 同一张表抄一份给房主自己那屏（他那颗「开始游戏」读的就是这一格）。
        tableSink: receiveReadyTable,
      });
      // 切片⑤b：征召进度表。读的全是房主自己 store 里的那几格（征召这本账不进引擎、
      // 也不进快照），抄上线的只有座次与两个数——别席的候选牌面在这张表里没有位置。
      progress = startHostDraftProgress({
        facts: () => draftFactsOf(useGameStore.getState()),
        send: (rows) => room.connection.send({ t: 'draftprogress', from: room.connection.state.selfId, rows }),
        tableSink: receiveDraftProgress,
      });
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
      setHostReadySink((msg) => ready?.noteMark(msg.peer, msg.on));
      // 房主连着大厅没动牌、客人却已经进来了 ⇒ 先各给一份当下的，别让人家等下一次变化。
      // 顺序是 auth 先、bc 后：bc 要按席位各出一份，而席位表正是 auth 算出来抄进 netRoom 的
      // ——反过来的话，新进来那位第一次拿到的是"还没绑上"的全遮那份。
      // ready 排在最前：它是局外那一段的事实，与牌无关，但房主那屏那颗钮等着这一格。
      ready.syncNow();
      // 进度表也排在 auth 前：刚连上线那一刻若真在征召，别人才不用等下一次点将才看见进度。
      progress.syncNow();
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
        // 迟来的客人要点将进度：这一张表可能一个字没动（座次全来自房主 store 里那批玩家，
        // 与谁进房无关），去重判据会把它按住不发 ⇒ 这里强制重发一遍，让人家一进来就有得看。
        progress?.syncNow();
        // 同 start：先把席位表算出来，再按新座次逐人发私有视图。
        auth?.syncNow();
        bc?.flush();
      }
      // 准备表在这条路上问两遍（名册变了要重算，连线表上有人被判掉线也要重算——那张表换了
      // 但不换名册）。"没变就不发、不发就不惊动界面"那条判据住在 netReady，这里不重写一遍。
      ready?.syncNow();
    };

    // 局面每变一次：先让 auth 重算席位表与清单（并抄进 netRoom），bc 才读得到当下这份座次
    // 去按席位各出一私有视图。反了一序，视图会慢一整拍地跟着旧座次走。
    const unsubscribeStore = useGameStore.subscribe(() => {
      auth?.notifyChange();
      bc?.notifyChange();
      // 征召那一段每勾一名都会 set 一次 store；进度表就是靠这一趟跟上（那张表没动时一条不发）。
      progress?.notifyChange();
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
