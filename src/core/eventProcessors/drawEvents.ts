import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';
import { cloneRngState, rngShuffle } from '../rng';

export function applyDrawRequiredEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    reason?: 'initial' | 'turnStart' | 'compensation';
    playerId?: number;
    totalCards?: number;
    baseLossPending?: boolean;
    resumePhase?: string;
    resumePlayerId?: number | null;
  } | undefined;
  if (typeof data?.playerId !== 'number') return state;
  const player = state.players.find(p => p.id === data.playerId);
  if (!player || player.isAlive === false) return state;
  return {
    ...state,
    phase: 'drawing',
    timelinePhase: 'DRAW',
    currentPlayerId: player.id,
    metadata: {
      ...(state.metadata ?? {}),
      drawPlayerId: player.id,
      drawReason: data.reason ?? 'turnStart',
      drawTotalCards: typeof data.totalCards === 'number' ? data.totalCards : 5,
    },
    drawState: {
      reason: data.reason ?? 'turnStart',
      playerId: player.id,
      totalCards: typeof data.totalCards === 'number' ? data.totalCards : 5,
      baseLossPending: data.baseLossPending === true,
      resumePhase: typeof data.resumePhase === 'string' ? data.resumePhase : undefined,
      resumePlayerId: typeof data.resumePlayerId === 'number' ? data.resumePlayerId : null,
    },
  };
}

/** Stable identity key used to remove exactly the drawn cards from a pile. */
function cardRemovalKey(card: unknown): string {
  const rt = getRuntimeCardId(card as any);
  if (rt) return rt;
  if (card && typeof card === 'object' && 'id' in card) return String((card as any).id);
  return JSON.stringify(card);
}

/**
 * Applies a DRAW event. Per D-2 (stage D) all card selection happens here —
 * the resolver only emits requested counts. Randomness (general-pool shuffle +
 * discard-pile reshuffle) is consumed from a private clone of EngineState
 * .rngState, which is then advanced in the returned state so the whole match
 * is reproducible from state alone. A missing cursor (legacy snapshot) is
 * lazily seeded from the current turn so even the first draw is deterministic.
 */
export function applyDrawEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    playerId?: number;
    requestedGeneral?: number;
    requestedCards?: number;
    count?: number;
    value?: number;
  } | undefined;
  if (typeof data?.playerId !== 'number') return state;

  const player = state.players.find(p => p.id === data.playerId);
  if (!player) return state;

  const requestedGeneral = Math.max(0, Math.floor(Number(data.requestedGeneral ?? 0)));
  const requestedCards = Math.max(0, Math.floor(Number(data.requestedCards ?? data.count ?? data.value ?? 0)));
  if (requestedGeneral === 0 && requestedCards === 0) return state;

  const fallbackSeed = (((state.turn + 1) * 2654435761) ^ ((state.round + 1) * 40503) ^ ((state.deck?.length ?? 0) * 2246822519)) >>> 0;
  const rng = cloneRngState(state.rngState, fallbackSeed);

  // Private general pool: seeded shuffle so draft/selection order never biases
  // which general is drawn (main-faction generals are presented first when
  // drafting, so using that order would artificially favor them).
  const generalPool = Array.isArray(player.generalPool) ? player.generalPool : [];
  const shuffledGeneralPool = requestedGeneral > 0 ? rngShuffle(generalPool, rng) : generalPool;
  const generalCards = shuffledGeneralPool.slice(0, Math.min(requestedGeneral, shuffledGeneralPool.length));

  // Shared card pool: take from the top of the deck; when it runs low, reshuffle
  // the discard pile (seeded) to refill.
  const deckCards = Array.isArray(state.deck) ? state.deck : [];
  const discardCards = Array.isArray(state.discardPile) ? state.discardPile : [];
  let cardCards = deckCards.slice(0, Math.min(requestedCards, deckCards.length));
  let reshuffledCardCards: unknown[] = [];
  if (cardCards.length < requestedCards && discardCards.length > 0) {
    const reshuffled = rngShuffle(discardCards, rng);
    reshuffledCardCards = reshuffled.slice(0, Math.min(requestedCards - cardCards.length, reshuffled.length));
    cardCards = [...cardCards, ...reshuffledCardCards];
  }

  const drawn = [...generalCards, ...cardCards];

  // Remove the drawn generals from the pool by exact runtime identity.
  const drawnGeneralKeys = new Map<string, number>();
  for (const card of generalCards) {
    const key = cardRemovalKey(card);
    drawnGeneralKeys.set(key, (drawnGeneralKeys.get(key) ?? 0) + 1);
  }
  const remainingGeneralPool = generalPool.filter(card => {
    const key = cardRemovalKey(card);
    const count = drawnGeneralKeys.get(key) ?? 0;
    if (count <= 0) return true;
    if (count === 1) drawnGeneralKeys.delete(key);
    else drawnGeneralKeys.set(key, count - 1);
    return false;
  });

  // Remove the reshuffled cards that left the discard pile by exact identity.
  const reshuffledKeys = new Map<string, number>();
  for (const card of reshuffledCardCards) {
    const key = cardRemovalKey(card);
    reshuffledKeys.set(key, (reshuffledKeys.get(key) ?? 0) + 1);
  }
  const nextDiscard = reshuffledCardCards.length === 0
    ? state.discardPile
    : state.discardPile.filter(card => {
        const key = cardRemovalKey(card);
        const count = reshuffledKeys.get(key) ?? 0;
        if (count <= 0) return true;
        if (count === 1) reshuffledKeys.delete(key);
        else reshuffledKeys.set(key, count - 1);
        return false;
      });

  // Only deck-sourced cards advance the deck pointer; reshuffled cards came
  // from the discard pile.
  const deckConsume = Math.min(cardCards.length - reshuffledCardCards.length, deckCards.length);

  const players = state.players.map(p => {
    if (p.id !== data.playerId) return p;
    const currentHand = Array.isArray(p.hand) ? p.hand : [];
    return {
      ...p,
      hand: [...currentHand, ...drawn],
      generalPool: remainingGeneralPool,
    };
  });

  return {
    ...state,
    players,
    deck: state.deck.slice(deckConsume),
    discardPile: nextDiscard,
    rngState: rng,
  };
}

export function applyDrawConfirmedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    reason?: string;
    completed?: boolean;
    nextPlayerId?: number | null;
    nextPlayerIndex?: number;
    resumePhase?: string;
    resumePlayerId?: number | null;
  } | undefined;
  const completed = data?.completed === true;
  if (!completed && data?.nextPlayerId !== undefined && data?.nextPlayerId !== null) {
    const nextPlayer = state.players.find(player => player.id === data.nextPlayerId);
    return {
      ...state,
      currentPlayerId: data.nextPlayerId,
      drawState: nextPlayer ? {
        reason: 'initial',
        playerId: nextPlayer.id,
        totalCards: 5,
        baseLossPending: false,
      } : state.drawState,
      phase: 'drawing',
      timelinePhase: 'DRAW',
    };
  }

  // Secondary/compensation draws must resume the exact state that was
  // active before the temporary draw window opened. Returning to the
  // previous actor/phase prevents a compensation draw from leaving the
  // match in a dangling DRAW phase.
  if (completed && data?.reason === 'compensation') {
    const resumePhase = data.resumePhase ?? state.drawState?.resumePhase ?? 'ACTION';
    const resumePlayerId = data.resumePlayerId ?? state.drawState?.resumePlayerId ?? state.currentPlayerId;
    const isAction = resumePhase === 'ACTION' || resumePhase === 'playing';
    return {
      ...state,
      currentPlayerId: typeof resumePlayerId === 'number' ? resumePlayerId : state.currentPlayerId,
      phase: isAction ? 'playing' : resumePhase.toLowerCase(),
      timelinePhase: resumePhase,
      drawState: null,
    };
  }

  return {
    ...state,
    drawState: null,
  };
}
