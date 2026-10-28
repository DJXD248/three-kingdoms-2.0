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
    // 限次刀·窗口戳的**唯一写手**（裁决②逐字：归零点＝"A 回合结束、处理完所有可处理事项、
    // 即将进入 B 回合开始的这个节点"）。`TURN_END` 已把 `turn` 加过一，所以这里的值就是
    // 新的一格那一号；没有下一拍 TURN_START（终局／整场打完）＝戳停在最后一格，账照旧读得到。
    turnWindow: state.turn,
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
