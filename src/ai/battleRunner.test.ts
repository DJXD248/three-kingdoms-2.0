/**
 * AI battle runner smoke tests — small seeded matches, kept fast for CI.
 * The heavy soak (hundreds of games) is a local `npm run ai-battle` activity;
 * these tests only pin: matches terminate, no invariant fires, and the same
 * seed reproduces the same outcome.
 */
import { describe, expect, it } from 'vitest';
import { runMatch, runBatch, skillTriggerKey } from './battleRunner';
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

describe('skill trigger tracking (2.4.3 content audit)', () => {
  it('off by default: no skillTriggers field, outcome untouched', () => {
    const config = defaultMatchConfig(711, { poolPerPlayer: 4, deckSize: 40 });
    const plain = runMatch(config, { maxSteps: 1500 });
    expect(plain.skillTriggers).toBeUndefined();
    expect(plain.skillTriggers === undefined).toBe(true);
    // B4 default path hard证: tracking off must not perturb anything.
    expect(plain.status).toBe('won');
    expect(plain.violations).toEqual([]);
  });

  it('on: effect-event counts are keyed by skill name and deterministic', () => {
    const config = defaultMatchConfig(
      712,
      { poolPerPlayer: 5, deckSize: 45, skillInjection: 0.99 },
    );
    const a = runMatch(config, { maxSteps: 2000, trackSkillTriggers: true });
    const b = runMatch(config, { maxSteps: 2000, trackSkillTriggers: true });
    expect(a.violations).toEqual([]);
    expect(a.skillTriggers).toEqual(b.skillTriggers);
    for (const key of Object.keys(a.skillTriggers ?? {})) {
      // join key = bare skill-name segment, never an instance-salted id
      expect(key).not.toContain(':');
      expect(key).not.toContain('__inst');
    }
    // Same seed, tracking off → identical match outcome (counter is pure observer).
    const untracked = runMatch(config, { maxSteps: 2000 });
    expect(untracked.winnerId).toBe(a.winnerId);
    expect(untracked.steps).toBe(a.steps);
    expect(untracked.actions).toEqual(a.actions);
  });

  it('skillTriggerKey takes the name segment of a compiled skillId', () => {
    expect(skillTriggerKey('wei_001__inst_a:奸雄:e1')).toBe('奸雄');
    expect(skillTriggerKey('ai712_c3:猛进:e1')).toBe('猛进');
    expect(skillTriggerKey('no-colon-fallback')).toBe('no-colon-fallback');
  });

  it('runBatch rolls up counts only when tracking is on', () => {
    const overrides = { poolPerPlayer: 5, deckSize: 45, skillInjection: 0.99 };
    const off = runBatch({ games: 20, seed: 712, maxSteps: 2000, configOverrides: overrides });
    expect(off.skillTriggerCounts).toBeUndefined();
    const on = runBatch({
      games: 20,
      seed: 712,
      maxSteps: 2000,
      trackSkillTriggers: true,
      configOverrides: overrides,
    });
    expect(on.skillTriggerCounts).toBeDefined();
    // 20 near-full-injection games provably fire skill effects (CLI-verified).
    const counts = on.skillTriggerCounts ?? {};
    expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
    // Roll-up keys are sorted for byte-stable output across reruns.
    const keys = Object.keys(counts);
    expect(keys).toEqual([...keys].sort());
    expect(on.winnerCounts).toEqual(off.winnerCounts);
  });
});
