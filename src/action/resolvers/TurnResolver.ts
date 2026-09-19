import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import { getTurnStartDrawCount } from '../../core/turnRules';

export class TurnResolver implements ActionResolver {
  canResolve(action: GameAction) {
    return action.type === 'END_TURN';
  }

  resolve(state: EngineState, action: GameAction): GameEvent[] {
    const currentIndex = state.players.findIndex(p => p.id === action.playerId);
    const fromIndex = currentIndex >= 0 ? currentIndex : Math.max(0, state.players.findIndex(p => p.id === state.currentPlayerId));
    let nextIndex = -1;
    if (state.players.length > 0) {
      let candidate = (fromIndex + 1) % state.players.length;
      let guard = 0;
      while (guard < state.players.length && state.players[candidate]?.isAlive === false) {
        candidate = (candidate + 1) % state.players.length;
        guard += 1;
      }
      if (guard < state.players.length && state.players[candidate]?.isAlive !== false) {
        nextIndex = candidate;
      }
    }
    const nextPlayerId = nextIndex >= 0 ? state.players[nextIndex]?.id : undefined;
    const nextPlayer = nextIndex >= 0 ? state.players[nextIndex] : undefined;
    const nextRound = nextIndex >= 0 && nextIndex <= fromIndex ? state.round + 1 : state.round;
    const baseLossPending = Boolean(nextPlayer && nextPlayer.isAlive !== false && (nextPlayer.generalPool?.length ?? 0) === 0);

    const drawTotalCards = getTurnStartDrawCount({ ...state, round: nextRound }, nextIndex);

    return [
      {
        type: 'TURN_END',
        data: {
          playerId: action.playerId,
          fromIndex,
          toIndex: nextIndex,
          nextPlayerId,
          nextRound,
        },
      },
      {
        type: 'TURN_START',
        data: {
          playerId: nextPlayerId,
          nextRound,
        },
      },
      {
        type: 'TURN_ACTIONS_RESET',
        data: {
          playerId: nextPlayerId,
        },
      },
      {
        type: 'DRAW_REQUIRED',
        data: {
          reason: 'turnStart',
          playerId: nextPlayerId,
          totalCards: drawTotalCards,
          baseLossPending,
        },
      },
    ];
  }
}
