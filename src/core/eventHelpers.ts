import type { GameEvent } from './Event';

export function createEvent<T>(
  type: GameEvent['type'],
  data?: T
): GameEvent<T> {
  return {
    type,
    data,
    timestamp: Date.now()
  };
}
