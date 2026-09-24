import { GameEngine } from '../core/GameEngine';
import { storeStateToEngineState } from './gameStateAdapter';
import { cloneEngineState } from '../core/GameState';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { recordLiveDispatch } from '../replay/liveReplayRecorder';
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';

/**
 * Phase 5.35.2 → 2.2.21 (decision D-1, second cut)
 *
 * The store's single execution choke point, now backed by ONE long-lived
 * GameEngine container instead of a fresh engine per dispatch. Per the D-1
 * resolution the container only holds currentState/rngState — the transition
 * itself is still TransitionCore.transition inside GameEngine.dispatch, and
 * the store projection stays authoritative: every dispatch adopts a clone of
 * the incoming engineState (same input the pre-2.2.21 rebuild path consumed),
 * so aliasing mutations of store-aliased arrays can never diverge from the
 * container. The rebuild execution is demoted to `dispatchStoreActionReconcile`
 * below — a reconciliation tool pinned against this path by
 * core/transitionEquivalence.test.ts.
 *
 * Skill uniqueness: the data-driven skill registry is fully resynced before
 * every dispatch (unregister previous owners + syncPlayerSkills), which
 * reproduces the fresh-engine registration semantics of the rebuild path
 * byte-for-byte — a general that died last step cannot keep triggering from
 * the resident container.
 */

interface ResidentContainer {
  engine: GameEngine;
  /** Owner ids registered by the last resync — the exact set to clear before
   * the next one, so no stale bindings survive across steps or matches. */
  registeredOwners: Array<number | string>;
  dispatches: number;
}

let container: ResidentContainer | null = null;

function acquireContainer(engineState: EngineState): ResidentContainer {
  if (!container) {
    // recordHistory:false: the match-level capture lives in liveReplayRecorder
    // (fed once per dispatch below). A resident engine must not also grow its
    // own ReplayRecorder/SnapshotManager chains — that would double memory
    // per match with zero readers.
    container = {
      engine: new GameEngine(cloneEngineState(engineState), { recordHistory: false }),
      registeredOwners: [],
      dispatches: 0,
    };
  }
  return container;
}

function resyncSkills(resident: ResidentContainer, state: EngineState): void {
  for (const owner of resident.registeredOwners) {
    resident.engine.unregisterPlayerSkills(owner);
  }
  resident.registeredOwners = state.players.map(player => player.id);
  syncPlayerSkills(resident.engine, state);
}

/** Test seam: drop the resident container (module state, never used by UI). */
export function __resetResidentEngineContainer(): void {
  container = null;
}

/** Test seam: observe container identity/reuse. */
export function __residentEngineProbe(): { engine: GameEngine | null; dispatches: number } {
  return { engine: container?.engine ?? null, dispatches: container?.dispatches ?? 0 };
}

function toEngineState(storeState: unknown): EngineState {
  const provided = (storeState as any)?.engineState;
  return provided && Array.isArray(provided.players)
    ? cloneEngineState(provided as EngineState)
    : storeStateToEngineState(storeState);
}

export function dispatchStoreAction(storeState: unknown, action: GameAction): {
  engineState: EngineState;
  events: GameEvent[];
} {
  const engineState = toEngineState(storeState);
  const resident = acquireContainer(engineState);
  const engine = resident.engine;
  engine.state = engineState;
  resyncSkills(resident, engineState);
  const events = engine.dispatch(action);
  const snapshot = engine.snapshot();
  resident.dispatches += 1;
  // 2.2.6: the match-level replay lives in liveReplayRecorder — feed every
  // dispatched action into it.
  recordLiveDispatch(action, events, snapshot);
  return { engineState: snapshot, events };
}

/**
 * Reconciliation path (D-1): the pre-2.2.21 per-step rebuild execution, kept
 * as the authority-check twin of dispatchStoreAction. It deliberately does
 * NOT feed liveReplayRecorder — production recording is the resident path's
 * job — so tests can run both side by side without double-capturing.
 */
export function dispatchStoreActionReconcile(storeState: unknown, action: GameAction): {
  engineState: EngineState;
  events: GameEvent[];
} {
  const engineState = toEngineState(storeState);
  const engine = new GameEngine(engineState);
  syncPlayerSkills(engine, engineState);
  const events = engine.dispatch(action);
  return { engineState: engine.snapshot(), events };
}
