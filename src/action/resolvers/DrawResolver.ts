import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';

export interface DrawActionPayload {
  fromGeneralPool: number;
  fromCardPool: number;
  reason?: string;
}

/**
 * Resolves a player's requested split between their private General Pool and
 * the shared Card Pool.
 *
 * Per stabilization decision D-2 (stage D), the resolver only validates the
 * request and emits a *count-only* DRAW event. It never selects concrete card
 * instances and never touches randomness — EventProcessor (applyDrawEvent)
 * performs the shuffle/slice at apply time using EngineState.rngState, so all
 * engine randomness flows through one seedable, serializable cursor and a
 * match is reproducible from state alone.
 */
export class DrawResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'DRAW';
  }

  resolve(state: EngineState, action: GameAction<DrawActionPayload>): GameEvent[] {
    const drawState = state.drawState;
    if (!drawState || drawState.playerId !== action.playerId) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'NO_PENDING_DRAW' } }];
    }

    const player = state.players.find(p => p.id === action.playerId);
    if (!player || player.isAlive === false) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'DRAW_PLAYER_NOT_FOUND' } }];
    }

    const requestedGeneral = Math.max(0, Math.floor(action.payload?.fromGeneralPool ?? 0));
    const requestedCards = Math.max(0, Math.floor(action.payload?.fromCardPool ?? 0));
    const totalRequested = requestedGeneral + requestedCards;
    if (totalRequested !== drawState.totalCards) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'DRAW_TOTAL_MISMATCH', expected: drawState.totalCards, requested: totalRequested } }];
    }

    return [{
      type: 'DRAW',
      data: {
        playerId: action.playerId,
        requestedGeneral,
        requestedCards,
        count: totalRequested,
        reason: drawState.reason,
      },
    }];
  }
}
