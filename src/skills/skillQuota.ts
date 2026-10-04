/**
 * 「一局一次」额度（v2.8.32 限定技额度刀）——两处单点：
 *  ① **判定**：`limitedQuotaAvailable`，三条发动路（回合结束／响应问答／自动触发）
 *     与界面候选列表读的都是这同一句，判据＝账本 `EngineState.consumedSkills` 里
 *     有没有同一枚技能的任意一笔。账本只由 EventProcessor 落笔、从不删，所以
 *     "一局"跨回合天然成立，回放／重建／常驻四路拿到的是同一份账。
 *  ② **记账的形状**：`skillActivatedEvent`，全库唯一生产 `SKILL_ACTIVATED` 载荷的
 *     地方。三条路以前各写各的（只有回合结束那路落账），这一刀起形状只有一份，
 *     所以同一枚限定技无论从哪条路发动，消耗的都是同一笔账。
 *
 * 用户 2026-10-04 的四条裁决逐字对应：①每枚技能各一局一次⇒键按**技能**不按定义；
 * ②用完照常在候选里列出、置灰写明原因；③被无效不退⇒账本没有任何回退入口，这一条
 * 是结构成立的、不需要代码；④没发动成功不消耗⇒`limitedActivationEvent` 里那句
 * "什么都没产出就不落账"，与既有的"宁可不发，绝不空耗"同一条诚实口径。
 */
import type { EngineState } from '../core/GameState';
import type { GameEvent, SkillActivationEventData } from '../core/Event';
import type { DataSkillDefinition } from './dataTypes';

/** 置灰文案与拒绝理由共用这一句——写两份迟早分叉。 */
export const LIMIT_EXHAUSTED_TEXT = '本局已用尽';

export interface SkillActivationContext {
  playerId: number | string;
  generalId: string;
  turn: number;
}

/**
 * 这枚定义的「一局一次」额度还在不在。**不带额度的定义恒为真**＝本刀对既有内容
 * 零影响（两个锚池因此结构上不动）。
 *
 * `spent` 是**同一条触发链内**已经落账的额度键（`TriggerContext.quotaSpent`）：整条
 * 展开读的是落账之前的同一份 state，只查账本会让一条链上两声命中同一枚技能时结两遍
 * 效果、台账只扣一次。问答路与回合结束路每次都跑在已落账的 state 上，不传这一份。
 */
export function limitedQuotaAvailable(
  state: EngineState,
  definition: DataSkillDefinition,
  spent?: ReadonlySet<string>,
): boolean {
  const key = definition.limitKey;
  if (!key) return true;
  if (spent?.has(key)) return false;
  return !(state.consumedSkills ?? []).some(entry => entry.limitKey === key);
}

/** `SKILL_ACTIVATED` 的唯一形状。stableId 沿用 `<回合>:<定义 id>`：同一枚定义一个
 *  游戏里只会落一笔带额度的账，而回合结束那路的"每回合一次"查的还是同一个键。 */
export function skillActivatedEvent(
  definition: DataSkillDefinition,
  ctx: SkillActivationContext,
): GameEvent {
  const data: SkillActivationEventData = {
    skillId: definition.id,
    skillName: definition.name,
    effectId: definition.effectId ?? definition.id,
    generalId: ctx.generalId,
    playerId: Number(ctx.playerId),
    stableId: `${ctx.turn}:${definition.id}`,
    ...(definition.limitKey ? { limitKey: definition.limitKey } : {}),
  };
  return { type: 'SKILL_ACTIVATED', data };
}

/**
 * 该不该为这一次发动落账（自动触发路与响应问答路的门）。两条都不落的场合是如实的：
 *  - 定义不带额度⇒台账唯一的消费者就是额度，多落一笔没人读，还平白改事件流；
 *  - 这一发什么都没产出⇒按裁决④"没有发动成功不消耗"，落账就等于把一次空发算成
 *    一次使用（与回合结束那路选择组全不过门槛时的判据同一条）。
 */
export function limitedActivationEvent(
  definition: DataSkillDefinition,
  ctx: SkillActivationContext,
  producedCount: number,
): GameEvent | null {
  if (!definition.limitKey || producedCount === 0) return null;
  return skillActivatedEvent(definition, ctx);
}
