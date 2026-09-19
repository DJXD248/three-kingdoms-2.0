import type { RuleContext, RuleResult } from './types';

export class ActionValidator {
  validate(context: RuleContext): RuleResult {
    const action = context.action;
    const state = context.state;

    if (!action || typeof action.playerId !== 'number') {
      return { valid: false, reason: 'INVALID_ACTION' };
    }

    if (state.phase === 'testArena') {
      // Developer test arena intentionally bypasses normal phase/turn gating.
      // The test harness can control any player and exercise gameplay actions.
    } else if (state.phase === 'drawing') {
      const drawPlayerId = state.metadata?.drawPlayerId;
      if (typeof drawPlayerId === 'number' && action.playerId !== drawPlayerId) {
        return { valid: false, reason: 'NOT_DRAW_PLAYER' };
      }
    } else {
      if (state.currentPlayerId !== null &&
        state.currentPlayerId !== undefined &&
        action.playerId !== state.currentPlayerId) {
        return { valid: false, reason: 'NOT_CURRENT_PLAYER' };
      }

      if (action.type !== 'END_TURN' && action.type !== 'DRAW' && action.type !== 'BEGIN_DRAW' && action.type !== 'CONFIRM_DRAW') {
        if (state.timelinePhase !== 'ACTION' && state.phase !== 'playing') {
          return { valid: false, reason: 'ACTION_NOT_ALLOWED_IN_PHASE' };
        }
      }
    }

    if (action.type === 'ATTACK') {
      const payload = action.payload as any;
      if (!payload?.attackerId || !payload?.targetId || typeof payload.ranged !== 'boolean' || !payload.consumeCard) {
        return { valid: false, reason: 'INVALID_ATTACK_PAYLOAD' };
      }
    }

    if (action.type === 'DEPLOY_GENERAL') {
      const payload = action.payload as any;
      if (!payload?.general || !Array.isArray(payload.consumeCards)) {
        return { valid: false, reason: 'INVALID_DEPLOY_PAYLOAD' };
      }
    }

    if (action.type === 'SUPPLY') {
      const payload = action.payload as any;
      if (!payload?.generalId || !Array.isArray(payload.consumeCards)) {
        return { valid: false, reason: 'INVALID_SUPPLY_PAYLOAD' };
      }
    }

    if (action.type === 'EQUIP_ARMOR') {
      const payload = action.payload as any;
      if (!payload?.generalId || !Array.isArray(payload.armorCards) || payload.armorCards.length === 0) {
        return { valid: false, reason: 'INVALID_ARMOR_PAYLOAD' };
      }
    }

    return { valid: true };
  }
}
