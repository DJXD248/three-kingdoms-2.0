import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';

export function createPlayCardAction(playerId: number, cardId: string, targetId?: number): GameAction {
  return createAction('DRAW', playerId, { cardId, targetId });
}
