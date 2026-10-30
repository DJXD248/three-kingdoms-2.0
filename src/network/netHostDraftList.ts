/**
 * 联机切片⑤（v2.9.25）房主侧的候选名单发布者＋（腿3/⑤d）那一条交回来的收信人。
 *
 * 与 `startHostDraftProgress`、`startHostReady` 同一个形状：住在一间房上，读房主当下的事实，
 * 算出这一格，**按人各算一份、变了才发**。不同之处在于这一格是**指名的**：
 * 屋里每一位客人拿到的是"他自己那一席的那一份"，而不是同一张表抄两遍。
 *
 * 它不含规则（那几条判据住 `netDraftList`），也不改局面——征召这本账今天仍住在房主的 store 里。
 * 它也**没有** `tableSink`（⑤b 那张进度表有的那一格）：房主自己那屏看的是真的征召面板
 * `components/GeneralDraft.tsx`，把线上传的那一帧再抄给他一遍等于让同一张桌上出现两份读数。
 *
 * ⑤d 起这里还多了一条**进来的路**，但它只做搬运与执行，判据一律问 `netDraftList`：
 *
 * ㈠**唯一的依据＝自己发出去的那一帧**（就记在 `last` 那本按人头的账上，所以那一格叫 `frameSentTo`）。
 *   客人说什么、报第几席，房主一眼不看——席位读的是权威那张席位表（`boundSeat`），不是信封里那一个数。
 * ㈡**执行只走 store 自己那颗**：拿编号在**自己那两份名单**里查出那张牌的对象，再调
 *   `selectDraftGeneral(那张牌)`／`confirmDraft()`。线上传来的任何字节都不当牌用（派单 2026-10-30 逐字）。
 * ㈢**拒不得静默**：不合法就回一句人话，走的是**已有的那一枚指名名单信封**（把 `instruction` 那一格换成
 *   拒他的那句，不新增出口）。这一句是一次性的：下一次 `sync` 把它带上墙就消费掉，之后真有了变化，
 *   正常那句会重新拼出来、内容一变照样发得出去（`sameDraftListFrames` 比的就是那一句）。
 * ㈣**确认那一档房主自己先把闸算一遍**：`store/gameStore.ts:345` 那颗 `confirmDraft()` 不查人数与群牌上下限
 *   （那条真闸今天长在热座界面 `GeneralDraft.tsx:22` 的 `canConfirm`），所以这一条绝不"收到就转交"。
 */
import {
  buildDraftListFrame,
  judgeDraftConfirm,
  judgeDraftPick,
  cardAtKey,
  REFUSE_NO_CARD,
  sameDraftListFrames,
  type DraftListFacts,
  type DraftVerdict,
  type IncomingDraft,
} from './netDraftList';
import { clampText } from './netSeat';
import { MAX_DRAFT_INSTRUCTION_LENGTH, type NetDraftListFrame } from './netProtocol';
import type { DraftCardLike } from './netDraftList';

export type HostDraftListGuest = { peer: string; seat: number | null };

export type HostDraftList = {
  /** 房主那边每动一次（点将、确认、换席、甚至界面重绘）调一次；那一格没动就一条也不发。 */
  notifyChange: () => void;
  /** 立刻对齐一次：换房、刚连上线、名册换了人时把当前那一帧逐人补发一遍（不等下一次点将）。 */
  syncNow: () => void;
  /** 房主**实际发给这一位**的那一帧（没发过＝`null`）。⑤d 重判的唯一依据，也是测试看线上说了什么的窗口。 */
  frameSentTo: (peer: string) => NetDraftListFrame | null;
  /** 收客人交回来的那一条；返回是否照这一条办了事（没办的那一条一定伴着一句回给他的话）。 */
  handleIncoming: (msg: IncomingDraft) => boolean;
};

/**
 * `TCard` 是房主那台机器上"牌"的真实形状（接线那头传 store 的 `General`），只出现在 `cards`／`toggle` 这两格：
 * 这一层只把它当 `DraftCardLike` 那几格读，**不认识也不 import 数据层**。
 * 之所以留一个类型参数而不是到处写 `as`，是为了让"从自己名单里查出来的那一张"原样交给
 * `selectDraftGeneral`——中间不需要一次向下转型，也就没有"转错了也看不出来"的那种漏。
 * 返回值不带这个参数：那四条方法搬运的是编号与帧，一张牌也不经它们的手。
 */
export function startHostDraftList<TCard extends DraftCardLike = DraftCardLike>(deps: {
  /** 房主当下的征召事实（每次现读，不缓存 store 对象）。 */
  facts: () => DraftListFacts;
  /** 屋里每位客人＋他被绑到的席位号。那张表由房主的权威算好抄进 `netRoom`，这里只读、不自算第二遍。 */
  guests: () => HostDraftListGuest[];
  /** 指名上线的那一条：这一帧只交给这一个号（`to` 必填这件事由信封的类型替人盯着）。 */
  send: (peer: string, frame: NetDraftListFrame) => void;
  /**
   * ⑤d：房主那两份名单上的**牌本身**（下标口径与 `facts` 里的位置编号一对一，见 `draftListFactsOf`）。
   * ⚠️ 与 `facts` 必须来自**同一次同步**的读数（两边都是 `useGameStore.getState()`；一个同步块里读两次拿到的是同一个对象），
   * 否则编号会指到另一张牌上——这也是"客人交回来的编号只用来查自己的名单"这句话的实际含义。
   */
  cards: () => { main: TCard[]; qun: TCard[] };
  /** ⑤d：勾一颗／退一颗——store 自己那颗 `selectDraftGeneral`，与热座点同一颗，不是这里另写一份。 */
  toggle: (card: TCard) => void;
  /** ⑤d：交这一席的卷——store 自己那颗 `confirmDraft`（判据已经在上一步由房主算过一遍）。 */
  confirm: () => void;
  /** ⑤d：这位发送者在权威席位表上绑的是第几席（没绑＝`null`）。 */
  boundSeat: (peer: string) => number | null;
}): HostDraftList {
  /** 按人头记账：两个人各自的那一帧互不影响，一位客人那一格没动不该按住另一位的那一帧。 */
  const last = new Map<string, NetDraftListFrame>();
  /**
   * ⑤d 那一次性的一格：下一个人该收到的是**这句拒话**，说完就消掉（不进 `last`，也不长期占着那一格）。
   * 为什么不为它新增信封：派单给的两档里选一档即可，而这一档复用已有的那条指名名单通路——
   * 客人的界面本来就照抄 `instruction` 那一行，句子换了就是内容变了，去重判据拦不住它。
   */
  const refusal = new Map<string, string>();

  const sync = () => {
    const facts = deps.facts();
    const guests = deps.guests();
    const present = new Set<string>();
    for (const guest of guests) {
      present.add(guest.peer);
      const built = buildDraftListFrame(facts, guest.seat);
      // 还没绑到椅子的那位（观战、或椅子没排到他）没有"自己那一格"可看 ⇒ 一帧也不发；
      // 他往后被绑上时这一笔自然重新算，所以这里把账也一并放下。
      if (built === null) {
        last.delete(guest.peer);
        refusal.delete(guest.peer);
        continue;
      }
      const reason = refusal.get(guest.peer);
      let frame = built;
      if (reason !== undefined) {
        refusal.delete(guest.peer);
        // 只换那一句话，别的一格原样留着：他屏上的名单与"已选"不能因为一句拒话被改写或清空。
        frame = { ...built, instruction: clampText(reason, MAX_DRAFT_INSTRUCTION_LENGTH, '房主那边没能给出一句拒因') };
      }
      const sent = last.get(guest.peer);
      if (sent !== undefined && sameDraftListFrames(sent, frame)) continue;
      last.set(guest.peer, frame);
      deps.send(guest.peer, frame);
    }
    // 走了的那位把账清掉：不清的话他再进来时"内容没变"会把他该收的第一帧按住不发。
    for (const peer of [...last.keys()]) {
      if (!present.has(peer)) {
        last.delete(peer);
        refusal.delete(peer);
      }
    }
  };

  /** 判下来不合法 ⇒ 把那句挂进一次性那一格，然后立刻对齐一次（这一次就把它送出去）。 */
  const refuse = (peer: string, reason: string): false => {
    refusal.set(peer, reason);
    sync();
    return false;
  };

  const handleIncoming = (msg: IncomingDraft): boolean => {
    const facts = deps.facts();
    const senderSeat = deps.boundSeat(msg.peer);
    // `frameSentTo`：只认**真的上过线**的那一帧。没发过＝他手上根本没有可点的名单，判据也就不能凭空给他补一份。
    const sent = last.get(msg.peer) ?? null;
    const verdict: DraftVerdict = msg.kind === 'pick'
      ? judgeDraftPick(facts, sent, senderSeat, msg.key)
      : judgeDraftConfirm(facts, sent, senderSeat);
    if (!verdict.ok) return refuse(msg.peer, verdict.reason);

    if (msg.kind === 'confirm') {
      // 上下限已经在 `judgeDraftConfirm` 里由房主算过一遍（同一个 `draftTally`），这一步只是转交。
      deps.confirm();
      sync();
      return true;
    }
    // 编号→牌：查的是**房主自己那两份名单**（`cards`），对照的是**他自己发出去的那一帧**上的同一批编号。
    // 这一行里没有一寸内容来自线上传的字节：客人那侧连牌面都没发上来（信封里只有席位与编号）。
    const { main, qun } = deps.cards();
    const card = sent === null ? null : cardAtKey(main, qun, sent.main, sent.qun, msg.key);
    if (card === null) return refuse(msg.peer, REFUSE_NO_CARD);
    deps.toggle(card);
    sync();
    return true;
  };

  return {
    notifyChange: sync,
    syncNow: () => {
      last.clear();
      // 换房／重连时那句一次性拒话也跟着作废：新一帧说的是"现在该做什么"，不是上一场的旧账。
      refusal.clear();
      sync();
    },
    frameSentTo: (peer) => last.get(peer) ?? null,
    handleIncoming,
  };
}
