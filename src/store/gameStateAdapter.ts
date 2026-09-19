/**
 * Zustand ↔ Core Engine compatibility adapter.
 *
 * The store remains the presentation/client state while migration is in
 * progress. No rules belong here.
 */
import type { EngineState } from '../core/GameState';
import type { GameCard } from '../data/cards';
import type { GameState, Player } from './gameStore';
import type { DrawContext } from './gameStore';

export function storeStateToEngineState(store: any): EngineState {
  return {
    version: 1,
    phase: store.phase ?? 'menu',
    timelinePhase: store.turnPhase ? String(store.turnPhase).toUpperCase() : undefined,
    players: Array.isArray(store.players) ? store.players.map((player: any) => ({
      ...player,
      hand: Array.isArray(player.hand) ? player.hand : [],
      generalPool: Array.isArray(player.generalPool) ? player.generalPool : [],
    })) : [],
    currentPlayerId: Array.isArray(store.players)
      ? store.players?.[store.currentPlayerIndex]?.id ?? null
      : null,
    turn: typeof store.currentRound === 'number' ? store.currentRound : 0,
    round: typeof store.currentRound === 'number' ? store.currentRound : 0,
    deck: Array.isArray(store.cardDeck) ? store.cardDeck : [],
    discardPile: Array.isArray(store.discardPile) ? store.discardPile : [],
    metadata: {
      source: 'zustand-compatibility-adapter',
      drawPlayerId: store.drawContext?.playerId ?? null,
      drawReason: store.drawContext?.reason ?? null,
      drawTotalCards: store.drawContext?.totalCards ?? null,
    },
    drawState: store.drawContext
      ? {
          reason: store.drawContext.reason,
          playerId: store.drawContext.playerId,
          totalCards: store.drawContext.totalCards,
          baseLossPending: store.drawContext.baseLossPending === true,
          resumePhase: store.drawContext.resumePhase,
          resumePlayerId: store.drawContext.resumePlayerId ?? null,
        }
      : null,
    isFirstTurn: store.isFirstTurn === true,
  };
}

export function applyEngineStateToStore(
  engineState: EngineState,
  set: (data: any) => void,
) {
  const currentPlayerIndex = engineState.players.findIndex(
    player => player.id === engineState.currentPlayerId,
  );

  const drawState = engineState.drawState ?? null;
  const winnerId = typeof engineState.metadata?.winnerId === 'number'
    ? engineState.metadata.winnerId
    : null;
  const timelinePhase = String(engineState.timelinePhase ?? '').toUpperCase();
  const restoredTurnPhase: GameState['turnPhase'] = timelinePhase === 'DRAW'
    ? 'draw'
    : timelinePhase === 'ACTION'
      ? 'main'
      : timelinePhase === 'GAME_OVER' || engineState.phase === 'gameOver'
        ? 'end'
        : 'start';
  set({
    engineState,
    players: engineState.players,
    playerCount: engineState.players.length,
    currentRound: engineState.round,
    cardDeck: engineState.deck,
    discardPile: engineState.discardPile,
    currentPlayerIndex: currentPlayerIndex >= 0 ? currentPlayerIndex : 0,
    phase: engineState.phase === 'drawing' ? 'drawing' : engineState.phase === 'turn' ? 'playing' : engineState.phase,
    turnPhase: restoredTurnPhase,
    winnerId,
    gameOverBanner: null,
    defeatEvent: null,
    pendingTurnTransition: null,
    revealedDrawCards: [],
    isFirstTurn: engineState.isFirstTurn ?? undefined,
    drawContext: drawState
      ? buildDrawContext(engineState, drawState, {
          phaseAfter: 'playing',
          subtitle: describeDrawSubtitle(engineState, drawState),
        })
      : null,
  });
}

export function isRestorableEngineState(value: unknown): value is EngineState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<EngineState>;
  const players = Array.isArray(state.players) ? state.players : [];
  const playersAreValid = players.every(player => (
    !!player
    && typeof player === 'object'
    && Number.isFinite(player.id)
    && typeof player.name === 'string'
  ));
  const playerIds = players.map(player => player.id);
  const playerIdsAreUnique = new Set(playerIds).size === playerIds.length;
  const currentPlayerIsValid = state.currentPlayerId === null
    || (typeof state.currentPlayerId === 'number'
      && Number.isFinite(state.currentPlayerId)
      && playerIds.includes(state.currentPlayerId));

  return Number.isFinite(state.version)
    && typeof state.phase === 'string'
    && playersAreValid
    && playerIdsAreUnique
    && currentPlayerIsValid
    && Number.isFinite(state.turn)
    && Number.isFinite(state.round)
    && Array.isArray(state.deck)
    && Array.isArray(state.discardPile);
}

export function engineStateToStoreProjection(
  engineState: EngineState,
  fallbackPlayerIndex: number,
): Pick<GameState, 'engineState' | 'players' | 'cardDeck' | 'discardPile' | 'currentPlayerIndex'> {
  const currentPlayerIndex = engineState.players.findIndex(
    player => player.id === engineState.currentPlayerId,
  );

  return {
    engineState,
    players: engineState.players as unknown as Player[],
    cardDeck: engineState.deck as GameCard[],
    discardPile: engineState.discardPile as GameCard[],
    currentPlayerIndex: currentPlayerIndex >= 0 ? currentPlayerIndex : fallbackPlayerIndex,
  };
}

export function describeDrawSubtitle(
  engineState: EngineState,
  drawState: NonNullable<EngineState['drawState']>,
  fallback?: string,
): string {
  const playerName = engineState.players.find(player => player.id === drawState.playerId)?.name ?? '';
  if (fallback) return fallback;
  if (drawState.reason === 'compensation') return `${playerName} 击破补偿抽卡`;
  if (drawState.reason === 'initial') return `${playerName} 初始抽卡 (5张)`;
  return `${playerName} 回合开始（抽${drawState.totalCards}张）`;
}

export function buildDrawContext(
  engineState: EngineState,
  drawState: NonNullable<EngineState['drawState']>,
  options: { phaseAfter?: DrawContext['phaseAfter']; subtitle?: string } = {},
): DrawContext {
  return {
    reason: drawState.reason,
    playerId: drawState.playerId,
    totalCards: drawState.totalCards,
    phaseAfter: options.phaseAfter ?? (drawState.reason === 'turnStart' ? 'playing' : 'drawing'),
    subtitle: describeDrawSubtitle(engineState, drawState, options.subtitle),
    baseLossPending: drawState.baseLossPending,
    resumePhase: drawState.resumePhase,
    resumePlayerId: drawState.resumePlayerId ?? null,
  };
}
