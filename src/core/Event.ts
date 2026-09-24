
export type GameEventType =
  | 'ACTION_ACCEPTED'
  | 'ACTION_REJECTED'
  | 'BEFORE_DAMAGE'
  | 'DAMAGE'
  | 'AFTER_DAMAGE'
  | 'HEAL'
  | 'GAIN_ARMOR'
  | 'DRAW'
  | 'DRAW_REQUIRED'
  | 'DRAW_CONFIRMED'
  | 'RANDOM_OUTCOME'
  | 'DEATH'
  | 'TURN_START'
  | 'TURN_END'
  | 'TURN_ACTIONS_RESET'
  | 'PHASE_CHANGED'
  | 'REACTION_WINDOW_OPENED'
  | 'REACTION_WINDOW_CLOSED'
  | 'TRIGGERED'
  | 'SKILL_ACTIVATED'
  | 'STATE_CHANGED'
  | 'GENERAL_DEPLOYED'
  | 'GENERAL_MOVED'
  | 'ATTACK_RESOLVED'
  | 'SUPPLY_RESOLVED'
  | 'ARMOR_EQUIPPED'
  | 'PLAYER_DEFEATED'
  | 'GAME_OVER'
  | 'BASE_DAMAGE'
  | 'CUSTOM';

export interface GameEvent<T = unknown> {
  id?: string;
  type: GameEventType;
  timestamp?: number;
  data?: T;
}

/**
 * RandomOutcome (decision D-2a, 2.2.22): one random SELECTION made during a
 * dispatch, recorded as data — "record outcomes, not re-rolls". Replay
 * consumes these instead of re-running the RNG algorithm: it materializes
 * the chosen cards by identity key and restores cursorAfter, so a replay
 * stays correct even if the RNG implementation itself ever changes.
 * Replays without these events (pre-2.2.22) legitimately fall back to the
 * reproducible re-roll path (2.2.18 cursors); dual-read, no version bump.
 */
export interface RandomOutcomeValue {
  playerId: number;
  /** Chosen generals from the private pool, keyed like cardRemovalKey. */
  generalKeys: string[];
  /** How many cards were taken from the top of the shared deck. */
  deckTake: number;
  /** Cards pulled from the discard pile by the seeded reshuffle. */
  reshuffleKeys: string[];
  /** Engine RNG cursor right after this selection consumed randomness. */
  cursorAfter: { s: number };
}

export interface RandomOutcomeData {
  purpose: 'DRAW_SELECTION';
  stableId: string;
  value: RandomOutcomeValue;
}

/**
 * SKILL_ACTIVATED (2.3.1, decision D-3 content era): the A-class record that
 * an explicit ACTIVATE_SKILL action ran. Currently only the ask-before-END_TURN
 * turn-end path (turnEndSkills/TurnEndSkillResolver) mints it. Its `stableId`
 * (`<turn>:<skillId>`) is what consumption tracking stores in
 * EngineState.consumedSkills, making "once per turn" a replayable game fact
 * rather than container timing.
 */
export interface SkillActivationEventData {
  skillId: string;
  skillName: string;
  effectId: string;
  generalId: string;
  playerId: number;
  stableId: string;
}
