import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';

export interface ResolverContext {
  gameState: EngineState;
}

/**
 * Canonical resolver contract.
 * A resolver describes what happened; EventProcessor later mutates state.
 */
export interface ActionResolver {
  canResolve(action: GameAction): boolean;
  resolve(state: EngineState, action: GameAction): GameEvent[];
}
