import { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import { cloneEngineState } from '../core/GameState';
import type { GameEvent, RandomOutcomeData } from '../core/Event';
import type { OverrideFailure } from '../core/eventProcessors/drawEvents';
import { syncPlayerSkills } from '../skills/skillCompiler';
import type { ReplayDocument, ReplayEvent } from './types';

export interface ReplayOverrideFailure extends OverrideFailure {
  sequence: number;
}

export interface ReplayPlaybackResult {
  state: EngineState;
  processed: number;
  events: ReplayEvent[];
  /** D-2a bypass (2.2.23): recorded outcomes that failed strict validation
   * during this playback (each one fell back to the seeded re-roll).
   * Empty for clean and legacy documents — "可自动降级，不可无痕降级". */
  overrideFailures: ReplayOverrideFailure[];
}

/** Replays the canonical action log through the same GameEngine used by live play.
 * Skill registration is re-derived from EngineState before every dispatch —
 * exactly what the live per-step path does (resident bridge, 2.2.21;
 * per-step syncPlayerSkills keeps mid-match deployments in sync, 2.2.20) —
 * so plays of mid-match deployments match live, not just the initial field.
 *
 * D-2a (2.2.22) "record outcomes, not re-rolls": recorded RANDOM_OUTCOME
 * events are injected per dispatch, so draw selections come from the replay
 * document itself instead of re-running the RNG. Entries without them
 * (pre-2.2.22 replays) legitimately fall back to the reproducible seeded
 * re-roll from 2.2.18 — dual read, no version bump.
 *
 * D-2a bypass (2.2.23): whenever an injected result fails strict validation
 * the behavior still degrades to the seeded re-roll, but never silently —
 * the reason surfaces in ReplayPlaybackResult.overrideFailures and one
 * console.warn summary per playback. */
export class ReplayPlayer {
  play(document: ReplayDocument, untilSequence?: number): ReplayPlaybackResult {
    const limit = untilSequence === undefined ? document.entries.length : untilSequence;
    const engine = new GameEngine(cloneEngineState(document.initialState));
    const processed: ReplayEvent[] = [];
    const overrideFailures: ReplayOverrideFailure[] = [];

    for (const entry of document.entries) {
      if (entry.sequence > limit) break;
      syncPlayerSkills(engine, engine.state);
      engine.outcomeOverrides = extractRandomOutcomes(entry.events);
      const before = engine.snapshot();
      const events = engine.dispatch(entry.action);
      const after = engine.snapshot();
      for (const failure of engine.lastOverrideFailures) {
        overrideFailures.push({ ...failure, sequence: entry.sequence });
      }
      processed.push({
        sequence: entry.sequence,
        timestamp: entry.timestamp,
        action: structuredClone(entry.action),
        events: structuredClone(events),
        beforeState: before,
        afterState: after,
      });
    }

    if (overrideFailures.length > 0) {
      const reasons = new Map<OverrideFailure['reason'], number>();
      for (const failure of overrideFailures) {
        reasons.set(failure.reason, (reasons.get(failure.reason) ?? 0) + 1);
      }
      const summary = [...reasons.entries()].map(([reason, count]) => `${reason}×${count}`).join(', ');
      console.warn(
        `[replay] ${overrideFailures.length} recorded outcome(s) failed strict validation (sequences ${overrideFailures
          .map(f => f.sequence)
          .join(', ')}; ${summary}) — fell back to the seeded re-roll.`,
      );
    }

    return {
      state: engine.snapshot(),
      processed: processed.length,
      events: processed,
      overrideFailures,
    };
  }
}

function extractRandomOutcomes(events: readonly GameEvent[]): RandomOutcomeData[] {
  return events
    .filter(event => event.type === 'RANDOM_OUTCOME' && event.data)
    .map(event => structuredClone(event.data) as RandomOutcomeData);
}
