import type { EngineState, PendingChoiceOption } from '../GameState';
import type { GameEvent } from '../Event';

/**
 * choice channel settlement (2.6.3, capability-layer NON-content cut —
 * PROJECT_ARCH_MAP §F choice table). Two symmetric settlers around the single
 * A-class slot EngineState.pendingChoice:
 *
 *  - CHOICE_REQUIRED opens the debt: the offer's options were deterministically
 *    pre-translated at trigger time by SkillTriggerBridge (label + the events
 *    the chosen branch will settle). One slot only — a second offer while a
 *    debt is owed settles as an honest no-op (the event is still recorded);
 *    multi-slot waits for a real content driver.
 *  - CHOOSE_OPTION's settlement returns CHOICE_RESOLVED FIRST (clearing the
 *    debt, keyed so a stale resolution can never clear someone else's offer),
 *    then the chosen option's events ride the normal settlement chain.
 *
 * Between the two, the validator freezes the world (only the debtor's
 * CHOOSE_OPTION is accepted), so the recorded candidates cannot go stale.
 */

export interface ChoiceRequiredData {
  choiceKey: string;
  chooserPlayerId: number;
  options: PendingChoiceOption[];
  skillId?: string;
  skillName?: string;
}

export interface ChoiceResolvedData {
  choiceKey: string;
  chooserPlayerId: number;
  optionIndex: number;
  label: string;
}

export function applyChoiceRequiredEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as Partial<ChoiceRequiredData> | undefined;
  if (typeof data?.choiceKey !== 'string' || !data.choiceKey) return state;
  if (typeof data.chooserPlayerId !== 'number') return state;
  if (!state.players.some(player => player.id === data.chooserPlayerId)) return state;
  const options = Array.isArray(data.options)
    ? data.options.filter(option =>
      !!option && typeof option.label === 'string' && Array.isArray(option.events))
    : [];
  if (options.length === 0) return state;
  // Collision gate: one slot, never overwrite — the debt already owed keeps
  // its original candidates; the rejected offer is still recorded as an event.
  if (state.pendingChoice) return state;
  return {
    ...state,
    pendingChoice: { key: data.choiceKey, playerId: data.chooserPlayerId, options },
  };
}

export function applyChoiceResolvedEvent(state: EngineState, event: GameEvent): EngineState {
  const pending = state.pendingChoice;
  if (!pending) return state;
  const data = event.data as Partial<ChoiceResolvedData> | undefined;
  // Keyed clear: a resolution aimed at another (or stale) offer never wipes
  // the live debt — the frozen-world gate would have rejected it upstream,
  // this is the second line of defense.
  if (typeof data?.choiceKey !== 'string' || data.choiceKey !== pending.key) return state;
  return { ...state, pendingChoice: null };
}
