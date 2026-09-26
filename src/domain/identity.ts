/**
 * v2.8.0 identity lock (身份锁) — pure vocabulary + rules, zero RNG, zero state.
 * Contract table: PROJECT_ARCH_MAP.md §F「身份锁契约表」.
 *
 * An identity (身份) is shared by same-name generals across factions
 * (关羽 exists as 蜀关羽/魏关羽/群关羽). The lock key is (identity, faction):
 * one "category of a concrete general". Distribution locks are derived from
 * these keys ONLY — never from template ids or runtime instance ids.
 */
import type { Faction, General } from '../data/generals';

/** Reserved identity: DIY generals never mutually exclude each other. */
export const DIY_IDENTITY = 'DIY';

/** The public/common faction used by 群 draft candidates. */
export const QUN_FACTION: Faction = '群';

export type IdentityBearing = Pick<General, 'name' | 'identity' | 'faction'>;

/**
 * Resolved identity key of a general (格1).
 * - `identity` absent (undefined)  ⇒ falls back to the general's own name
 *   (every official general carries its name-identity with zero data edits).
 * - `identity` explicitly blank/whitespace ⇒ NO identity (never locks).
 * - otherwise the trimmed stored registry key.
 */
export function identityOf(g: Pick<General, 'name' | 'identity'>): string | null {
  if (g.identity === undefined) {
    const derived = g.name.trim();
    return derived === '' ? null : derived;
  }
  const trimmed = g.identity.trim();
  return trimmed === '' ? null : trimmed;
}

/** Lock key for a concrete (identity, faction) category. */
export function lockKey(identity: string, faction: Faction): string {
  return `${identity}\u0000${faction}`;
}

/**
 * Lock key of a general, or null when it is exempt (格7: 无身份 / 'DIY'
 * never produce a lock key and may coexist freely).
 */
export function lockKeyOf(g: IdentityBearing): string | null {
  const identity = identityOf(g);
  if (identity === null || identity === DIY_IDENTITY) return null;
  return lockKey(identity, g.faction);
}

/** Set of all lock keys held by a batch of generals (exempt ones skipped). */
export function lockKeysOf(generals: readonly IdentityBearing[]): Set<string> {
  const keys = new Set<string>();
  for (const g of generals) {
    const key = lockKeyOf(g);
    if (key !== null) keys.add(key);
  }
  return keys;
}

/** Set of resolved identities held by a batch (exempt ones skipped). */
export function identitiesOf(generals: readonly IdentityBearing[]): Set<string> {
  const ids = new Set<string>();
  for (const g of generals) {
    const identity = identityOf(g);
    if (identity !== null && identity !== DIY_IDENTITY) ids.add(identity);
  }
  return ids;
}

/**
 * Cross-seat distribution lock (格3/格6) — consumed by BOTH draft paths
 * (store 征召链 + ai/matchSetup). Pure: takes no random, mutates nothing.
 *
 * Blocking rules, in contract order:
 *  - same (identity, faction) already distributed to any seat  ⇒ block
 *    (同身份同势力全局唯一; 群同名 distributed ⇒ no more 群同名 anywhere).
 *  - a 群 candidate whose identity matches a main-faction candidate on the
 *    SAME surface                                    ⇒ block (主候选优先保留).
 *  - a 群 candidate whose identity is already distributed as 群 is covered
 *    by the first rule; a distributed main-faction X does NOT block other
 *    seats' 群 X beyond what rule 1 says only within same faction —
 *    cross-faction same-name by DIFFERENT players stays allowed (格6).
 */
export function isLockedForSeat(
  candidate: IdentityBearing,
  distributedKeys: ReadonlySet<string>,
  mainSurfaceIdentities: ReadonlySet<string> = new Set(),
): boolean {
  const key = lockKeyOf(candidate);
  if (key === null) return false;
  if (distributedKeys.has(key)) return true;
  if (candidate.faction === QUN_FACTION) {
    const identity = identityOf(candidate);
    if (identity !== null && mainSurfaceIdentities.has(identity)) return true;
  }
  return false;
}

/**
 * Assembly-time conflict scan (格9/格11): pairs of generals sharing one lock
 * key. Used for explicit prompts only — never for silent filtering or state
 * rewriting (red line: no second transition path).
 */
export function findIdentityConflicts(
  generals: readonly IdentityBearing[],
): { key: string; names: string[] }[] {
  const byKey = new Map<string, string[]>();
  for (const g of generals) {
    const key = lockKeyOf(g);
    if (key === null) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(g.name);
    else byKey.set(key, [g.name]);
  }
  const conflicts: { key: string; names: string[] }[] = [];
  for (const [key, names] of byKey) {
    if (names.length > 1) conflicts.push({ key, names });
  }
  return conflicts;
}

/** Decode a lock key for human-readable prompts ("关羽·群"). */
export function describeLockKey(key: string): string {
  const [identity, faction] = key.split('\u0000');
  return `${identity}·${faction}`;
}
