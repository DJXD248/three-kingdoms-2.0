import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';

export function createAttackAction(
  playerId: number,
  attackerId: string,
  targetId: string,
  ranged: boolean,
  consumeCard?: unknown,
): GameAction {
  return createAction('ATTACK', playerId, {
    attackerId,
    targetId,
    ranged,
    consumeCard: consumeCard ?? null,
  });
}
