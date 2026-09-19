import type { GameAction } from '../action/ActionTypes';
import type { PlayerAgent } from './types';

/** Human/UI input adapter. It never mutates game state directly. */
export class HumanController implements PlayerAgent {
  readonly mode = 'HUMAN' as const;

  constructor(readonly id: number | string) {}

  decideAction(input: unknown): GameAction | null {
    return input && typeof input === 'object' && 'type' in input
      ? input as GameAction
      : null;
  }
}
