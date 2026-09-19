import { GameEngine } from '../core/GameEngine';
import { storeStateToEngineState } from './gameStateAdapter';
import { cloneEngineState } from '../core/GameState';
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';

/**
 * Phase 5.35.2
 *
 * Thin adapter used while Zustand is being migrated to the authoritative
 * GameEngine. It deliberately does not contain game rules; it only translates
 * the current UI/store snapshot into EngineState and executes one Action.
 */
export function dispatchStoreAction(storeState: unknown, action: GameAction): {
  engineState: EngineState;
  events: GameEvent[];
} {
  const provided = (storeState as any)?.engineState;
  const engineState: EngineState = provided && Array.isArray(provided.players)
    ? cloneEngineState(provided as EngineState)
    : storeStateToEngineState(storeState);
  const engine = new GameEngine(engineState);
  const events = engine.dispatch(action);
  return { engineState: engine.snapshot(), events };
}
