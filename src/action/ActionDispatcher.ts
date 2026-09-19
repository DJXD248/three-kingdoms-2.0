import type { GameAction } from './ActionTypes';
import type { GameEvent } from '../core/Event';
import { GameEngine } from '../core/GameEngine';

/**
 * Single public behavior entry point for local, hotseat, AI and future network clients.
 */
export class ActionDispatcher {
  constructor(private readonly engine: GameEngine) {}

  dispatch(action: GameAction): GameEvent[] {
    return this.engine.dispatch(action);
  }

  canDispatch(action: GameAction): boolean {
    return Boolean(action?.id && action?.playerId !== undefined && action?.type);
  }
}
