import type { GameAction } from '../action/ActionTypes';
import { GameEngine } from '../core/GameEngine';

/** Local action transport into the canonical GameEngine. */
export class LocalController {
  constructor(private readonly engine: GameEngine) {}

  dispatch(action: GameAction) {
    return this.engine.dispatch(action);
  }
}
