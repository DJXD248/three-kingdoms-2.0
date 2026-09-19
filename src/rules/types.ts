import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';

export interface RuleContext {
  state: EngineState;
  action: GameAction;
}

export interface RuleResult {
  valid: boolean;
  reason?: string;
}
