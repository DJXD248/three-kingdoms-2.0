import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent, SkillActivationEventData } from '../../core/Event';
import { SkillTriggerBridge } from '../../skills/SkillTriggerBridge';
import { evaluateSkillConditions } from '../../skills/skillConditions';
import { listAllTurnEndDefinitions } from '../../skills/turnEndSkills';

interface ActivateSkillPayload {
  skillId?: unknown;
  generalId?: unknown;
}

/**
 * ACTIVATE_SKILL (2.3.1) — the ONE and only activation path for onTurnEnd
 * skills (TURN_END is deliberately not mapped in SkillTriggerBridge, so this
 * resolver can never double-fire with an auto trigger).
 *
 * Shape follows the canonical contract: the resolver only DESCRIBES what
 * happened — SKILL_ACTIVATED (an A-class fact: EventProcessor turns it into
 * the consumedSkills ledger entry) followed by the effect events translated
 * with the bridge's STATIC createSkillEvents (the same code the trigger path
 * uses — never a second effect mechanism) — and state settlement happens
 * exclusively in EventProcessor. Legality is re-derived from EngineState,
 * never from the trigger registry, so the isLegal probe (validate + resolve +
 * no rejection) also works on a fresh engine with no skills registered (the
 * strategy-policy probe case).
 */
export class TurnEndSkillResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'ACTIVATE_SKILL';
  }

  resolve(state: EngineState, action: GameAction): GameEvent[] {
    const payload = (action.payload ?? {}) as ActivateSkillPayload;
    const skillId = typeof payload.skillId === 'string' ? payload.skillId : '';
    const generalId = typeof payload.generalId === 'string' ? payload.generalId : '';
    if (!skillId || !generalId) {
      return [rejected(action, 'MALFORMED_PAYLOAD')];
    }
    if (!state.players.some(p => p.id === action.playerId)) {
      return [rejected(action, 'PLAYER_NOT_FOUND')];
    }

    const turn = state.turn ?? 0;
    // Unfiltered derivation on purpose: rejection reasons stay honest
    // ("not on field" vs "already activated this turn").
    const definition = listAllTurnEndDefinitions(state, action.playerId)
      .find(d => d.id === skillId);
    if (!definition) {
      return [rejected(action, 'TURN_END_SKILL_NOT_FOUND')];
    }
    if (definition.sourceGeneralId !== generalId || definition.turnSubType === 'otherTurn') {
      return [rejected(action, 'GENERAL_NOT_CONTROLLED')];
    }
    if ((state.consumedSkills ?? []).some(c => c.stableId === `${turn}:${skillId}`)) {
      return [rejected(action, 'SKILL_ALREADY_ACTIVATED')];
    }
    // v2.7.3 threshold gate: re-derived here independently of the candidate
    // filter, so an activation that raced a state change is honestly refused
    // instead of settling as a silent no-op skill.
    if (!evaluateSkillConditions(definition.conditions, {
      state,
      ownerId: action.playerId,
      sourceGeneralId: definition.sourceGeneralId,
    })) {
      return [rejected(action, 'SKILL_CONDITION_UNMET')];
    }

    const stableId = `${turn}:${definition.id}`;
    const activationData: SkillActivationEventData = {
      skillId: definition.id,
      skillName: definition.name,
      effectId: definition.effectId ?? definition.id,
      generalId,
      playerId: action.playerId,
      stableId,
    };
    const activationEvent: GameEvent = { type: 'SKILL_ACTIVATED', data: activationData };
    const effectEvents = SkillTriggerBridge.createSkillEvents(
      { ownerId: action.playerId, skill: definition },
      state,
      activationEvent,
    );
    return [activationEvent, ...effectEvents];
  }
}

function rejected(action: GameAction, reason: string): GameEvent {
  return { type: 'ACTION_REJECTED', data: { action, reason } };
}
