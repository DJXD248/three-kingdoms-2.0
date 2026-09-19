import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';

interface ResolveBaseLossPayload {
  reason?: 'turnStart' | 'initial' | 'compensation';
}

export class ResolveBaseLossResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'RESOLVE_BASE_LOSS';
  }

  resolve(state: EngineState, action: GameAction<ResolveBaseLossPayload>): GameEvent[] {
    const draw = state.drawState;
    if (!draw || draw.playerId !== action.playerId || draw.baseLossPending !== true) {
      return [{
        type: 'ACTION_REJECTED',
        data: { action, reason: 'NO_PENDING_BASE_LOSS' },
      }];
    }

    return [{
      type: 'BASE_DAMAGE',
      data: {
        playerId: action.playerId,
        amount: 1,
        reason: action.payload?.reason ?? draw.reason,
      },
    }];
  }
}
