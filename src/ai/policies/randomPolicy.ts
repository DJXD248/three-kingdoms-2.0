/**
 * AI action policies.
 *
 * A policy is a pure chooser: given an engine and the player to move, it
 * returns ONE action (or null when nothing is legal — which the runner treats
 * as a bug, because the action window always has at least END_TURN /
 * CONFIRM_DRAW for the actor). `engine.legalActions` is the only legality
 * source, so every policy (random now, tiered strategies in phase 3) stays
 * rule-agnostic by construction.
 */
import type { GameAction } from '../../action/ActionTypes';
import type { GameEngine } from '../../core/GameEngine';

export type AiPolicy = (engine: GameEngine, playerId: number) => GameAction | null;

/** Uniform-random pick over the legal list — the phase-2 baseline. */
export const randomPolicy: AiPolicy = (engine, playerId) => {
  const legal = engine.legalActions(playerId);
  if (legal.length === 0) return null;
  return legal[Math.floor(Math.random() * legal.length) % legal.length];
};
