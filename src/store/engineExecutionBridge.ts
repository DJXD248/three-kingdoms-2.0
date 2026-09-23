import { GameEngine } from '../core/GameEngine';
import { storeStateToEngineState } from './gameStateAdapter';
import { cloneEngineState } from '../core/GameState';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { recordLiveDispatch } from '../replay/liveReplayRecorder';
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';

/**
 * Phase 5.35.2
 *
 * Thin adapter used while Zustand is being migrated to the authoritative
 * GameEngine. It deliberately does not contain game rules; it only translates
 * the current UI/store snapshot into EngineState and executes one Action.
 *
 * Skill uniqueness: data-driven skills are re-derived from the engine state
 * on every dispatch (syncPlayerSkills), because the engine instance itself is
 * per-dispatch. There is exactly one skill runtime: GameEngine + TriggerEngine
 * + SkillTriggerBridge.
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
  syncPlayerSkills(engine, engineState);
  const events = engine.dispatch(action);
  const snapshot = engine.snapshot();
  // 2.2.6: the store engine is per-dispatch, so the match-level replay lives
  // in liveReplayRecorder instead — feed every dispatched action into it.
  recordLiveDispatch(action, events, snapshot);
  return { engineState: snapshot, events };
}
