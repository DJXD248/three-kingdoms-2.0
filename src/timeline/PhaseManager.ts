import type { EngineState } from '../core/GameState';
import type { GamePhase, PhaseDefinition, TimelineResult } from './types';

export class PhaseManager {
  private readonly phases: PhaseDefinition[] = [
    { id: 'ROUND_START', next: 'TURN_START' },
    { id: 'TURN_START', next: 'DRAW' },
    { id: 'DRAW', next: 'ACTION' },
    { id: 'ACTION', next: 'RESPONSE', priorityWindow: true },
    { id: 'RESPONSE', next: 'TURN_END', priorityWindow: true },
    { id: 'TURN_END', next: 'TURN_START' },
    { id: 'ROUND_END', next: 'ROUND_START' },
    { id: 'GAME_OVER' }
  ];

  get(id: GamePhase) {
    return this.phases.find(phase => phase.id === id);
  }

  next(state: EngineState): TimelineResult {
    const current = state.phase as GamePhase;
    const definition = this.get(current);

    if (!definition?.next) {
      return {
        phase: current,
        playerId: state.currentPlayerId,
        turn: state.turn,
        round: state.round
      };
    }

    let phase = definition.next;
    let turn = state.turn;
    let round = state.round;
    let playerId = state.currentPlayerId;

    if (phase === 'TURN_START' && state.players.length > 0) {
      const index = Math.max(
        0,
        state.players.findIndex(player => player.id === state.currentPlayerId)
      );
      playerId = state.players[(index + 1) % state.players.length]?.id ?? null;
    }

    if (phase === 'ROUND_START') {
      round += 1;
    }

    if (phase === 'TURN_END') {
      turn += 1;
    }

    return { phase, playerId, turn, round };
  }
}
