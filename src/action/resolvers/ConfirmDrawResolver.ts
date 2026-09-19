import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';

interface ConfirmDrawPayload {
  confirmation?: boolean;
}

/**
 * Converts the UI's draw-confirm operation into a deterministic turn/state
 * transition. The resolver owns progression; Zustand only mirrors the result.
 */
export class ConfirmDrawResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'CONFIRM_DRAW';
  }

  resolve(state: EngineState, action: GameAction<ConfirmDrawPayload>): GameEvent[] {
    const draw = state.drawState;
    if (!draw || draw.playerId !== action.playerId) {
      return [{
        type: 'ACTION_REJECTED',
        data: { action, reason: 'NO_PENDING_DRAW_CONFIRMATION' },
      }];
    }

    const currentIndex = state.players.findIndex(player => player.id === draw.playerId);
    if (currentIndex < 0) {
      return [{
        type: 'ACTION_REJECTED',
        data: { action, reason: 'DRAW_PLAYER_NOT_FOUND' },
      }];
    }

    if (draw.reason === 'initial') {
      const nextIndex = currentIndex + 1;
      if (nextIndex < state.players.length) {
        const nextPlayerId = state.players[nextIndex].id;
        return [{
          type: 'DRAW_CONFIRMED',
          data: {
            reason: 'initial',
            playerId: action.playerId,
            completed: false,
            nextPlayerId,
            nextPlayerIndex: nextIndex,
          },
        }, {
          type: 'DRAW_REQUIRED',
          data: {
            reason: 'initial',
            playerId: nextPlayerId,
            totalCards: 5,
            baseLossPending: false,
          },
        }];
      }

      const firstPlayerId = state.players[0]?.id ?? null;
      return [{
        type: 'DRAW_CONFIRMED',
        data: {
          reason: 'initial',
          playerId: action.playerId,
          completed: true,
          nextPlayerId: firstPlayerId,
          nextPlayerIndex: 0,
        },
      }, {
        type: 'PHASE_CHANGED',
        data: {
          from: 'DRAW',
          to: 'ACTION',
          playerId: firstPlayerId,
        },
      }];
    }

    if (draw.reason === 'turnStart') {
      return [{
        type: 'DRAW_CONFIRMED',
        data: {
          reason: 'turnStart',
          playerId: action.playerId,
          completed: true,
          nextPlayerId: action.playerId,
          nextPlayerIndex: currentIndex,
        },
      }, {
        type: 'PHASE_CHANGED',
        data: {
          from: 'DRAW',
          to: 'ACTION',
          playerId: action.playerId,
        },
      }];
    }

    if (draw.reason === 'compensation') {
      return [{
        type: 'DRAW_CONFIRMED',
        data: {
          reason: 'compensation',
          playerId: action.playerId,
          completed: true,
          nextPlayerId: draw.resumePlayerId ?? state.currentPlayerId,
          nextPlayerIndex: state.players.findIndex(p => p.id === (draw.resumePlayerId ?? state.currentPlayerId)),
          resumePhase: draw.resumePhase ?? 'ACTION',
          resumePlayerId: draw.resumePlayerId ?? state.currentPlayerId,
        },
      }, {
        type: 'PHASE_CHANGED',
        data: {
          from: 'DRAW',
          to: draw.resumePhase ?? 'ACTION',
          playerId: draw.resumePlayerId ?? state.currentPlayerId,
        },
      }];
    }

    return [{
      type: 'DRAW_CONFIRMED',
      data: {
        reason: draw.reason,
        playerId: action.playerId,
        completed: true,
        nextPlayerId: action.playerId,
        nextPlayerIndex: currentIndex,
      },
    }];
  }
}
