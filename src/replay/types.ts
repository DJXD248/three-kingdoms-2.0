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

/** Current replay schema (decision D-4): 2 = header present, RANDOM_OUTCOME
 *  events may appear in entry.events. Documents predating 2.2.24 carry no
 *  header and are read as schemaVersion 1 — legacy archives are NEVER rewritten. */
export const REPLAY_SCHEMA_VERSION = 2;

/** Format header written by 2.2.24+ (D-4). Optional by contract: absence means
 *  "pre-header document", which the reader must still load read-only. */
export interface ReplayHeader {
  schemaVersion: number;
  gameVersion: string;
}

/** Portable replay document: initial state + ordered action/event/state history. */
export interface ReplayDocument {
  version: number;
  /** Written from 2.2.24 on (decision D-4); absent = pre-header legacy document. */
  header?: ReplayHeader;
  roomId: string;
  createdAt: number;
  initialState: EngineState;
  entries: ReplayEvent[];
}
