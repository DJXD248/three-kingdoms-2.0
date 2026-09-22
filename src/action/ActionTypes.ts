/**
 * Canonical action types for the game engine.
 * All local, AI, hotseat and future network inputs use this model.
 */
export type ActionType =
  | 'DRAW'
  | 'DEPLOY_GENERAL'
  | 'MOVE_GENERAL'
  | 'ATTACK'
  | 'SUPPLY'
  | 'EQUIP_ARMOR'
  | 'END_TURN'
  | 'CONFIRM_DRAW'
  | 'BEGIN_DRAW'
  | 'RESOLVE_BASE_LOSS'
  | 'SURRENDER';

export interface GameAction<T = unknown> {
  id: string;
  type: ActionType;
  playerId: number;
  payload?: T;
}

export function createAction<T = unknown>(
  type: ActionType,
  playerId: number,
  payload?: T,
): GameAction<T> {
  return {
    id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    playerId,
    ...(payload === undefined ? {} : { payload }),
  };
}
