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

// D-2 second cut (2.2.19): action.id only has to be unique within the process
// (SnapshotRecord.actionId association, network packet ids — nothing looks
// actions up by id), so it is a plain counter. No clock, no entropy: creating
// an action can never perturb a seeded stream or make a replay diverge.
let actionSerial = 0;

export function createAction<T = unknown>(
  type: ActionType,
  playerId: number,
  payload?: T,
): GameAction<T> {
  actionSerial += 1;
  return {
    id: `action_${actionSerial}`,
    type,
    playerId,
    ...(payload === undefined ? {} : { payload }),
  };
}
