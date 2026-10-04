
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
  /**
   * v2.8.32 限定技额度刀·**同一条展开链内**已经落过发动账的额度键。
   *
   * 为什么要有这一份：`resolveTriggerChain` 整条展开读的都是**同一次落账前的
   * `state`**（落账发生在展开之后），所以一条链里若有两声都命中同一枚「一局一次」
   * 的技能（一次多目标／续跑的伤害批），只看账本会两声都放行⇒一发技能结算两遍、
   * 台账却只扣一次。这一份集合就是"这条链里它已经响过了"的如实事实。
   *
   * 谁是作者：集合由 `core/EngineDispatchFlow` 每次展开时新建、由 `TriggerEngine.process`
   * 原样带进 context，**只有 `skills/SkillTriggerBridge` 读写它**——触发器层不懂技能语义，
   * 跨调用不共享（每次调用之间已经落过账，账本本身才是真相）。
   */
  quotaSpent?: Set<string>;
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
