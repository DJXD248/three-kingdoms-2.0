import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';

export interface BeginDrawPayload {
  reason: 'initial' | 'turnStart' | 'compensation';
  totalCards?: number;
  playerId?: number;
  baseLossPending?: boolean;
}

/** Starts a pending draw window. It does not draw cards; it establishes the
 * engine-owned draw lifecycle that the UI can then execute/confirm. */
export class BeginDrawResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'BEGIN_DRAW';
  }

  resolve(state: EngineState, action: GameAction<BeginDrawPayload>): GameEvent[] {
    const payload = action.payload;
    const playerId = typeof payload?.playerId === 'number' ? payload.playerId : action.playerId;
    const player = state.players.find(p => p.id === playerId);
    if (!player) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'DRAW_PLAYER_NOT_FOUND' } }];
    }

    const reason = payload?.reason ?? 'turnStart';
    const totalCards = Math.max(0, Math.floor(payload?.totalCards ?? 5));

    return [{
      type: 'DRAW_REQUIRED',
      data: {
        reason,
        playerId,
        totalCards,
        baseLossPending: payload?.baseLossPending === true,
      },
    }];
  }
}
