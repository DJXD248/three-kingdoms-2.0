import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';

export class SurrenderResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'SURRENDER';
  }

  resolve(state: EngineState, action: GameAction): GameEvent[] {
    const player = state.players.find(candidate => candidate.id === action.playerId);
    if (!player) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'PLAYER_NOT_FOUND' } }];
    }
    if (player.isAlive === false) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'PLAYER_ALREADY_DEFEATED' } }];
    }

    return [{
      type: 'PLAYER_DEFEATED',
      data: {
        playerId: action.playerId,
        reason: 'SURRENDER',
      },
    }];
  }
}
