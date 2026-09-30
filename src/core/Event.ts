// v2.8.22 响应链执法刀：`ReactionQueueSyncedData` 引用状态侧的队列形状。纯类型
// 导入（编译期擦除），与 GameState→Event 那条方向构成类型环，运行时不存在环。
import type { PendingReaction } from './GameState';

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
