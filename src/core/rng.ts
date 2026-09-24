/**
 * Deterministic engine RNG (stabilization decision D-2, stage D).
 *
 * The engine's randomness lives inside EngineState.rngState so that a match is
 * fully reproducible from state alone — no global Math.random, no process-wide
 * monkey-patching. The state is plain data (a single uint32 cursor) so it
 * survives structuredClone and JSON round-trips unchanged.
 *
 * PRNG: mulberry32 — small, fast, adequate for shuffles. Callers on the engine
 * path must go through these helpers instead of Math.random (D-2: "禁止 Resolver
 * 私拿随机源").
 */

export interface RngState {
  /** mulberry32 cursor; kept >>> 0 so it stays a uint32. */
  s: number;
}

/** Build a fresh RNG state from an integer seed. */
export function createRngState(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Copy an RNG state so a handler can advance a private clone. */
export function cloneRngState(rng: RngState | undefined, fallbackSeed: number): RngState {
  return { s: rng ? rng.s >>> 0 : fallbackSeed >>> 0 };
}

/** Advance `rng` in place and return the next float in [0, 1). */
export function rngNext(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Fisher-Yates shuffle returning a NEW array, consuming `rng` in place.
 * Replaces the old biased `sort(() => Math.random() - 0.5)` reshuffles.
 */
export function rngShuffle<T>(items: readonly T[], rng: RngState): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rngNext(rng) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
