import type { DataSkillTrigger } from './dataTypes';
import type { GameEventType } from '../core/Event';

/**
 * 「可响应节点」登记处（§H9 第八/九/十轮，v2.8.22 响应链执法刀）。
 *
 * 用户口径里的"响应链"落在**受击／受伤两型**上：第八轮原话"受击方优先发动"
 * 说的是"这次事件打到谁身上"，而第九轮 b) 点名要接进问窗的正是这两型
 * （`onBecomingTarget`＝成为目标时／`onDamageTaken`＝受到伤害后）。其余触发型
 * 一字不动（登场、回合开始、击杀、遗言、手牌……照旧到点自动响）。
 *
 * 本文件是**叶子模块**：只认类型，不 import 桥接层／编译器，好让"哪些时机算可响应
 * 节点"这一维在触发链（分流开关）与响应链（候选枚举）两处读到同一份表。
 */
export const REACTION_TRIGGERS = ['onBecomingTarget', 'onDamageTaken'] as const;

export type ReactionTrigger = typeof REACTION_TRIGGERS[number];

export function isReactionTrigger(trigger: DataSkillTrigger): trigger is ReactionTrigger {
  return (REACTION_TRIGGERS as readonly string[]).includes(trigger);
}

/**
 * **每一型监听听得懂的那几一声——全库唯一一份表**（v2.8.25 强制发动执法刀）。
 *
 * 为什么必须只有一份：自动发动路（`SkillTriggerBridge` 注册进触发链）与问答路
 * （`skills/reactionChain.ts` 现算候选）过去各写一份"这型听哪一声"，于是
 * 「受到伤害后」在问答路听两声（`DAMAGE`＋决斗收官的 `DUEL_INJURY`）、在自动路
 * 只听一声（`DAMAGE`）⇒打了「强制发动」的受伤技**结构上听不到决斗收官那一笔**，
 * 而不打的照常被问到。这正是本文件头注警告过的分叉族：一响一不响最难查。
 *
 * `onTurnEnd` **故意不在这一列**（2.3.1 单发动路／绝不一技能两响）：它的唯一发动
 * 路是 canonical `ACTIVATE_SKILL`，任何情况下都不自动响。
 */
export const TRIGGER_EVENTS: Partial<Record<DataSkillTrigger, readonly GameEventType[]>> = {
  onDeploy: ['GENERAL_DEPLOYED'],
  onTurnStart: ['TURN_START'],
  // 2.3.0: BEFORE_DAMAGE is a pure notification (no EventProcessor case, no
  // state change) emitted by AttackResolver right before damage settlement.
  // Derived effects queue at the trigger-chain tail, so a counter hit from
  // this trigger settles AFTER the source DAMAGE within one dispatch —
  // frozen semantics, see PROJECT_ARCH_MAP "Trigger 契约表".
  onBecomingTarget: ['BEFORE_DAMAGE'],
  onDamageTaken: ['DAMAGE', 'DUEL_INJURY'],
  onDamageDealt: ['AFTER_DAMAGE'],
  onKill: ['DEATH'],
  onDeath: ['DEATH'],
  // 2.5.3: card-loss/gain triggers listen to the pure notification events
  // derived by the GIVE settlement (chainedConsequences). CARD_* carries no
  // EventProcessor case and changes no state by itself — same "pure
  // notification in the table" shape as BEFORE_DAMAGE (2.3.0).
  onCardLost: ['CARD_LOST'],
  onCardGained: ['CARD_GAINED'],
};

/** 这一型听得懂的全部几声；不在表里的型＝压根不在触发面上（返回空＝绝不响）。 */
export function eventsHeardBy(trigger: DataSkillTrigger): readonly GameEventType[] {
  return TRIGGER_EVENTS[trigger] ?? [];
}

/**
 * 可响应问答读的"哪一声开一格"——**从上面那张表派生，不再自己写一份**
 * （v2.8.25；§H9 第九轮 d) 与决斗刀 2 的那两条事实原样保留）。
 *
 * 「受到伤害后」听两声：`DAMAGE` 本体＋决斗打完**按角色累计**的那笔
 * `DUEL_INJURY`（一场决斗只记一笔、只结算一次；逐轮那些"打"仍不响，由
 * `isReactionSourceEvent` 显式排除）。「成为目标时」不扩：决斗开局喂的是"成为
 * **技能**目标"，仍走同一声 `BEFORE_DAMAGE`，由载荷里的 `damageType:'skill'` 与
 * `targetSource` 那一维分档（第五轮⑤：不喂"成为攻击目标"）。
 */
export const REACTION_EVENT_TYPES: Record<ReactionTrigger, readonly GameEventType[]> = {
  onBecomingTarget: eventsHeardBy('onBecomingTarget'),
  onDamageTaken: eventsHeardBy('onDamageTaken'),
};

/** 反查：这一声事件是哪种可响应节点（不是⇒undefined，扫描器据此跳过）。 */
export function reactionTriggerOfEvent(type: GameEventType): ReactionTrigger | undefined {
  for (const trigger of REACTION_TRIGGERS) {
    if (REACTION_EVENT_TYPES[trigger].includes(type)) return trigger;
  }
  return undefined;
}
