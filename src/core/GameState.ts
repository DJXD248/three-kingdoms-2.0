/**
 * Phase 5.2 - Serializable engine state.
 * This state is independent from React/Zustand and can be used by:
 * - local single player
 * - hotseat
 * - network synchronization
 */

import { createRngState, type RngState } from './rng';
import type { GameEvent, GameEventType } from './Event';
import type { StatModifier } from './statModifiers';

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
  /**
   * 响应链问答队列（v2.8.22＝#71）。与 pendingChoice 同族的 A 类可回放事实：
   * 受击／受伤两型的"到点自动响"改成"停下来按座次规矩问"，问的那一席只有
   * `ACTIVATE_SKILL`／`SKIP_REACTION` 两条合法动作（冻结世界门），所以队列里的
   * 候选不会因为别人抢着出牌而过期。缺省=没有待答问答（v2.8.21 之前的状态、
   * 旧存档照常读）。
   */
  pendingReaction?: PendingReaction | null;
  /**
   * 数值修正器账本（2.8 刀4＝#25，PROJECT_ARCH_MAP §F「数值修正器管线」）。
   * 一条规则改一个数字＝这里的一笔账，卡面打印值一字不改（裁决第 3/4 条：在场即生效、
   * 固定失效后增减恢复参与，都要求"改数"与"改卡"分开）。与 consumedSkills／pendingChoice／
   * pendingReaction 同族的 A 类可回放事实：常驻／重建／回放四路都读同一份账算同一个读数，
   * 缺省（旧存档、旧录像）＝没有账＝所有读数走卡面基础值。
   */
  statModifiers?: StatModifier[];
}

/** One frozen candidate branch of a pending choice: label for the HUD plus
 * the effect events pre-translated at offer time (settled verbatim when the
 * debtor picks this option — see PROJECT_ARCH_MAP §F choice table). */
export interface PendingChoiceOption {
  label: string;
  events: GameEvent[];
  /**
   * v2.8.11 刀2「选择其一」的门槛：false=这一刻这一项不过**逐项门槛**，
   * 置灰可见并注明 `gateText` 原因（用户口径①：技能信息完全公开，不藏）。
   * 缺省（undefined）=可用——包括没有门槛的选择组，v2.8.10 之前一字未变。
   * 求值只在开窗那一刻做一次并冻结进录像态：决策时点=结算时点，之后世界
   * 怎么变都不重算（与 events 同一套延后结算契约）。
   */
  enabled?: boolean;
  /** 门槛的大白话原文（如「手牌≤2」），只在 enabled=false 时写入。 */
  gateText?: string;
}

export interface PendingChoice {
  /** `ch:<turn>:<round>:<skillId>` — deterministic, no RNG (same recipe as rw ids). */
  key: string;
  /** The debtor: only this player's CHOOSE_OPTION settles the offer. */
  playerId: number;
  options: PendingChoiceOption[];
}

/**
 * 响应链问答队列（v2.8.22 响应链执法刀＝#71；§H9 第八/九/十轮）。A 类可回放
 * 事实，与 `pendingChoice` 同族：**状态里只记事实**（哪一声事件在等人表态、
 * 谁已经表过态），"此刻该问谁、他能选什么"一律由 `skills/reactionChain.ts`
 * 现算（§12-79 派生点唯一）——所以一格问答不会因为世界变了而给出过期的选项。
 *
 * 记的两笔事实：
 *  - `nodes`：**排队中的格**，先开先问（append-only，绝不插队＝§H9 第九轮⑨）。
 *    每格带着它回应的那一声事件（`sourceEvent`）与表态台账。
 *  - `serial`：本回合已开过的格数，只用来发号（键）与跑飞封顶，不参与判序。
 */
export interface PendingReaction {
  /** 队列所属回合：换回合⇒旧队列作废（冻结世界门保证回合切换前已排空）。 */
  turn: number;
  /** 单调递增的格号源（`rn:<turn>:<serial>`，无 RNG）。 */
  serial: number;
  nodes: ReactionNode[];
}

export interface ReactionNode {
  key: string;
  /** 这一格在回应的那一声：结算侧**已经记下**的事件（类型＋数据原样存）。
   *  效果翻译（TARGET/ATTACKER 这些角色）按它解，与触发链读的是同一条事实。 */
  sourceEvent: ReactionSourceEvent;
  /** 表态台账＝`${playerId}:${generalId}` 的集合（一员将领在一格里只表一次态，
   *  多枚被动在那一次里自选＝§H9 第九轮⑤的三键问窗）。 */
  answered: string[];
}

export interface ReactionSourceEvent {
  type: GameEventType;
  data: unknown;
}

export interface ConsumedSkill {
  /** `<turn>:<skillId>` — the SKILL_ACTIVATED stableId. */
  stableId: string;
  /** Compiled skill definition id (unique per general instance + effect). */
  skillId: string;
  turn: number;
  playerId: number;
  /**
   * v2.8.32 限定技额度刀：这一笔消耗的是哪一枚**技能**的一局一次额度（编译器给的
   * `<将领实例>:<技能名>`，同一枚技能编出好几个定义也共用这一个键）。只有带额度
   * 的定义落账时才写这一键；既有条目一律没有＝旧局没有额度可消耗，如实成立。
   */
  limitKey?: string;
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
