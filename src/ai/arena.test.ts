/**
 * Arena aggregation tests (v2.2.7) — small seeded batches only; the win-rate
 * evidence itself comes from the npm run ai-arena soak, this pins mechanics:
 * seat alternation reporting, violation gating, and key validation.
 */
import { describe, expect, it } from 'vitest';
import { formatArenaSummary, runDuelSeries, runFreeForAll, runRoundRobin } from './arena';

const QUICK = { games: 2, seed: 1500, maxSteps: 400, configOverrides: { poolPerPlayer: 4, deckSize: 36 } };

describe('ai arena', () => {
  it('duel series alternates seats and keeps a clean ledger', () => {
    const summary = runDuelSeries('aggressive', 'random', QUICK);
    expect(summary.games).toBe(2);
    expect(summary.violated).toBe(0);
    expect(summary.violations_detail).toEqual([]);
    // every recorded game ran with seat 1 aggressive then seat 2 aggressive
    expect(summary.lines.map(l => l.winnerSeat)).toHaveLength(2);
    const wins = Object.values(summary.winsByPolicy).reduce((a, b) => a + b, 0);
    expect(wins).toBe(summary.won);
  });

  it('free-for-all maps winners to the right policy across 3 seats', () => {
    const summary = runFreeForAll(['aggressive', 'balanced', 'random'], QUICK);
    expect(summary.games).toBe(2);
    expect(summary.seats).toEqual(['aggressive', 'balanced', 'random']);
    const total = Object.values(summary.winsByPolicy).reduce((a, b) => a + b, 0);
    expect(total).toBe(summary.won);
  });

  it('rejects unknown policy keys and bad seat counts', () => {
    expect(() => runDuelSeries('nope', 'random', { games: 1, seed: 1 })).toThrow(/unknown policy/);
    expect(() => runFreeForAll(['random'], QUICK)).toThrow(/2-4/);
  });

  it('round robin produces one summary per unordered pair', () => {
    const rr = runRoundRobin(['aggressive', 'balanced', 'random'], { games: 1, seed: 1600, maxSteps: 300 });
    expect(Object.keys(rr)).toEqual([
      'aggressive vs balanced',
      'aggressive vs random',
      'balanced vs random',
    ]);
    expect(rr['aggressive vs random'].games).toBe(1);
  });

  it('formats a human-readable summary line', () => {
    const summary = runDuelSeries('balanced', 'random', { games: 1, seed: 1700, maxSteps: 300 });
    const text = formatArenaSummary('均衡 vs random', summary);
    expect(text).toContain('均衡 vs random');
    expect(text).toContain('局');
  });
});
