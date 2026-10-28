
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
   * v2.8.32 限定技额度刀·**同一条展开链内**已经落过发动账的额度键，限次刀起改成
   * **按次数计**（`Set` 只能回答"响过没"，而「每回合限 2 次」要的是同一格窗里还能再响一次）。
   *
   * 为什么要有这一份：`resolveTriggerChain` 整条展开读的都是**同一次落账前的
   * `state`**（落账发生在展开之后），所以一条链里若有两声都命中同一枚带额度的
   * 技能（一次多目标／续跑的伤害批），只看账本会两声都放行⇒一发技能结算两遍、
   * 台账却只扣一次。这一份就是"这条链里它已经用掉几次"的如实事实。
   *
   * 谁是作者：Map 由 `core/EngineDispatchFlow` 每次展开时新建、由 `TriggerEngine.process`
   * 原样带进 context，**只有 `skills/SkillTriggerBridge` 读写它**（写的那一句走
   * `skills/skillQuota.ts::spendChainQuota`，键的拼法不在这里抄第二份）——触发器层不懂
   * 技能语义，跨调用不共享（每次调用之间已经落过账，账本本身才是真相）。
   *
   * 键有两种形状，共用同一份 Map：一局一次＝`<将领实例>:<技能名>`（`limitKey`），
   * 每回合 N 次＝`<窗口戳>:<将领实例>:<技能名>`（`turnQuotaKeyOf`）。两种串不会撞上，
   * 所以"数几笔"和"在不在"两条判据读的是同一个容器。
   */
  quotaSpent?: Map<string, number>;
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
