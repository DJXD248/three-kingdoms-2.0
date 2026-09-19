
import type { EngineState } from '../core/GameState';
import type { GameEvent, GameEventType } from '../core/Event';

export interface TriggerContext {
  state: EngineState;
  event: GameEvent;
  depth: number;
  rootEventId: string;
  /** The player/general that owns the trigger, when applicable. */
  ownerId?: number | string;
  /** Skill that registered this trigger, when applicable. */
  skillId?: string;
}

export interface TriggerDefinition {
  id: string;
  eventType: GameEventType;
  priority?: number;
  oncePerEvent?: boolean;
  enabled?: boolean;
  ownerId?: number | string;
  skillId?: string;
  condition?: (context: TriggerContext) => boolean;
  createEvents: (context: TriggerContext) => GameEvent[];
}

export interface TriggerProcessResult {
  events: GameEvent[];
  depth: number;
  truncated: boolean;
}

export interface ReactionWindowState {
  id: string;
  sourceEventId: string;
  sourceEventType: GameEventType;
  participants: number[];
  passed: number[];
  openedAt: number;
  closed: boolean;
}
