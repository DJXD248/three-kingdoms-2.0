/**
 * 「一局一次」额度（v2.8.32 限定技额度刀）——两处单点：
 *  ① **判定**：`limitedQuotaAvailable`，三条发动路（回合结束／响应问答／自动触发）
 *     与界面候选列表读的都是这同一句，判据＝账本 `EngineState.consumedSkills` 里
 *     有没有同一枚技能的任意一笔。账本只由 EventProcessor 落笔、从不删，所以
 *     "一局"跨回合天然成立，回放／重建／常驻四路拿到的是同一份账。
 *  ② **记账的形状**：`mintActivation`（对外两个出口 `skillActivatedEvent`／
 *     `activationRecordEvent`），全库唯一生产 `SKILL_ACTIVATED` 载荷的地方。三条路以前
 *     各写各的（只有回合结束那路落账），这一刀起形状只有一份，所以同一枚限定技无论
 *     从哪条路发动，消耗的都是同一笔账。
 *  ③ **（v2.9.15 乙档刀起）"刚刚发动了一次技能"这一声**：与②同一个形状、同一个生产
 *     点，差别只在进不进台账。以前只有带额度的定义才出声，普通技能发动一声不吭⇒
 *     「其他将领技能发动时」那一格接上电之后，每次真发动都出声（空发不出＝裁决④）。
 *
 * 用户 2026-10-04 的四条裁决逐字对应：①每枚技能各一局一次⇒键按**技能**不按定义；
 * ②用完照常在候选里列出、置灰写明原因；③被无效不退⇒账本没有任何回退入口，这一条
 * 是结构成立的、不需要代码；④没发动成功不消耗⇒`activationRecordEvent` 里那句
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
  /** v2.9.15 乙档刀·防套娃那一句：这一次发动是**由「其他将领技能发动时」那一声引起的**。
   *  只在为真时落这一键（与 `limitKey`／`occasion` 同一条规矩：键在不在就是意思的一部分，
   *  多一个 `viaActivation: undefined` 会弄坏逐字节比对）。唯一消费点＝
   *  `skills/skillEventMatch.ts` 的 `onOtherSkillActivated`——带这一键的那一身它不听。 */
  viaActivation?: boolean;
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

/** `SKILL_ACTIVATED` 的**唯一形状**（三条发动路都从这里出）。
 *  `booked` 决定这一身进不进台账：带 `stableId` ⇒ `applySkillActivatedEvent` 落一笔；
 *  不带 ⇒ **纯通知**（与 `INJURY`／`CARD_*` 同一族：`EventProcessor` 读到缺 `stableId`
 *  恒等返回，state 一个字不动）。v2.9.15 乙档刀起两者同形同点，只差这一个键——
 *  「其他将领技能发动时」听的是这一声，而台账今天依然只有回合结束路与带额度的定义需要它。
 *  键序＝旧字面量顺序（`stableId` 在前、`limitKey` 在后、`viaActivation` 最后），
 *  既有带额度那一身因此逐字不变。 */
function mintActivation(
  definition: DataSkillDefinition,
  ctx: SkillActivationContext,
  booked: boolean,
): GameEvent {
  const data: SkillActivationEventData = {
    skillId: definition.id,
    skillName: definition.name,
    effectId: definition.effectId ?? definition.id,
    generalId: ctx.generalId,
    playerId: Number(ctx.playerId),
    ...(booked ? { stableId: `${ctx.turn}:${definition.id}` } : {}),
    ...(definition.limitKey ? { limitKey: definition.limitKey } : {}),
    ...(ctx.viaActivation === true ? { viaActivation: true } : {}),
  };
  return { type: 'SKILL_ACTIVATED', data };
}

/** 回合结束那一路：每一次真发动都必进账（"每回合限一次"查的就是这笔，2.3.1 起）。
 *  stableId 沿用 `<回合>:<定义 id>`：同一枚定义一个游戏里只会落一笔带额度的账。 */
export function skillActivatedEvent(
  definition: DataSkillDefinition,
  ctx: SkillActivationContext,
): GameEvent {
  return mintActivation(definition, ctx, true);
}

/**
 * 自动触发路与响应问答路的"这一次发动"该落的那一笔（v2.9.15 起**不再要求定义带额度**——
 * 旧名叫 `limitedActivationEvent`，那是"只有带额度才落账"时代的名字）。
 * 唯一不落账的场合是如实的那一条：
 *  - 这一发什么都没产出⇒按裁决④"没有发动成功不消耗"，落账就等于把一次空发算成
 *    一次使用（与回合结束那路选择组全不过门槛时的判据同一条）。
 * 带额度的定义照旧进台账（`booked`），其余只出声不进账＝纯通知⇒既有对局的事件流里
 *  那些"带额度的那一身"逐字不变，多出来的每一身都不动状态。
 */
export function activationRecordEvent(
  definition: DataSkillDefinition,
  ctx: SkillActivationContext,
  producedCount: number,
): GameEvent | null {
  if (producedCount === 0) return null;
  return mintActivation(definition, ctx, definition.limitKey !== undefined);
}
