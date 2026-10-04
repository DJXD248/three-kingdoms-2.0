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
  type DrawOutcomeFlow,
} from './eventProcessors/drawEvents';
import {
  applyGeneralDeployedEvent,
  applyGeneralMovedEvent,
  applySupplyResolvedEvent,
  applyArmorEquippedEvent,
  applyHealEvent,
  applyGainArmorEvent,
  applyDiscardEvent,
  applyGiveEvent,
  applyEquipStripEvent,
} from './eventProcessors/generalEvents';
import {
  applyRevealEvent,
  applyDeckPlaceEvent,
} from './eventProcessors/deckEvents';
import { applyDuelEvent } from './eventProcessors/duelEvents';
import { applyStatModifyEvent } from './eventProcessors/statModifierEvents';
import {
  applyChoiceRequiredEvent,
  applyChoiceResolvedEvent,
} from './eventProcessors/choiceEvents';
import {
  applyReactionAnsweredEvent,
  applyReactionQueueSyncedEvent,
} from './eventProcessors/reactionEvents';
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
import { applySkillActivatedEvent } from './eventProcessors/skillEvents';

/**
 * Applies emitted events to engine state.
 * Resolver decides WHAT happened.
 * Processor decides HOW state changes.
 *
 * Canonical single entry: every state mutation from emitted events flows
 * through process() -> apply(). Event-family handlers live under
 * eventProcessors/ as pure (state, event) => state functions; do not add a
 * second entry point that mutates EngineState from events.
 *
 * process() also accepts an optional `collected` array: every event derived
 * mid-queue (by enqueueDerivedConsequences) is appended there so the caller
 * (GameEngine.dispatch) can re-enter the trigger chain for events whose
 * consequences were only knowable after state settled — e.g. skill kills.
 *
 * The optional 4th `flow` (2.2.22, decision D-2a) threads the per-dispatch
 * RandomOutcome record/replay channel to the DRAW handler only; every other
 * event family stays untouched.
 */
export class EventProcessor {
  process(
    state: EngineState,
    events: GameEvent[],
    collected?: GameEvent[],
    flow?: DrawOutcomeFlow,
  ): EngineState {
    let next = cloneEngineState(state);
    const queue = [...events];

    while (queue.length > 0) {
      const event = queue.shift()!;
      const before = next;
      next = this.apply(next, event, flow);
      const derivedStart = queue.length;
      // 2.8 刀9: the derivation point normally appends (queue.push) and returns
      // null. A continuous-settlement effect (so far only DUEL) instead hands
      // back a whole block that belongs at the HEAD of the queue — see
      // PROJECT_ARCH_MAP §F "DUEL 决斗流程原语", 队列前置权（封口）row. The
      // block's CONTENT is still decided by the single derivation point; this
      // loop only decides placement, so nothing here mints game facts.
      const headBlock = enqueueDerivedConsequences(queue, event, before, next);
      const tailDerived = queue.slice(derivedStart);
      if (headBlock && headBlock.length > 0) {
        queue.unshift(...headBlock);
      }
      if (collected) collected.push(...(headBlock ?? []), ...tailDerived);
    }

    return next;
  }

  private apply(state: EngineState, event: GameEvent, flow?: DrawOutcomeFlow): EngineState {
    switch (event.type) {
      case 'BASE_DAMAGE':
        return applyBaseDamageEvent(state, event);
      case 'DRAW_REQUIRED':
        return applyDrawRequiredEvent(state, event);
      case 'DRAW':
        return applyDrawEvent(state, event, flow);
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
      case 'HEAL':
        return applyHealEvent(state, event);
      case 'GAIN_ARMOR':
        return applyGainArmorEvent(state, event);
      case 'DISCARD':
        return applyDiscardEvent(state, event);
      case 'GIVE':
        return applyGiveEvent(state, event);
      case 'EQUIP_STRIP':
        return applyEquipStripEvent(state, event);
      case 'REVEAL':
        return applyRevealEvent(state, event);
      case 'DECK_PLACE':
        return applyDeckPlaceEvent(state, event);
      case 'DUEL':
        return applyDuelEvent(state, event);
      case 'STAT_MODIFY':
        return applyStatModifyEvent(state, event);
      case 'CHOICE_REQUIRED':
        return applyChoiceRequiredEvent(state, event);
      case 'CHOICE_RESOLVED':
        return applyChoiceResolvedEvent(state, event);
      case 'REACTION_ANSWERED':
        return applyReactionAnsweredEvent(state, event);
      case 'REACTION_QUEUE_SYNCED':
        return applyReactionQueueSyncedEvent(state, event);
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
      case 'SKILL_ACTIVATED':
        return applySkillActivatedEvent(state, event);
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
