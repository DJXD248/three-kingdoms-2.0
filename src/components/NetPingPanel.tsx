import { useSyncExternalStore } from 'react';
import type { NetLinkRow } from '../network/netProtocol';
import { getActiveRoom, getNetStatus, subscribeNetRoom } from '../network/netRoom';

/**
 * 房间内左上角那张公开连线表（J3＝联机第三刀）。
 *
 * 用户 2026-10-07 定稿原话：「我需要你在房间内左上角列出当前玩家ping值，对所有玩家公开。
 * 判定＝连线断开或心跳超时。阈值：15 秒。」⇒ 三件事一次落：
 * ① **公开**＝房主与客人都看得见同一张表（表由房主算、随探测广播，客人只照抄）；
 * ② **左上角**＝这一格挂在屏幕上、不住在大厅弹窗里——房主关掉大厅去开局也得看得见；
 * ③ **掉线要有话说**＝判出来是谁、在第几行标出来，并写清"接下来那两选一还没做"。
 *
 * 它不含任何判据：状态与数字全由 `netHeartbeat` 算好、经 `netRoom` 那一份存着，
 * 这里只负责给人看（判据若在界面里再算一遍，就会出现两套"谁算掉了"）。
 */

const pingText = (row: NetLinkRow): string => {
  if (row.state === 'lost') return '掉线';
  return row.pingMs === null ? '还没回话' : `${row.pingMs} 毫秒`;
};

export function NetPingPanel({
  rows,
  selfId,
  hostId,
}: {
  rows: NetLinkRow[];
  selfId: string;
  hostId: string;
}) {
  const lost = rows.filter((row) => row.state === 'lost');
  return (
    <div className="rounded-lg border border-amber-700/25 bg-black/40 px-3 py-2 text-xs">
      <p className="mb-1 font-bold text-amber-300/80">
        📶 连线情况（{rows.length} 人·全桌公开）
      </p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span className={row.state === 'lost' ? 'text-red-300 font-bold' : 'text-emerald-300'}>
              {row.state === 'lost' ? '●' : '○'}
            </span>
            <span className="text-amber-100">{row.name}</span>
            {row.id === hostId && <span className="text-amber-200/45">房主·算牌</span>}
            {row.id === selfId && <span className="text-emerald-300/70">（我）</span>}
            <span className={row.state === 'lost' ? 'ml-auto text-red-300' : 'ml-auto text-amber-200/60'}>
              {pingText(row)}
            </span>
          </li>
        ))}
      </ul>
      {lost.length > 0 && (
        <p className="mt-1.5 rounded border border-red-700/40 bg-red-950/40 px-2 py-1 text-red-200">
          ⚠️ {lost.map((row) => row.name).join('、')} 掉线了（15 秒没收到他任何一条消息）。
          对局先停在这儿——「保存并退出」或「交给 AI 继续」那两选一＝J5，还没做；
          他要是又来信，这一行会自己变回在线，但把座位交回给他＝挂起项，也不在本刀。
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-amber-200/40">
        这里的数字是各人与「房主那台机器」之间的往返时间，不是两人之间的真实延时，
        也不是卡顿指标（房主机器忙，这个数字也会显得大）。
      </p>
    </div>
  );
}

/**
 * 挂在屏幕左上角的那一份（房主关掉大厅去开局、客人只开着牌桌时，靠它继续公开）。
 * 整块 `pointer-events-none`：它只是给人看的，绝不挡牌桌上的任何一次点击。
 */
export default function NetPingOverlay() {
  const rows = useSyncExternalStore(subscribeNetRoom, getNetStatus, getNetStatus);
  const room = useSyncExternalStore(subscribeNetRoom, getActiveRoom, getActiveRoom);
  if (!room || !rows || rows.length === 0) return null;
  const selfId = room.connection.state.selfId;
  const hostId = room.connection.state.peers.find((p) => p.role === 'host')?.id ?? selfId;
  return (
    <div className="pointer-events-none fixed left-3 top-3 z-40 w-64">
      <NetPingPanel rows={rows} selfId={selfId} hostId={hostId} />
    </div>
  );
}
