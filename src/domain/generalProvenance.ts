/**
 * v2.8.5 content-layer provenance (来源与不变量) — pure vocabulary + rules,
 * zero RNG on the engine path, zero state.
 * Contract: PROJECT_ARCH_MAP.md §H1/§H2 (frozen set corrected 2026-09-28:
 * `id` and `source` freeze at creation; `identity` is an EDITABLE content
 * field — a mis-picked or missing 身份 must stay fixable).
 *
 * Two layers of "official" (§H2), kept apart on purpose:
 *  - `source === 'official'`  who authored it (permission layer)
 *  - repository official      it is in `src/data/generals.ts`, so CI can
 *                            rebuild it (isRepositoryOfficial)
 * A developer-mode new general is an official LOCAL DRAFT: playable locally,
 * never part of the AI standard pool (ai/matchSetup reads the ledger only).
 */
import { allGenerals, type Faction, type General, type GeneralSource, type Skill } from '../data/generals';

export const OFFICIAL_DRAFT_ID_PREFIX = 'G-';
export const DIY_ID_PREFIX = 'D-';

/** Fields frozen at creation. `identity` is deliberately NOT here (§H1). */
export const FROZEN_GENERAL_FIELDS = ['id', 'source'] as const;
export type FrozenGeneralField = (typeof FROZEN_GENERAL_FIELDS)[number];

const REPOSITORY_LEDGER_IDS = new Set(allGenerals.map(g => g.id));

/**
 * Source of a general. Ledger cards carry no `source` field, so absence means
 * 'official' — the STRICTER default: an unknown record is treated as official
 * content and therefore protected from non-developer edits, never the reverse.
 */
export function sourceOf(g: Pick<General, 'source'>): GeneralSource {
  return g.source ?? 'official';
}

/** Is this general the repository ledger's own card (CI-rebuildable)? */
export function isRepositoryOfficial(g: Pick<General, 'id'>): boolean {
  return REPOSITORY_LEDGER_IDS.has(g.id);
}

/** Which namespace a record id belongs to ('' id shapes are the legacy ledger). */
export function idNamespace(id: string): 'G' | 'D' | 'legacy' {
  if (id.startsWith(OFFICIAL_DRAFT_ID_PREFIX)) return 'G';
  if (id.startsWith(DIY_ID_PREFIX)) return 'D';
  return 'legacy';
}

export function isAuthoredId(id: string): boolean {
  return idNamespace(id) !== 'legacy';
}

/**
 * Any edit patch (from the editor, an Excel row, or a restored localStorage
 * blob) may never carry a frozen field. Reported, never silently dropped —
 * a dropped write the user cannot see is the worst failure shape (§12-46①).
 */
export function frozenFieldWrites(patch: Record<string, unknown>): FrozenGeneralField[] {
  return FROZEN_GENERAL_FIELDS.filter(field => field in patch);
}

export function stripFrozenFields(patch: Record<string, unknown>): {
  clean: Record<string, unknown>;
  rejected: FrozenGeneralField[];
} {
  const rejected = frozenFieldWrites(patch);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(FROZEN_GENERAL_FIELDS as readonly string[]).includes(key)) clean[key] = value;
  }
  return { clean, rejected };
}

export type AuthoredGeneralInput = {
  name: string;
  faction: Faction;
  hp: number;
  identity?: string;
  title?: string;
  skills?: Skill[];
};

export type AuthoringFailure = { ok: false; reason: 'NAME_REQUIRED' | 'HP_INVALID' | 'ID_SOURCE_UNAVAILABLE' };
export type AuthoringSuccess = { ok: true; general: General };

/**
 * The ONLY way a new general record comes into existence (§H1).
 * - mints an id inside the namespace that matches the caller's source
 * - writes `identity` EXPLICITLY (falling back to the name at creation), so a
 *   later rename can never silently move the lock key `identity.ts:27-34` derives
 * - `''` (explicit blank) is preserved: that general carries no identity and
 *   no lock key while it stays blank (filling an identity in later puts the
 *   general back under the lock — `identity` is an editable field, §H1),
 *   exactly like the editor's existing 无身份 semantics
 * - `source` is stamped here and never rewritten afterwards
 */
export function createAuthoredGeneral(
  input: AuthoredGeneralInput,
  source: GeneralSource,
  randomId: () => string = () => globalThis.crypto?.randomUUID?.(),
): AuthoringSuccess | AuthoringFailure {
  const name = input.name.trim();
  if (name === '') return { ok: false, reason: 'NAME_REQUIRED' };
  const hp = Number(input.hp);
  if (!Number.isFinite(hp) || hp <= 0) return { ok: false, reason: 'HP_INVALID' };
  const suffix = randomId();
  if (typeof suffix !== 'string' || suffix.trim() === '') return { ok: false, reason: 'ID_SOURCE_UNAVAILABLE' };
  const prefix = source === 'official' ? OFFICIAL_DRAFT_ID_PREFIX : DIY_ID_PREFIX;
  const identity = input.identity === undefined ? name : input.identity.trim();
  const type: General['type'] = hp >= 4 ? '武将' : '文将';
  return {
    ok: true,
    general: {
      id: `${prefix}${suffix}`,
      name,
      faction: input.faction,
      hp,
      type,
      meleeAtk: type === '武将' ? 2 : 1,
      rangedAtk: type === '武将' ? 1 : 2,
      armor: 0,
      skills: input.skills ?? [],
      title: input.title?.trim() || undefined,
      identity,
      source,
    },
  };
}

/**
 * Load-time acceptance test for a persisted authored record. Anything shaped
 * like a ledger id (or missing provenance) is refused: the authored list can
 * never shadow or rewrite a repository card, and re-import must not mint new
 * numbers for records that already have one.
 */
export function isAcceptableAuthoredRecord(value: unknown): value is General {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<General>;
  if (typeof g.id !== 'string' || !isAuthoredId(g.id)) return false;
  if (g.source !== 'official' && g.source !== 'DIY') return false;
  if (idNamespace(g.id) !== (g.source === 'official' ? 'G' : 'D')) return false;
  if (typeof g.name !== 'string' || g.name.trim() === '') return false;
  return true;
}
