/**
 * Live match replay capture (2.2.6).
 *
 * The production store dispatches through a RESIDENT engine whose own
 * recorder is switched off (engineExecutionBridge, 2.2.21 — recordHistory:
 * false), so this module stays the single long-lived recorder for a whole
 * match: every store dispatch feeds one entry in, and the settlement screen
 * / auto-save pull the finished ReplayDocument back out.
 *
 * Memory note: entries chain `afterState` only — ReplayRecorder reconstructs
 * each step's beforeState from the previous entry, halving the state clones.
 */
import type { GameAction } from '../action/ActionTypes';
import type { GameEvent } from '../core/Event';
import type { EngineState } from '../core/GameState';
import type { ReplayDocument } from './types';
import { ReplayRecorder } from './ReplayRecorder';

let recorder: ReplayRecorder | null = null;
let entryCount = 0;

/** Drop the current capture (new match / restore / reset). */
export function resetLiveReplay(): void {
  recorder = null;
  entryCount = 0;
}

/**
 * Record one store dispatch. A fresh capture starts on the first action seen
 * after a reset; an initial BEGIN_DRAW always re-opens the document so a new
 * match can never inherit the previous match's history as a safety net.
 */
export function recordLiveDispatch(
  action: GameAction,
  events: GameEvent[],
  afterState: EngineState,
): void {
  const isMatchStart =
    action.type === 'BEGIN_DRAW' &&
    (action.payload as { reason?: string } | undefined)?.reason === 'initial';
  if (!recorder || isMatchStart) {
    recorder = new ReplayRecorder();
    entryCount = 0;
    const roomId = String(afterState.metadata?.roomId ?? 'local');
    recorder.start(afterState, roomId);
    return;
  }
  recorder.record(action, events, undefined, afterState);
  entryCount += 1;
}

export function getLiveReplayDocument(): ReplayDocument | null {
  return recorder?.getDocument() ?? null;
}

/** JSON of the current match replay ('' when nothing was captured). */
export function serializeLiveReplay(): string {
  return recorder?.serialize() ?? '';
}

/** Cheap count (no document clone) so UIs can check availability per render. */
export function getLiveReplayEntryCount(): number {
  return entryCount;
}
