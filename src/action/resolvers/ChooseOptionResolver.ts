import type { ActionResolver } from './ResolverTypes';
import type { ChooseOptionPayload, GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import type { ChoiceResolvedData } from '../../core/eventProcessors/choiceEvents';

/**

 * CHOOSE_OPTION (2.6.3) — the player-decision channel. The offer
 * (EngineState.pendingChoice) was opened by a CHOICE_REQUIRED event whose
 * options were deterministically pre-translated at trigger time; this
 * resolver only converts the choice into facts: CHOICE_RESOLVED FIRST
 * (clears the debt, keyed), then the chosen branch's events ride the normal
 * settlement chain — the延后结算时点=决策时点 contract. No effect mechanism
 * of its own, no RNG, no second transition path.
 *
 * Five honest gates mirror TurnEndSkillResolver; legality is re-derived
 * from EngineState only, so the isLegal probe works on a fresh engine.
 */
export class ChooseOptionResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'CHOOSE_OPTION';
  }

  resolve(state: EngineState, action: GameAction): GameEvent[] {
    const payload = (action.payload ?? {}) as Partial<ChooseOptionPayload>;
    if (typeof payload.choiceKey !== 'string' || !payload.choiceKey
      || !Number.isInteger(payload.optionIndex) || (payload.optionIndex as number) < 0) {
      return [rejected(action, 'MALFORMED_PAYLOAD')];
    }
    if (!state.players.some(p => p.id === action.playerId)) {
      return [rejected(action, 'PLAYER_NOT_FOUND')];
    }
    const pending = state.pendingChoice;
    if (!pending) {
      return [rejected(action, 'NO_PENDING_CHOICE')];
    }
    if (pending.key !== payload.choiceKey) {
      return [rejected(action, 'CHOICE_KEY_MISMATCH')];
    }
    if (pending.playerId !== action.playerId) {
      return [rejected(action, 'NOT_CHOICE_PLAYER')];
    }
    const optionIndex = payload.optionIndex as number;
    if (optionIndex >= pending.options.length) {
      return [rejected(action, 'CHOICE_OPTION_OUT_OF_RANGE')];
    }

    const option = pending.options[optionIndex];
    const resolvedData: ChoiceResolvedData = {
      choiceKey: pending.key,
      chooserPlayerId: pending.playerId,
      optionIndex,
      label: option.label,
    };
    return [
      { type: 'CHOICE_RESOLVED', data: resolvedData },
      ...cloneOptionEvents(option.events),
    ];
  }
}

/** Events are plain data, but the settled state must never hold references
 *  into the still-live pendingChoice options array (a later dispatch could
 *  otherwise observe mutated objects). */
function cloneOptionEvents(events: GameEvent[]): GameEvent[] {
  return events.map(event => ({
    type: event.type,
    ...(event.data === undefined ? {} : { data: structuredClone(event.data) }),
  }));
}

function rejected(action: GameAction, reason: string): GameEvent {
  return { type: 'ACTION_REJECTED', data: { action, reason } };
}
