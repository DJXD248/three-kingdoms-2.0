import type { GameAction } from './ActionTypes';
import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { ResolverRegistry } from './ResolverRegistry';

/**
 * Compatibility facade while callers migrate to GameEngine.dispatch().
 * It no longer owns a second mutation system.
 */
export class ActionMutationBridge {
  constructor(private readonly registry = new ResolverRegistry()) {}

  execute(action: GameAction, state: EngineState): GameEvent[] {
    const resolver = this.registry.getResolver(action);
    if (!resolver) throw new Error(`Resolver not found for action ${action.type}`);
    return resolver.resolve(state, action);
  }
}
