/**
 * AI battle runner smoke tests — small seeded matches, kept fast for CI.
 * The heavy soak (hundreds of games) is a local `npm run ai-battle` activity;
 * these tests only pin: matches terminate, no invariant fires, and the same
 * seed reproduces the same outcome.
 */
import { describe, expect, it } from 'vitest';
import { runMatch } from './battleRunner';
import { defaultMatchConfig } from './matchSetup';

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
    expect(a.actions.map(x => x.type).join(',')).toBe(b.actions.map(x => x.type).join(','));
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
});
