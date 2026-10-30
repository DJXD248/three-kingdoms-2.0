/**
 * 征召那一段的**数量闸**（v2.9.25 ⑤·更正轮㈡）：只吃数、不吃 store 的一把尺。
 *
 * 为什么要单独立一个文件：这条规则原本只长在热座面板 `components/GeneralDraft.tsx` 的 `isSelectable` 里。
 * 联机客人那条路（`network/netDraftList.judgeDraftPick`）今天也要判同一件事，而现场读出来的后果有两条，都很实在——
 * ㈠`store/gameStore.ts` 那颗 `selectDraftGeneral` 只挡"满 10 颗"这一档，其余一律照加，
 *   于是房主放行而店里什么也没发生、`sync()` 重算出来的那一帧与上一帧一字未动 ⇒ 客人屏幕上真的没反应（派单逐字：「拒不得静默」）；
 * ㈡群牌那一档 store 压根不挡 ⇒ 客人能做出一种热座永远点不出来的形状，再在确认那一档被拒，
 *   "已选"那一排与热座的合法形状说了两套。
 *
 * 于是这一把尺由两边**共用同一个函数**（派单第 4 条那句"单一真值，不要把那条上下限再手抄一遍"）：
 * 热座那颗牌点不点得动、房主重判放不放行，读的都是下面这几行。
 *
 * ⚠️ 这一把尺量的**只有数量**。热座面板 `isSelectable` 里排在它前面的那一半——身份锁 `lockConflicts`
 * ——**没有搬进来**，因为它要读数据层那台 identity 机器（`domain/identity`），而联机那一层今天的纪律是不 import 数据层。
 * ⇒ 这是一条登记在册的已知差异：**客人那一侧不加身份锁这一档**，不许写成"两边一致"。
 * 它今天量不到东西：分牌那一步已经把身份冲突的牌挡在同一个席位之外（`GeneralDraft.tsx:24-27` 的注释），
 * 一屏上出现同键或主↔群同身份只有旧档共存这一条路。
 *
 * 形状与 `netDraftList.draftTally` 一样：入参是数，返回值是"这一颗加不加得进去、加不进去是为哪一条"，
 * 没有网络、没有 store、没有 React。
 */

/** 群势力那一份的上限（热座那句"群势力1-3名"里的那个 3）。 */
export const DRAFT_QUN_MAX = 3;

/** 当下这一席已经勾着的那几颗怎么分的（三个数都由调用方从**自己那份读数**里数出来，这里不读牌面也不读 store）。 */
export type DraftQuotaCounts = {
  /** 这一席该勾几名（分母；热座传的是 10，客人那一帧传的是 `frame.total`）。 */
  total: number;
  totalCount: number;
  qunCount: number;
  mainCount: number;
};

/** 加不进去是为哪一条——三句拒话要分得开，别让人猜是哪条拦的人。 */
export type DraftQuotaBlock = 'totalFull' | 'qunFull' | 'mainNeedsQun';

/**
 * 这颗**新加**的牌（已经勾着的那颗不在这里的判断范围内——退一颗永远允许，那是调用方先看的一步）
 * 按数量那一档加不加得进去；`null`＝加得进去，否则给的是哪一条。
 *
 * 三个分支逐字搬自 `GeneralDraft.tsx` 的 `isSelectable`（更正轮㈡ 之前那一版，`git show HEAD:src/components/GeneralDraft.tsx` 的 :50-58），
 * 一个判据也没改、也没加；那两个 10 现在从入参 `total` 传进来（热座那头传的正是 10）。
 * 搬完之后 `GeneralDraft.tsx:47-54` 就只剩"先判已勾、再判身份锁、最后叫这一把尺"三行。
 */
export function draftQuotaBlockFor(counts: DraftQuotaCounts, isQun: boolean): DraftQuotaBlock | null {
  const { total, totalCount, qunCount, mainCount } = counts;
  if (totalCount >= total) return 'totalFull';
  if (isQun) return qunCount < DRAFT_QUN_MAX ? null : 'qunFull';
  // 至少得给群势力留一颗位置，所以本势力最多 `total - max(1, qunCount)` 名。
  const maxMain = total - Math.max(1, qunCount);
  return mainCount < maxMain || qunCount >= 1 ? null : 'mainNeedsQun';
}
