import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';

export function createEndTurnAction(playerId: number): GameAction {
  return createAction('END_TURN', playerId);
}
