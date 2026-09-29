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
import { describeLockKey, DIY_IDENTITY, identityOf, lockKeyOf } from '../domain/identity';
import { DIY_FIXTURE_GENERALS } from './fixtures/diyGeneralFixture';

/**
 * v2.8.9 地基刀4（方案A，§H）：which repository-fixed file fills the AI pool.
 * - `'official'` (absent = default) — `src/data/generals.ts` ledger only, i.e.
 *   what the B10 anchor means. Nothing else may read into it.
 * - `'diy-fixture'` — `ai/fixtures/diyGeneralFixture.ts`, a committed file
 *   (CI-rebuildable), used ONLY behind the CLI's explicit `--diy-fixture`.
 * Player-side state (store `poolGenerals()`, localStorage drafts) is not a
 * choice here and never will be: automation input must come from files.
 */
export type GeneralPoolSource = 'official' | 'diy-fixture';

/** The one place that resolves a pool source into general records. */
export function generalsForPoolSource(source: GeneralPoolSource | undefined): General[] {
  return source === 'diy-fixture' ? DIY_FIXTURE_GENERALS : allGenerals;
}

/**
 * Factions a pool can actually serve, in ledger order. For the official pool
 * this is provably `allFactions` itself (all five are populated), so the seeded
 * draw order — and B10 — is untouched; a smaller fixture pool simply can't be
 * asked to serve a faction it has no card for.
 */
export function factionsForPoolSource(source: GeneralPoolSource | undefined): Faction[] {
  const pool = generalsForPoolSource(source);
  return allFactions.filter(faction => pool.some(g => g.faction === faction));
}


/**
 * Per-seat setup for the "自选势力/将领" mode (2.2.8). With the v2.8.0
 * identity lock every seat is a distinct owner, so duplicates are illegal by
 * default: an explicit seat list that collides on a lock key aborts the whole
 * batch with a reason (契约表「装配期新冲突拒整批」), and seeded pools draw
 * from the not-yet-locked remainder. These bypasses ONLY live in the
 * practice-window config (never in canonical EngineState / replays / the
 * standard room chain); the CLI omits them → full lock compliance.
 */
export interface SeatConfig {
  /** '' is tolerated as "not picked" so raw hash/AiBattleSeat objects pass through. */
  faction?: Faction | '' | null;
  /** General definition ids (data/generals.ts); repeats collide with the lock. */
  generals?: string[];
}

/** Practice-window identity-lock bypasses (v2.8.0). Absent = full compliance. */
export interface IdentityLockBypass {
  /** 关闭身份锁 — restores the pre-2.8 pooled-duplicates behaviour entirely. */
  off?: boolean;
  /** 允许同势力AI — later seats may reuse a lock key an earlier seat already holds. */
  allowSameFactionSeatSharing?: boolean;
  /** 允许同身份同势力多份 — same lock key may appear several times in ONE seat pool. */
  allowSameIdentitySameFactionMultiCopy?: boolean;
  /** 自选AI将领不受锁 — explicit seat picks skip the reject-the-batch validation. */
  allowExplicitGeneralsIgnoreLock?: boolean;
  /** 指定身份白名单 — only these identities lock; others are free. */
  identityWhitelist?: string[];
  /** 全局同身份互斥（加强压力档）— same identity locks across DIFFERENT factions too. */
  lockIdentityGloballyAcrossFactions?: boolean;
}

export interface MatchConfig {
  seed: number;
  playerCount: number;
  poolPerPlayer: number;
  deckSize: number;
  /**
   * 0..1 — probability a pool general carries an executable practice skill.
   * v2.8.16 default = 0 (off): practice batches run on the ledger's own skills
   * unless a caller raises this on purpose. The roll is still drawn at 0, so
   * the setup RNG stream — and anchor B11's `--skill 0` path — is unchanged.
   */
  skillInjection: number;
  baseHp: number;
  /** One entry per seat (index 0 = player 1); missing entries = random. */
  seatConfigs?: SeatConfig[];
  /** v2.8.0: practice-window bypass switches; CLI/standard path never sets this. */
  identityLock?: IdentityLockBypass;
  /** v2.8.9: which repository-fixed file supplies the generals; absent = official ledger. */
  poolSource?: GeneralPoolSource;
}

export function defaultMatchConfig(seed: number, overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed,
    playerCount: 2,
    poolPerPlayer: 8,
    deckSize: 60,
    skillInjection: 0,
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
  {
    // 2.3.1 content anchor for the turn-end ask chain. Never auto-fires
    // (TURN_END is not event-mapped): it activates only through an explicit
    // ACTIVATE_SKILL action — in ai-battle via policy picks from
    // legalActions, in live play via the ask window / AI driver.
    name: '演練・守夜',
    description: 'AI 演練注入：回合结束时可摸一张牌',
    effects: [{ id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
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
  const pool = generalsForPoolSource(config.poolSource);
  const factionChoices = factionsForPoolSource(config.poolSource);
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

  // v2.8.0 identity lock (ARCH_MAP §F 契约表). Locking itself consumes zero
  // randomness; the seeded path's filter sits BEFORE sampleFrom's shuffle,
  // so a shrunk pool changes that shuffle's iteration count — the expected
  // content effect that re-anchors the B9 baseline to B10, not a hidden
  // second random stream.
  const bypass = config.identityLock ?? {};
  const lockOn = !bypass.off;
  const whitelisted = (identity: string | null): boolean =>
    identity !== null && (bypass.identityWhitelist === undefined || bypass.identityWhitelist.includes(identity));
  const lockedKeyOf = (g: General): string | null => {
    if (!lockOn) return null;
    const key = lockKeyOf(g);
    return key !== null && whitelisted(identityOf(g)) ? key : null;
  };
  const globalIdentityLock = bypass.lockIdentityGloballyAcrossFactions === true;
  const usedKeys = new Set<string>();
  const usedIdentities = new Set<string>();
  const seatConflict = (g: General): string | null => {
    const key = lockedKeyOf(g);
    if (key === null) return null;
    if (usedKeys.has(key) && !bypass.allowSameFactionSeatSharing) {
      return `与前面座位已分发的同锁将领（${describeLockKey(key)}）`;
    }
    if (globalIdentityLock) {
      const identity = identityOf(g);
      if (identity !== null && usedIdentities.has(identity)) {
        return '与前面座位同身份（全局同身份互斥压力档）';
      }
    }
    return null;
  };

  for (let index = 0; index < config.playerCount; index += 1) {
    const id = index + 1;
    const seat = config.seatConfigs?.[index] ?? {};
    // Explicit general ids win; a collision they cause is an assembly error
    // (拒整批 + 明确原因), never a silent filter — unless a bypass says so.
    const explicit = (seat.generals ?? [])
      .map(gid => pool.find(g => g.id === gid))
      .filter((g): g is General => Boolean(g));
    if (lockOn && !bypass.allowExplicitGeneralsIgnoreLock && explicit.length > 0) {
      const seenKeys = new Set<string>();
      const problems: string[] = [];
      for (const g of explicit) {
        const key = lockedKeyOf(g);
        if (key === null) continue;
        const cross = seatConflict(g);
        if (cross) problems.push(`座${id}「${g.name}·${g.faction}」${cross}`);
        if (seenKeys.has(key) && !bypass.allowSameIdentitySameFactionMultiCopy) {
          problems.push(`座${id}自选列表内部同锁重复（${describeLockKey(key)}）`);
        }
        seenKeys.add(key);
      }
      if (problems.length > 0) {
        throw new Error(`身份锁拒绝整批装配：${problems.join('；')}。演练窗旁路开关可放行。`);
      }
    }
    const picked = seat.faction && (factionChoices as string[]).includes(seat.faction)
      ? (seat.faction as Faction)
      : undefined;
    const faction: Faction = picked ?? explicit[0]?.faction ?? takeRandom(factionChoices, random);
    let sources: General[];
    if (explicit.length > 0) {
      sources = explicit;
    } else {
      const unlocked = pool.filter(g => g.faction === faction && seatConflict(g) === null);
      const sampled = sampleFrom(unlocked, config.poolPerPlayer, random);
      if (!lockOn || bypass.allowSameIdentitySameFactionMultiCopy) {
        sources = sampled;
      } else {
        const seenKeys = new Set<string>();
        sources = sampled.filter(g => {
          const key = lockedKeyOf(g);
          if (key === null) return true;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
      }
    }
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
      const key = lockedKeyOf(source);
      if (key !== null) usedKeys.add(key);
      const identity = identityOf(source);
      if (identity !== null && identity !== DIY_IDENTITY) usedIdentities.add(identity);
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
