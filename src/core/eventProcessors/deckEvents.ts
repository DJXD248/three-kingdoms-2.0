import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { selectHandCards } from './handSelection';

/**
 * Skill REVEAL effect settlement (2.6.1, deck-top capability layer — a
 * NON-content cut: no built-in payload wires this yet): pure observation of
 * the top `count` cards of the deck. It NEVER mutates EngineState — looking at
 * the deck does not move anything — and it consumes ZERO rngState (the deck
 * order is already fixed, so a replay recomputes the identical head verbatim).
 * The observed card identities are informational only and are NOT recorded
 * into state; the REVEAL event itself is always kept (the look happened),
 * which is the same "record even on no-op" discipline as EQUIP_STRIP/DISCARD.
 */
export function applyRevealEvent(state: EngineState, event: GameEvent): EngineState {
  // Observation has no state effect by contract. Payload shape is validated
  // only so a malformed REVEAL still settles as the harmless no-op it is.
  const data = event.data as { viewerPlayerId?: number; count?: number } | undefined;
  if (typeof data?.viewerPlayerId !== 'number') return state;
  return state;
}

/**
 * Skill DECK_PLACE effect settlement (2.6.1, deck-top capability layer): the
 * hand→deck mirror of GIVE — detaches up to `count` cards from the HEAD of a
 * player's hand and re-attaches them onto the TOP or BOTTOM of the shared
 * deck, preserving their relative order. Head selection is deterministic
 * (same policy as DISCARD/GIVE, zero RNG); `count === 0` is the whole-hand
 * sentinel (as on the hand side, deliberately unlike the equipment side which
 * has no "all"). `cardKeys` (v2.7.2 choice producer surface) overrides the head
 * slice — see eventProcessors/handSelection. Both card kinds stay physical — a general card placed on the
 * deck is a deck card like any drawn general and may resurface via a later
 * reshuffle. An empty hand settles as an honest no-op — the DECK_PLACE event
 * is still recorded, the trigger happened. This is the mechanical "place on
 * top/bottom" half that the future 观星/心战/自书/秘置 content will compose
 * AFTER the choice decision channel (v2.6.3) decides the order.
 */
export function applyDeckPlaceEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    playerId?: number; dest?: string; count?: number; cardKeys?: unknown[];
  } | undefined;
  if (typeof data?.playerId !== 'number') return state;

  const player = state.players.find(p => p.id === data.playerId);
  if (!player) return state;
  const hand = Array.isArray(player.hand) ? (player.hand as unknown[]) : [];
  if (hand.length === 0) return state;

  const count = Math.max(0, Math.floor(Number(data.count ?? 0)));
  const { moved, rest } = selectHandCards(hand, count, data.cardKeys);
  if (moved.length === 0) return state;

  const deck = Array.isArray(state.deck) ? (state.deck as unknown[]) : [];
  const toTop = data.dest === 'TOP';
  const nextDeck = toTop ? [...moved, ...deck] : [...deck, ...moved];

  const players = state.players.map(p =>
    p.id === data.playerId ? { ...p, hand: rest } : p
  );

  return { ...state, players, deck: nextDeck };
}
