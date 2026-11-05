/**
 * 乙 线第三片㈂（2026-11-01）＝**算牌进程那一侧的宿主**。
 *
 * 上一片（`openingCompute.ts`）把开局那四步搬到浏览器外面跑通了；那一步之后牌局要接着往下走，
 * 往下走靠的就是这一份。它不是第二套规则——它一个判据都没写，只做两件事：
 *
 *  ㈠ 拿住一份引擎读数（`host.engineState`），每迈一步就把闸口退回的新读数换上；
 *  ㈡ 把 `applyCanonicalAction` 要的那 14 个入口按**进程侧的真值**解出来（该哪一席动手）。
 *
 * 真正的"这一步该怎么走、走不通怎么拒绝"全在 `store/engineSteps.ts`，与玩家浏览器里那份
 * `gameStore` 调的是同一批函数、过的是同一个闸口。两臂唯一合法的差别只剩一件＝**怎么知道现在轮到谁**：
 * 浏览器按展示面 `players[currentPlayerIndex]`／`drawContext.playerId` 解析，
 * 进程没有那些展示字段，按引擎真值 `engineState.currentPlayerId`／`drawState.playerId`／
 * `pendingChoice.playerId` 解析。投影（`set()`、`players`、`cardDeck`、`drawContext`…）一概不做——
 * 那是画面那半，进程不参与画面（用户裁：算牌那台机器换一台／一个人不参与打牌＝档二）。
 *
 * 这里**不许**出现的东西（证人钉在 `tableCompute.test.ts` ㈠）：`zustand`、`gameStore`、
 * `localStorage`／`sessionStorage`、`document`／`window`、Node 的 `fs`。
 * 最后那一条是有讲究的：`gameStore` 一加载就从本机那六格存档读名册，进程要是 import 它，
 * 名册就会从"这台机器自己的存档"里冒出来——而名册来源裁的是**甲**（开房间那位玩家把本机那份
 * 交给算牌机器），那份必须由外面交进来，绝不能靠宿主自带的存档冒充。
 *
 * ⚠️ 本份**没有**搬的东西（照实说，不许糊）：人类席回合结束那一扇"逢人就问"的窗。
 * `turnEndAsk` 住在容器层、是展示字段，既不进 EngineState 也不进录像，进程这一侧没有 `set()`
 * 也就没有那扇窗；`endTurn` 因此＝先把勾了「强制发动」的那几枚替这一席自己响掉（`autoFireForcedTurnEnd`
 * ＝与浏览器同一份判据），然后**直接提交** `END_TURN`。这与浏览器里 AI 席那条路逐字同形，
 * 与人类席那条路差一步"问人"。
 * 末片第一刀（2026-11-05）把这一拍**拆成两拍**：新出口 `holdTurnEndForAnswer` 只响强制发动、
 * 把"该问哪几格"原样回话，清单非空就**不提交**——进程头一次能停在"该问人"这一拍上（证人钉在
 * `tableCompute.test.ts` 末片那一段）。停下来之后还差后半句：**这一格送到谁的屏上、玩家勾完怎么回执**，
 * 归界面与措辞那一格（末片第二刀，等业主裁）。今天生产画面里那扇窗照旧住在开房间那位的浏览器
 * （`store/gameStore.ts` 的 `endTurn`），这一刀对它一个字都没动，也不许提前写成"另一台机器在算牌"。
 */
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import type { General } from '../data/generals';
import type { GameCard } from '../data/cards';
import type { SetupPlayerSeed } from './runtimeSetup';
import { applyCanonicalAction, type CanonicalActionHost } from '../store/applyCanonicalAction';
import { storeStateToEngineState } from '../store/gameStateAdapter';
import { probeSeatActions } from '../store/engineExecutionBridge';
import type { SkillPromptMode } from '../store/gameStoreTypes';
import type { TurnEndAskItem } from '../skills/turnEndSkills';
import {
  activateSkillStep,
  answerReaction,
  attackStep,
  armGeneralStep,
  autoFireForcedTurnEnd,
  chooseOptionStep,
  confirmDrawStep,
  currentSeatId,
  deployGeneralStep,
  endTurnStep,
  executeCanonicalDraw,
  moveGeneralStep,
  pendingChoiceSeatId,
  pendingDrawSeatId,
  reactionAskSeat,
  resolveDrawBaseLoss,
  supplyStep,
  surrenderStep,
  visibleTurnEndAskItems,
  type TurnEndFireHost,
} from '../store/engineSteps';

/** 进程宿主：一份引擎读数 ＋ 牌桌那 14 个入口（与 `GameState` 同一个结构化口子）。 */
export type TableHost = CanonicalActionHost;

/**
 * 造一份进程侧牌桌宿主。`initial` 从外面进来（开局那四步的产物／交上来的名册算出来的那份），
 * 本函数**不读任何本机状态**：名册不在这条路上，它只接已经算好的那份读数。
 */
export function createTableHost(initial: EngineState): TableHost {
  const host: TableHost = {
    engineState: initial,

    // ── 抽牌那两拍 ────────────────────────────────────────────────────────────
    executeDraw(fromPool) {
      const outcome = executeCanonicalDraw(host, fromPool);
      if (!outcome.ok) return false;
      host.engineState = outcome.engineState;
      return true;
    },
    confirmDraw() {
      const playerId = pendingDrawSeatId(host.engineState);
      if (playerId === null) return;
      const step = confirmDrawStep(host, playerId, host.engineState.drawState?.reason ?? 'turnStart');
      host.engineState = step.engineState;
    },
    resolvePendingDrawLoss() {
      const draw = host.engineState.drawState;
      if (!draw?.baseLossPending) return;
      const outcome = resolveDrawBaseLoss(host, draw.playerId, draw.reason);
      host.engineState = outcome.engineState;
    },

    // ── 行棋那几步：actor 一律按引擎真值解析（浏览器那侧按展示面，同一条动作、两个解法） ──
    deployGeneral(general, slot, consumeCards) {
      const step = deployGeneralStep(host, currentSeatId(host.engineState) ?? 0, general, slot, consumeCards);
      if (!step.ok) return false;
      host.engineState = step.engineState;
      return true;
    },
    moveGeneral(generalId, target, consumeCard, sandboxAllowArming) {
      const step = moveGeneralStep(host, currentSeatId(host.engineState) ?? 0, generalId, target, consumeCard, sandboxAllowArming);
      host.engineState = step.engineState;
    },
    attackTarget(attackerId, targetId, ranged, consumeCard) {
      const step = attackStep(host, currentSeatId(host.engineState) ?? 0, attackerId, targetId, ranged, consumeCard);
      host.engineState = step.engineState;
    },
    supplyGeneral(generalId, cards) {
      const seat = currentSeatId(host.engineState);
      if (seat === null) return;
      const step = supplyStep(host, seat, generalId, cards);
      if (!step.ok) return;
      host.engineState = step.engineState;
    },
    armGeneral(generalId, armorCards) {
      const seat = currentSeatId(host.engineState);
      if (seat === null) return false;
      const step = armGeneralStep(host, seat, generalId, armorCards);
      if (!step.ok) return false;
      host.engineState = step.engineState;
      return true;
    },

    // ── 两条发动路：响应链那一格由引擎现算"该谁答"，调用方只能点名技能（与热座、AI 同一份） ──
    activateTurnEndSkill(skillId, generalId) {
      const seat = currentSeatId(host.engineState);
      if (typeof seat !== 'number') return false;
      const step = activateSkillStep(host, seat, skillId, generalId);
      if (!step.ok) return false;
      host.engineState = step.engineState;
      return true;
    },
    activateReactionSkill(skillId, generalId) {
      const answer = answerReaction(host, skillId, generalId);
      if (!answer.ok) return false;
      host.engineState = answer.engineState;
      return true;
    },
    skipReaction() {
      const answer = answerReaction(host, null, null);
      if (!answer.ok) return false;
      host.engineState = answer.engineState;
      return true;
    },
    chooseOption(optionIndex) {
      const pending = host.engineState.pendingChoice;
      const seat = pendingChoiceSeatId(host.engineState);
      if (!pending || seat === null) return false;
      const step = chooseOptionStep(host, seat, pending.key, optionIndex);
      if (!step.ok) return false;
      host.engineState = step.engineState;
      return true;
    },

    // ── 结束回合：先替这一席把勾了「强制发动」的定义响掉，再提交。窗那一格见文件头 ⚠️ ──
    endTurn() {
      const seat = currentSeatId(host.engineState);
      if (typeof seat !== 'number') return;
      autoFireForcedTurnEnd(() => host as TurnEndFireHost, seat);
      if (host.engineState.phase === 'gameOver') return;
      const step = endTurnStep(host, seat);
      host.engineState = step.engineState;
    },
    surrender(playerId) {
      const step = surrenderStep(host, playerId);
      host.engineState = step.engineState;
    },
  };
  return host;
}

/**
 * 这一席此刻"逢人就问"该问哪几格——进程把判据原样递出去（`visibleTurnEndAskItems`＝与浏览器同一份），
 * 但**不在这儿等回答**：等谁答、怎么回执归界面与措辞那一格（末片第二刀）。留这一个出口，是为了让
 * 那一格接上时不必再抄第二份分档判据。
 */
export function turnEndAskItemsFor(host: TableHost, playerId: number, mode: SkillPromptMode) {
  return visibleTurnEndAskItems(host.engineState, playerId, mode);
}

/** `holdTurnEndForAnswer` 的回话：`items`＝该问哪几格（同一份分档判据算出来的），`committed`＝这一拍迈没迈出去。 */
export interface TurnEndHold {
  items: TurnEndAskItem[];
  committed: boolean;
}

/**
 * 末片第一刀（2026-11-05）＝把进程那臂的「结束回合」**拆成两拍**里的头一拍：
 * 先替这一席响掉勾了「强制发动」的那几枚，然后把"该问哪几格"原样回话；
 * **清单非空⇒不提交**（`turn`／`currentPlayerId`／`phase` 一格都不动），**清单空⇒与 `endTurn()` 同形**、
 * 当场提交。第二拍就是既有那个"响完就提交"的 `endTurn()`——它一个字没改，开工前既有的 **6** 个调用点
 * （本文件驱动 1＋`seatViewCompute.test.ts` 3＋`seatViewComputeProcess.node.test.ts` 1＋本测试的代理壳 1）
 * 也一行没动；本刀只在测试里另加 2 处直接调用用来与旧臂对形⇒全库 `.endTurn()` 行数实测 47→49，差额正好这 2 处。
 * ⚠️ 派单件 `knife-Y2-mopian-order-v2.md:51` 那句「现有 5 个调用点」是**监督台自己数错了**（同一行括号里列了 6 处）；
 * 施工方按那 6 处保护、没受影响，错的只是那个数。
 *
 * 这一格是给**下一刀**（界面与措辞）接的出口：那一刀要把 `items` 送到该答的那一席屏上、等玩家勾完
 * 再走第二拍。它自己不开窗、不投影、不问人——进程这一侧仍然没有 `set()`，只是从"没有那扇窗"变成
 * "能停在窗该开的那一拍上，并且说得出该问哪几格"。
 *
 * 判据一份都没另写：分档＝`engineSteps.ts:291 visibleTurnEndAskItems`，强制发动＝`:310 autoFireForcedTurnEnd`，
 * 提交＝`endTurnStep`——三样都与浏览器里 `gameStore.endTurn` 调的是同一批函数。解行棋席与 `endTurn()`
 * 用同一句引擎真值（`currentSeatId`），所以"清单空"那一支与今天逐字节同形。
 */
export function holdTurnEndForAnswer(host: TableHost, mode: SkillPromptMode): TurnEndHold {
  const seat = currentSeatId(host.engineState);
  if (typeof seat !== 'number') return { items: [], committed: false };
  autoFireForcedTurnEnd(() => host as TurnEndFireHost, seat);
  // 那几发自己响的有可能把这一局当场打死：终局就到此为止，绝不提交（与 `endTurn()` 同一条兜底）。
  if (host.engineState.phase === 'gameOver') return { items: [], committed: false };
  const items = visibleTurnEndAskItems(host.engineState, seat, mode);
  if (items.length > 0) return { items, committed: false };
  host.engineState = endTurnStep(host, seat).engineState;
  return { items, committed: true };
}

/** 只读探针：这一席现在能走哪几条规范动作（不推进对局、不动游标、不进录像）。 */
export function legalTableActions(host: TableHost, playerId: number): GameAction[] {
  return probeSeatActions(host, playerId);
}

/**
 * 这一步该派给谁（进程侧真值；浏览器那侧读的是展示面，同一条动作、两个解法）。
 * 次序与 AI 司机逐字一致：冻结世界那格 → 抽牌那格 → 响应欠账那一格 → 行棋席。
 */
export function tableActorId(host: TableHost): number | null {
  const state = host.engineState;
  const pending = pendingChoiceSeatId(state);
  if (pending !== null) return pending;
  const draw = pendingDrawSeatId(state);
  if (draw !== null) return draw;
  const ask = reactionAskSeat(state);
  if (ask !== null) return ask.playerId;
  return currentSeatId(state);
}

/**
 * 单步：按当前真值把这一拍迈出去。`pick` 由外面给（策略档、剧本、或第一枚合法动作），
 * 返回 false ＝这一局已经收口（终局／没有行棋席）。
 */
export function stepTable(host: TableHost, pick?: (host: TableHost, playerId: number) => GameAction | null): boolean {
  const state = host.engineState;
  if (state.phase === 'gameOver') return false;

  // 冻结世界那两格优先：只认欠账的那一席，与 AI 司机、热座同一个次序。
  const pending = state.pendingChoice;
  if (pending) {
    const seat = pendingChoiceSeatId(state);
    if (seat === null) return false;
    const action = pick?.(host, seat);
    if (action?.type === 'CHOOSE_OPTION') return applyTableAction(host, seat, action);
    const firstEnabled = pending.options.findIndex(option => option.enabled !== false);
    if (firstEnabled < 0) return false;
    host.chooseOption(firstEnabled);
    return true;
  }

  // 响应链那一格：兜底永远是"跳过"（问窗必有出口 §12-61），队列不卡在一席沉默上。
  const askSeat = tableActorId(host);
  if (state.pendingReaction && askSeat !== null) {
    const action = pick?.(host, askSeat);
    if (action && (action.type === 'ACTIVATE_SKILL' || action.type === 'SKIP_REACTION')) {
      return applyTableAction(host, askSeat, action);
    }
    host.skipReaction();
    return true;
  }

  const draw = state.drawState;
  if (draw) {
    if (draw.baseLossPending) {
      host.resolvePendingDrawLoss();
      return true;
    }
    const action = pick?.(host, draw.playerId);
    const fromPool = action?.type === 'DRAW'
      ? Number((action.payload as { fromGeneralPool?: number } | undefined)?.fromGeneralPool) || 0
      : 0;
    // 进程没有"亮出来的牌等人看"这一拍：抽完就当场把这一格关掉，绝不把窗留在桌上。
    host.executeDraw(fromPool, 0);
    host.confirmDraw();
    return true;
  }

  const seat = currentSeatId(state);
  if (typeof seat !== 'number') return false;
  const action = pick?.(host, seat) ?? legalTableActions(host, seat)[0] ?? null;
  if (action && action.type !== 'END_TURN') {
    if (applyTableAction(host, seat, action)) return true;
  }
  host.endTurn();
  return host.engineState.phase !== 'gameOver';
}

/** 进程侧的"一枚合法动作⇒牌桌一步"＝与 AI 司机、联机客人同一个翻译出口。 */
export function applyTableAction(host: TableHost, playerId: number, action: GameAction): boolean {
  return applyCanonicalAction(host, playerId, action);
}

// ── 开局那份账 ⇒ 引擎那份账（㈂ 才有的这一段：第一片只算到"牌桌上的料"，往下一拍都靠这里） ──

/**
 * 把 `openingCompute.ts` 那份开局面账换成引擎认的那份读数，交给 `createTableHost`。
 * 走的是**生产那份镜像**（`storeStateToEngineState`，浏览器 store 每步投影也过它），
 * 不在这里重抄任何规则：席位面／洗好的牌堆／游标都原样递进去，落定的 10 张挂回 `generalPool`。
 * 那颗游标必须显式带上——镜像没有 `engineState.rngState` 可读时自己会去摸 `Date.now()^Math.random()`，
 * 那样这一局就不可复现了（乙 线第 0 步量到的那条物理实话）。
 */
export function openingToEngineState(opening: {
  rng: number;
  deck: GameCard[];
  players: SetupPlayerSeed[];
  seats: { playerId: number; picks: General[] }[];
}): EngineState {
  const picks = new Map(opening.seats.map(seat => [seat.playerId, seat.picks]));
  return storeStateToEngineState({
    phase: 'playing',
    turnPhase: 'main',
    currentRound: 1,
    isFirstTurn: true,
    currentPlayerIndex: 0,
    players: opening.players.map(seed => ({
      ...seed,
      generalPool: picks.get(seed.id) ?? [],
      hand: [],
    })),
    cardDeck: opening.deck,
    discardPile: [],
    drawContext: null,
    engineState: { rngState: { s: opening.rng >>> 0 } },
  });
}

/** 把这一局跑到底（或跑到 `maxSteps`）。CLI 与证人共用这一个循环。 */
export function playTable(
  host: TableHost,
  options: {
    maxSteps?: number;
    pick?: (host: TableHost, playerId: number) => GameAction | null;
    onStep?: (host: TableHost, step: number) => void;
  } = {},
): { steps: number; phase: EngineState['phase']; winnerId: number | null } {
  const maxSteps = options.maxSteps ?? 3000;
  let step = 0;
  for (; step < maxSteps; step += 1) {
    if (host.engineState.phase === 'gameOver') break;
    if (!stepTable(host, options.pick)) break;
    options.onStep?.(host, step);
  }
  const alive = host.engineState.players.filter(player => player.isAlive !== false);
  return {
    steps: step,
    phase: host.engineState.phase,
    winnerId: host.engineState.phase === 'gameOver' && alive.length === 1 ? alive[0]!.id : null,
  };
}
