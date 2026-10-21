import type { DataSkillTrigger } from './dataTypes';
import type { GameEventType } from '../core/Event';

/**
 * 触发面登记处（§H9 第八/九/十轮，v2.8.22 响应链执法刀；v2.9.16 询问制刀改头）。
 *
 * 本文件只回答一个问题：**每一型时机听得懂哪几声**。它不回答"要不要停下来问人"
 * ——那一维 v2.9.16 起由**技能自己**决定（用户 2026-10-20 裁：除「在场即生效」与
 * 「强制发动」以外，任何时机到点都要问），判据单点在
 * `SkillTriggerBridge.defersToReactionQueue`，消费者是响应链问答（`reactionChain.ts`）。
 *
 * 旧的那份"哪几型算可响应节点"的两型名单（受击／受伤）连同它的反查助手已整层删
 * 除：今天"能听到的型＝要问的型"，两维合流，留一份反而是将来分叉的把手。
 *
 * 本文件是**叶子模块**：只认类型，不 import 桥接层／编译器，好让"这型听哪一声"在
 * 自动发动路（`SkillTriggerBridge` 注册）与问答路（候选枚举）两处读到同一份表。
 */

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
  // v2.9.14 营地刀：**同一声**，分族靠载荷里的 `isBase`（判据在 `skillEventMatch.ts`）。
  // 营地掉血派生的那一声由 `chainedConsequences` 在血量差>0 时才发，所以"只有真掉血
  // 才算受到伤害"这一条在营地这一侧同样是结构性成立，没有任何一处再判断一次。
  // 它**没打**「强制发动」⇒v2.9.16 询问制刀起照样停下来问人（问法与受击／受伤同一
  // 套）：判据落在这一枚定义身上，不落在这一格上——本文件不再持有任何"哪一型该问"的名单。
  onBaseDamaged: ['INJURY'],
  // v2.9.15 乙档刀：又一声**已经存在**的事件——`SKILL_ACTIVATED`。本刀之前它只在定义
  // 带"一局一次"额度时才发，所以这一格压根没东西可听；本刀起每次真发动都发（生产点
  // 仍是 `skills/skillQuota.ts` 那唯一一处），不带台账键的那一身＝纯通知、零状态位移。
  // 同一族：问不问只看这枚定义有没有打「强制发动」，"这一声是别人的技能发动"这一事实
  // 不构成豁免（防套娃由 `skillEventMatch.ts` 的 `viaActivation` 那一刀管，与问答无关）。
  onOtherSkillActivated: ['SKILL_ACTIVATED'],
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
 * 给响应链的开格免费闸用（v2.9.3 刀B 立、v2.9.16 询问制刀扩到全触发面）：表外的一声
 * （摸牌、移动、投降……）压根没有任何时机听得懂，不必进去扫一遍候选。
 * 表扩了新声，这一集自动跟着扩——两处不会分叉。
 */
export const ANY_TRIGGER_EVENT_TYPES: ReadonlySet<GameEventType> = new Set(
  (Object.values(TRIGGER_EVENTS) as readonly (readonly GameEventType[])[]).flat(),
);
