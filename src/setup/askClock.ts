/**
 * 询问窗那把尺（乙 线末片第二刀 · 刀 1 拍 1）。
 *
 * 业主 2026-11-06 裁的原话拆成三条：倒计时是一个**房间参数**（房主开局前定一次，
 * 全员同一个数，客人只读），它**只约束真人席**（AI 席不等，立刻自答），
 * 到点＝系统替那一席按下那条本来就合法的默认选择（回合结束＝都不发动，响应＝跳过，
 * "请选择其一"＝第一项——同一条出路，不新增第三种结果）。
 *
 * 为什么单独成文：三扇窗（抉择／响应链／回合结束）、算牌那臂、界面 tick 要共用一把尺。
 * 放 `gameStore.ts` ⇒ 进程侧用不了（`setup/tableCompute.ts` 文件头明禁 zustand／gameStore）；
 * 放 `engineSteps.ts` ⇒ 把计时塞进判据文件，与那里"窗体本身是画面那半"的纪律打架。
 *
 * 这里只放算得动的纯函数：不碰状态、不碰时钟源（`now` 一律由调用方递进来），
 * 所以同一条窗、同一份读数重复算必然同结果——N3 授权"墙上钟进入判定链"仅限
 * **决定何时发出那条动作**，动作的内容与合法性与钟无关。
 */
import type { PendingChoiceOption } from '../core/GameState';

export const ASK_TIMEOUT_DEFAULT_SEC = 30;
export const ASK_TIMEOUT_MIN_SEC = 15;
export const ASK_TIMEOUT_MAX_SEC = 90;

/**
 * 房主开局前那一格曾经能挑的五个数（`ASK_TIMEOUT_CHOICES_SEC`）。
 *
 * ⚠️ 实话：它**曾经是那五颗按钮的出处**，现在已被滑块取代（业主 2026-11-06 原话
 * 「做一个像现在调整抽卡数量一样的滑动块」）⇒ 生产代码里没有任何一处再读它，
 * 界面那枚滑块只认 `ASK_TIMEOUT_MIN_SEC`／`ASK_TIMEOUT_MAX_SEC` 这两个边界。
 * 留着它是因为刀 1 拍 1 那本在册证人还在量这条尺（范围内、含默认值、升序）；
 * 它不构成第二套账——**不许**被界面某处偷偷读回去。
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
 * 三扇窗都只读现成的格，这里不扫队列、不重算时机：
 *  - 抉择窗＝引擎那侧现成的 `pendingChoice.key` ＋`.playerId`（业主 2026-11-06 原话㈠：
 *    "强制'请选择其一'那种窗也要算 30 秒，时间到了默认选第一项"⇒这一扇从此也进表）；
 *  - 响应链＝容器窗的 `id` ＋引擎那侧现算出来的此刻欠答者（调用方递 `liveReactionAsk` 的结果）；
 *  - 回合结束＝`turnEndAsk.windowId` ＋`turnEndAsk.playerId`（开窗那一刻算好的两格）。
 *
 * 三扇同时活着时**按画面的门排死**（`GameBoard.tsx` 那三扇 HUD 的互斥条件＝
 * `pendingChoice` ⇢ `reactionAsk && !pendingChoice` ⇢ `turnEndAsk && !pendingChoice && !reactionAsk`）
 * ⇒ 抉择排最前，其次响应链，最后回合结束。理由与 v5 的 C3 同一条：画面先问哪一扇，
 * 秒表跟着哪一扇走，不许出现"秒表跟着后一扇、钮按的是前一扇"。
 *
 * `null`＝此刻没有该答的人⇒不起表、锚也清掉。
 *
 * 顺带把**这一把锚属于哪扇窗**一起交回去（`channel`）：到点那一下要按的钮三扇不一样
 * （回合结束＝「都不发动」／响应链＝「跳过」／抉择＝那一条 `CHOOSE_OPTION`），
 * 让调用方再判一次"是哪扇窗"就是第二份账。
 */
export interface AskAnchor {
  key: string;
  channel: 'reaction' | 'turnEnd' | 'choice';
}

export function askAnchorKey(input: {
  choiceWindowKey: string | null;
  choiceDebtorId: number | null;
  reactionWindowId: string | null;
  reactionDebtorId: number | null;
  turnEndWindowId: string | null;
  turnEndDebtorId: number | null;
}): AskAnchor | null {
  if (input.choiceWindowKey !== null && input.choiceDebtorId !== null) {
    return { key: `${input.choiceWindowKey}|${input.choiceDebtorId}`, channel: 'choice' };
  }
  if (input.reactionWindowId !== null && input.reactionDebtorId !== null) {
    return { key: `${input.reactionWindowId}|${input.reactionDebtorId}`, channel: 'reaction' };
  }
  if (input.turnEndWindowId !== null && input.turnEndDebtorId !== null) {
    return { key: `${input.turnEndWindowId}|${input.turnEndDebtorId}`, channel: 'turnEnd' };
  }
  return null;
}

/**
 * 抉择窗到点选**哪一项**＝业主原话里那"第一项"，落点写死为「界面排第一、而且这一刻真能
 * 执行的那一项」：`PendingChoiceOption.enabled === false` 那一族（v2.8.11 刀2 的逐项门槛）
 * 会把排在最前的那一项真置灰，硬点它只会被解析器拒成 `CHOICE_OPTION_LOCKED`。
 *
 * 返回 `null`＝这一扇此刻**一项都不合法**（桥接层根本不造全灰窗，出现即状态异常）：
 * 到点那一下**什么都不派**，也不为它另造一条"到点取消"的出路——那种东西今天不存在。
 *
 * 与界面同一份事实、同一个"排第一"的读法（下标＝按钮渲染顺序，见 `GameBoard.tsx` 抉择 HUD
 * 那个 `options.map`）；这里不重算门槛，只认开窗那一刻冻结进状态的那一个 `enabled`。
 */
export function choiceAtDeadlineHit(options: readonly PendingChoiceOption[]): number | null {
  const index = options.findIndex(option => option.enabled !== false);
  return index < 0 ? null : index;
}
