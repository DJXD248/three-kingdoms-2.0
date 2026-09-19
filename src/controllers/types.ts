import type { GameAction } from '../action/ActionTypes';

/** Runtime controller modes. Controllers create/forward actions; the engine owns rules. */
export type PlayerControllerMode = 'HUMAN' | 'AI' | 'LOCAL';

/** Optional player-facing decision adapter used by future AI/network integrations. */
export interface PlayerAgent {
  id: number | string;
  mode: PlayerControllerMode;
  decideAction(input: unknown): GameAction | null;
}
