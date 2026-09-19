import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';

export interface DrawActionPayload {
  fromGeneralPool: number;
  fromCardPool: number;
  reason?: string;
}

/**
 * Resolves a player's requested split between their private General Pool and
 * the shared Card Pool. The resolver only selects concrete instances;
 * EventProcessor performs the actual state mutation.
 */
export class DrawResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'DRAW';
  }

  resolve(state: EngineState, action: GameAction<DrawActionPayload>): GameEvent[] {
    const drawState = state.drawState;
    if (!drawState || drawState.playerId !== action.playerId) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'NO_PENDING_DRAW' } }];
    }

    const player = state.players.find(p => p.id === action.playerId);
    if (!player || player.isAlive === false) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'DRAW_PLAYER_NOT_FOUND' } }];
    }

    const requestedGeneral = Math.max(0, Math.floor(action.payload?.fromGeneralPool ?? 0));
    const requestedCards = Math.max(0, Math.floor(action.payload?.fromCardPool ?? 0));
    const totalRequested = requestedGeneral + requestedCards;
    if (totalRequested !== drawState.totalCards) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'DRAW_TOTAL_MISMATCH', expected: drawState.totalCards, requested: totalRequested } }];
    }
    const generalPool = Array.isArray(player.generalPool) ? player.generalPool : [];
    const deck = Array.isArray(state.deck) ? state.deck : [];
    const discardPile = Array.isArray(state.discardPile) ? state.discardPile : [];

    // A player's general pool is a shuffled/random draw source. Never use the
    // draft/selection order as draw order, otherwise main-faction generals
    // (which are presented first during drafting) become artificially favored.
    const shuffledGeneralPool = [...generalPool];
    for (let i = shuffledGeneralPool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledGeneralPool[i], shuffledGeneralPool[j]] = [shuffledGeneralPool[j], shuffledGeneralPool[i]];
    }
    const generalCards = shuffledGeneralPool.slice(0, Math.min(requestedGeneral, shuffledGeneralPool.length));
    let cardCards = deck.slice(0, Math.min(requestedCards, deck.length));
    let reshuffledCardCards: unknown[] = [];
    let reshuffleUsed = false;

    if (cardCards.length < requestedCards && discardPile.length > 0) {
      const remaining = requestedCards - cardCards.length;
      const reshuffled = [...discardPile].sort(() => Math.random() - 0.5);
      reshuffledCardCards = reshuffled.slice(0, Math.min(remaining, reshuffled.length));
      cardCards = [...cardCards, ...reshuffledCardCards];
      reshuffleUsed = reshuffledCardCards.length > 0;
    }

    return [{
      type: 'DRAW',
      data: {
        playerId: action.playerId,
        generalCards,
        cardCards,
        reshuffledCardCards,
        reshuffleUsed,
        discardedCardCount: reshuffledCardCards.length,
        count: generalCards.length + cardCards.length,
        requestedGeneral,
        requestedCards,
        reason: drawState.reason,
      },
    }];
  }
}
