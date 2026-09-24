import type { EngineState } from '../GameState';
import type { GameEvent, RandomOutcomeData, RandomOutcomeValue } from '../Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';
import { cloneRngState, rngShuffle, type RngState } from '../rng';

/**
 * Per-dispatch RNG flow (decision D-2a, 2.2.22). Created by TransitionCore
 * for every accepted action: `produced` collects the draw selections made on
 * the live RNG path (later appended to the event stream as RANDOM_OUTCOME
 * events); `overrides` is the replay injection queue consumed one slot per
 * DRAW event, in dispatch order. Live production play never sets overrides.
 */
export interface DrawOutcomeFlow {
  produced: RandomOutcomeData[];
  overrides?: readonly RandomOutcomeData[];
  overridePos: number;
  /** D-2a diagnostic bypass (2.2.23): recorded overrides that failed strict
   * validation. Observation only — behavior stays the seeded re-roll. */
  diagnostics?: OverrideFailure[];
}

export type OverrideFailureReason = 'MISMATCHED_SLOTS' | 'COUNT_MISMATCH' | 'UNRESOLVABLE_KEY';

export interface OverrideFailure {
  stableId: string;
  playerId: number;
  reason: OverrideFailureReason;
}

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
 *
 * D-2a (2.2.22): the live selection is additionally reported into
 * `flow.produced` as a RandomOutcome ("record outcomes, not re-rolls"). When
 * `flow.overrides` carries a replay result that passes materialization
 * (counts match the deterministic formulas AND every identity key exists in
 * the current piles), the recorded selection is applied verbatim and the
 * cursor jumps to cursorAfter without touching the RNG. Any mismatch falls
 * back to the seeded re-roll — old pre-2.2.22 replays and corrupt payloads
 * both keep working through that path.
 *
 * D-2a bypass (2.2.23): a rejected override is additionally reported into
 * `flow.diagnostics` with its reason ("可自动降级，不可无痕降级" — the
 * behavior still degrades silently, the observation is not silent).
 */
export function applyDrawEvent(state: EngineState, event: GameEvent, flow?: DrawOutcomeFlow): EngineState {
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

  const generalPool = Array.isArray(player.generalPool) ? player.generalPool : [];
  const deckCards = Array.isArray(state.deck) ? state.deck : [];
  const discardCards = Array.isArray(state.discardPile) ? state.discardPile : [];

  let generalCards: unknown[];
  let cardCards: unknown[];
  let reshuffledCardCards: unknown[] = [];
  let nextCursor: RngState;

  const override = takeOverride(flow, data.playerId);
  const materialized = override
    ? materializeSelection(override.value, { generalPool, deckCards, discardCards, requestedGeneral, requestedCards })
    : null;
  if (override && materialized && !materialized.ok) {
    pushDiagnostic(flow, { stableId: override.stableId, playerId: data.playerId, reason: materialized.reason });
  }
  const replayed = materialized?.ok ? materialized.selection : null;

  if (replayed) {
    generalCards = replayed.generalCards;
    cardCards = replayed.cardCards;
    reshuffledCardCards = replayed.reshuffledCardCards;
    nextCursor = replayed.cursorAfter;
    flow?.produced.push(override!);
  } else {
    const fallbackSeed = (((state.turn + 1) * 2654435761) ^ ((state.round + 1) * 40503) ^ ((state.deck?.length ?? 0) * 2246822519)) >>> 0;
    const rng = cloneRngState(state.rngState, fallbackSeed);

    // Private general pool: seeded shuffle so draft/selection order never biases
    // which general is drawn (main-faction generals are presented first when
    // drafting, so using that order would artificially favor them).
    const shuffledGeneralPool = requestedGeneral > 0 ? rngShuffle(generalPool, rng) : generalPool;
    generalCards = shuffledGeneralPool.slice(0, Math.min(requestedGeneral, shuffledGeneralPool.length));

    // Shared card pool: take from the top of the deck; when it runs low, reshuffle
    // the discard pile (seeded) to refill.
    const deckTake = Math.min(requestedCards, deckCards.length);
    cardCards = deckCards.slice(0, deckTake);
    if (cardCards.length < requestedCards && discardCards.length > 0) {
      const reshuffled = rngShuffle(discardCards, rng);
      reshuffledCardCards = reshuffled.slice(0, Math.min(requestedCards - cardCards.length, reshuffled.length));
      cardCards = [...cardCards, ...reshuffledCardCards];
    }

    nextCursor = rng;
    flow?.produced.push({
      purpose: 'DRAW_SELECTION',
      stableId: '',
      value: {
        playerId: data.playerId,
        generalKeys: generalCards.map(cardRemovalKey),
        deckTake: deckTakeCount(cardCards, reshuffledCardCards),
        reshuffleKeys: reshuffledCardCards.map(cardRemovalKey),
        cursorAfter: { s: rng.s >>> 0 },
      },
    });
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
    rngState: nextCursor,
  };
}

/** Pop the next replay slot for this DRAW (one per DRAW event, in order).
 * A missing slot is legitimate (legacy documents); a slot that disagrees on
 * purpose/playerId means the recorded stream is misaligned — fall back, and
 * say so (2.2.23 diagnostic bypass). */
function takeOverride(flow: DrawOutcomeFlow | undefined, playerId: number): RandomOutcomeData | null {
  if (!flow?.overrides) return null;
  const override = flow.overrides[flow.overridePos];
  flow.overridePos += 1;
  if (!override) return null;
  if (override.purpose !== 'DRAW_SELECTION' || override.value.playerId !== playerId) {
    pushDiagnostic(flow, { stableId: override.stableId, playerId, reason: 'MISMATCHED_SLOTS' });
    return null;
  }
  return override;
}

function pushDiagnostic(flow: DrawOutcomeFlow | undefined, failure: OverrideFailure): void {
  if (!flow) return;
  (flow.diagnostics ??= []).push(failure);
}

function deckTakeCount(cardCards: unknown[], reshuffledCardCards: unknown[]): number {
  return cardCards.length - reshuffledCardCards.length;
}

interface SelectionInputs {
  generalPool: unknown[];
  deckCards: unknown[];
  discardCards: unknown[];
  requestedGeneral: number;
  requestedCards: number;
}

/**
 * Rebuild the exact card objects a recorded selection drew, from the piles of
 * the replayed-before state. Strict: any count or key divergence fails with a
 * reason so the caller falls back to the seeded re-roll — and reports the
 * reason into the flow diagnostics (2.2.23).
 */
type MaterializedSelection = { generalCards: unknown[]; cardCards: unknown[]; reshuffledCardCards: unknown[]; cursorAfter: { s: number } };

function materializeSelection(
  value: RandomOutcomeValue,
  inputs: SelectionInputs,
): { ok: true; selection: MaterializedSelection } | { ok: false; reason: OverrideFailureReason } {
  const { generalPool, deckCards, discardCards, requestedGeneral, requestedCards } = inputs;

  const wantGeneral = Math.min(requestedGeneral, generalPool.length);
  const wantDeck = Math.min(requestedCards, deckCards.length);
  const wantReshuffle = Math.min(requestedCards - wantDeck, discardCards.length);
  if (value.generalKeys.length !== wantGeneral) return { ok: false, reason: 'COUNT_MISMATCH' };
  if (value.deckTake !== wantDeck) return { ok: false, reason: 'COUNT_MISMATCH' };
  if (value.reshuffleKeys.length !== wantReshuffle) return { ok: false, reason: 'COUNT_MISMATCH' };

  const generalCards = takeByKeys(generalPool, value.generalKeys);
  if (!generalCards) return { ok: false, reason: 'UNRESOLVABLE_KEY' };
  const reshuffledCardCards = takeByKeys(discardCards, value.reshuffleKeys);
  if (!reshuffledCardCards) return { ok: false, reason: 'UNRESOLVABLE_KEY' };
  const cardCards = [...deckCards.slice(0, wantDeck), ...reshuffledCardCards];
  return { ok: true, selection: { generalCards, cardCards, reshuffledCardCards, cursorAfter: { s: value.cursorAfter.s >>> 0 } } };
}

/** Remove one matching card per requested key (same identity notion as
 * cardRemovalKey). Returns null when a key cannot be resolved. */
function takeByKeys(pile: unknown[], keys: string[]): unknown[] | null {
  if (keys.length === 0) return [];
  const pool = [...pile];
  const picked: unknown[] = [];
  for (const key of keys) {
    const index = pool.findIndex(card => cardRemovalKey(card) === key);
    if (index < 0) return null;
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
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
