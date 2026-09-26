import { getRuntimeCardId } from '../utils/runtimeIdentity';
import type { EnginePlayer, EngineState } from '../core/GameState';

/**
 * choice 生产者候选枚举器 (v2.7.2, GPT 三检 Q5 的"只接线不带内容"最小验证刀).
 *
 * v2.6.3 built the decision channel; its only producer turned a skill's
 * pre-compiled effect branches into options (one option per branch). These two
 * enumerators answer the next question — can a producer derive candidates from
 * ENGINE STATE instead (pick a general, pick a card)? They are pure
 * observation: zero state writes, zero RNG, zero events, and the offer they
 * feed is still the standard CHOICE_REQUIRED shape, so validator, resolver,
 * legal-actions enumeration and the HUD all work unchanged.
 *
 * Order is part of the contract: candidates are enumerated players-order ×
 * fieldGenerals-order (or hand-array-order), and that recorded order IS the
 * optionIndex the debtor picks with — same table for AI and humans, byte-stable
 * under replay.
 */

/** A candidate the debtor may pick: what to show, and what to fill into the
 * definition's single template effect. */
export interface ChoiceCandidate {
  label: string;
  /** TARGET candidates: runtime card id of the field general. */
  targetId?: string;
  /** HAND_CARD candidates: runtime card ids to settle (one per candidate). */
  cardKeys?: string[];
}

export type ChoiceTargetScope = 'ENEMY_FIELD' | 'ALL_FIELD' | 'SELF_FIELD';

type Entry = Record<string, unknown>;

function asEntry(value: unknown): Entry | null {
  return value && typeof value === 'object' ? (value as Entry) : null;
}

function nameOf(entry: Entry | null, fallback: string): string {
  const name = entry?.name;
  return typeof name === 'string' && name ? name : fallback;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Field generals in players-order × fieldGenerals-order, scoped against the
 * owning seat (ENEMY_FIELD never offers the owner's own generals, and a dead
 * player's field never enters any scope). */
export function enumerateTargetCandidates(
  state: EngineState,
  ownerId: number,
  scope: ChoiceTargetScope = 'ENEMY_FIELD',
): ChoiceCandidate[] {
  const out: ChoiceCandidate[] = [];
  for (const player of state.players ?? []) {
    if ((player as Entry | undefined)?.isAlive === false) continue;
    const isOwner = Number((player as EnginePlayer).id) === ownerId;
    if (scope === 'ENEMY_FIELD' && isOwner) continue;
    if (scope === 'SELF_FIELD' && !isOwner) continue;
    for (const raw of listOf((player as Entry).fieldGenerals)) {
      const entry = asEntry(raw);
      const general = asEntry(entry?.general);
      if (!general) continue;
      const targetId = getRuntimeCardId(general as never) || String(general.id ?? '');
      if (!targetId) continue;
      out.push({ label: nameOf(general, targetId), targetId });
    }
  }
  return out;
}

/** The debtor's own hand, in hand-array order (the same order DISCARD/GIVE/
 * DECK_PLACE read before explicit selection existed). */
export function enumerateHandCardCandidates(
  state: EngineState,
  playerId: number,
): ChoiceCandidate[] {
  const player = (state.players ?? []).find(p => Number((p as Entry).id) === playerId);
  if (!player) return [];
  const out: ChoiceCandidate[] = [];
  for (const raw of listOf((player as Entry).hand)) {
    const card = asEntry(raw);
    if (!card) continue;
    const cardKey = getRuntimeCardId(card as never) || String(card.id ?? '');
    if (!cardKey) continue;
    out.push({ label: nameOf(card, cardKey), cardKeys: [cardKey] });
  }
  return out;
}
