
export type GameEventType =
  | 'ACTION_ACCEPTED'
  | 'ACTION_REJECTED'
  | 'BEFORE_DAMAGE'
  | 'DAMAGE'
  | 'AFTER_DAMAGE'
  | 'DRAW'
  | 'DRAW_REQUIRED'
  | 'DRAW_CONFIRMED'
  | 'DEATH'
  | 'TURN_START'
  | 'TURN_END'
  | 'TURN_ACTIONS_RESET'
  | 'PHASE_CHANGED'
  | 'REACTION_WINDOW_OPENED'
  | 'REACTION_WINDOW_CLOSED'
  | 'TRIGGERED'
  | 'STATE_CHANGED'
  | 'GENERAL_DEPLOYED'
  | 'GENERAL_MOVED'
  | 'ATTACK_RESOLVED'
  | 'SUPPLY_RESOLVED'
  | 'ARMOR_EQUIPPED'
  | 'PLAYER_DEFEATED'
  | 'GAME_OVER'
  | 'BASE_DAMAGE'
  | 'CUSTOM';

export interface GameEvent<T = unknown> {
  id?: string;
  type: GameEventType;
  timestamp?: number;
  data?: T;
}
