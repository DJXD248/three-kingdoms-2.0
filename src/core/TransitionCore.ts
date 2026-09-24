import type { GameAction } from '../action/ActionTypes';
import type { ResolverRegistry } from '../action/ResolverRegistry';
import type { EventProcessor } from './EventProcessor';
import type { TriggerEngine } from '../triggers/TriggerEngine';
import type { RuleEngine } from '../rules/RuleEngine';
import type { EngineState } from './GameState';
import type { GameEvent } from './Event';
import { resolveTriggerChain } from './EngineDispatchFlow';

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
}

export interface TransitionResult {
  /** Advanced state, or the exact input state reference when rejected. */
  state: EngineState;
  /** ACTION_ACCEPTED + triggered events + reentry-derived events (+ limit
   * marker), or the single ACTION_REJECTED event. Unstamped: EventBus.emit
   * adds id/timestamp at the container layer. */
  events: GameEvent[];
  accepted: boolean;
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
    return { state, events: [rejected], accepted: false };
  }

  const resolver = ctx.resolvers.getResolver(action);
  if (!resolver) {
    const rejected: GameEvent = {
      type: 'ACTION_REJECTED',
      data: { action, reason: `NO_RESOLVER:${action.type}` },
    };
    return { state, events: [rejected], accepted: false };
  }

  const events: GameEvent[] = [{ type: 'ACTION_ACCEPTED', data: { action } }];

  const resolvedEvents = resolver.resolve(state, action);
  const triggeredEvents = resolveTriggerChain(state, ctx.triggers, resolvedEvents);
  events.push(...triggeredEvents);

  const derived: GameEvent[] = [];
  let next = ctx.processor.process(state, events, derived);

  // Skill kills settle inside process(), so their derived DEATH events miss
  // the pre-dispatch trigger chain. Re-enter it (bounded) with post-apply
  // state so onKill/onDeath skills fire for skill kills too. Each derived
  // DEATH already had its state consequences settled where it was derived
  // (chainedConsequences), so re-entry only processes freshly generated
  // events — never the DEATH itself — to avoid double settlement.
  let pendingDeaths = derived.filter(event => event.type === 'DEATH');
  for (let round = 0; pendingDeaths.length > 0 && round < MAX_TRIGGER_REENTRY_ROUNDS; round += 1) {
    const expanded = resolveTriggerChain(next, ctx.triggers, pendingDeaths);
    events.push(...expanded);
    const generated = expanded.filter(event => event.type !== 'DEATH' && event.type !== 'TRIGGERED');
    const nextDerived: GameEvent[] = [];
    next = ctx.processor.process(next, generated, nextDerived);
    pendingDeaths = nextDerived.filter(event => event.type === 'DEATH');
  }
  if (pendingDeaths.length > 0) {
    events.push({ type: 'CUSTOM', data: { kind: 'TRIGGER_REENTRY_LIMIT', pendingDeaths: pendingDeaths.length } });
  }

  return { state: next, events, accepted: true };
}
