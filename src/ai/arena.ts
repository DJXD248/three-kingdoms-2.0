/**
 * Tier-vs-tier arena (v2.2.7, phase 3 of the AI line).
 *
 * Pure aggregation over the existing seeded runner — no new game logic.
 * Duels ALTERNATE SEATS every game (game 1: A sits seat 1, game 2: seat 2, …)
 * so seat/turn-order bias cancels out across the batch; an even `games`
 * count gives every policy the same number of turns at each seat under the
 * same seeded setup. Win rates are only meaningful with zero violations —
 * callers treat `violated > 0` as a hard failure, not a statistic.
 */
import { runMatch } from './battleRunner';
import { defaultMatchConfig, type MatchConfig } from './matchSetup';
import { policyByName } from './policies/strategyPolicy';
import type { AiPolicy } from './policies/randomPolicy';
import type { MatchResult } from './battleRunner';

export interface ArenaGameLine {
  seed: number;
  status: MatchResult['status'];
  winnerSeat: number | null;
  winnerPolicy: string | null;
  steps: number;
  violations: number;
}

export interface ArenaSummary {
  /** Policy key per seat for seat assignment reporting. */
  seats: string[];
  games: number;
  won: number;
  exhausted: number;
  violated: number;
  /** Wins per policy key (duel + FFA). */
  winsByPolicy: Record<string, number>;
  /** Wins per seat index (exposes residual seat bias). */
  winsBySeat: Record<number, number>;
  avgSteps: number;
  totalMs: number;
  lines: ArenaGameLine[];
  violations_detail: { seed: number; step: number; code: string; detail: string }[];
}

function resolveSeatPolicies(seats: string[]): AiPolicy[] {
  return seats.map(key => {
    const policy = policyByName(key);
    if (!policy) throw new Error(`[arena] unknown policy "${key}" (use random/conservative/balanced/aggressive)`);
    return policy;
  });
}

function emptySummary(seats: string[]): ArenaSummary {
  return {
    seats,
    games: 0,
    won: 0,
    exhausted: 0,
    violated: 0,
    winsByPolicy: Object.fromEntries(seats.map(s => [s, 0])),
    winsBySeat: {},
    avgSteps: 0,
    totalMs: 0,
    lines: [],
    violations_detail: [],
  };
}

function absorb(summary: ArenaSummary, result: MatchResult, seed: number, seatKeys: string[]) {
  summary.games += 1;
  summary.totalMs += result.durationMs;
  const winnerSeat = result.status === 'won' && result.winnerId !== null ? result.winnerId : null;
  const winnerPolicy = winnerSeat !== null ? seatKeys[winnerSeat - 1] ?? null : null;
  if (result.status === 'won') {
    summary.won += 1;
    if (winnerPolicy) summary.winsByPolicy[winnerPolicy] = (summary.winsByPolicy[winnerPolicy] ?? 0) + 1;
    if (winnerSeat !== null) summary.winsBySeat[winnerSeat] = (summary.winsBySeat[winnerSeat] ?? 0) + 1;
  } else if (result.status === 'stepsExhausted') {
    summary.exhausted += 1;
  } else {
    summary.violated += 1;
    for (const v of result.violations) {
      summary.violations_detail.push({ seed, step: v.step, code: v.code, detail: v.detail });
    }
  }
  summary.lines.push({
    seed,
    status: result.status,
    winnerSeat,
    winnerPolicy,
    steps: result.steps,
    violations: result.violations.length,
  });
}

export interface ArenaOptions {
  games: number;
  seed: number;
  maxSteps?: number;
  configOverrides?: Partial<MatchConfig>;
}

/**
 * One duel series: two policies, 2 players, seats flipped every game.
 * `games` ≤ 5000 keeps the batch in one process comfortably.
 */
export function runDuelSeries(policyA: string, policyB: string, options: ArenaOptions): ArenaSummary {
  const summary = emptySummary([policyA, policyB]);
  const policies = resolveSeatPolicies([policyA, policyB]);
  for (let i = 0; i < options.games; i += 1) {
    const seed = options.seed + i;
    const flip = i % 2 === 1;
    const seatPolicies = flip ? [policies[1], policies[0]] : policies;
    const seatKeys = flip ? [policyB, policyA] : [policyA, policyB];
    const config = defaultMatchConfig(seed, { playerCount: 2, ...options.configOverrides });
    const result = runMatch(config, { seatPolicies, maxSteps: options.maxSteps });
    absorb(summary, result, seed, seatKeys);
  }
  summary.avgSteps = summary.games > 0
    ? Math.round(summary.lines.reduce((sum, line) => sum + line.steps, 0) / summary.games)
    : 0;
  return summary;
}

/** Free-for-all: one seat per policy key (2-4 players), fixed seats. */
export function runFreeForAll(seats: string[], options: ArenaOptions): ArenaSummary {
  if (seats.length < 2 || seats.length > 4) {
    throw new Error('[arena] free-for-all needs 2-4 policy keys');
  }
  const summary = emptySummary(seats);
  const policies = resolveSeatPolicies(seats);
  for (let i = 0; i < options.games; i += 1) {
    const seed = options.seed + i;
    const config = defaultMatchConfig(seed, {
      playerCount: seats.length,
      ...options.configOverrides,
    });
    const result = runMatch(config, { seatPolicies: policies, maxSteps: options.maxSteps });
    absorb(summary, result, seed, seats);
  }
  summary.avgSteps = summary.games > 0
    ? Math.round(summary.lines.reduce((sum, line) => sum + line.steps, 0) / summary.games)
    : 0;
  return summary;
}

/** All ordered pairs of the given policy keys (A vs B with seat alternation). */
export function runRoundRobin(keys: string[], options: ArenaOptions): Record<string, ArenaSummary> {
  const out: Record<string, ArenaSummary> = {};
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      out[`${keys[i]} vs ${keys[j]}`] = runDuelSeries(keys[i], keys[j], options);
    }
  }
  return out;
}

export function formatArenaSummary(title: string, summary: ArenaSummary): string {
  const pct = (key: string) =>
    summary.games > 0 ? `${((summary.winsByPolicy[key] ?? 0) / summary.games * 100).toFixed(1)}%` : '-';
  const rows = summary.seats.map(
    key => `  ${key.padEnd(12)} 胜 ${String(summary.winsByPolicy[key] ?? 0).padStart(4)} (${pct(key)})`,
  );
  return [
    `${title} · ${summary.games} 局 · seed ${summary.games > 0 ? summary.lines[0].seed : '-'}..`,
    ...rows,
    `  分出胜负 ${summary.won} · 步数耗尽 ${summary.exhausted} · 违例局 ${summary.violated} · 平均 ${summary.avgSteps} 步 · ${Math.round(summary.totalMs)}ms`,
  ].join('\n');
}
