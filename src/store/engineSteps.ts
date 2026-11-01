/**
 * 乙 线第三片㈂（2026-11-01）＝**把"改引擎的那半"从玩家浏览器里剥出来**。
 *
 * 这一格要搬的是"算牌"本体，不是画面。现场量到的形状＝生产 store 那 14 个入口
 * （`gameStore.ts` 的 `executeDraw`／`confirmDraw`／…／`skipReaction`）每一个都同一种三段式：
 *
 * ```
 * ㈠ 取 actor、建 canonical 动作                ← 引擎那半（谁能动、动的是哪一条）
 * ㈡ dispatchStoreAction(...)                   ← 引擎那半（唯一执行闸口，v2.2.21 常驻容器）
 * ㈢ 认那一身必须出现的事件，认不中就不投        ← 引擎那半（诚实拒绝：没落地绝不说成落地了）
 * ㈣ set({...}) 投影成展示面字段                ← 画面那半（留在浏览器）
 * ```
 *
 * 本文件收 ㈠～㈢，**一条判据都不重抄**；`gameStore.ts` 那 14 处改成调这里的同一个函数，
 * 于是"浏览器里那一局"与"算牌进程里那一局"用的是同一批判据、同一个闸口、同一份拒绝口径。
 * 判据落在证人上（`src/setup/tableCompute.test.ts` ㈡）＝同一份引擎读数＋同一条动作序列，
 * 两臂逐步逐字同读数；不是这句写在注释里就算数。
 *
 * 这里**不许**出现的东西：zustand、React、`localStorage`、`document`/`window`、`gameStore`
 * （store 模块一加载就从本机存档读六格名册＝名册来源裁的是**甲**，进程那份必须由外面交进来，
 * 绝不能靠自己那台机器的存档冒出来）。类型只从 `gameStoreTypes.ts` 取（那里全是 `import type`，
 * esbuild 打包时整行抹掉，不会把 zustand 拖进进程）。
 *
 * 还没搬的（照实说）：人类席回合结束那一扇"逢人就问"的窗——它在浏览器里住在容器层
 * （`turnEndAsk` 是展示字段，不进 EngineState、不进录像）。进程这一侧没有 `set()`，本文件因此
 * 只提供**判据**（`visibleTurnEndAskItems` 问哪几格、`autoFireForcedTurnEnd` 替勾了强制发动的那几枚
 * 自己响），"问完了等谁答、答完了怎么回执"是第四片"逐席私有视图由进程发"那一格。
 */
import { createAction, type GameAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent, GameEventType, ReactionAnsweredData } from '../core/Event';
import type { General } from '../data/generals';
import type { GameCard } from '../data/cards';
import { getReactionAsk, type ReactionAsk } from '../skills/reactionChain';
import {
  listForcedTurnEndActivations,
  listTurnEndAskItems,
  type TurnEndAskItem,
} from '../skills/turnEndSkills';
import type { Position, SkillPromptMode } from './gameStoreTypes';
import { dispatchStoreAction } from './engineExecutionBridge';

/**
 * 引擎那半的入口只需要一件事：一份当前引擎读数。
 * 浏览器递来的是整个 store 快照（`toEngineState` 里那份 `engineState` 优先，展示字段不参与），
 * 进程递来的是宿主自己那份账——两边落进同一个闸口，这就是"同一条路"的落点。
 */
export interface EngineHolder {
  engineState: EngineState;
}

/** 一步转移的共用形状：新读数、这一趟的事件流、以及"那一身必须出现的事件有没有认中"。 */
export interface StepOutcome {
  engineState: EngineState;
  events: GameEvent[];
  /** `requiredEvent` 传 null 时恒为 true（那几条本来就只认引擎自己的 `ACTION_REJECTED`）。 */
  ok: boolean;
  /** 没认中时的那一身名字，给日志与白话说明用。 */
  requiredEvent: GameEventType | null;
}

/**
 * ㈡ ＋ ㈢：一次 dispatch，加"这一步到底落没落地"的判据。
 * `requiredEvent`＝该入口原来写死的那一身（`GENERAL_DEPLOYED`／`SUPPLY_RESOLVED`／
 * `ARMOR_EQUIPPED`／`SKILL_ACTIVATED`／`CHOICE_RESOLVED`／`REACTION_ANSWERED`／`DRAW_CONFIRMED` 之外
 * 的那几个）。认不中就叫没落地：状态一个字节都不投，绝不"半个动作"混过去。
 */
export function runCanonicalStep(
  holder: EngineHolder,
  action: GameAction,
  requiredEvent: GameEventType | null = null,
): StepOutcome {
  const { engineState, events } = dispatchStoreAction(holder, action);
  return {
    engineState,
    events,
    ok: requiredEvent === null || events.some(event => event.type === requiredEvent),
    requiredEvent,
  };
}

// ── 抽牌：`executeDraw` 的那七道归一化闸（引擎那半） ──────────────────────────

export type DrawRejection =
  | 'engineHasNoPendingDraw'
  | 'activeSeatUnavailable'
  | 'baseLossMustBeResolvedFirst'
  | 'normalizedTotalMismatch'
  | 'generalPoolShortage'
  | 'cardPoolShortage'
  | 'engineRefused';

export type CanonicalDrawOutcome =
  | {
      ok: true;
      engineState: EngineState;
      events: GameEvent[];
      /** 这一趟新亮出来的那几张（＝手牌尾部多出来的那段）；展示面用，判据不靠它。 */
      revealed: (General | GameCard)[];
      /** 亮出来的张数对不上该抽的张数（原样保留的那句告警由调用方决定怎么说）。 */
      revealedCountMismatch: boolean;
      playerId: number;
      requestedTotal: number;
    }
  | {
      ok: false;
      reason: DrawRejection;
      /** 引擎侧的事实；展示侧那几格（`drawContext`）由调用方自己带上。 */
      detail: Record<string, unknown>;
      events: GameEvent[];
      playerId: number | null;
    };

/**
 * 抽牌那一步的完整引擎判据。次序照 `executeDraw` 原样搬，一道都不许换：
 * 引擎有没有待发的那格 → 那一席还在不在 → 归一化 → 扣营地损耗结没结 → 总数对不对得上 →
 * 将领池够不够 → 牌堆＋弃堆够不够 → 发出去 → 认 `DRAW` 那身且没有 `ACTION_REJECTED`。
 */
export function executeCanonicalDraw(holder: EngineHolder, fromGeneralPool: number): CanonicalDrawOutcome {
  const engineState = holder.engineState;
  const pendingDraw = engineState.drawState;
  if (!pendingDraw) {
    return { ok: false, reason: 'engineHasNoPendingDraw', detail: {}, events: [], playerId: null };
  }
  const playerId = pendingDraw.playerId;
  const activeEnginePlayer = engineState.players.find(player => player.id === playerId);
  if (!activeEnginePlayer || activeEnginePlayer.isAlive === false) {
    return { ok: false, reason: 'activeSeatUnavailable', detail: { playerId }, events: [], playerId };
  }

  const requestedTotal = Math.max(0, Math.floor(pendingDraw.totalCards));
  const maxFromPool = Math.min(
    requestedTotal,
    Array.isArray(activeEnginePlayer.generalPool) ? activeEnginePlayer.generalPool.length : 0,
  );
  const requestedGeneral = Math.min(Math.max(0, Math.floor(fromGeneralPool)), maxFromPool);
  const requestedCards = Math.max(0, requestedTotal - requestedGeneral);
  const generalAvailable = Array.isArray(activeEnginePlayer.generalPool) ? activeEnginePlayer.generalPool.length : 0;
  const cardAvailable =
    (Array.isArray(engineState.deck) ? engineState.deck.length : 0)
    + (Array.isArray(engineState.discardPile) ? engineState.discardPile.length : 0);

  if (pendingDraw.baseLossPending) {
    return { ok: false, reason: 'baseLossMustBeResolvedFirst', detail: { playerId, totalCards: requestedTotal }, events: [], playerId };
  }
  if (requestedGeneral + requestedCards !== requestedTotal) {
    return {
      ok: false,
      reason: 'normalizedTotalMismatch',
      detail: { requestedGeneral, requestedCards, requestedTotal, generalAvailable, cardAvailable },
      events: [],
      playerId,
    };
  }
  if (requestedGeneral > generalAvailable) {
    return { ok: false, reason: 'generalPoolShortage', detail: { requestedGeneral, generalAvailable }, events: [], playerId };
  }
  if (requestedCards > cardAvailable) {
    return { ok: false, reason: 'cardPoolShortage', detail: { requestedCards, cardAvailable }, events: [], playerId };
  }

  const beforeHand = Array.isArray(activeEnginePlayer.hand) ? activeEnginePlayer.hand.length : 0;
  const { engineState: next, events } = dispatchStoreAction(
    holder,
    createAction('DRAW', activeEnginePlayer.id, {
      fromGeneralPool: requestedGeneral,
      fromCardPool: requestedCards,
      reason: pendingDraw.reason,
    }),
  );
  const rejected = events.find(event => event.type === 'ACTION_REJECTED');
  const drawEvent = events.find(event => event.type === 'DRAW');
  if (rejected || !drawEvent) {
    return {
      ok: false,
      reason: 'engineRefused',
      detail: {
        rejected: rejected?.data ?? rejected ?? null,
        pendingDraw,
        requestedGeneral,
        requestedCards,
      },
      events,
      playerId,
    };
  }

  const updatedPlayer = next.players.find(player => player.id === activeEnginePlayer.id);
  const afterHand = Array.isArray(updatedPlayer?.hand) ? updatedPlayer.hand : [];
  const revealed = afterHand.slice(beforeHand) as (General | GameCard)[];
  return {
    ok: true,
    engineState: next,
    events,
    revealed,
    revealedCountMismatch: revealed.length !== requestedTotal,
    playerId: activeEnginePlayer.id,
    requestedTotal,
  };
}

/**
 * 待发的那一格到底该派给谁（引擎侧真值）。`confirmDraw` 在浏览器里读的是展示面
 * `drawContext.playerId`，进程里没有那一格——两边同一把尺：投影对得上的时候两个号必然同一个。
 */
export function pendingDrawSeatId(engineState: EngineState): number | null {
  return engineState.drawState?.playerId ?? null;
}

/** 当前行棋那一席（引擎侧真值，同上）。 */
export function currentSeatId(engineState: EngineState): number | null {
  return engineState.currentPlayerId ?? null;
}

/**
 * 此刻有没有一扇等人点头的响应欠账、该哪一席答（v2.8.22 #71）。
 * 仍是 `getReactionAsk` 那一处唯一推导点——本函数只是把"谁该答"这一格递出去，
 * 让进程宿主与 AI 司机按同一句判断，而不是各抄一份"队列非空＝有问句"。
 */
export function reactionAskSeat(engineState: EngineState): ReactionAsk | null {
  const queue = engineState?.pendingReaction;
  if (!queue || queue.nodes.length === 0) return null;
  return getReactionAsk(engineState);
}

/** 冻结世界那格欠账的债主（2.6.3；引擎侧真值）。 */
export function pendingChoiceSeatId(engineState: EngineState): number | null {
  return engineState.pendingChoice?.playerId ?? null;
}

// ── 开局那一下：`confirmDraft` 最后一席确认之后的 `BEGIN_DRAW` ────────────────

export interface BeginDrawOutcome extends StepOutcome {
  /** 引擎确实挂上了待发的那格；原口径里"没挂上就是失败"，绝不静默开局。 */
  started: boolean;
}

export function beginInitialDraw(holder: EngineHolder, playerId: number): BeginDrawOutcome {
  const { engineState, events } = dispatchStoreAction(
    holder,
    createAction('BEGIN_DRAW', playerId, { reason: 'initial', playerId, totalCards: 5 }),
  );
  const drawRequired = events.some(event => event.type === 'DRAW_REQUIRED');
  return {
    engineState,
    events,
    ok: drawRequired && !!engineState.drawState,
    requiredEvent: 'DRAW_REQUIRED',
    started: drawRequired && !!engineState.drawState,
  };
}

// ── 响应链问答的两个出口（v2.8.22 #71）──────────────────────────────────────

export type ReactionAnswerRejection = 'noOutstandingAsk' | 'optionNotOnTheAsk';

export type ReactionAnswerOutcome =
  | { ok: true; engineState: EngineState; events: GameEvent[]; answered: ReactionAnsweredData; ask: ReactionAsk }
  | { ok: false; reason: ReactionAnswerRejection; engineState: null; events: GameEvent[]; ask: ReactionAsk | null };

/**
 * 「该谁答、答哪一格」永远由引擎现算（`getReactionAsk`＝唯一推导点），调用方只能递
 * "想发动哪一枚"。跳过那一手＝`skillId` 传 null，出口恒常存在（§12-61 问窗必有出口）。
 * 热座点按钮、AI 司机挑动作、将来进程收客人那一条表态，三条路都落在这同一个函数上。
 */
export function answerReaction(holder: EngineHolder, skillId: string | null, generalId: string | null): ReactionAnswerOutcome {
  const ask = getReactionAsk(holder.engineState);
  if (!ask) return { ok: false, reason: 'noOutstandingAsk', engineState: null, events: [], ask: null };
  const option = skillId === null
    ? undefined
    : ask.options.find(entry => entry.skillId === skillId && entry.generalId === generalId);
  if (skillId !== null && !option) {
    return { ok: false, reason: 'optionNotOnTheAsk', engineState: null, events: [], ask };
  }

  const action = skillId === null
    ? createAction('SKIP_REACTION', ask.playerId, { nodeKey: ask.nodeKey })
    : createAction('ACTIVATE_SKILL', ask.playerId, { skillId, generalId });
  const { engineState, events } = dispatchStoreAction(holder, action);
  const answered = events.find(event => event.type === 'REACTION_ANSWERED')?.data as ReactionAnsweredData | undefined;
  if (!answered) {
    // 这一句表态没能记进事件流（门槛不过／问句已换人）⇒算没落地，一问一答都不许改账。
    return { ok: false, reason: 'optionNotOnTheAsk', engineState: null, events, ask };
  }
  return { ok: true, engineState, events, answered, ask };
}

// ── 回合结束询问窗的判据（2.3.1／2.8.17 两档；窗体本身仍是画面那半）──────────

/** 两档的唯一分档处，原样从 store 里搬出来：智能＝只列可发动的，完整＝全列、不可发动的写明原因。 */
export function visibleTurnEndAskItems(
  engineState: EngineState,
  playerId: number,
  mode: SkillPromptMode,
): TurnEndAskItem[] {
  const items = listTurnEndAskItems(engineState, playerId);
  return mode === 'full' ? items : items.filter(item => item.activatable);
}

export interface TurnEndFireHost extends EngineHolder {
  activateTurnEndSkill: (skillId: string, generalId: string) => boolean;
}

/**
 * 轮到结束这一刻，勾了「强制发动」的定义不进那扇逢人就问的窗，由系统替这一席发动（v2.9.17）。
 * 每发完一枚都从**新状态**重推候选，绝不一开始抓快照清单；`declined` 只防同一枚被反复重试
 * （引擎按"宁可不发，绝不空耗"退回时算一次拒，不再碰它）。读 host 用 thunk 而不是抓一份快照＝
 * 浏览器那侧每次读到的都是 `get()` 的新对象，进程那侧读到的是宿主自己那份账——同一句"读新的"。
 */
export function autoFireForcedTurnEnd(readHost: () => TurnEndFireHost, playerId: number): void {
  const declined = new Set<string>();
  for (let step = 0; step < 64; step += 1) {
    const current = readHost();
    if (current.engineState.currentPlayerId !== playerId) return;
    const next = listForcedTurnEndActivations(current.engineState, playerId)
      .find(candidate => !declined.has(candidate.definition.id));
    if (!next) return;
    if (!current.activateTurnEndSkill(next.definition.id, next.generalId)) {
      declined.add(next.definition.id);
    }
  }
}

/**
 * 牌桌上那几条"改引擎"的步，各自的 **㈠ 建动作 ＋ ㈡ 过闸 ＋ ㈢ 认那一身事件** 都收在这几个函数里。
 * 唯一的例外是 `actorId`（该哪一席动手）：浏览器按展示面 `players[currentPlayerIndex]` 解析、
 * 进程按引擎真值 `engineState.currentPlayerId` 解析，由调用方各解各的、当参数递进来。
 * 投影（`set()`）一律不在这里——那是画面那半。
 */
export function confirmDrawStep(holder: EngineHolder, playerId: number, reason: string): StepOutcome {
  return runCanonicalStep(holder, createAction('CONFIRM_DRAW', playerId, { reason }));
}

export function resolveBaseLossStep(holder: EngineHolder, playerId: number, reason: string): StepOutcome {
  return runCanonicalStep(holder, createAction('RESOLVE_BASE_LOSS', playerId, { reason }));
}

export interface DrawLossOutcome extends StepOutcome {
  /** 赔完基础伤害后那张"回合开始、0 张"的空窗有没有顺手关掉（两臂共用这一句判据）。 */
  followUpApplied: boolean;
}

/**
 * 营地欠损结完那一步的完整引擎判据：先 `RESOLVE_BASE_LOSS`，再看引擎新状态里是不是
 * 剩下一张 `turnStart`／0 张／不再欠损的空窗——那种窗没有任何牌可亮，留着只会把这一席
 * 卡在一扇问不出话的窗上，所以当场关掉。
 * 原来这一条只写在 `gameStore.resolvePendingDrawLoss` 里；搬到这里＝进程宿主不必（也不许）
 * 再抄第二份。两臂各自读的那一席／那一身 reason 仍由调用方解析后当参数递进来。
 */
export function resolveDrawBaseLoss(holder: EngineHolder, playerId: number, reason: string): DrawLossOutcome {
  const first = resolveBaseLossStep(holder, playerId, reason);
  const nextDraw = first.engineState.drawState;
  if (nextDraw && nextDraw.reason === 'turnStart' && nextDraw.totalCards === 0 && !nextDraw.baseLossPending) {
    const followUp = confirmDrawStep({ ...holder, engineState: first.engineState }, nextDraw.playerId, nextDraw.reason);
    return {
      engineState: followUp.engineState,
      events: [...first.events, ...followUp.events],
      ok: first.ok && followUp.ok,
      requiredEvent: first.requiredEvent,
      followUpApplied: true,
    };
  }
  return { ...first, followUpApplied: false };
}

export function deployGeneralStep(
  holder: EngineHolder,
  actorId: number,
  general: General,
  slot: number,
  consumeCards: (General | GameCard)[],
): StepOutcome {
  return runCanonicalStep(
    holder,
    createAction('DEPLOY_GENERAL', actorId, { general, slot, consumeCards }),
    'GENERAL_DEPLOYED',
  );
}

export function moveGeneralStep(
  holder: EngineHolder,
  actorId: number,
  generalId: string,
  target: Position,
  consumeCard: General | GameCard | undefined,
  sandboxAllowArming?: boolean,
): StepOutcome {
  return runCanonicalStep(holder, createAction('MOVE_GENERAL', actorId, {
    generalId,
    target,
    consumeCard,
    // 演练场（沙盒）旁路：整备中的将允许移动。GameBoard／AI／进程都不传⇒正式玩法不受影响。
    ...(sandboxAllowArming === true ? { sandboxAllowArming: true } : {}),
  }));
}

export function attackStep(
  holder: EngineHolder,
  actorId: number,
  attackerId: string,
  targetId: string,
  ranged: boolean,
  consumeCard: General | GameCard | undefined,
): StepOutcome {
  return runCanonicalStep(holder, createAction('ATTACK', actorId, {
    attackerId,
    targetId,
    ranged,
    consumeCard: consumeCard ?? null,
  }));
}

export function supplyStep(
  holder: EngineHolder,
  actorId: number,
  generalId: string,
  consumeCards: (General | GameCard)[],
): StepOutcome {
  return runCanonicalStep(holder, createAction('SUPPLY', actorId, { generalId, consumeCards }), 'SUPPLY_RESOLVED');
}

export function armGeneralStep(
  holder: EngineHolder,
  actorId: number,
  generalId: string,
  armorCards: GameCard[],
): StepOutcome {
  return runCanonicalStep(holder, createAction('EQUIP_ARMOR', actorId, { generalId, armorCards }), 'ARMOR_EQUIPPED');
}

export function activateSkillStep(
  holder: EngineHolder,
  actorId: number,
  skillId: string,
  generalId: string,
): StepOutcome {
  return runCanonicalStep(holder, createAction('ACTIVATE_SKILL', actorId, { skillId, generalId }), 'SKILL_ACTIVATED');
}

export function chooseOptionStep(holder: EngineHolder, playerId: number, choiceKey: string, optionIndex: number): StepOutcome {
  return runCanonicalStep(holder, createAction('CHOOSE_OPTION', playerId, { choiceKey, optionIndex }), 'CHOICE_RESOLVED');
}

export function endTurnStep(holder: EngineHolder, actorId: number): StepOutcome {
  return runCanonicalStep(holder, createAction('END_TURN', actorId));
}

export function surrenderStep(holder: EngineHolder, playerId: number): StepOutcome {
  return runCanonicalStep(holder, createAction('SURRENDER', playerId));
}

/** 结算完会不会终局：两臂共用的这一句把"还剩几席活着"这一条判据也收成一处。 */
export function survivingSeats(engineState: EngineState): EnginePlayer[] {
  return engineState.players.filter(player => player.isAlive !== false);
}
