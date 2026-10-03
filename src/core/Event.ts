// v2.8.22 响应链执法刀：`ReactionQueueSyncedData` 引用状态侧的队列形状。纯类型
// 导入（编译期擦除），与 GameState→Event 那条方向构成类型环，运行时不存在环。
// v2.8 刀4 同理再引一条 `statModifiers`（账本笔的形状），运行时依旧不存在环。
import type { PendingReaction } from './GameState';
import type { StatModifier } from './statModifiers';

export type GameEventType =
  | 'ACTION_ACCEPTED'
  | 'ACTION_REJECTED'
  | 'BEFORE_DAMAGE'
  | 'DAMAGE'
  | 'AFTER_DAMAGE'
  | 'HEAL'
  | 'GAIN_ARMOR'
  | 'DISCARD'
  | 'GIVE'
  | 'EQUIP_STRIP'
  | 'REVEAL'
  | 'DECK_PLACE'
  | 'DUEL'
  // v2.8 刀5（#26）「受到伤害」那一身。用户 2026-10-03 重新裁定：**只有掉血才算受到了
  // 伤害**（只掉护甲、或伤害≤0 都不算）⇒这一声**不是一条独立的游戏事实**，而是"某一员
  // 将的体力在这一刀里真实下降了多少"的**派生通知**（零状态位移，默认处理器恒等），由
  // `chainedConsequences` 在每一刀落账后按前后血量差发射。它不存在的时刻＝这一刀没掉血
  // ⇒「受到伤害后」压根听不到这一刀——判据因此是**结构性的**，不靠任何一处再判断一次。
  // v2.8.24 决斗刀 2 的收官那笔（原名 `DUEL_INJURY`）＝这一声的决斗形状（一场决斗累计
  // 成一笔、带 `duelKey`＋`duelStage:'injury'`），刀5 把它并进同一个名字，因为"受伤"
  // 从来只有一种读法；决斗**逐轮**那些"打"（带 `duelRound`）不发射这一声。
  | 'INJURY'
  // v2.8 刀4（#25 数值变化）：账本上落笔／销笔。引擎里**每一条会改状态的事实都是一
  // 条事件**——修正器账本既然是 A 类可回放事实（常驻／重建／回放四路必须逐字同果），
  // 它就不能只靠派生悬浮在状态里，必须自己留痕。`op:'ADD'` 落一笔（号由处理器从账本
  // 纯派生，零 RNG）、`op:'REMOVE'` 销一笔（`ids`＝被销的 `modifierId`）。缺省（无此
  // 事件）＝账本为空＝所有读数走卡面基础值⇒今日所有对局逐字不产生这一声。
  | 'STAT_MODIFY'
  | 'CHOICE_REQUIRED'
  | 'CHOICE_RESOLVED'
  | 'CARD_LOST'
  | 'CARD_GAINED'
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
  // v2.8.22 响应链执法刀（#71）：受击／受伤节点的问答。三个名字都带 `REACTION_`
  // 前缀但**不是**上面那两行——那两个是容器层的问答窗（B 类、不进状态、不进
  // 录像），下面这两个是队列本体（A 类、进状态、回放逐字重算）。
  | 'REACTION_ANSWERED'
  | 'REACTION_QUEUE_SYNCED'
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

/**
 * STAT_MODIFY（v2.8 刀4＝#25）：数值修正器账本上的一笔落/销。账本本身是 A 类事实
 * （`EngineState.statModifiers`），所以它的每一次位移都必须留痕，否则回放会重新
 * 派生一遍、四路同果的结构性等价就断了。
 *
 * `op:'ADD'` 带 `modifier`（此时 `id`/`seq` 由发射器从**当前账本**纯派生，零 RNG）；
 * `op:'REMOVE'` 带 `ids`（被销的笔）。**生命周期收账（离场、到期）也走 REMOVE**——
 * 那不是"无效化别人那笔账"，是"人在场／周期未到"这个前提本身没了，所以它不读
 * `locked`（`revokeModifier` 那条外部入口才读）。
 */
export interface StatModifyEventData {
  op: 'ADD' | 'REMOVE';
  /** ADD 用：这笔账的内容。**不带 id/seq**——号由处理器从它落账那一刻的账本纯派生
   *  （`sm:<seq>`），四路拿到的是同一份账⇒同一个号，发射器无需也未授权自己编号。 */
  modifier?: Omit<StatModifier, 'id' | 'seq'>;
  /** REMOVE 用：要销掉的笔 id 列表（不存在的 id 静默忽略，＝账本已自洽）。 */
  ids?: string[];
  /** 哪一声把这笔带出来的（记账用＋测试断言用，不参与判定）。 */
  cause?: string;
}

/**
 * REACTION_ANSWERED（v2.8.22＝#71）：某一席的某一员在某一格问答上表了态。
 * `skillId===null`＝那一句「跳过」——它是"这次不响应"在录像里的**正身**：回合
 * 结束那格的"一个也不做"可以由那次 `END_TURN` 代记（§12-75①），响应链这一格
 * 没有任何既有动作能代替它，所以必须自己记一条（否则"跳过了"这件事在录像里
 * 不存在，回放会把这一格重新问一遍）。
 */
export interface ReactionAnsweredData {
  /** 表态落在哪一格（`ReactionNode.key`）。 */
  nodeKey: string;
  /** `${playerId}:${generalId}`＝表态单位（一员将领在一格里只表一次态）。 */
  subjectKey: string;
  playerId: number;
  generalId: string;
  generalName: string;
  /** 发动了哪枚（编译定义 id）；null＝跳过。 */
  skillId: string | null;
  skillName: string | null;
}

/**
 * REACTION_QUEUE_SYNCED（v2.8.22＝#71）：结算后扫描给出的队列视图（收掉的问完
 * 格＋本次新开的格，排在队尾）。它由 `skills/reactionChain.ts` 从
 * （已结算状态，本次 dispatch 事件序列）**纯派生**，回放重跑同一次转移即得同
 * 一条⇒三路（常驻/重建/回放）逐字同果。
 */
export interface ReactionQueueSyncedData {
  /** null＝队列排空（状态槽清空）。 */
  queue: PendingReaction | null;
  /** 跑飞封顶后被丢弃的格数（正常对局恒为 0；非 0 即一条如实的欠账）。 */
  overflow: number;
}
