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
    } else if (state.pendingChoice && state.phase !== 'gameOver') {
      // Frozen world (2.6.3): while an offer is outstanding, only the debtor's
      // CHOOSE_OPTION passes — the recorded candidates can never go stale.
      // gameOver is exempt so the terminal phase falls back to the ordinary
      // gating below (a dead game must not hang on an unpaid debt).
      if (action.type === 'CHOOSE_OPTION') {
        if (action.playerId !== state.pendingChoice.playerId) {
          return { valid: false, reason: 'NOT_CHOICE_PLAYER' };
        }
      } else {
        return { valid: false, reason: 'CHOICE_PENDING' };
      }
    } else if (state.phase === 'drawing') {
      // The window itself (drawState) is the authority on who may act.
      // metadata.drawPlayerId is a legacy mirror (store-adapter channel) that
      // not every window writer refreshes — trusting it alone deadlocked a
      // compensation-resumed window in the 2.3.1 soak (246 seed sweep).
      const drawPlayerId = state.drawState?.playerId ?? state.metadata?.drawPlayerId;
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

    if (action.type === 'ACTIVATE_SKILL') {
      // 2.3.1: addressing-only shape check — ownership / once-per-turn are
      // game facts the resolver judges against re-derived state.
      const payload = action.payload as any;
      if (typeof payload?.skillId !== 'string' || typeof payload?.generalId !== 'string' ||
        !payload.skillId || !payload.generalId) {
        return { valid: false, reason: 'INVALID_ACTIVATE_SKILL_PAYLOAD' };
      }
    }

    if (action.type === 'CHOOSE_OPTION') {
      // 2.6.3: addressing-only shape check — which offer is live and whether
      // the index is in range are game facts the resolver re-derives.
      const payload = action.payload as any;
      if (typeof payload?.choiceKey !== 'string' || !payload.choiceKey ||
        !Number.isInteger(payload.optionIndex) || payload.optionIndex < 0) {
        return { valid: false, reason: 'INVALID_CHOOSE_OPTION_PAYLOAD' };
      }
    }

    return { valid: true };
  }
}
