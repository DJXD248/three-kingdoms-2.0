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
 * 每一型可响应监听听的是哪一声事件（与 `SkillTriggerBridge` 的
 * `TRIGGER_EVENT_MAP` 逐字同读法：成为目标时听 `BEFORE_DAMAGE`、受到伤害后听
 * `DAMAGE` 本体——第九轮 d) 更正过的那条事实）。
 */
export const REACTION_EVENT_TYPE: Record<ReactionTrigger, GameEventType> = {
  onBecomingTarget: 'BEFORE_DAMAGE',
  onDamageTaken: 'DAMAGE',
};

/** 反查：这一声事件是哪种可响应节点（不是⇒undefined，扫描器据此跳过）。 */
export function reactionTriggerOfEvent(type: GameEventType): ReactionTrigger | undefined {
  for (const trigger of REACTION_TRIGGERS) {
    if (REACTION_EVENT_TYPE[trigger] === type) return trigger;
  }
  return undefined;
}
