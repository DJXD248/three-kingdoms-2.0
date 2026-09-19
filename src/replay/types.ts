import type { GameAction } from '../action/ActionTypes';
import type { GameEvent } from '../core/Event';
import type { EngineState } from '../core/GameState';

/** A point-in-time, serializable engine snapshot. */
export interface SnapshotRecord {
  version: number;
  timestamp: number;
  roomId: string;
  sequence: number;
  state: EngineState;
  reason?: 'initial' | 'action' | 'manual' | 'turn' | 'recovery';
  actionId?: string;
}

/** One deterministic step in a replay timeline. */
export interface ReplayEvent {
  sequence: number;
  timestamp: number;
  action: GameAction;
  events: GameEvent[];
  beforeState: EngineState;
  afterState: EngineState;
}

/** Portable replay document: initial state + ordered action/event/state history. */
export interface ReplayDocument {
  version: number;
  roomId: string;
  createdAt: number;
  initialState: EngineState;
  entries: ReplayEvent[];
}
