import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getTurnStartDrawCount } from '../turnRules';

export function applyTurnEndEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    fromIndex?: number;
    toIndex?: number;
    nextRound?: number;
  } | undefined;
  return {
    ...state,
    turn: state.turn + 1,
    round: typeof data?.nextRound === 'number' ? data.nextRound : state.round,
  };
}

export function applyTurnActionsResetEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as { playerId?: number } | undefined;
  if (typeof data?.playerId !== 'number') return state;
  const players = state.players.map(player => {
    if (player.id !== data.playerId) return player;
    const fieldGenerals = Array.isArray(player.fieldGenerals)
      ? player.fieldGenerals as any[]
      : [];
    return {
      ...player,
      fieldGenerals: fieldGenerals.map(fg => ({
        ...fg,
        hasMoved: false,
        hasAttacked: false,
        hasSupplied: false,
        justDeployed: false,
        isArming: false,
      })),
    };
  });
  return { ...state, players };
}

export function applyTurnStartEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as any;
  const nextPlayerId = typeof data?.playerId === 'number' ? data.playerId : state.currentPlayerId;
  const nextPlayer = state.players.find(player => player.id === nextPlayerId);
  return {
    ...state,
    phase: nextPlayerId === null || nextPlayerId === undefined ? state.phase : 'drawing',
    timelinePhase: nextPlayerId === null || nextPlayerId === undefined ? 'TURN_START' : 'DRAW',
    currentPlayerId: nextPlayerId,
    drawState: nextPlayerId === null || nextPlayerId === undefined || !nextPlayer
      ? null
      : {
          reason: 'turnStart',
          playerId: nextPlayer.id,
          totalCards: getTurnStartDrawCount(state, state.players.findIndex(player => player.id === nextPlayer.id)),
          baseLossPending: false,
        },
  };
}

export function applyPhaseChangedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as any;
  const to = typeof data?.to === 'string' ? data.to : undefined;
  const nextPlayerId = typeof data?.playerId === 'number' ? data.playerId : state.currentPlayerId;
  if (to === 'ACTION') {
    return {
      ...state,
      phase: 'playing',
      timelinePhase: 'ACTION',
      currentPlayerId: nextPlayerId,
      drawState: null,
    };
  }
  if (to === 'DRAW') {
    const player = state.players.find(p => p.id === nextPlayerId);
    return {
      ...state,
      phase: 'drawing',
      timelinePhase: 'DRAW',
      currentPlayerId: nextPlayerId,
      drawState: player ? (state.drawState ?? {
        reason: data?.drawReason === 'initial' ? 'initial' : 'turnStart',
        playerId: player.id,
        totalCards: data?.totalCards ?? 5,
        baseLossPending: false,
      }) : state.drawState,
    };
  }
  return {
    ...state,
    phase: to ? to.toLowerCase() : state.phase,
    timelinePhase: to ?? state.timelinePhase,
    currentPlayerId: nextPlayerId,
  };
}
