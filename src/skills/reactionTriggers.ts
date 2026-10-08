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
 * （`skills/reactionChain.ts` 现算候选）过去各写一份"这型听哪一声"，于是同一型在
 * 两路边数不一样——v2.8.24 那一轮「受到伤害后」在问答路听两声、自动路只听一声，
 * 打了「强制发动」的受伤技就结构上听不到决斗收官那一笔。一响一不响是最难查的那一族。
 * 今天（v2.8 刀5）受伤只听一声 `INJURY`，两路边数天然相同。
 *
 * `onTurnEnd` **故意不在这一列**（2.3.1 单发动路／绝不一技能两响）：它的唯一发动
 * 路是 canonical `ACTIVATE_SKILL`，任何情况下都不自动响。
 */
export const TRIGGER_EVENTS: Partial<Record<DataSkillTrigger, readonly GameEventType[]>> = {
  onDeploy: ['GENERAL_DEPLOYED'],
  onTurnStart: ['TURN_START'],
  // 2.3.0: BEFORE_DAMAGE is a pure notification (no EventProcessor case, no
  // state change). v2.8.31 (§12-102): the attack now has two beats — the
  // becoming-target layer fully resolves (auto road fires, ask road opens a
  // cell) BEFORE the blow's damage math is computed against the post-layer
  // state, so a counter hit from this trigger always lands first.
  onBecomingTarget: ['BEFORE_DAMAGE'],
  // v2.8 刀5：受伤这一身**只听 `INJURY`**。它是每一刀落账后派生出来的那一声明
  // （"这一员将的体力真实下降了"），护甲全挡、伤害≤0 都压根不发⇒用户 2026-10-03
  // 重新裁定的判据（只有掉血才算受到伤害）在这里是**结构性成立**的，没有任何一处
  // 再判断一次"这次算不算受到了伤害"。决斗的收官那一笔也是这一声（带 `duelStage:
  // 'injury'`），逐轮那些"打"不发这一声（`chainedConsequences` 显式排除 `duelRound`）。
  onDamageTaken: ['INJURY'],
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
 * **任何**触发型听得懂的几声总集（由上面那张表派生，绝不另写一份名单）。
 * 给响应链的免费闸用（v2.9.3 刀B）：觉醒技听哪一声＝它自己的触发时机在那张表里的
 * 那一行，所以"这一声有没有可能轮到觉醒技"只可能落在这几个类型上；表外的一声
 * （摸牌、移动、投降……）压根没有任何时机听得懂，不必进去扫一遍候选。
 * 表扩了新声，这一集自动跟着扩——两处不会分叉。
 */
export const ANY_TRIGGER_EVENT_TYPES: ReadonlySet<GameEventType> = new Set(
  (Object.values(TRIGGER_EVENTS) as readonly (readonly GameEventType[])[]).flat(),
);

/**
 * 可响应问答读的"哪一声开一格"——**从上面那张表派生，不再自己写一份**
 * （v2.8.25；§H9 第九轮 d) 与决斗刀 2 的那两条事实原样保留）。
 *
 * 「受到伤害后」听一声：`INJURY`＝每一刀实际掉血派生的那一声明（v2.8 刀5）。决斗打完
 * **按角色累计**的那笔也是同一声（一场决斗只记一笔、只结算一次；逐轮那些"打"压根不发
 * 这一声，派生点显式排除 `duelRound`）。「成为目标时」不扩：决斗开局喂的是"成为
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
