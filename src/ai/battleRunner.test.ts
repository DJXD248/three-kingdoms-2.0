/**
 * AI battle runner smoke tests — small seeded matches, kept fast for CI.
 * The heavy soak (hundreds of games) is a local `npm run ai-battle` activity;
 * these tests only pin: matches terminate, no invariant fires, and the same
 * seed reproduces the same outcome.
 */
import { describe, expect, it } from 'vitest';
import { runMatch } from './battleRunner';
import { defaultMatchConfig } from './matchSetup';
import { policyByName } from './policies/strategyPolicy';

describe('ai battle runner (seeded smoke)', () => {
  it('2-player random match finishes with zero violations', () => {
    const result = runMatch(defaultMatchConfig(101, { poolPerPlayer: 5, deckSize: 40 }), { maxSteps: 2000 });
    expect(result.violations).toEqual([]);
    expect(result.status).toBe('won');
    expect(result.winnerId).not.toBeNull();
    expect(result.steps).toBeGreaterThan(5);
    expect(result.finalPhase).toBe('gameOver');
  });

  it('3-player match with skill injection finishes clean', () => {
    const result = runMatch(
      defaultMatchConfig(202, { playerCount: 3, poolPerPlayer: 5, deckSize: 45, skillInjection: 0.8 }),
      { maxSteps: 2500 },
    );
    expect(result.violations).toEqual([]);
    expect(['won', 'stepsExhausted']).toContain(result.status);
    if (result.status === 'won') expect(result.winnerId).not.toBeNull();
  });

  it('same seed reproduces the same match', () => {
    const config = defaultMatchConfig(303, { poolPerPlayer: 4, deckSize: 40 });
    const a = runMatch(config, { maxSteps: 1500 });
    const b = runMatch(config, { maxSteps: 1500 });
    expect(a.status).toBe(b.status);
    expect(a.winnerId).toBe(b.winnerId);
    expect(a.steps).toBe(b.steps);
    // 2.2.19: full action equality (type + seat + payload), not just the type
    // sequence — every stream (assembly, draws, policy picks) is seeded
    // explicitly, so a patchless rerun is bit-identical end to end.
    expect(a.actions).toEqual(b.actions);
  });

  it('patchless: a generated match never reaches for the global random source', () => {
    // Headline guard for the retired withSeededRandom patch (D-2 second cut):
    // Math.random throws, so ANY hidden entropy consumer on the runner path
    // fails the match instead of silently drifting across reruns.
    const original = Math.random;
    Math.random = () => { throw new Error('battleRunner must run on explicit seeded streams'); };
    try {
      const result = runMatch(defaultMatchConfig(505, { poolPerPlayer: 4, deckSize: 40 }), { maxSteps: 1500 });
      expect(result.violations).toEqual([]);
      expect(result.status).toBe('won');
    } finally {
      Math.random = original;
    }
  });

  it('replaying a recorded match accepts every action and ends identically', () => {
    const config = defaultMatchConfig(404, { poolPerPlayer: 4, deckSize: 40 });
    const original = runMatch(config, { maxSteps: 1500 });
    expect(original.status).toBe('won');
    const replayed = runMatch(config, { recorded: original.actions, maxSteps: original.actions.length + 5 });
    expect(replayed.violations).toEqual([]);
    expect(replayed.status).toBe('won');
    expect(replayed.winnerId).toBe(original.winnerId);
    expect(replayed.steps).toBe(original.steps);
  });

  it('seat stats track deployments/deaths coherently and mark exactly one winner', () => {
    const seatPolicies = [policyByName('aggressive')!, policyByName('aggressive')!];
    const config = defaultMatchConfig(902, { poolPerPlayer: 6, deckSize: 50 });
    const result = runMatch(config, { maxSteps: 1500, seatPolicies });
    const stats = result.seatStats ?? [];
    expect(stats).toHaveLength(2);
    for (const s of stats) {
      const opponentDeaths = stats.filter(o => o !== s).reduce((acc, o) => acc + o.deaths, 0);
      expect(s.faction).toMatch(/魏|蜀|吴|群|晋/);
      expect(s.deaths).toBeLessThanOrEqual(s.deployed);
      expect(s.kills).toBeLessThanOrEqual(opponentDeaths); // 2p: kills ⊆ opponent removals
    }
    // Aggressive-vs-aggressive actually fights: field actions must be tracked.
    expect(stats.reduce((acc, s) => acc + s.deployed, 0)).toBeGreaterThan(0);
    expect(result.actions.filter(a => a.type === 'ATTACK').length).toBeGreaterThan(0);
    expect(stats.reduce((acc, s) => acc + s.attacks, 0)).toBe(
      result.actions.filter(a => a.type === 'ATTACK').length,
    );
    expect(stats.reduce((acc, s) => acc + s.won, 0)).toBe(result.status === 'won' ? 1 : 0);
    if (result.status === 'won') {
      expect(stats[(result.winnerId ?? 0) - 1]?.won).toBe(1);
    }
    // Determinism: the same seeded run yields identical stats.
    const again = runMatch(config, { maxSteps: 1500, seatPolicies });
    expect(again.seatStats).toEqual(stats);
  });
});
