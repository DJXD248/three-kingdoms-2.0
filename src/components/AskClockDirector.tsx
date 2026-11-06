/**
 * 问窗那把表（乙 线末片第二刀 · 刀 1 拍 3 ㈁，2026-11-06）。
 *
 * 全程序**只许有这一枚**询问倒计时用的秒表（v5 的 C1）：`useEffect` 里一枚 `setInterval(…, 1000)`、
 * cleanup 真做、渲染 `null`、挂在 `App.tsx` 里 `<AiDirector />` 旁边只此一处。
 * ⚠️ 绝不复用 `GameBoard.tsx` 受击闪红那一组**故意不做 cleanup** 的定时器——那些是画面特效，
 * 这里的表必须说停就停，两回事（那里的注释也写着"别复用"）。
 *
 * 这一拍只干四件事，判断一律不在这里重写：
 *  ㈠ 这一秒该为谁计时、算不算钟＝`askClock.askAnchorKey` ＋ `askClock.isHotSeatTable`
 *     （热座不套倒计时＝业主裁的那一格；单机一位真人＋电脑照套，因为电脑那一席根本不问）。
 *  ㈡ 起锚＝`askClock.askDeadlineAtMs(nowMs, askTimeoutSec)`，其中 `nowMs` **只在这一拍取一次**
 *     `Date.now()`（C3）；同一把窗换了人答就是换了键＝当场重新起锚（各席各算各的）。
 *  ㈢ 到点只做一件事＝按那颗本来就合法的钮（C4）：回合结束⇒既有的 `skipTurnEndAsk()`
 *     （「都不发动」），响应链⇒既有的 `skipReaction()`（「跳过」）。不新增提交路、
 *     不新增 canonical 动作、不新增第二种判据；录像上与人手点逐字同形。
 *  ㈣ 每秒把锚原样再挂一次（内容一字不变、只换个引用）＝让 HUD 那一行的秒数跟着走。
 *     HUD 显示的数只由 `askClock.remainingAskSec` 算，界面不自己减、也不取 `Date.now()`（C7）。
 *
 * `askClockNowMs()` 是这一拍交出去的那个"现在"：**只有本文件读表**，HUD 拿它去算还剩几秒。
 * 表没跑过＝`0`，而 HUD 在锚为 `null` 时整块不显示秒数（热座／测试台／没开窗都是这一形）。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useGameStore, type GameState } from '../store/gameStore';
import { liveReactionAsk } from '../store/applyCanonicalAction';
import { getActiveRoom, subscribeNetRoom } from '../network/netRoom';
import { askAnchorKey, askDeadlineAtMs, isAskDeadlineReached, isHotSeatTable } from '../setup/askClock';

/** 这一枚表的间隔＝业主裁的那"一次一跳"（秒数本身是房间参数 `askTimeoutSec`，不在这里定）。 */
const ASK_TICK_MS = 1000;

let lastSampleMs = 0;

/** 画面那一行用的"现在"＝本文件上一拍取的那一个数（全树倒计时这条线唯一的读表处）。 */
export function askClockNowMs(): number {
  return lastSampleMs;
}

/** 真人席那一格与 `gameStore.endTurn` 那颗门用的是同一个 `isAi` 读数（C5：不另起一套）。 */
const humanSeatCountOf = (state: Pick<GameState, 'players'>): number =>
  state.players.filter(player => !player.isAi).length;

/** 此刻这一秒该为谁计时（键与出口都只由 `askAnchorKey` 那一处算，这里只搬现成的格）。 */
const anchorOf = (state: Pick<GameState, 'turnEndAsk' | 'reactionWindow' | 'engineState'>) =>
  askAnchorKey({
    reactionWindowId: state.reactionWindow && !state.reactionWindow.closed ? state.reactionWindow.id : null,
    reactionDebtorId: liveReactionAsk({ engineState: state.engineState })?.playerId ?? null,
    turnEndWindowId: state.turnEndAsk?.windowId ?? null,
    turnEndDebtorId: state.turnEndAsk?.playerId ?? null,
  });

const netRoomPresent = () => getActiveRoom() !== null;

/** 到点／起锚／清锚全在这一拍里；不闭包任何渲染值，所以每拍读的都是**此刻**的状态。 */
function askTick(): void {
  const nowMs = Date.now();
  lastSampleMs = nowMs;
  const state = useGameStore.getState();
  const anchor = anchorOf(state);

  if (anchor === null || isHotSeatTable(netRoomPresent(), humanSeatCountOf(state))) {
    if (state.askDeadline !== null) state.setAskDeadline(null);
    return;
  }
  // 换键＝换人答＝当场重新起锚（旧那把窗的到点时刻从此不再算到点）。
  if (state.askDeadline?.key !== anchor.key) {
    state.setAskDeadline({ key: anchor.key, deadlineAtMs: askDeadlineAtMs(nowMs, state.askTimeoutSec) });
    return;
  }
  if (isAskDeadlineReached(nowMs, state.askDeadline.deadlineAtMs)) {
    if (anchor.channel === 'reaction') state.skipReaction();
    else state.skipTurnEndAsk();
    return;
  }
  // 还没到点：把同一把锚原样再交一次（内容一字不变）＝HUD 那一行因此一秒跳一下。
  state.setAskDeadline({ key: anchor.key, deadlineAtMs: state.askDeadline.deadlineAtMs });
}

export default function AskClockDirector() {
  const anchorKey = useGameStore(state => anchorOf(state)?.key ?? null);
  const netRoomPresentNow = useSyncExternalStore(subscribeNetRoom, netRoomPresent, netRoomPresent);
  const humanSeatCount = useGameStore(humanSeatCountOf);
  const hotSeat = isHotSeatTable(netRoomPresentNow, humanSeatCount);

  useEffect(() => {
    if (anchorKey === null || hotSeat) {
      if (useGameStore.getState().askDeadline !== null) askTick();
      return;
    }
    // 开窗那一拍立刻起锚（不等满一秒），画面当场就有那一个数。
    askTick();
    const timer = setInterval(askTick, ASK_TICK_MS);
    return () => { clearInterval(timer); };
  }, [anchorKey, hotSeat]);

  return null;
}
