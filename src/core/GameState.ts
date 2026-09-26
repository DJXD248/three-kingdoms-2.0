/**
 * Phase 5.2 - Serializable engine state.
 * This state is independent from React/Zustand and can be used by:
 * - local single player
 * - hotseat
 * - network synchronization
 */

import { createRngState, type RngState } from './rng';
import type { GameEvent } from './Event';

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
  /** Faction label ('魏'|'蜀'|'吴'|'群'|'晋'); kept as string to stay data-independent. */
  faction?: string;
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
  /** Deterministic engine RNG cursor (D-2). Optional so legacy snapshots and
   * replays without it still load; a missing cursor is lazily re-seeded. */
  rngState?: RngState;
  /**
   * Turn-bound skill consumption ledger (2.3.1, D-3 content era): one entry
   * per accepted SKILL_ACTIVATED event. A-class game fact — it lives in the
   * state (so 常驻/重建/回放 all see it) and the "once per turn" gate in
   * TurnEndSkillResolver reads it. Optional: legacy states/saves lack it and
   * simply carry no consumption.
   */
  consumedSkills?: ConsumedSkill[];
  /**
   * Pending player decision (2.6.3, choice channel — a capability-layer
   * non-content cut): an A-class replayable fact, same idea as consumedSkills
   * — it lives in the state so 常驻/重建/回放 all see the SAME debt, and the
   * validator's frozen-world gate keys off it (while a debt is owed, ONLY the
   * debtor's CHOOSE_OPTION action is accepted, so candidates never go stale).
   * Optional: legacy states/saves lack it and simply carry no debt.
   */
  pendingChoice?: PendingChoice | null;
}

/** One frozen candidate branch of a pending choice: label for the HUD plus
 * the effect events pre-translated at offer time (settled verbatim when the
 * debtor picks this option — see PROJECT_ARCH_MAP §F choice table). */
export interface PendingChoiceOption {
  label: string;
  events: GameEvent[];
}

export interface PendingChoice {
  /** `ch:<turn>:<round>:<skillId>` — deterministic, no RNG (same recipe as rw ids). */
  key: string;
  /** The debtor: only this player's CHOOSE_OPTION settles the offer. */
  playerId: number;
  options: PendingChoiceOption[];
}

export interface ConsumedSkill {
  /** `<turn>:<skillId>` — the SKILL_ACTIVATED stableId. */
  stableId: string;
  /** Compiled skill definition id (unique per general instance + effect). */
  skillId: string;
  turn: number;
  playerId: number;
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
    isFirstTurn: true,
    // Default cursor; real matches re-seed at room creation (createRoom) so a
    // deterministic run can also be reproduced from a chosen seed.
    rngState: createRngState(0x9e3779b9),
  };
}

export function cloneEngineState(state: EngineState): EngineState {
  return structuredClone(state);
}
