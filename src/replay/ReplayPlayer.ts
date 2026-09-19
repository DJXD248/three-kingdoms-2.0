import { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import { cloneEngineState } from '../core/GameState';
import type { ReplayDocument, ReplayEvent } from './types';

export interface ReplayPlaybackResult {
  state: EngineState;
  processed: number;
  events: ReplayEvent[];
}

/** Replays the canonical action log through the same GameEngine used by live play. */
export class ReplayPlayer {
  play(document: ReplayDocument, untilSequence?: number): ReplayPlaybackResult {
    const limit = untilSequence === undefined ? document.entries.length : untilSequence;
    const engine = new GameEngine(cloneEngineState(document.initialState));
    const processed: ReplayEvent[] = [];

    for (const entry of document.entries) {
      if (entry.sequence > limit) break;
      const before = engine.snapshot();
      const events = engine.dispatch(entry.action);
      const after = engine.snapshot();
      processed.push({
        sequence: entry.sequence,
        timestamp: entry.timestamp,
        action: structuredClone(entry.action),
        events: structuredClone(events),
        beforeState: before,
        afterState: after,
      });
    }

    return {
      state: engine.snapshot(),
      processed: processed.length,
      events: processed,
    };
  }
}
