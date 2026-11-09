/**
 * 窄投影问面色（刀 2 ＝ 客人屏幕问得出来）。
 *
 * 房主算佳的 "逢人就问" 那几格只把题面/候选/可否/原因送过去，效果与牌面引用留在房主侧：
 * 这一份里**没有** `events`、`cardKeys`、选择肢内部引用——所有会打开"做了什么、由哪张卡
 * 触发"的字段全部不出这一道。`NEVER_SENT_TOP_LEVEL` 的三样（`rngState`/`pendingChoice`/
 * `pendingReaction`）同样不在这几格上，客人不碰引擎过程、也不知道房主那台机器的
 * 随机游标长什么样。
 *
 * 行色只一处在产：房主把容器层那几分（`turnEndAsk` 题面＋`reactionWindow` 的答者账）
 * 拖出去，每席投一帧（`t:'snapshot'` 信封的 `to` 指名到欠答那一席；别席收到的那一份
 * 只有题目没有候选）。客端收到后由 `netRoom` 收进一格，界面（同一段写法）照原文读。
 */
import type { TurnEndAsk, TurnEndAskCandidate } from '../store/gameStoreTypes';
import type { ReactionWindowState } from '../triggers/types';
import { waitingSeatsOf } from '../setup/askClock';

/** 窄投影里的一张候选：题面/能否/原因，不多加一格。 */
export type NarrowCandidate = {
  skillId: string;
  generalId: string;
  generalName: string;
  skillName: string;
  description: string;
  activatable: boolean;
  disabledReason: string | null;
};

/** 同 `TurnEndAskCandidate`，但只装这一层：写代码的人必须知道"这一格跨了线"，不能拿原格进线。 */
export type NarrowQuestionTurnEnd = {
  playerId: number;
  windowId: string;
  candidates: NarrowCandidate[];
};

/**
 * 除了题面，再递一格里 "还差谁没答"（各席各算各的，保序的席位号）——
 * 坐在欠答那一席的人拿题面，屋里所有人类似见那一份 `waitingSeats`。
 * 这里的席位号就是引擎的 playerId，与 `netSeat.buildSeatMap` 同一口径。
 */
export type NarrowQuestionFace = {
  turnEndAsk?: NarrowQuestionTurnEnd;
  /** 窗口还差哪些席（参加者减去已答过的，原序）；没有挂窗＝空列表。 */
  waitingSeats: number[];
};

/** 对号入座：窗的候选出自 `toTurnEndAskCandidate`，进线只查这一份照抄。 */
function toNarrowCandidate(c: TurnEndAskCandidate): NarrowCandidate {
  return {
    skillId: c.skillId,
    generalId: c.generalId,
    generalName: c.generalName,
    skillName: c.skillName,
    description: c.description,
    activatable: c.activatable,
    disabledReason: c.disabledReason,
  };
}

/**
 * 把 `turnEndAsk` 那一份（已经窄色，但在产出格上再甩一遍）变成无线格式。
 * 不加 `pendingChoice`——`NEVER_SENT_TOP_LEVEL` 不放开；等它决定再上道。
 * 这三扇窗同一时间只开一扇，`turnEndAsk` 是备盘：窗后头挂着别的栏，这里不查。
 */
export function narrowTurnEndAskFace(ask?: TurnEndAsk): NarrowQuestionTurnEnd | null {
  if (!ask) return null;
  return {
    playerId: ask.playerId,
    windowId: ask.windowId,
    candidates: ask.candidates.map(toNarrowCandidate),
  };
}

/**
 * 把窗口答者账拆成"还差的"：读容器层现成的两格，走 `waitingSeatsOf` 唯一出处；
 * 不走自己的第二份名单。不读 `gameStore`，所以进程侧也能用。
 */
export function narrowWaitingSeatsOf(
  reactionWindow?: ReactionWindowState | null,
): NarrowQuestionFace['waitingSeats'] {
  return waitingSeatsOf(reactionWindow?.participants ?? [], reactionWindow?.passed ?? []);
}

/** 一角打出：题面＋还差谁能一票收齐（空账本＝两空值，不造第二份账）。 */
export function deriveNarrowQuestionFace(
  turnEndAsk?: TurnEndAsk,
  reactionWindow?: ReactionWindowState | null,
): NarrowQuestionFace {
  return {
    turnEndAsk: narrowTurnEndAskFace(turnEndAsk) ?? undefined,
    waitingSeats: narrowWaitingSeatsOf(reactionWindow),
  };
}
