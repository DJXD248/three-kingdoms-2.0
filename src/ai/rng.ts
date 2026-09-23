/**
 * Seeded RNG helpers for deterministic AI battles.
 *
 * Every randomness source on the engine path (DrawResolver shuffle/reshuffle,
 * EventProcessor graveyard reshuffle, card-deck build, action ids) goes
 * through the global Math.random — verified by grep in 2.2.4. Therefore a
 * single global patch makes a whole match reproducible from one seed, without
 * touching engine internals. `withSeededRandom` always restores the original.
 */

/** mulberry32 — small, fast, good enough for battle shuffling. */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run `fn` with Math.random replaced by a seeded stream, then restore. */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = createSeededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
