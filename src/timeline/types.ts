import type { EngineState } from '../core/GameState';

export type GamePhase =
  | 'MENU'
  | 'ROUND_START'
  | 'TURN_START'
  | 'DRAW'
  | 'ACTION'
  | 'RESPONSE'
  | 'TURN_END'
  | 'ROUND_END'
  | 'GAME_OVER';

export interface PhaseContext {
  state: EngineState;
  playerId: number | null;
  turn: number;
  round: number;
}

export interface PhaseDefinition {
  id: GamePhase;
  next?: GamePhase;
  priorityWindow?: boolean;
}

export interface TimelineResult {
  phase: GamePhase;
  playerId: number | null;
  turn: number;
  round: number;
}
