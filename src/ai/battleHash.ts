/**
 * URL-hash contract between the developer-mode menu (AiBattleConfig) and the
 * background battle window (`#ai-battle?...`). Kept out of the component files
 * so React Fast Refresh stays clean and vitest can import it directly.
 */
import { allFactions, type Faction } from '../data/generals';
import type { IdentityLockBypass } from './matchSetup';

/**
 * One seat's chosen setup (2.2.8). Empty faction / empty generals list mean
 * "random at match-build time"; duplicates across and inside seats are legal.
 * Encoded in the hash as `seats=魏:wei_001,wei_002|蜀|` (per-seat entries
 * joined by `|`), so the batch is frozen until it finishes.
 */
export interface AiBattleSeat {
  faction: Faction | '';
  generals: string[];
}

export interface AiBattleParams {
  games: number;
  seed: number;
  players: number;
  pool: number;
  deck: number;
  skill: number;
  maxSteps: number;
  /**
   * Per-seat policy keys (random/conservative/balanced/aggressive). Length is
   * clamped to `players` (missing seats fall back to 'random'); the dev window
   * feeds these straight into runMatch's seatPolicies so one side can be an
   * aggressive bot and the other a random one for eyeball testing.
   */
  policies: string[];
  /** Always exactly `players` long (empty entries = random seat). */
  seats: AiBattleSeat[];
  /**
   * v2.8.0 practice-window identity-lock bypasses (`lock=off,share,…` +
   * `lockwl=关羽,张飞`). Null = full lock compliance (the CLI/standard
   * default). Never part of EngineState or replays.
   */
  identityLock: IdentityLockBypass | null;
}

const LOCK_FLAG_KEYS: Record<string, keyof Omit<IdentityLockBypass, 'identityWhitelist'>> = {
  off: 'off',
  share: 'allowSameFactionSeatSharing',
  multi: 'allowSameIdentitySameFactionMultiCopy',
  noexp: 'allowExplicitGeneralsIgnoreLock',
  global: 'lockIdentityGloballyAcrossFactions',
};

/** Bypass switches → hash fragment pairs (inverse of the parser below). */
export function encodeIdentityLock(bypass: IdentityLockBypass): string {
  const flags = Object.entries(LOCK_FLAG_KEYS)
    .filter(([, field]) => bypass[field] === true)
    .map(([flag]) => flag);
  return flags.join(',');
}

function parseIdentityLock(q: URLSearchParams): IdentityLockBypass | null {
  const flags = new Set((q.get('lock') ?? '').split(',').map(s => s.trim()).filter(Boolean));
  const whitelist = (q.get('lockwl') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (flags.size === 0 && whitelist.length === 0) return null;
  const bypass: IdentityLockBypass = {};
  for (const [flag, field] of Object.entries(LOCK_FLAG_KEYS)) {
    if (flags.has(flag)) bypass[field] = true;
  }
  if (whitelist.length > 0) bypass.identityWhitelist = whitelist;
  return bypass;
}

const POLICY_KEYS = new Set(['random', 'conservative', 'balanced', 'aggressive']);

export function parseAiBattleHash(hash: string): AiBattleParams | null {
  const match = /^#ai-battle\?(.*)$/.exec(hash);
  if (!match) return null;
  const q = new URLSearchParams(match[1]);
  const num = (key: string, fallback: number, min: number, max: number) => {
    const raw = q.get(key);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;
  };
  const parsed = {
    games: num('games', 10, 1, 5000),
    seed: num('seed', 1, 0, 2 ** 30),
    players: num('players', 2, 2, 4),
    pool: num('pool', 8, 1, 30),
    deck: num('deck', 60, 10, 400),
    skill: (() => {
      const raw = q.get('skill');
      // v2.8.16: absent = no practice-skill injection (the dev dialog's advanced
      // knob has to be raised on purpose to get the old 2.2.4 behaviour back).
      const v = raw === null ? 0 : Number(raw);
      return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    })(),
    maxSteps: num('maxSteps', 3000, 50, 20000),
    policies: (q.get('policies') ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => POLICY_KEYS.has(s)),
    seats: parseSeats(q.get('seats')),
    identityLock: parseIdentityLock(q),
  };
  // One key per seat; unknown/missing entries fall back to 'random'.
  while (parsed.policies.length < parsed.players) parsed.policies.push('random');
  parsed.policies.length = parsed.players;
  // One entry per seat; absent/blank seat = fully random setup.
  while (parsed.seats.length < parsed.players) parsed.seats.push({ faction: '', generals: [] });
  parsed.seats.length = parsed.players;
  return parsed;
}

const FACTION_NAMES: string[] = allFactions;

/** `魏:wei_001,wei_002|蜀|` → per-seat {faction, generals} entries. */
function parseSeats(raw: string | null): AiBattleSeat[] {
  if (!raw) return [];
  return raw
    .split('|')
    .slice(0, 4)
    .map(entry => {
      const colon = entry.indexOf(':');
      const factionPart = (colon === -1 ? entry : entry.slice(0, colon)).trim();
      const idsPart = colon === -1 ? '' : entry.slice(colon + 1);
      const faction: Faction | '' = (FACTION_NAMES as string[]).includes(factionPart)
        ? (factionPart as Faction)
        : '';
      const generals = idsPart
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      return { faction, generals };
    });
}

/** Inverse of parseSeats — the config dialog builds the hash with this. */
export function encodeSeats(seats: AiBattleSeat[]): string {
  return seats
    .map(s => `${s.faction}${s.generals.length > 0 ? `:${s.generals.join(',')}` : ''}`)
    .join('|');
}
