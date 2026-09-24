import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';

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

export function applyDrawEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    playerId?: number;
    generalCards?: unknown[];
    cardCards?: unknown[];
    reshuffledCardCards?: unknown[];
    count?: number;
    value?: number;
  } | undefined;
  if (typeof data?.playerId !== 'number') return state;

  const generalCards = Array.isArray(data.generalCards) ? data.generalCards : [];
  let cardCards = Array.isArray(data.cardCards) ? data.cardCards : [];
  let reshuffledCardCards = Array.isArray(data.reshuffledCardCards) ? data.reshuffledCardCards : [];

  // Skill-triggered draws (DRAW_CARD effects) arrive as a bare count.
  // Select concrete card instances at apply time from the shared deck
  // (reshuffling the discard pile when it runs low) so chained draws
  // can never duplicate card instances the way pre-selected slices could.
  if (!Array.isArray(data.generalCards) && !Array.isArray(data.cardCards)) {
    const requested = Math.max(0, Math.floor(Number(data.count ?? data.value ?? 0)));
    if (requested === 0) return state;
    const deckCards = Array.isArray(state.deck) ? state.deck : [];
    const discardCards = Array.isArray(state.discardPile) ? state.discardPile : [];
    cardCards = deckCards.slice(0, Math.min(requested, deckCards.length));
    if (cardCards.length < requested && discardCards.length > 0) {
      reshuffledCardCards = [...discardCards]
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(requested - cardCards.length, discardCards.length));
      cardCards = [...cardCards, ...reshuffledCardCards];
    }
  }

  const drawn = [...generalCards, ...cardCards];

  const remainingReshuffledIds = new Set(reshuffledCardCards.map(card => {
    if (card && typeof card === 'object' && 'id' in card) return String((card as any).id);
    return JSON.stringify(card);
  }));

  const nextDiscard = reshuffledCardCards.length === 0
    ? state.discardPile
    : state.discardPile.filter(card => {
        const key = card && typeof card === 'object' && 'id' in card
          ? String((card as any).id)
          : JSON.stringify(card);
        if (remainingReshuffledIds.has(key)) {
          remainingReshuffledIds.delete(key);
          return false;
        }
        return true;
      });

  const players = state.players.map(player => {
    if (player.id !== data.playerId) return player;
    const currentHand = Array.isArray(player.hand) ? player.hand : [];
    const currentPool = Array.isArray(player.generalPool) ? player.generalPool : [];

    // IMPORTANT: DrawResolver selects physical general instances after
    // shuffling a copy of the pool. Never remove the first N entries
    // from the original pool here, because that can leave the actually
    // drawn general behind and make it drawable again. Remove the exact
    // runtime instances emitted by the DRAW event instead.
    const selectedGeneralIds = new Map<string, number>();
    for (const card of generalCards) {
      const id = getRuntimeCardId(card as any);
      if (id) selectedGeneralIds.set(id, (selectedGeneralIds.get(id) ?? 0) + 1);
    }
    const remainingGeneralPool = currentPool.filter(card => {
      const id = getRuntimeCardId(card as any);
      const count = selectedGeneralIds.get(id) ?? 0;
      if (count <= 0) return true;
      if (count === 1) selectedGeneralIds.delete(id);
      else selectedGeneralIds.set(id, count - 1);
      return false;
    });

    return {
      ...player,
      hand: [...currentHand, ...drawn],
      generalPool: remainingGeneralPool,
    };
  });

  return {
    ...state,
    players,
    deck: state.deck.slice(Math.min(cardCards.length - reshuffledCardCards.length, state.deck.length)),
    discardPile: nextDiscard,
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
