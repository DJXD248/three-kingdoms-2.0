import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { PhaseManager } from './PhaseManager';
import type { GamePhase, TimelineResult } from './types';

export class TurnManager {
  readonly phases = new PhaseManager();

  start(state: EngineState): TimelineResult {
    const playerId = state.currentPlayerId ?? state.players[0]?.id ?? null;
    return {
      phase: 'ROUND_START',
      playerId,
      turn: state.turn,
      round: Math.max(1, state.round)
    };
  }

  advance(state: EngineState): TimelineResult {
    return this.phases.next(state);
  }

  eventsForTransition(from: GamePhase, to: GamePhase, playerId: number | null): GameEvent[] {
    const events: GameEvent[] = [
      { type: 'PHASE_CHANGED', data: { from, to, playerId } }
    ];

    if (to === 'TURN_START') {
      events.push({ type: 'TURN_START', data: { playerId } });
    }
    if (to === 'TURN_END') {
      events.push({ type: 'TURN_END', data: { playerId } });
    }

    return events;
  }
}
