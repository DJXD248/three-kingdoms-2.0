/**
 * 联机切片⑤c（v2.9.25）房主侧的候选名单发布者。
 *
 * 与 `startHostDraftProgress`、`startHostReady` 同一个形状：住在一间房上，读房主当下的事实，
 * 算出这一格，**按人各算一份、变了才发**。不同之处在于这一格是**指名的**：
 * 屋里每一位客人拿到的是"他自己那一席的那一份"，而不是同一张表抄两遍。
 *
 * 它不含规则（那一格的三条判据住 `netDraftList`），也不改局面——征召这本账今天仍住在房主的 store 里。
 * 它也**没有** `tableSink`（⑤b 那张进度表有的那一格）：房主自己那屏看的是真的征召面板
 * `components/GeneralDraft.tsx`，把线上传的那一帧再抄给他一遍等于让同一张桌上出现两份读数。
 *
 * 客人交回来的那一颗（点将）＝腿3（⑤d），这一版没有那条路：这里只往外送。
 */
import { buildDraftListFrame, sameDraftListFrames, type DraftListFacts } from './netDraftList';
import type { NetDraftListFrame } from './netProtocol';

export type HostDraftListGuest = { peer: string; seat: number | null };

export type HostDraftList = {
  /** 房主那边每动一次（点将、确认、换席、甚至界面重绘）调一次；那一格没动就一条也不发。 */
  notifyChange: () => void;
  /** 立刻对齐一次：换房、刚连上线、名册换了人时把当前那一帧逐人补发一遍（不等下一次点将）。 */
  syncNow: () => void;
};

export function startHostDraftList(deps: {
  /** 房主当下的征召事实（每次现读，不缓存 store 对象）。 */
  facts: () => DraftListFacts;
  /** 屋里每位客人＋他被绑到的席位号。那张表由房主的权威算好抄进 `netRoom`，这里只读、不自算第二遍。 */
  guests: () => HostDraftListGuest[];
  /** 指名上线的那一条：这一帧只交给这一个号（`to` 必填这件事由信封的类型替人盯着）。 */
  send: (peer: string, frame: NetDraftListFrame) => void;
}): HostDraftList {
  /** 按人头记账：两个人各自的那一帧互不影响，一位客人那一格没动不该按住另一位的那一帧。 */
  const last = new Map<string, NetDraftListFrame>();

  const sync = () => {
    const facts = deps.facts();
    const guests = deps.guests();
    const present = new Set<string>();
    for (const guest of guests) {
      present.add(guest.peer);
      const frame = buildDraftListFrame(facts, guest.seat);
      // 还没绑到椅子的那位（观战、或椅子没排到他）没有"自己那一格"可看 ⇒ 一帧也不发；
      // 他往后被绑上时这一笔自然重新算，所以这里把账也一并放下。
      if (frame === null) {
        last.delete(guest.peer);
        continue;
      }
      const sent = last.get(guest.peer);
      if (sent !== undefined && sameDraftListFrames(sent, frame)) continue;
      last.set(guest.peer, frame);
      deps.send(guest.peer, frame);
    }
    // 走了的那位把账清掉：不清的话他再进来时"内容没变"会把他该收的第一帧按住不发。
    for (const peer of [...last.keys()]) {
      if (!present.has(peer)) last.delete(peer);
    }
  };

  return {
    notifyChange: sync,
    syncNow: () => {
      last.clear();
      sync();
    },
  };
}
