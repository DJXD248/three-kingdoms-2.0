import type { GameAction } from '../action/ActionTypes';
import type { ResolverRegistry } from '../action/ResolverRegistry';
import type { EventProcessor } from './EventProcessor';
import type { TriggerEngine } from '../triggers/TriggerEngine';
import type { RuleEngine } from '../rules/RuleEngine';
import type { EngineState } from './GameState';
import type { GameEvent, RandomOutcomeData } from './Event';
import { resolveTriggerChain } from './EngineDispatchFlow';
import { echoDuelRounds, isDuelListenerEvent } from './eventProcessors/duelEvents';
import {
  findResumedDuels,
  isReactionSourceEvent,
  reactionQueueFingerprint,
  syncReactionQueue,
} from '../skills/reactionChain';
import type { DrawOutcomeFlow, OverrideFailure } from './eventProcessors/drawEvents';

/**
 * TransitionCore (decision D-1): the ONE pure state transition of the game.
 *
 * `transition(state, action, ctx)` validates the action, resolves it into
 * events, expands the trigger chain, settles everything through the single
 * EventProcessor entry, and runs the bounded death-reentry loop — and nothing
 * else. No snapshots, no EventBus emission, no replay recording, no
 * STATE_CHANGED payload: those are container concerns owned by GameEngine.
 * Both the resident-engine path and the per-step rebuild path (store bridge,
 * battleRunner, ReplayPlayer) funnel through this function, so
 * "resident === rebuilt" is structural, not just tested.
 */

/** Everything transition() needs from its environment. GameEngine satisfies
 * this shape itself; any long-lived container can provide the same ctx. */
export interface TransitionContext {
  readonly rules: RuleEngine;
  readonly resolvers: ResolverRegistry;
  readonly processor: EventProcessor;
  readonly triggers: TriggerEngine;
  /** Replay-only RandomOutcome injection queue (D-2a). Absent/null on every
   * live path — selections then run the seeded RNG and get RECORDED. */
  readonly outcomeOverrides?: readonly RandomOutcomeData[] | null;
  /** v2.5.1 onDeploy wiring (§12-26): container hook that re-derives the
   * skill registrations from the given (post-settlement) state, so listeners
   * created by a GENERAL_DEPLOYED in this dispatch exist before the deploy
   * step is replayed through the trigger chain. Presence-gated: hookless
   * contexts keep the pre-wiring behavior verbatim. */
  readonly resyncSkills?: (state: EngineState) => void;
}

export interface TransitionResult {
  /** Advanced state, or the exact input state reference when rejected. */
  state: EngineState;
  /** ACTION_ACCEPTED + triggered events + reentry-derived events (+ limit
   * marker), or the single ACTION_REJECTED event. Unstamped: EventBus.emit
   * adds id/timestamp at the container layer. */
  events: GameEvent[];
  accepted: boolean;
  /** Recorded overrides that failed strict validation on this dispatch
   * (D-2a bypass, 2.2.23). Out-of-band observation: never part of the
   * event stream, always empty on live paths (no overrides there). */
  overrideFailures: OverrideFailure[];
}

const MAX_TRIGGER_REENTRY_ROUNDS = 8;
/** 决斗续跑的波数上限（跑飞防护，与上面同源思路）：一局里一场决斗最多两层问
 *  答（开局＋收官），4 波已是富余；真到上限就在事件流里留一条如实欠账。 */
const MAX_DUEL_RESUME_WAVES = 4;

export function transition(
  state: EngineState,
  action: GameAction,
  ctx: TransitionContext,
): TransitionResult {
  const validation = ctx.rules.validateAction(state, action);
  if (!validation.valid) {
    const rejected: GameEvent = {
      type: 'ACTION_REJECTED',
      data: { action, reason: validation.reason ?? 'INVALID_ACTION' },
    };
    return { state, events: [rejected], accepted: false, overrideFailures: [] };
  }

  const resolver = ctx.resolvers.getResolver(action);
  if (!resolver) {
    const rejected: GameEvent = {
      type: 'ACTION_REJECTED',
      data: { action, reason: `NO_RESOLVER:${action.type}` },
    };
    return { state, events: [rejected], accepted: false, overrideFailures: [] };
  }

  const events: GameEvent[] = [{ type: 'ACTION_ACCEPTED', data: { action } }];

  const resolvedEvents = resolver.resolve(state, action);
  const triggeredEvents = resolveTriggerChain(state, ctx.triggers, resolvedEvents);
  events.push(...triggeredEvents);

  const flow: DrawOutcomeFlow = { produced: [], overrides: ctx.outcomeOverrides ?? undefined, overridePos: 0 };
  const derived: GameEvent[] = [];
  let next = ctx.processor.process(state, events, derived, flow);

  // 2.8 刀9: a duel's round block is derived inside the queue, so it never
  // reaches `events` by itself (dispatch 不返回内联追加事件). Echo it right
  // after the DUEL event it came from so the log / 录像 / AI report see every
  // round in the order the queue settled them: 各轮伤害 → 同技能后序效果 →
  // 死亡善后。Replay re-dispatches actions (never replays this array), and
  // DAMAGE is not a reaction type, so the echo cannot double-settle.
  echoDuelRounds(events, derived);

  // v2.5.1 onDeploy wiring (§12-26): syncPlayerSkills runs per-dispatch in
  // the container, so a general deployed by THIS action had no listener when
  // the pre-dispatch chain above ran. Resync against the settled state, then
  // replay only this step's GENERAL_DEPLOYED events through the chain.
  // No double-fire: every compiled onDeploy definition pins sourceGeneralId
  // and the bridge condition matches it against the deployed general's
  // runtime id, so a replayed deploy event can only hit the listener owned
  // by that very general — which did not exist before the resync.
  // settleable excludes DEATH/TRIGGERED echoes for the same reason as the
  // death-reentry loop below; deploy-derived DEATHs fold into it via derived.
  const deployedEvents = events.filter(event => event.type === 'GENERAL_DEPLOYED');
  if (deployedEvents.length > 0 && ctx.resyncSkills) {
    ctx.resyncSkills(next);
    const expanded = resolveTriggerChain(next, ctx.triggers, deployedEvents);
    const fresh = expanded.filter(event => !deployedEvents.includes(event));
    events.push(...fresh);
    const settleable = fresh.filter(event => event.type !== 'DEATH' && event.type !== 'TRIGGERED');
    if (settleable.length > 0) {
      const deployDerived: GameEvent[] = [];
      next = ctx.processor.process(next, settleable, deployDerived, flow);
      derived.push(...deployDerived);
    }
  }

  // Skill kills settle inside process(), so their derived DEATH events miss
  // the pre-dispatch trigger chain. Re-enter it (bounded) with post-apply
  // state so onKill/onDeath skills fire for skill kills too. Each derived
  // DEATH already had its state consequences settled where it was derived
  // (chainedConsequences), so re-entry only processes freshly generated
  // events — never the DEATH itself — to avoid double settlement.
  // 2.5.3: the same re-entry now also carries CARD_LOST/CARD_GAINED (derived
  // by the GIVE settlement). They are pure notifications — no EventProcessor
  // case, nothing to double-settle — but they must reach the trigger chain
  // for onCardLost/onCardGained listeners within the same dispatch. The
  // bounded rounds above already cap any give→gain→give pile-up.
  // 注意这个名字里的 "reaction"＝"要重入触发链的衍生事件"，与 v2.8.22 的**响应链**
  // （受击/受伤问答，见下面的 `scanReaction`）是两回事，别混。
  next = runTriggerReentry(next, derived, events, ctx, flow);

  // v2.8.22 响应链执法刀（#71）·结算后扫描：把"这一声要不要有人表态"从触发链的
  // 自动发动搬出来，落成状态里的一个问答队列（乙案＝搬出结算链、同一个窗问答）。
  // 纯派生 of（已结算状态，本次 dispatch 的事件序列）⇒ 常驻/重建/回放三路同果；
  // 只有队列真的变了才写事件，没有变化时事件流逐字不变（旧录像与日志零扰动）。
  // D-2a: every random selection made in this dispatch leaves the pure path
  // as a RANDOM_OUTCOME event (purpose/value/stableId). Stable ids are
  // stamped here from post-transition coordinates; replay forwards the
  // recorded objects verbatim, so live and replay streams stay identical.
  flow.produced.forEach((outcome, index) => {
    if (!outcome.stableId) {
      outcome.stableId = `ro:${next.turn}:${next.round}:${outcome.value.playerId}:${index}`;
    }
    events.push({ type: 'RANDOM_OUTCOME', data: outcome });
  });

  // 位置在所有结算与触发链重入之后：响应链问的是"这一趟结算完的事实"，不参与
  // 触发链本身，也绝不插到 RANDOM_OUTCOME 之前去改动既有事件流的次序。
  let scan = scanReaction(next, events, events, ctx);
  next = scan.state;
  let windowStart = events.length;

  // v2.8.24 决斗刀 2（§H9 第七轮开局格）：开局那一层问完了⇒这一场决斗接着往下
  // 打。每一波都是"结算⇒重入⇒再扫描"，所以答复里回复的体力进了决斗起点、决斗
  // 收官问出来的新格也走同一条扫描（不插队：新格永远排在既有格之后）。
  // 每波之后只把**新增的那一段**事件交给下一次扫描（`windowStart`）：同一段事件
  // 扫两遍会把已经立过格的受击／受伤再开一次格——那是第二个推导点，不是这里。
  const duelKeys = new Set<string>();
  for (let wave = 0; wave < MAX_DUEL_RESUME_WAVES; wave += 1) {
    const pending = scan.resumedDuels.filter(duel => {
      const key = String((duel.data as { duelKey?: unknown } | undefined)?.duelKey ?? '');
      if (!key || duelKeys.has(key)) return false;
      duelKeys.add(key);
      return true;
    });
    if (pending.length === 0) break;
    for (const duelEvent of pending) {
      next = settleDeferredDuel(next, duelEvent, events, ctx, flow);
    }
    scan = scanReaction(next, events.slice(windowStart), events, ctx);
    next = scan.state;
    windowStart = events.length;
  }
  // 如实欠账（与 TRIGGER_REENTRY_LIMIT 同一手法，只记观察标记、不进状态）：
  // 波数用尽还有决斗没续上。真实牌局走不到这里（一层开局＋一层收官＝两波）。
  const stranded = scan.resumedDuels.filter(duel => {
    const key = String((duel.data as { duelKey?: unknown } | undefined)?.duelKey ?? '');
    return key && !duelKeys.has(key);
  });
  if (stranded.length > 0) {
    events.push({ type: 'CUSTOM', data: { kind: 'DUEL_RESUME_LIMIT', pending: stranded.length } });
  }

  return { state: next, events, accepted: true, overrideFailures: flow.diagnostics ?? [] };
}

/** 要重入触发链的衍生事件（名字里的 "reaction"＝"重入"，不是响应链问答）。
 *  决斗刀 2 的收官通知 `DUEL_INJURY` 走的是另一条路（`isDuelListenerEvent`），
 *  不写在这一列里，因为它按**层**认（开局的 `duelStage` 那一声明＋收官那一笔），
 *  而逐轮那些"打"绝不重入——把这一维压进类型集合就等于把"逐轮不响"写丢了。 */
const TRIGGER_REENTRY_TYPES: ReadonlySet<GameEvent['type']> = new Set(['DEATH', 'CARD_LOST', 'CARD_GAINED']);

/**
 * 这一条派生事件要不要过一遍触发链（v2.8.25 强制发动执法刀）。
 *
 * `DUEL_INJURY` 与决斗开局那一声**以前故意不在**这一判据里（§12-55 的口径是
 * "它的听众走响应链问答"）。那句话只到 v2.8.24 为止：问答路的听众是**不强制**的
 * 那一类，而「强制发动」的受击／受伤技压根不进问答队列——两声都不喂给它，
 * 它就在决斗里结构性失聪。分流开关（`defersToReactionQueue`）从此是**唯一**
 * 判据：不强制⇒问人；强制⇒自己响，而"自己响"必须有路喂到它耳边。
 * 绝不一技能两响仍然成立：一枚定义只走一条路，两条路读同一份事件表。
 */
function reentersTriggerChain(event: GameEvent): boolean {
  return TRIGGER_REENTRY_TYPES.has(event.type) || isDuelListenerEvent(event);
}

/**
 * 有界触发链重入（主路与决斗续跑路**共用这一份**）：队列里派生出来的 DEATH／
 * CARD_*／决斗那两层已经在派生点结算过状态，这里只让它们过一遍触发链（onKill／
 * onDeath／手牌监听／决斗的受击与受伤），并且只结算**新造出来**的事件，绝不把
 * 派生事件本身再结算一遍。
 */
function runTriggerReentry(
  state: EngineState,
  derived: readonly GameEvent[],
  events: GameEvent[],
  ctx: TransitionContext,
  flow: DrawOutcomeFlow,
): EngineState {
  let next = state;
  let pendingReactions = derived.filter(reentersTriggerChain);
  for (let round = 0; pendingReactions.length > 0 && round < MAX_TRIGGER_REENTRY_ROUNDS; round += 1) {
    const expanded = resolveTriggerChain(next, ctx.triggers, pendingReactions);
    // 决斗那两层已经在 `echoDuelRounds` 里写进事件流了（同一批对象），这里绝不再
    // 写第二遍；DEATH／CARD_* 反过来——它们唯一的入流处就是这一行，行为逐字不变。
    events.push(...expanded.filter(event => !events.includes(event)));
    const generated = expanded.filter(event => !reentersTriggerChain(event) && event.type !== 'TRIGGERED');
    const nextDerived: GameEvent[] = [];
    next = ctx.processor.process(next, generated, nextDerived, flow);
    pendingReactions = nextDerived.filter(reentersTriggerChain);
  }
  if (pendingReactions.length > 0) {
    events.push({ type: 'CUSTOM', data: { kind: 'TRIGGER_REENTRY_LIMIT', pendingReactions: pendingReactions.length } });
  }
  return next;
}

/**
 * 一场被开局问答延后的决斗的续跑（§H9 第七轮"这一层全部响完，决斗才开始"）。
 *
 * 令＝那条 `DUEL{duelStage:'answered'}`；它的逐轮与收官那笔由**同一个派生点**
 * （`eventProcessors/duelEvents.ts`）在**答复落账之后**的状态上再算一次，整块前置
 * 结算，随后走与主路同一份重入（阵亡者的遗言与击破补偿抽照旧同一条 FIFO）。
 * 这里不造任何游戏事实，只决定"什么时候把令交下去"。
 */
function settleDeferredDuel(
  state: EngineState,
  duelEvent: GameEvent,
  events: GameEvent[],
  ctx: TransitionContext,
  flow: DrawOutcomeFlow,
): EngineState {
  events.push(duelEvent);
  const derived: GameEvent[] = [];
  const settled = ctx.processor.process(state, [duelEvent], derived, flow);
  echoDuelRounds(events, derived);
  return runTriggerReentry(settled, derived, events, ctx, flow);
}

/**
 * 结算后的响应链扫描（#71 的唯一调用点，决斗刀 2 起它同时报告"哪些决斗该续跑"）。
 *
 * 触发条件先做免费闸：这一趟既没有可响应的一声（受击／受伤，且非决斗逐轮）、
 * 状态里也没有待答队列 ⇒ 原样返回，事件流一个字都不动。这条闸是"旧对局零扰动"
 * 的构造保证，不是优化。
 *
 * 队列没变（指纹相同）也不写事件——只有真的收格／开格／记账才落一条
 * `REACTION_QUEUE_SYNCED`，并经唯一突变入口 `EventProcessor` 落槽。封顶丢格是
 * 如实账：与 `TRIGGER_REENTRY_LIMIT` 同一手法，只往事件流里记一条 CUSTOM 观察
 * 标记，不进状态。
 */
function scanReaction(
  state: EngineState,
  dispatchEvents: readonly GameEvent[],
  events: GameEvent[],
  ctx: TransitionContext,
): { state: EngineState; resumedDuels: GameEvent[] } {
  const before = state.pendingReaction ?? null;
  const hasSource = dispatchEvents.some(event => isReactionSourceEvent(event));
  let next = state;
  let after = before;
  if (hasSource || before) {
    const { queue, overflow } = syncReactionQueue(state, dispatchEvents);
    after = queue;
    if (reactionQueueFingerprint(before) !== reactionQueueFingerprint(queue)) {
      const syncEvent: GameEvent = { type: 'REACTION_QUEUE_SYNCED', data: { queue, overflow } };
      events.push(syncEvent);
      next = ctx.processor.process(state, [syncEvent]);
    } else if (overflow > 0) {
      events.push({ type: 'CUSTOM', data: { kind: 'REACTION_QUEUE_LIMIT', overflow } });
    }
  }
  return { state: next, resumedDuels: findResumedDuels(dispatchEvents, before, after) };
}
