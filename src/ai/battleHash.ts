/**
 * URL-hash contract between the developer-mode menu (AiBattleConfig) and the
 * background battle window (`#ai-battle?...`). Kept out of the component files
 * so React Fast Refresh stays clean and vitest can import it directly.
 */
export interface AiBattleParams {
  games: number;
  seed: number;
  players: number;
  pool: number;
  deck: number;
  skill: number;
  maxSteps: number;
}

export function parseAiBattleHash(hash: string): AiBattleParams | null {
  const match = /^#ai-battle\?(.*)$/.exec(hash);
  if (!match) return null;
  const q = new URLSearchParams(match[1]);
  const num = (key: string, fallback: number, min: number, max: number) => {
    const raw = q.get(key);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;
  };
  return {
    games: num('games', 10, 1, 5000),
    seed: num('seed', 1, 0, 2 ** 30),
    players: num('players', 2, 2, 4),
    pool: num('pool', 8, 1, 30),
    deck: num('deck', 60, 10, 400),
    skill: (() => {
      const raw = q.get('skill');
      const v = raw === null ? 0.35 : Number(raw);
      return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.35));
    })(),
    maxSteps: num('maxSteps', 3000, 50, 20000),
  };
}
