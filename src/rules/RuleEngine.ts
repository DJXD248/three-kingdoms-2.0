import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import { ActionValidator } from './ActionValidator';

export class RuleEngine {
  private readonly validator = new ActionValidator();

  validateAction(state: EngineState, action: GameAction) {
    return this.validator.validate({ state, action });
  }
}
