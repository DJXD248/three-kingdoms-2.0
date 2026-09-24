import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getTurnStartDrawCount } from '../turnRules';

export function applyPlayerDefeatedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as { playerId?: number } | undefined;
  const defeatedId = typeof data?.playerId === 'number' ? data.playerId : null;
  if (defeatedId === null) return state;

  const players = state.players.map(player => {
    if (player.id !== defeatedId) return player;
    return {
      ...player,
      baseHp: 0,
      isAlive: false,
      isSpectating: true,
      hand: [],
      fieldGenerals: [],
    };
  });

  const survivors = players.filter(player => player.id !== defeatedId && player.isAlive !== false);
  if (survivors.length <= 1) {
    return {
      ...state,
      players,
      phase: 'gameOver',
      timelinePhase: 'GAME_OVER',
      currentPlayerId: survivors.length === 1 ? survivors[0].id : null,
      drawState: null,
      metadata: { ...(state.metadata ?? {}), winnerId: survivors.length === 1 ? survivors[0].id : null },
    };
  }

  if (state.timelinePhase === 'DRAW' && state.currentPlayerId === defeatedId) {
    const defeatedIndex = state.players.findIndex(player => player.id === defeatedId);
    let nextIndex = defeatedIndex < 0 ? 0 : (defeatedIndex + 1) % state.players.length;
    let guard = 0;
    while (guard < state.players.length && players[nextIndex]?.isAlive === false) {
      nextIndex = (nextIndex + 1) % state.players.length;
      guard += 1;
    }
    const nextPlayer = players[nextIndex];
    if (nextPlayer && nextPlayer.isAlive !== false) {
      const nextRound = nextIndex <= Math.max(0, defeatedIndex) ? state.round + 1 : state.round;
      return {
        ...state,
        players,
        phase: 'drawing',
        timelinePhase: 'DRAW',
        currentPlayerId: nextPlayer.id,
        drawState: {
          reason: 'turnStart',
          playerId: nextPlayer.id,
          totalCards: getTurnStartDrawCount({ ...state, round: nextRound }, nextIndex),
          baseLossPending: (nextPlayer.generalPool?.length ?? 0) === 0,
        },
      };
    }
  }

  return { ...state, players };
}

export function applyGameOverEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as { winnerId?: number | null } | undefined;
  return {
    ...state,
    phase: 'gameOver',
    timelinePhase: 'GAME_OVER',
    metadata: {
      ...(state.metadata ?? {}),
      winnerId: data?.winnerId ?? null,
    },
    drawState: null,
  };
}
