import type { GameAction } from '../action/ActionTypes';
import type { PlayerAgent } from './types';

/**
 * AI adapter boundary. AI produces actions only; GameEngine remains the sole rule authority.
 * The actual decision policy is supplied later by the AI subsystem.
 */
export class AIController implements PlayerAgent {
  readonly mode = 'AI' as const;

  constructor(readonly id: number | string) {}

  decideAction(input: unknown): GameAction | null {
    return input && typeof input === 'object' && 'type' in input
      ? input as GameAction
      : null;
  }
}
