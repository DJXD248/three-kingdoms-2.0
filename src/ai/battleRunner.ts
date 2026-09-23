/**
 * Local AI-vs-AI battle runner (fs-free so vitest can import it directly).
 *
 * Each step mirrors the production bridge path exactly:
 *   fresh `new GameEngine(state, { recordHistory: false })` +
 *   `syncPlayerSkills(engine, state)` + `engine.dispatch(action)`.
 * recordHistory:false is what lets thousands of games run without the
 * replay/snapshot deep-clone retention (O(n^2)) building up — the UI keeps
 * the default (true) and is untouched.
 *
 * Determinism: every randomness source on the engine path goes through the
 * global Math.random (see src/ai/rng.ts), so one seed reproduces a whole
 * match. The replay mode keeps the SAME random-number consumption as the
 * generated run (the policy is still consulted each step) and merely
 * overrides the choice with the recorded action — that way divergence points
 * at a real non-determinism or rule bug rather than stream skew.
 */
import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';
import { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { withSeededRandom } from './rng';
import { buildMatchState, defaultMatchConfig, type MatchConfig } from './matchSetup';
import { createLedgerSentinel, checkStateInvariants, type Violation } from './invariants';
import { randomPolicy, type AiPolicy } from './policies/randomPolicy';

export interface RecordedAction {
  type: GameAction['type'];
  playerId: number;
  payload?: unknown;
}

export interface MatchResult {
  config: MatchConfig;
  status: 'won' | 'stepsExhausted' | 'violation' | 'replay-diverged';
  winnerId: number | null;
  steps: number;
  durationMs: number;
  actions: RecordedAction[];
  violations: Violation[];
  finalPhase: string;
}

export interface BatchSummary {
  games: number;
  won: number;
  violated: number;
  exhausted: number;
  winnerCounts: Record<string, number>;
  totalMs: number;
  avgMs: number;
  slowestMs: number;
  violations: { seed: number; step: number; code: string; detail: string }[];
  failedMatches: MatchResult[];
}

function countAlive(state: EngineState): number {
  return (state.players ?? []).filter(p => p.isAlive !== false).length;
}

function winnerOf(state: EngineState): number | null {
  const raw = (state.metadata as Record<string, unknown> | undefined)?.winnerId;
  return typeof raw === 'number' ? raw : null;
}

interface RunOptions {
  policy?: AiPolicy;
  /** Per-seat overrides (index = playerId − 1) — the arena feeds different
   * tiers per seat; seats beyond the array (or absent) fall back to `policy`. */
  seatPolicies?: AiPolicy[];
  maxSteps?: number;
  /** Replay mode: dispatch these actions (after the opening BEGIN_DRAW) instead of policy picks. */
  recorded?: RecordedAction[];
}

/**
 * Core loop shared by generation and replay. The opening action is always an
 * explicit BEGIN_DRAW(initial) — the engine's draw lifecycle then chains the
 * remaining players' initial draws itself.
 */
export function runMatch(config: MatchConfig, options: RunOptions = {}): MatchResult {
  const defaultPolicy = options.policy ?? randomPolicy;
  const policyFor = (playerId: number): AiPolicy =>
    options.seatPolicies?.[playerId - 1] ?? defaultPolicy;
  const maxSteps = options.maxSteps ?? 3000;
  const recorded = options.recorded ?? null;

  return withSeededRandom(config.seed, () => {
    const startedAt = Date.now();
    let state = buildMatchState(config);
    const actions: RecordedAction[] = [];
    const violations: Violation[] = [];
    const ledger = createLedgerSentinel();
    let status: MatchResult['status'] = 'stepsExhausted';

    const firstPlayerId = state.currentPlayerId ?? 1;

    const dispatchStep = (action: GameAction, index: number, prepared?: GameEngine): boolean => {
      const engine = prepared ?? new GameEngine(state, { recordHistory: false });
      const aliveBefore = countAlive(state);
      const events = engine.dispatch(action);
      state = engine.state;
      const rejected = events.filter(ev => ev.type === 'ACTION_REJECTED');
      if (rejected.length > 0) {
        violations.push({
          code: recorded ? 'REPLAY_ACTION_REJECTED' : 'ENUMERATED_REJECTED',
          step: index,
          detail: `${action.type} by player ${action.playerId} rejected: ${JSON.stringify(rejected[0]?.data ?? null)}`,
        });
        return false;
      }
      actions.push({ type: action.type, playerId: action.playerId, payload: action.payload });
      const died = aliveBefore - countAlive(state) > 0;
      const found = checkStateInvariants(state, index).concat(ledger.check(state, index, died));
      if (found.length > 0) {
        violations.push(...found);
        return false;
      }
      return true;
    };

    // Step 0: open the initial draw window explicitly (runner-owned setup,
    // BEGIN_DRAW is intentionally never policy-enumerated).
    const begin = createAction('BEGIN_DRAW', firstPlayerId, {
      reason: 'initial',
      playerId: firstPlayerId,
      totalCards: 5,
    });
    if (!dispatchStep(begin, 0)) {
      status = recorded ? 'replay-diverged' : 'violation';
    } else {
      for (let index = 1; index <= maxSteps; index += 1) {
        if (state.phase === 'gameOver') {
          status = 'won';
          break;
        }
        const actor =
          state.phase === 'drawing' && state.drawState
            ? state.drawState.playerId
            : state.currentPlayerId ?? firstPlayerId;
        const engine = new GameEngine(state, { recordHistory: false });
        syncPlayerSkills(engine, state);
        const picked = policyFor(actor)(engine, actor); // always consulted → identical RNG stream in replay mode
        let next = picked;
        if (recorded) {
          // actions[0] is always the runner-owned BEGIN_DRAW (both modes),
          // so the recording for loop step `index` sits at recorded[index].
          const rec = recorded[index];
          if (!rec) {
            status = state.phase === 'gameOver' ? 'won' : 'stepsExhausted';
            break;
          }
          // Reuse the recording verbatim. A plain literal (not createAction)
          // keeps the seeded RNG stream in lockstep with the generated run.
          next = { id: `replay_${index}`, type: rec.type, playerId: rec.playerId, payload: rec.payload } as GameAction;
        }
        if (!next) {
          violations.push({
            code: 'NO_LEGAL_ACTION',
            step: index,
            detail: `policy found nothing legal for player ${actor} in ${state.phase}/${state.timelinePhase}`,
          });
          status = 'violation';
          break;
        }
        if (!dispatchStep(next, index, engine)) {
          status = recorded ? 'replay-diverged' : 'violation';
          break;
        }
      }
      if (status === 'stepsExhausted' && state.phase === 'gameOver') status = 'won';
    }

    return {
      config,
      status,
      winnerId: winnerOf(state),
      steps: actions.length,
      durationMs: Date.now() - startedAt,
      actions,
      violations,
      finalPhase: String(state.phase),
    };
  });
}

export interface BatchOptions extends RunOptions {
  games: number;
  seed: number;
  configOverrides?: Partial<MatchConfig>;
}

/** Run `games` seeded matches (seed, seed+1, …) and aggregate the results. */
export function runBatch(options: BatchOptions): BatchSummary {
  const summary: BatchSummary = {
    games: 0,
    won: 0,
    violated: 0,
    exhausted: 0,
    winnerCounts: {},
    totalMs: 0,
    avgMs: 0,
    slowestMs: 0,
    violations: [],
    failedMatches: [],
  };
  for (let i = 0; i < options.games; i += 1) {
    const seed = options.seed + i;
    const config = defaultMatchConfig(seed, options.configOverrides);
    const result = runMatch(config, {
      policy: options.policy,
      seatPolicies: options.seatPolicies,
      maxSteps: options.maxSteps,
    });
    summary.games += 1;
    summary.totalMs += result.durationMs;
    summary.slowestMs = Math.max(summary.slowestMs, result.durationMs);
    if (result.status === 'won') {
      summary.won += 1;
      const key = String(result.winnerId ?? 'none');
      summary.winnerCounts[key] = (summary.winnerCounts[key] ?? 0) + 1;
    } else if (result.status === 'stepsExhausted') {
      summary.exhausted += 1;
    } else {
      summary.violated += 1;
      summary.failedMatches.push(result);
      for (const v of result.violations) {
        summary.violations.push({ seed, step: v.step, code: v.code, detail: v.detail });
      }
    }
  }
  summary.avgMs = summary.games > 0 ? Math.round(summary.totalMs / summary.games) : 0;
  return summary;
}
