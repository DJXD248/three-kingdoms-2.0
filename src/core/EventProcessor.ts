import type { EngineState } from './GameState';
import type { GameEvent } from './Event';
import { cloneEngineState } from './GameState';
import {
  applyDamageEvent,
  applyBaseDamageEvent,
} from './eventProcessors/damageEvents';
import {
  applyDrawRequiredEvent,
  applyDrawEvent,
  applyDrawConfirmedEvent,
} from './eventProcessors/drawEvents';
import {
  applyGeneralDeployedEvent,
  applyGeneralMovedEvent,
  applySupplyResolvedEvent,
  applyArmorEquippedEvent,
} from './eventProcessors/generalEvents';
import {
  applyPlayerDefeatedEvent,
  applyGameOverEvent,
} from './eventProcessors/playerEvents';
import {
  applyTurnEndEvent,
  applyTurnActionsResetEvent,
  applyTurnStartEvent,
  applyPhaseChangedEvent,
} from './eventProcessors/turnEvents';
import { enqueueDerivedConsequences } from './eventProcessors/chainedConsequences';

/**
 * Applies emitted events to engine state.
 * Resolver decides WHAT happened.
 * Processor decides HOW state changes.
 *
 * Canonical single entry: every state mutation from emitted events flows
 * through process() -> apply(). Event-family handlers live under
 * eventProcessors/ as pure (state, event) => state functions; do not add a
 * second entry point that mutates EngineState from events.
 */
export class EventProcessor {
  process(state: EngineState, events: GameEvent[]): EngineState {
    let next = cloneEngineState(state);
    const queue = [...events];

    while (queue.length > 0) {
      const event = queue.shift()!;
      const before = next;
      next = this.apply(next, event);
      enqueueDerivedConsequences(queue, event, before, next);
    }

    return next;
  }

  private apply(state: EngineState, event: GameEvent): EngineState {
    switch (event.type) {
      case 'BASE_DAMAGE':
        return applyBaseDamageEvent(state, event);
      case 'DRAW_REQUIRED':
        return applyDrawRequiredEvent(state, event);
      case 'DRAW':
        return applyDrawEvent(state, event);
      case 'GENERAL_DEPLOYED':
        return applyGeneralDeployedEvent(state, event);
      case 'GENERAL_MOVED':
        return applyGeneralMovedEvent(state, event);
      case 'SUPPLY_RESOLVED':
        return applySupplyResolvedEvent(state, event);
      case 'ARMOR_EQUIPPED':
        return applyArmorEquippedEvent(state, event);
      case 'DAMAGE':
        return applyDamageEvent(state, event);
      case 'PLAYER_DEFEATED':
        return applyPlayerDefeatedEvent(state, event);
      case 'GAME_OVER':
        return applyGameOverEvent(state, event);
      case 'DRAW_CONFIRMED':
        return applyDrawConfirmedEvent(state, event);
      case 'TURN_END':
        return applyTurnEndEvent(state, event);
      case 'TURN_ACTIONS_RESET':
        return applyTurnActionsResetEvent(state, event);
      case 'TURN_START':
        return applyTurnStartEvent(state, event);
      case 'PHASE_CHANGED':
        return applyPhaseChangedEvent(state, event);
      case 'STATE_CHANGED':
      default:
        return state;
    }
  }
}
