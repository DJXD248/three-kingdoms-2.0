/**
 * 询问窗那把尺（乙 线末片第二刀 · 刀 1 拍 1）。
 *
 * 业主 2026-11-06 裁的原话拆成三条：倒计时是一个**房间参数**（房主开局前定一次，
 * 全员同一个数，客人只读），它**只约束真人席**（AI 席不等，立刻自答），
 * 到点＝系统替那一席按下那条本来就合法的"都不发动"——同一份出路，不新增第三种结果。
 *
 * 为什么单独成文：三扇窗（抉择／响应链／回合结束）、算牌那臂、界面 tick 要共用一把尺。
 * 放 `gameStore.ts` ⇒ 进程侧用不了（`setup/tableCompute.ts` 文件头明禁 zustand／gameStore）；
 * 放 `engineSteps.ts` ⇒ 把计时塞进判据文件，与那里"窗体本身是画面那半"的纪律打架。
 *
 * 这里只放算得动的纯函数：不碰状态、不碰时钟源（`now` 一律由调用方递进来），
 * 所以同一条窗、同一份读数重复算必然同结果——N3 授权"墙上钟进入判定链"仅限
 * **决定何时发出那条动作**，动作的内容与合法性与钟无关。
 */

export const ASK_TIMEOUT_DEFAULT_SEC = 30;
export const ASK_TIMEOUT_MIN_SEC = 15;
export const ASK_TIMEOUT_MAX_SEC = 90;

/**
 * 房主开局前那一格能挑的数（全在这把尺的范围内，界面因此不必自己抄边界）。
 */
export const ASK_TIMEOUT_CHOICES_SEC: number[] = [15, 30, 45, 60, 90];

/**
 * 全库唯一的钳制出处：界面上递进来的、信封里带回来的、落盘读出来的秒数都只过这一道。
 * 非有限数（NaN／缺字段）不夹、回默认值——那一格压根没定过，不该被当成"0 秒"。
 */
export function clampAskTimeoutSec(value: number): number {
  if (!Number.isFinite(value)) return ASK_TIMEOUT_DEFAULT_SEC;
  const sec = Math.floor(value);
  if (sec < ASK_TIMEOUT_MIN_SEC) return ASK_TIMEOUT_MIN_SEC;
  if (sec > ASK_TIMEOUT_MAX_SEC) return ASK_TIMEOUT_MAX_SEC;
  return sec;
}

/** 从某个锚点（开窗那一刻，或重连重置那一刻）算出这一扇窗的到点时刻。 */
export function askDeadlineAtMs(anchorMs: number, sec: number): number {
  return anchorMs + clampAskTimeoutSec(sec) * 1000;
}

/** 画面读数：还剩几秒。不足一秒的尾巴向上取整显示，到点归 0，绝不为负。 */
export function remainingAskSec(nowMs: number, deadlineAtMs: number): number {
  const left = deadlineAtMs - nowMs;
  return left <= 0 ? 0 : Math.ceil(left / 1000);
}

/** 到没到点（含边界：正好等于即已到）。 */
export function isAskDeadlineReached(nowMs: number, deadlineAtMs: number): boolean {
  return nowMs >= deadlineAtMs;
}

/**
 * "还差谁没答"的唯一出处＝参加者减去已答过的，**保序**。
 * 窗上那份名单（`ReactionWindowState.participants` / `passed`）本来就是同一批数据，
 * 这里只做减法，不另立一份席位账。
 */
export function waitingSeatsOf(participants: readonly number[], passed: readonly number[]): number[] {
  const answered = new Set(passed);
  return participants.filter(seat => !answered.has(seat));
}

/**
 * 热座（同一台机器多席轮流坐）那一格的判据（业主裁的那一格＝"热座不套倒计时"；
 * 形状由监督台 v5 的 C5 定：无联机房间 且 真人席 > 1）。
 *
 * 这一屏上根本没有"这一席走神了"这件事，套秒表就等于替下一位玩家把上一位的牌打掉 ⇒ 不套。
 * 单机一位真人＋若干电脑 ⇒ 照套（电脑那一席根本不问，`gameStore.endTurn` 那颗门已排除）；
 * 联机 ⇒ 一律照套，哪怕这台机器上只有房主一个真人（客人那边是真会不在屏幕前的）。
 *
 * 两个进料一律由调用方现读递进来，这一格不 import 网络层也不 import store——
 * 进程那一臂（`setup/tableCompute.ts`）文件头禁 netRoom，它若要用这条判据只能当参数传。
 */
export function isHotSeatTable(activeNetRoomPresent: boolean, humanSeatCount: number): boolean {
  return activeNetRoomPresent === false && humanSeatCount > 1;
}

/**
 * 「这一秒该为谁计时」＝**窗身份 + 该答那一席**（业主裁第 4 条「各席各算各的」的落点）。
 *
 * 两扇窗都只读现成的格，这里不扫队列、不重算时机：
 *  - 响应链＝容器窗的 `id` ＋引擎那侧现算出来的此刻欠答者（调用方递 `liveReactionAsk` 的结果）；
 *  - 回合结束＝`turnEndAsk.windowId` ＋`turnEndAsk.playerId`（开窗那一刻算好的两格）。
 *
 * 两条都活着时**响应链排在前面**：不是随手挑一个，而是牌桌上就写着这条规矩
 * （`GameBoard.tsx` 那两扇 HUD 的门是 `reactionAsk && !pendingChoice` 与
 * `turnEndAsk && !pendingChoice && !reactionAsk`）——画面先问哪一扇，秒表就跟着哪一扇走。
 *
 * 抉择窗（`pendingChoice`）不在这张表里（C6）：它是"请选择其一"，没有"不发动"这个出口。
 *
 * `null`＝此刻没有该答的人⇒不起表、锚也清掉。
 *
 * 顺带把**这一把锚属于哪扇窗**一起交回去（`channel`）：到点那一下要按的钮两扇不一样
 * （回合结束＝「都不发动」／响应链＝「跳过」），让调用方再判一次"是哪扇窗"就是第二份账。
 */
export interface AskAnchor {
  key: string;
  channel: 'reaction' | 'turnEnd';
}

export function askAnchorKey(input: {
  reactionWindowId: string | null;
  reactionDebtorId: number | null;
  turnEndWindowId: string | null;
  turnEndDebtorId: number | null;
}): AskAnchor | null {
  if (input.reactionWindowId !== null && input.reactionDebtorId !== null) {
    return { key: `${input.reactionWindowId}|${input.reactionDebtorId}`, channel: 'reaction' };
  }
  if (input.turnEndWindowId !== null && input.turnEndDebtorId !== null) {
    return { key: `${input.turnEndWindowId}|${input.turnEndDebtorId}`, channel: 'turnEnd' };
  }
  return null;
}
