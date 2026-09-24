/**
 * Match assembly for AI-vs-AI battles.
 *
 * Builds a playable EngineState directly (same fixture style the engine test
 * suite uses — the engine has no "menu" bootstrap to reuse headlessly):
 * real general definitions from data/generals.ts, real card names from
 * data/cards.ts, seeded sampling, and optional editor-style `runtime` skill
 * payloads so the compiler → trigger → effect pipeline is exercised in every
 * batch (production built-in generals are description-only otherwise).
 */
import type { EngineState, EnginePlayer } from '../core/GameState';
import { allGenerals, allFactions, type Faction, type General, type Skill } from '../data/generals';
import { createCardDeck, type CardType } from '../data/cards';
import { cloneWithRuntimeInstance } from '../utils/runtimeIdentity';
import { createRngState, rngNext } from '../core/rng';

/**
 * Per-seat setup for the "自选势力/将领" mode (2.2.8). Duplicates are legal —
 * the same faction or the same general id may appear on several seats and
 * several times inside one seat's pool. Empty fields fall back to seeded
 * random choice, so a batch without seatConfigs still plays (faction-pure).
 */
export interface SeatConfig {
  /** '' is tolerated as "not picked" so raw hash/AiBattleSeat objects pass through. */
  faction?: Faction | '' | null;
  /** General definition ids (data/generals.ts); repeats allowed. */
  generals?: string[];
}

export interface MatchConfig {
  seed: number;
  playerCount: number;
  poolPerPlayer: number;
  deckSize: number;
  /** 0..1 — probability a pool general carries an executable practice skill. */
  skillInjection: number;
  baseHp: number;
  /** One entry per seat (index 0 = player 1); missing entries = random. */
  seatConfigs?: SeatConfig[];
}

export function defaultMatchConfig(seed: number, overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed,
    playerCount: 2,
    poolPerPlayer: 8,
    deckSize: 60,
    skillInjection: 0.35,
    baseHp: 6,
    ...overrides,
  };
}

/** Executable skill templates using only compiler-settled triggers/effects (2.1.0 scope). */
const PRACTICE_SKILLS: Skill[] = [
  {
    name: '演練・勤学',
    description: 'AI 演練注入：回合开始时摸一张牌',
    effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  },
  {
    name: '演練・敛权',
    description: 'AI 演練注入：受到伤害后摸一张牌',
    effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  },
  {
    name: '演練・回刺',
    description: 'AI 演練注入：成为攻击目标时反弹 1 点伤害',
    effects: [{ id: 'e1', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } }],
  },
];

// Setup and in-play randomness are separate cursor streams derived from the
// same seed (D-2 second cut, 2.2.19 — no global Math.random patch): xor with
// distinct salts so "assembly of match N" and "turns of match N" never share
// draw positions, and re-ordering setup consumption can't shift the engine.
const SETUP_STREAM_SALT = 0x9e3779b9;

function takeRandom<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length];
}

/** Seeded shuffle + wrap-around sampling: duplicates if count exceeds supply. */
function sampleFrom<T>(items: T[], count: number, random: () => number): T[] {
  const pool = [...items];
  if (pool.length === 0) return [];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: T[] = [];
  for (let i = 0; i < count; i += 1) out.push(pool[i % pool.length]);
  return out;
}

export function buildMatchState(config: MatchConfig): EngineState {
  const setupRng = createRngState((config.seed ^ SETUP_STREAM_SALT) >>> 0);
  const random = () => rngNext(setupRng);
  const players: EnginePlayer[] = [];
  // Deterministic instance ids: every minted card AND injected skill gets a
  // seed-derived stamp, so two patchless builds of the same config are
  // byte-identical and `--replay` stays comparable across processes (the
  // process-local serial in createRuntimeInstanceId would otherwise leak).
  let serial = 0;
  const stamp = (card: { id: string }) => {
    (card as { instanceId?: string }).instanceId = `ai${config.seed}_c${serial}`;
    serial += 1;
    return card;
  };

  for (let index = 0; index < config.playerCount; index += 1) {
    const id = index + 1;
    const seat = config.seatConfigs?.[index] ?? {};
    // Explicit general ids win (duplicates kept); otherwise draw a faction-pure
    // pool of poolPerPlayer. Faction label: explicit > first general > seeded random.
    const explicit = (seat.generals ?? [])
      .map(gid => allGenerals.find(g => g.id === gid))
      .filter((g): g is General => Boolean(g));
    const picked = seat.faction && (allFactions as string[]).includes(seat.faction)
      ? (seat.faction as Faction)
      : undefined;
    const faction: Faction = picked ?? explicit[0]?.faction ?? takeRandom(allFactions, random);
    const sources = explicit.length > 0
      ? explicit
      : sampleFrom(allGenerals.filter(g => g.faction === faction), config.poolPerPlayer, random);
    const generalPool: General[] = [];
    for (const source of sources) {
      const copy = cloneWithRuntimeInstance(source) as General;
      copy.id = `${source.id}_p${id}`;
      stamp(copy);
      if (random() < config.skillInjection) {
        const skill = cloneWithRuntimeInstance({ ...takeRandom(PRACTICE_SKILLS, random) } as never) as unknown as Skill;
        skill.effects = (skill.effects ?? []).map((effect, i) => ({ ...effect, id: `e${i + 1}` }));
        stamp(skill as unknown as { id: string });
        copy.skills = [...(copy.skills ?? []), skill];
      }
      generalPool.push(copy);
    }
    players.push({
      id,
      name: `AI-${id}`,
      faction,
      hand: [],
      generalPool,
      fieldGenerals: [],
      graveyard: [],
      baseHp: config.baseHp,
      baseMaxHp: config.baseHp,
      isAlive: true,
      statuses: [],
    });
  }

  // Shared card pile from the real card list (createCardDeck shuffles on the
  // setup cursor stream), topped up with clones if deckSize exceeds it.
  const deckTemplate = createCardDeck(random);
  const types: CardType[] = ['粮草', '材料', '军备'];
  const deck: unknown[] = [];
  for (let i = 0; i < config.deckSize; i += 1) {
    const base = i < deckTemplate.length
      ? deckTemplate[i]
      : { id: `refill_${i}`, name: types[i % types.length], type: types[i % types.length] };
    const copy = cloneWithRuntimeInstance(base as never) as { id: string };
    copy.id = `${copy.id}_d${i}`;
    stamp(copy);
    deck.push(copy);
  }

  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0].id,
    turn: 0,
    round: 1,
    deck,
    discardPile: [],
    metadata: { roomId: `ai-battle-${config.seed}` },
    drawState: null,
    // Engine draws consume this cursor (D-2) — the in-play stream, separate
    // from the assembly stream above by salt, both derived from config.seed.
    rngState: createRngState(config.seed),
  };
}
