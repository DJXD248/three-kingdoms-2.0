import { useSyncExternalStore } from 'react';
import type { NetMoveItem, NetSeatRow } from '../network/netProtocol';
import {
  getActiveRoom,
  getSeatMap,
  subscribeNetRoom,
} from '../network/netRoom';
import type { SeatMoveList } from '../network/netSeat';
import { seatOfPeer } from '../network/netSeat';

/**
 * J4 那张"谁坐哪一席"与客人能点的那批按钮（v2.9.11）。
 *
 * 三样内容全部是**房主发来**的：席位表、指名给我这一席的清单、上一次没走成的那句话。
 * 这里一律不自算——客人自己排一遍座次，两边就会读着不同的席位动手。
 *
 * 界面上要守住的两条真话：
 * ① 按钮只在"这一步确实是房主算给我这一席"时出现（还没绑到我、椅子还没开出来、
 *    清单换了主人 ⇒ 一个都不出，仍然只看不动）；
 * ② 清单是封顶过的，"还有几条没列出来"要按那个数字说出来，不能让人以为看到的就是全部。
 */

export type NetSeatPanelProps = {
  seatMap: NetSeatRow[] | null;
  /** 客人侧：房主算给**我这一席**的那一份；房主这边永远是 null（清单只发给那一席的人）。 */
  moves: SeatMoveList | null;
  refusal: { key: string; reason: string } | null;
  selfId: string;
  isHost: boolean;
  /** 交回那一步（线上只跑席位号与编号）；没有它＝这一格只能看。 */
  onPick?: (item: NetMoveItem) => void;
};

export function NetSeatPanel({ seatMap, moves, refusal, selfId, isHost, onPick }: NetSeatPanelProps) {
  const mySeat = seatOfPeer(seatMap, selfId);
  const mine = moves !== null && moves.seat === mySeat ? moves : null;
  return (
    <div className="rounded-lg border border-amber-700/25 bg-black/40 px-3 py-2 text-xs">
      <p className="mb-1 font-bold text-amber-300/80">💺 席位表（房主那边绑的，客人这边照抄）</p>

      {seatMap === null ? (
        <p className="text-amber-200/45">
          还没收到席位表——房主那边开了局、桌上有了能坐的椅子才会发过来（开局前桌上没有席位，
          所以这一步也还没得点）。
        </p>
      ) : seatMap.length === 0 ? (
        <p className="text-amber-200/45">这一桌全是电脑在打，没有能坐人的椅子。</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {seatMap.map((row) => (
            <li key={row.seat} className="flex items-center gap-2">
              <span className="text-amber-200/50">第 {row.seat} 席</span>
              <span className="font-bold text-amber-100">{row.name}</span>
              {row.peer === selfId && <span className="text-emerald-300/70">（我）</span>}
              {row.peer === null && <span className="text-amber-200/40">本机在点</span>}
              {row.peer !== null && row.peer !== selfId && (
                <span className="text-amber-200/40">{isHost ? '客人' : '别人'}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isHost ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/40">
          客人那边能点的按钮，是按这张表算给他们的那一份。他们交回来的只有「第几席＋编号」，
          牌还是由你这台机器按当下的局面重算一遍，对得上才走。
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="text-[11px] text-amber-300/70">
            {mySeat === null
              ? '椅子还没排到你（房主重排后会发新的一份过来）——你这边先只看。'
              : `你坐第 ${mySeat} 席。`
                + (mine === null || onPick === undefined
                  ? ' 还没收到这一席的清单，房主那边牌一动就会发。'
                  // 清单是空的这一种**不许**说"现在能走"：那句与下面那一行自相矛盾
                  // （2026-10-28 两台机器实测读到的原文就是两行挨着打脸）。这里闭嘴，
                  // 让下面那句真话说，同一件事不派两句话。
                  : mine.items.length === 0
                    ? ''
                    : ' 现在能走：')}
          </p>

          {!isHost && mine !== null && onPick !== undefined && (
            <>
              {mine.items.length === 0 && (
                <p className="text-amber-200/45">这一席此刻一步也走不了（等牌走到要你动手的那一步）。</p>
              )}
              {mine.items.map((item) => (
                <button
                  key={item.key}
                  onClick={() => onPick(item)}
                  className="rounded-lg border border-amber-700/30 bg-black/30 px-2.5 py-1.5 text-left text-amber-100 hover:border-amber-400/60"
                >
                  {item.label}
                </button>
              ))}
              {mine.omitted > 0 && (
                <p className="text-[11px] leading-relaxed text-amber-200/45">
                  ⚠️ 这里只列出前 {mine.items.length} 步，还有 {mine.omitted} 步没列出来
                  ——房主本机那边看得见全部，要走没列出的那一步得请房主点。
                </p>
              )}
            </>
          )}

          {refusal && (
            <p className="rounded border border-red-700/40 bg-red-950/40 px-2 py-1 text-red-200">
              ↩️ 房主那边没让走：{refusal.reason}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-amber-200/40">
            点出去的那一步只是把「第几席＋这个编号」交给房主，你的手牌与牌面内容一个都不上线。
            牌动了这份清单会自己换一批；没走成时会在这里说明为什么。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 房主关掉大厅去开局时，那张"谁坐哪一席"还挂在他屏幕右上角（与左上角那张连线表同一批：
 * 只搬事实，判据都在网络层）。整块 `pointer-events-none`——它只是给人看的。
 * 客人不在这里点牌：他要动手得回大厅那一格，那里才有能按的按钮。
 */
export default function NetSeatOverlay() {
  const room = useSyncExternalStore(subscribeNetRoom, getActiveRoom, getActiveRoom);
  const seatMap = useSyncExternalStore(subscribeNetRoom, getSeatMap, getSeatMap);
  if (!room || room.role !== 'host' || seatMap === null) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-40 w-64">
      <NetSeatPanel seatMap={seatMap} moves={null} refusal={null} selfId={room.connection.state.selfId} isHost />
    </div>
  );
}
