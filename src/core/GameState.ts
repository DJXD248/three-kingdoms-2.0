/**
 * Phase 5.2 - Serializable engine state.
 * This state is independent from React/Zustand and can be used by:
 * - local single player
 * - hotseat
 * - network synchronization
 */

export interface EngineStatusState {
  id: string;
  kind: string;
  duration?: number | null;
  stacks?: number;
  metadata?: Record<string, unknown>;
  drawState?: EngineDrawState | null;
  isFirstTurn?: boolean;
}

export interface EngineDrawState {
  reason: 'initial' | 'turnStart' | 'compensation';
  playerId: number;
  totalCards: number;
  baseLossPending?: boolean;
  resumePhase?: string;
  resumePlayerId?: number | null;
}


export interface EnginePlayer {
  id: number;
  name: string;
  hp?: number;
  hand?: unknown[];
  generalPool?: unknown[];
  fieldGenerals?: unknown[];
  graveyard?: unknown[];
  baseHp?: number;
  baseMaxHp?: number;
  isAlive?: boolean;
  statuses?: EngineStatusState[];
  [key: string]: unknown;
}

export interface EngineState {
  version: number;
  phase: string;
  /** Phase 5.23 timeline phase; kept as string for backward compatibility. */
  timelinePhase?: string;
  players: EnginePlayer[];
  currentPlayerId: number | null;
  turn: number;
  round: number;
  deck: unknown[];
  discardPile: unknown[];
  metadata?: Record<string, unknown>;
  drawState?: EngineDrawState | null;
  isFirstTurn?: boolean;
}

export function createInitialEngineState(): EngineState {
  return {
    version: 1,
    phase: 'menu',
    timelinePhase: 'MENU',
    players: [],
    currentPlayerId: null,
    turn: 0,
    round: 0,
    deck: [],
    discardPile: [],
    drawState: null,
    isFirstTurn: true
  };
}

export function cloneEngineState(state: EngineState): EngineState {
  return structuredClone(state);
}
