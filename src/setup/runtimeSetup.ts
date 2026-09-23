import type { General, Faction } from '../data/generals';
import { allGenerals, getGeneralsByFaction } from '../data/generals';

// ── AI seat configuration (v2.2.9 human-vs-AI) ──────────────────────────────
// The tier keys intentionally mirror src/ai/policies/strategyPolicy (parseTier
// accepts them) plus 'random' for the baseline seat; keeping the union local
// here avoids a setup→ai import cycle.

export type AiSeatTier = 'random' | 'conservative' | 'balanced' | 'aggressive';

export interface AiSeatMode { isAi: boolean; tier: AiSeatTier }

export const AI_TIER_KEYS: AiSeatTier[] = ['random', 'conservative', 'balanced', 'aggressive'];

export const AI_TIER_LABELS: Record<AiSeatTier, string> = {
  random: '随机', conservative: '保守', balanced: '均衡', aggressive: '激进',
};

/** Four seats by default (max playerCount); all-human keeps legacy behaviour. */
export function defaultSeatModes(count = 4): AiSeatMode[] {
  return Array.from({ length: count }, () => ({ isAi: false, tier: 'balanced' as AiSeatTier }));
}

export interface SetupPlayerSeed {
  id: number;
  name: string;
  faction: Faction | null;
  seatOrder: number;
  diceRoll: number;
  generalPool: General[];
  hand: unknown[];
  fieldGenerals: unknown[];
  baseHp: number;
  baseMaxHp: number;
  isAlive: boolean;
  isSpectating: boolean;
  avatarGeneral: General | null;
  graveyard: General[];
  // v2.2.9: stamped at creation so the seat keeps its AI identity through
  // dice re-sorting, engine dispatch clones and snapshot round-trips
  // (EnginePlayer has an index signature for exactly this).
  isAi?: boolean;
  aiTier?: AiSeatTier;
}

const BATTLE_NAMES = [
  '赤壁之战','官渡之战','夷陵之战','定军山之战','汉中之战',
  '街亭之战','五丈原之战','合肥之战','长坂坡之战','潼关之战',
  '襄樊之战','濡须之战','博望坡之战','下邳之战','白马之战',
];

export function generateRoomName(random = Math.random): string {
  return `${BATTLE_NAMES[Math.floor(random() * BATTLE_NAMES.length)]}${Math.floor(1000 + random() * 9000)}`;
}

export function shuffle<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const PLAYABLE_FACTIONS: Faction[] = ['魏', '蜀', '吴', '晋'];

export function createLobbyPlayers(playerCount: number, seatModes: readonly AiSeatMode[] = []): SetupPlayerSeed[] {
  const avatars = shuffle(allGenerals);
  const players: SetupPlayerSeed[] = [];
  for (let i = 0; i < playerCount; i += 1) {
    const mode = seatModes[i] ?? { isAi: false, tier: 'balanced' as AiSeatTier };
    const tier: AiSeatTier = mode.tier ?? 'balanced';
    players.push({
      id: i + 1,
      name: mode.isAi ? `AI·${AI_TIER_LABELS[tier]}` : `玩家${i + 1}`,
      faction: null,
      seatOrder: i,
      diceRoll: 0,
      generalPool: [],
      hand: [],
      fieldGenerals: [],
      baseHp: 6,
      baseMaxHp: 6,
      isAlive: true,
      isSpectating: false,
      avatarGeneral: avatars[i] ?? avatars[0] ?? null,
      graveyard: [],
      isAi: mode.isAi,
      aiTier: tier,
    });
  }
  return players;
}

export function rollAndSortPlayers<T extends { diceRoll: number; seatOrder: number }>(players: readonly T[]): T[] {
  return [...players]
    .map(player => ({ ...player, diceRoll: Math.floor(Math.random() * 12) + 1 }))
    .sort((a, b) => b.diceRoll - a.diceRoll)
    .map((player, index) => ({ ...player, seatOrder: index }));
}

export function assignFactions<T extends { faction: Faction | null }>(players: readonly T[]): T[] {
  const factions = shuffle(PLAYABLE_FACTIONS);
  return players.map((player, index) => ({ ...player, faction: factions[index % factions.length] }));
}

export function buildDraftCandidates(
  faction: Faction,
  disabledIds: ReadonlySet<string>,
  alreadySelectedIds: readonly string[] = [],
): { main: General[]; qun: General[] } {
  const excluded = new Set(alreadySelectedIds);
  const available = shuffle(
    getGeneralsByFaction(faction).filter(general => !excluded.has(general.id) && !disabledIds.has(general.id)),
  );
  const warriors = available.filter(general => general.type === '武将');
  const scholars = available.filter(general => general.type === '文将');

  let main: General[] = [];
  main.push(...warriors.slice(0, Math.max(3, Math.min(warriors.length, 7))));
  main.push(...scholars.slice(0, 10 - main.length));
  if (main.length < 10) main.push(...warriors.slice(main.length).slice(0, 10 - main.length));
  main = shuffle(main.slice(0, 10));

  const qun = shuffle(
    getGeneralsByFaction('群').filter(general => !excluded.has(general.id) && !disabledIds.has(general.id)),
  ).slice(0, 5);

  return { main, qun };
}

/**
 * v2.2.9: deterministic AI draft pick — the seat rule is "10 generals with
 * 1–3 群"; the AI always takes its maximum 3 群 slots and fills the rest from
 * its faction's main candidate list. Returns [] unless a fully legal 10-card
 * set exists (then the caller leaves the draft to a human).
 */
export function pickAiDraftPicks(
  main: readonly General[],
  qun: readonly General[],
): General[] {
  const qunPicks = qun.slice(0, Math.min(3, qun.length));
  const mainPicks = main.slice(0, 10 - qunPicks.length);
  const picks = [...mainPicks, ...qunPicks];
  return picks.length === 10 ? picks : [];
}
