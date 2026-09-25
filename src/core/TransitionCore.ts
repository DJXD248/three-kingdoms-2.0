import type { GameAction } from '../action/ActionTypes';
import type { ResolverRegistry } from '../action/ResolverRegistry';
import type { EventProcessor } from './EventProcessor';
import type { TriggerEngine } from '../triggers/TriggerEngine';
import type { RuleEngine } from '../rules/RuleEngine';
import type { EngineState } from './GameState';
import type { GameEvent, RandomOutcomeData } from './Event';
import { resolveTriggerChain } from './EngineDispatchFlow';
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
  const REACTION_EVENT_TYPES: ReadonlySet<GameEvent['type']> = new Set(['DEATH', 'CARD_LOST', 'CARD_GAINED']);
  let pendingReactions = derived.filter(event => REACTION_EVENT_TYPES.has(event.type));
  for (let round = 0; pendingReactions.length > 0 && round < MAX_TRIGGER_REENTRY_ROUNDS; round += 1) {
    const expanded = resolveTriggerChain(next, ctx.triggers, pendingReactions);
    events.push(...expanded);
    const generated = expanded.filter(event => !REACTION_EVENT_TYPES.has(event.type) && event.type !== 'TRIGGERED');
    const nextDerived: GameEvent[] = [];
    next = ctx.processor.process(next, generated, nextDerived, flow);
    pendingReactions = nextDerived.filter(event => REACTION_EVENT_TYPES.has(event.type));
  }
  if (pendingReactions.length > 0) {
    events.push({ type: 'CUSTOM', data: { kind: 'TRIGGER_REENTRY_LIMIT', pendingReactions: pendingReactions.length } });
  }

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

  return { state: next, events, accepted: true, overrideFailures: flow.diagnostics ?? [] };
}
