
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
  /**
   * 这条监听属于哪一员将领（运行时实例 id）。顺序比较器要用它判断"这件事是不是打在
   * 我身上"——同一个席位里"挨打的那一员"和"没挨打的那一员"响应先后不同（用户第八轮
   * 工作例：A→C→D→B），只看 `ownerId`（席位）分不出这一层。
   */
  generalId?: string;
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
