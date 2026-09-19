import type { EngineState } from './GameState';

/** First round: player 1 already received the opening 5 cards, so their first
 * turn draws 0; every other player in round 1 draws 1. From round 2 onward
 * each turn-start draw is 5 cards.
 */
export function getTurnStartDrawCount(state: EngineState, nextPlayerIndex: number): number {
  if (nextPlayerIndex < 0) return 0;
  if (state.round <= 1) return nextPlayerIndex === 0 ? 0 : 1;
  return 5;
}
