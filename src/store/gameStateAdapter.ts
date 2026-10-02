/**
 * Zustand ↔ Core Engine compatibility adapter.
 *
 * The store remains the presentation/client state while migration is in
 * progress. No rules belong here.
 */
import type { EngineState } from '../core/GameState';
import type { GameCard } from '../data/cards';
import { createRngState } from '../core/rng';
import type { GameState, Player } from './gameStore';
import type { DrawContext } from './gameStore';

/** Seed a fresh engine RNG cursor. Reuses an existing cursor when rebuilding
 * from a store that already carries one (so the mid-game cursor is never
 * reset); otherwise draws entropy from time + Math.random for live play.
 * Headless/seeded runs pass their own config.seed via buildMatchState. */
function seedRngState(store: any) {
  const existing = store?.engineState?.rngState;
  if (existing && typeof existing.s === 'number') return { s: existing.s >>> 0 };
  return createRngState((Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0);
}

/**
 * Fact vs presentation boundary for the compatibility mirror (2.7.1,
 * 2.6.4 §12-37② observation item).
 *
 * `storeStateToEngineState` rebuilds EngineState out of store DISPLAY fields.
 * Whatever the display cannot express is a game fact and must be carried over
 * from the canonical state the store already holds — turn, consumedSkills,
 * pendingChoice, rngState and the metadata bag (roomId/winnerId…) are all in
 * that class. `timelinePhase` is a fact the display only reflects LOSSILY:
 * `applyEngineStateToStore` folds DRAW/ACTION/GAME_OVER into draw/main/end, so
 * the mirror has to invert that table rather than upper-case display
 * vocabulary. Before this contract a display-only `set()` wrote
 * `timelinePhase:'MAIN'` into the live snapshot and replaced metadata wholesale
 * (losing roomId), which is why the 2.6.4 hotseat live↔replay reconciliation
 * had to fold MAIN→ACTION inside its normalize口径 (§12-37② observation, ③ recipe).
 *
 * This is presentation hygiene only, never a second transition path: the
 * engine still derives facts through `TransitionCore.transition` alone, and the
 * mirror cannot invent or drop a canonical event (it emits nothing).
 */
const DISPLAY_TO_CANONICAL_TIMELINE: Record<string, string> = {
  draw: 'DRAW',
  main: 'ACTION',
  end: 'GAME_OVER',
};

function canonicalTimelinePhase(
  store: any,
  previous?: EngineState | null,
): string | undefined {
  const display = store?.turnPhase ? String(store.turnPhase).toLowerCase() : '';
  if (DISPLAY_TO_CANONICAL_TIMELINE[display]) return DISPLAY_TO_CANONICAL_TIMELINE[display];
  // 'start' is the collapse bucket — MENU and TURN_START both project onto it.
  if (display === 'start') {
    return previous?.timelinePhase === 'TURN_START' ? 'TURN_START' : 'MENU';
  }
  return previous?.timelinePhase;
}

/** Canonical metadata keys survive a mirror rebuild; the adapter's own display
 * observations (draw context, provenance marker) are layered on top. */
function rebuildMetadata(store: any): EngineState['metadata'] {
  const previous = store?.engineState?.metadata;
  const facts = previous && typeof previous === 'object' ? previous : {};
  return {
    ...facts,
    source: 'zustand-compatibility-adapter',
    drawPlayerId: store.drawContext?.playerId ?? null,
    drawReason: store.drawContext?.reason ?? null,
    drawTotalCards: store.drawContext?.totalCards ?? null,
  };
}

export function storeStateToEngineState(store: any): EngineState {
  const previous: EngineState | undefined = store?.engineState;
  return {
    version: 1,
    phase: store.phase ?? 'menu',
    timelinePhase: canonicalTimelinePhase(store, previous),
    players: Array.isArray(store.players) ? store.players.map((player: any) => ({
      ...player,
      hand: Array.isArray(player.hand) ? player.hand : [],
      generalPool: Array.isArray(player.generalPool) ? player.generalPool : [],
    })) : [],
    currentPlayerId: Array.isArray(store.players)
      ? store.players?.[store.currentPlayerIndex]?.id ?? null
      : null,
    // Engine-only facts survive a UI-layer rebuild (same retention idea as
    // the rng cursor below): turn has no store display field (currentRound
    // maps to round), and consumedSkills is written solely by EventProcessor.
    // Re-deriving turn from currentRound mid-match would rewind the counter
    // and corrupt the 2.3.1 once-per-turn ledger keys.
    turn: store?.engineState?.turn ?? (typeof store.currentRound === 'number' ? store.currentRound : 0),
    round: typeof store.currentRound === 'number' ? store.currentRound : 0,
    deck: Array.isArray(store.cardDeck) ? store.cardDeck : [],
    discardPile: Array.isArray(store.discardPile) ? store.discardPile : [],
    metadata: rebuildMetadata(store),
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
    rngState: seedRngState(store),
    // consumedSkills has no store display field (written solely by
    // EventProcessor) — dropping it on rebuild would silently undo
    // once-per-turn activation (2.3.1).
    consumedSkills: store?.engineState?.consumedSkills,
    // Same A-class-slot lesson for the choice channel (2.6.3): dropping an
    // outstanding pendingChoice on rebuild would hand a frozen game back to
    // the world with the debt erased.
    pendingChoice: store?.engineState?.pendingChoice,
    // v2.8.22 (#71) 响应链执法刀：同一个 A 类槽教训。重建时丢了待答队列，等于
    // 把一场"正停在问答上"的棋交给世界、而且债被抹掉——D-1 的
    // "常驻===重建"结构性等价要求这一格必须原样带过去。
    pendingReaction: store?.engineState?.pendingReaction,
    // v2.8 刀4（#25）数值修正器账本：同一个 A 类槽教训，第四遍。重建时把账本丢了，
    // 等于把所有"正在生效的改数"当场抹掉——而被改过的那位此刻体力可能已经按新上限
    // 截断过了，卡面打印值还是旧数，读数点会立刻算回老数字（界面与结算一起翻脸）。
    statModifiers: store?.engineState?.statModifiers,
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
  // playerIds 必须在 every 验证之后派生：混入 null 的坏档曾在这里把校验器
  // 自身打崩（.map 先于 playersAreValid 短路求值执行）。
  const playersAreValid = players.every(player => (
    !!player
    && typeof player === 'object'
    && Number.isFinite(player.id)
    && typeof player.name === 'string'
  ));
  const playerIds = playersAreValid ? players.map(player => player.id) : [];
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
