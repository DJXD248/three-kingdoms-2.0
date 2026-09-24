/**
 * Seeded RNG helpers for deterministic AI battles.
 *
 * Since D-2 (stage D) the engine's in-match randomness (draw shuffles) is
 * carried by EngineState.rngState instead of the global Math.random, so this
 * global patch now only covers the remaining setup-path randomness (card-deck
 * build, general sampling) and AI policy tie-breaks. `withSeededRandom` always
 * restores the original; full retirement is tracked as a PENDING item.
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
