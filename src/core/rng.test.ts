import { describe, it, expect } from 'vitest';
import { createRngState, cloneRngState, rngNext, rngShuffle, type RngState } from './rng';

describe('rng (D-2 engine RNG cursor)', () => {
  it('produces a deterministic stream from the same seed', () => {
    const a = createRngState(42);
    const b = createRngState(42);
    const streamA = Array.from({ length: 20 }, () => rngNext(a));
    const streamB = Array.from({ length: 20 }, () => rngNext(b));
    expect(streamA).toEqual(streamB);
  });

  it('produces different streams for different seeds', () => {
    const a = createRngState(1);
    const b = createRngState(2);
    const streamA = Array.from({ length: 8 }, () => rngNext(a));
    const streamB = Array.from({ length: 8 }, () => rngNext(b));
    expect(streamA).not.toEqual(streamB);
  });

  it('stays within [0, 1)', () => {
    const rng = createRngState(0xdeadbeef);
    for (let i = 0; i < 500; i += 1) {
      const v = rngNext(rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is serializable: JSON round-trip resumes the same stream', () => {
    const rng = createRngState(7);
    for (let i = 0; i < 5; i += 1) rngNext(rng);
    const revived: RngState = JSON.parse(JSON.stringify(rng));
    expect(revived).toEqual({ s: rng.s });
    expect(rngNext(revived)).toBe(rngNext({ ...rng }));
  });

  it('cloneRngState copies the cursor and falls back to the given seed', () => {
    const src = createRngState(99);
    rngNext(src);
    const copy = cloneRngState(src, 0);
    expect(copy.s).toBe(src.s);
    expect(cloneRngState(undefined, 123).s).toBe(123);
    expect(cloneRngState(undefined, -5).s).toBe((-5) >>> 0);
  });

  it('rngShuffle is deterministic per cursor and keeps the input untouched', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const first = rngShuffle(items, createRngState(5));
    const second = rngShuffle(items, createRngState(5));
    expect(first).toEqual(second);
    expect([...first].sort((x, y) => x - y)).toEqual(items);
    expect(items).toEqual(Array.from({ length: 10 }, (_, i) => i));
  });

  it('rngShuffle actually permutes (seeded cursor is consumed)', () => {
    const items = Array.from({ length: 16 }, (_, i) => i);
    const seen = new Set<string>();
    for (let seed = 0; seed < 10; seed += 1) {
      seen.add(rngShuffle(items, createRngState(seed)).join(','));
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('cursor advances in place: consecutive draws from one state differ', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const rng = createRngState(2024);
    const a = rngShuffle(items, rng);
    const b = rngShuffle(items, rng);
    expect(a).not.toEqual(b);
  });
});
