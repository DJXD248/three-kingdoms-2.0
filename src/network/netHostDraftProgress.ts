/**
 * 联机切片⑤b（v2.9.25）房主侧的征召进度发布者。
 *
 * 与 `startHostReady`、`startSnapshotBroadcaster` 同一个形状：住在一间房上，读房主当下的事实，
 * 算出那张表，**变了才发**，同时把同一份抄一格给房主自己那屏（算表的人不该是唯一看不见它的人）。
 *
 * 它不含规则：这张表能说什么由 `netDraftProgress` 那三条判据说了算（只报数量，不搬牌）；
 * 它也不改局面——征召这本账今天仍住在房主的 store 里，这一格只把它**抄成一句进度**。
 * 客人交回来的那一步走的是另一条路（切片⑤b 之外：征召问答通道这一版没建）。
 */
import { buildDraftProgressRows, sameDraftProgressRows, type DraftProgressFacts } from './netDraftProgress';
import type { NetDraftProgressRow } from './netProtocol';

export type HostDraftProgress = {
  /** 房主那边每动一次（点将、确认、甚至界面重绘）调一次；那张表没动就一条也不发。 */
  notifyChange: () => void;
  /** 立刻对齐一次：换房、刚连上线时不等下一次点将。 */
  syncNow: () => void;
};

export function startHostDraftProgress(deps: {
  /** 房主当下的征召事实（每次现读，不缓存 store 对象）。 */
  facts: () => DraftProgressFacts;
  /** 上线那一条：信封在这里拼由接线定，这一格只管"表变了"。 */
  send: (rows: NetDraftProgressRow[]) => void;
  /** 同一份抄给房主自己那屏；null＝这一格现在没话要说（与客人那格的读数同一个形状）。 */
  tableSink: (rows: NetDraftProgressRow[] | null) => void;
}): HostDraftProgress {
  let last: NetDraftProgressRow[] | null = null;

  const sync = () => {
    const rows = buildDraftProgressRows(deps.facts());
    if (sameDraftProgressRows(last, rows)) return;
    last = rows;
    // 没话要说的一刻不发空表（解析层也不收空表）；房主自己那一格照样要更新，
    // 否则"征召还没开始"这句话在他屏上会一直停在上一张表。
    if (rows !== null) deps.send(rows);
    deps.tableSink(rows);
  };

  return {
    notifyChange: sync,
    syncNow: () => {
      last = null;
      sync();
    },
  };
}
