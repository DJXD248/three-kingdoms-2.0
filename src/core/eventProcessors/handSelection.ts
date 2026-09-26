import { getRuntimeCardId } from '../../utils/runtimeIdentity';

/**
 * Hand-card selection policy, single point of truth (v2.7.2 choice producer
 * cut): DISCARD / GIVE / DECK_PLACE all read the debtor's hand through here.
 *
 *  - No `cardKeys` (every payload minted before 2.7.2, and everything the
 *    compiler can express today): the canonical HEAD-OF-HAND deterministic
 *    slice, `count === 0` = whole-hand sentinel — byte-identical to the
 *    pre-2.7.2 behaviour.
 *  - `cardKeys` present (only a choice producer can mint these, because the
 *    player picked those exact cards): the named cards are taken, keeping
 *    their relative hand order. `count` plays no part — the chosen set IS the
 *    selection. Unknown ids are ignored; when nothing matches, `moved` is
 *    empty and the caller's existing honest no-op gate applies (the event is
 *    still recorded, the trigger happened).
 *
 * Either way: zero RNG, so live play, snapshots and replay all agree.
 */
export interface HandSelection {
  moved: unknown[];
  rest: unknown[];
}

export function selectHandCards(
  hand: unknown[],
  count: number,
  cardKeys?: unknown,
): HandSelection {
  const wanted = Array.isArray(cardKeys)
    ? new Set(cardKeys.filter(key => key !== null && key !== undefined).map(String))
    : null;
  if (wanted && wanted.size > 0) {
    const moved: unknown[] = [];
    const rest: unknown[] = [];
    for (const card of hand) {
      if (wanted.has(getRuntimeCardId(card as never))) moved.push(card);
      else rest.push(card);
    }
    return { moved, rest };
  }
  const take = count === 0 ? hand.length : Math.min(count, hand.length);
  return { moved: hand.slice(0, take), rest: hand.slice(take) };
}
