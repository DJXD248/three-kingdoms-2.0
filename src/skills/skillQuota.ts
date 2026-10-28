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
 *
 * 限次刀（用户 2026-10-28 五条裁决）在同一处加**第二本账**：「每回合限 N 次」。
 * 两本账读同一份台账、走同一个记账形状，只是键不同——
 *  · 一局一次＝`limitKey`（`<将领实例>:<技能名>`），跨窗查同一枚技能用过没有；
 *  · 每回合 N 次＝`turnQuota`（`<窗口戳>:<将领实例>:<技能名>`），数这一格窗里落了几笔。
 * 键里带窗＝**归零不需要删任何账**：换窗就是换键，旧键不再被数到（裁决②"回合完全结束时
 * 自动归零"的落地形状，与上面"从不删账"这条结构纪律同时成立）。
 * 五条裁决逐字对应：①每一名玩家的回合各算一格窗⇒窗口戳只由 `applyTurnStartEvent` 盖；
 * ②归零点＝即将进入下一格窗的那一拍⇒同上，键里带窗；③N 汉字与阿拉伯数字都认、读不出
 * 就逐段退回⇒`skillTextParse.ts` 调 `parseCountNumber` 这一份，界面无默认值；④支付了代价
 * 并发动了就扣、被改变或被无效也不退⇒扣在**决议那一刻**（落的是发动账，不是效果账），
 * 账本没有任何回退入口＝结构成立、不需要代码；⑤用完界面说「本回合已用尽」⇒
 * `TURN_LIMIT_EXHAUSTED_TEXT` 与置灰/拒绝理由共用这一句。
 */
import type { EngineState } from '../core/GameState';
import type { GameEvent, SkillActivationEventData } from '../core/Event';
import type { DataSkillDefinition } from './dataTypes';

/** 置灰文案与拒绝理由共用这一句——写两份迟早分叉。 */
export const LIMIT_EXHAUSTED_TEXT = '本局已用尽';
/** 限次刀·「每回合限 N 次」用完那一句（裁决⑤逐字＝「加一句「本回合已用尽」」）。
 *  与上面同一条纪律：置灰文案与拒绝理由共用这一句。 */
export const TURN_LIMIT_EXHAUSTED_TEXT = '本回合已用尽';

/**
 * 当前这一格**窗口**。唯一回落点：没有戳（旧存档、旧录像、开局还没有 TURN_START）就读裸
 * `turn`——`turn` 每过一家营地加一，所以"一名玩家的回合＝一格窗"这一条在回落路径上同样成立。
 * 判定与记账都经这一句取窗（判据只有一份）。
 */
export function turnWindowOf(state: EngineState): number {
  return state.turnWindow ?? state.turn ?? 0;
}

/**
 * 「这一枚技能在这一格窗里已经用了几次」。台账里同键的笔数＋**同一条触发链内**已落的笔数
 * （`quotaSpent`：整条展开读的是落账前的同一份 state，只查账本会让一条链上两声命中结两遍
 * 而账上只扣一次——v2.8.32 那个洞在这里是同一个，只是这里要数数、不能只问在不在）。
 * 不带每回合额度的定义恒为 0。
 */
export function perTurnQuotaUsed(
  state: EngineState,
  definition: DataSkillDefinition,
  spent?: ReadonlyMap<string, number>,
): number {
  const key = turnQuotaKeyOf(state, definition);
  if (!key) return 0;
  const booked = (state.consumedSkills ?? []).filter(entry => entry.turnQuotaKey === key).length;
  return booked + (spent?.get(key) ?? 0);
}

/**
 * 把"这一次发动用掉的那几格额度"记进**同一条展开链**的已用计数（唯一写手＝
 * `skills/SkillTriggerBridge`）。一次发动可能同时吃掉两本账——「一局一次」的
 * `limitKey` 与「每回合 N 次」的窗键——哪几键该涨，只有这个文件知道：判定读的
 * 就是这两个键的拼法（`definition.limitKey` 与 `turnQuotaKeyOf`），写侧若另抄一份
 * 串，迟早和判定分叉成"扣的不是数的那格"。
 *
 * `state` 在这里取窗，与判定侧同一个函数（`turnWindowOf`）⇒同一格窗里"数几笔"和
 * "落哪一笔"不可能对不上。容器缺省（问答路／回合结束路不跑触发链）＝什么都不做，
 * 那两路的真相在账本里。
 */
export function spendChainQuota(
  spent: Map<string, number> | undefined,
  state: EngineState,
  definition: DataSkillDefinition,
): void {
  if (!spent) return;
  for (const key of [definition.limitKey, turnQuotaKeyOf(state, definition)]) {
    if (key) spent.set(key, (spent.get(key) ?? 0) + 1);
  }
}

/**
 * 这一次发动用的那一个窗键：`<窗口戳>:<将领实例>:<技能名>`（键按**技能**不按定义，与
 * `limitKey` 同一条纪律——一枚技能编出多个定义时共用同一格额度）。不带每回合额度＝没有这个键。
 * 唯一生产点：判定（`perTurnQuotaAvailable`）与记账（`mintActivation`）都调这一句，
 * 所以"数几笔"和"落哪一笔"不可能分叉成两个串。
 */
export function turnQuotaKeyOf(
  state: EngineState,
  definition: DataSkillDefinition,
): string | undefined {
  return turnQuotaKeyAt(turnWindowOf(state), definition);
}

/** 串的唯一拼法（判定与记账两处各调一次，不在任何一处手抄 `${窗}:${键}`）。 */
function turnQuotaKeyAt(
  window: number,
  definition: DataSkillDefinition,
): string | undefined {
  const quota = definition.turnQuota;
  return quota ? `${window}:${quota.key}` : undefined;
}

/**
 * 这枚定义的「每回合限 N 次」还在不在（裁决①：每一名玩家的回合各算一格窗）。
 * **不带每回合额度的定义恒为真**＝本刀对既有内容零影响（两个锚池因此结构上不动）。
 */
export function perTurnQuotaAvailable(
  state: EngineState,
  definition: DataSkillDefinition,
  spent?: ReadonlyMap<string, number>,
): boolean {
  const quota = definition.turnQuota;
  if (!quota) return true;
  return perTurnQuotaUsed(state, definition, spent) < quota.limit;
}

export interface SkillActivationContext {
  playerId: number | string;
  generalId: string;
  turn: number;
  /** 限次刀：这一次发动落在哪一格窗（唯一取法＝`turnWindowOf(state)`，调用方不许自己算）。
   *  只在定义带每回合额度时才有意义；不带＝这一键根本不出现。 */
  turnWindow?: number;
  /** 落账**之前**这一格窗里已经用过的次数（唯一取法＝`perTurnQuotaUsed(state, def, spent)`）。
   *  带每回合额度的定义要靠它把同窗的第二笔与第一笔分开——台账的幂等门按 `stableId` 认，
   *  两笔同串会被吞掉第二笔⇒次数永远扣不完（见 `mintStableId`）。 */
  turnQuotaUsed?: number;
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
  spent?: ReadonlyMap<string, number>,
): boolean {
  const key = definition.limitKey;
  if (!key) return true;
  if ((spent?.get(key) ?? 0) > 0) return false;
  return !(state.consumedSkills ?? []).some(entry => entry.limitKey === key);
}

/** `SKILL_ACTIVATED` 的**唯一形状**（三条发动路都从这里出）。
 *  `booked` 决定这一身进不进台账：带 `stableId` ⇒ `applySkillActivatedEvent` 落一笔；
 *  不带 ⇒ **纯通知**（与 `INJURY`／`CARD_*` 同一族：`EventProcessor` 读到缺 `stableId`
 *  恒等返回，state 一个字不动）。v2.9.15 乙档刀起两者同形同点，差别只在进不进账——
 *  「其他将领技能发动时」听的是这一声，而今天需要这一笔账的有两家：回合结束那一路，
 *  以及带「一局一次」或「每回合 N 次」额度的定义。
 *  键序＝旧字面量顺序（`stableId` 在前、`limitKey` 在后、`viaActivation` 最后），
 *  既有带额度那一身因此逐字不变；`turnQuotaKey` 排在 `limitKey` 之后＝只有挂了每回合
 *  额度的定义才多出这一键。 */
function mintActivation(
  definition: DataSkillDefinition,
  ctx: SkillActivationContext,
  booked: boolean,
): GameEvent {
  // 回落按 `ctx.turn`＝**绝不因为调用方漏传窗口而把这一笔扣掉**（漏传的后果必须是
  // "多扣一次"这种看得见的错，不能是"次数永远扣不完"这种看不见的错）。三个生产调用点
  // 都在同一个瞬间从同一个 state 取窗（`turnWindowOf(state)`），与判定侧同源⇒不会分叉。
  const window = ctx.turnWindow ?? ctx.turn;
  const turnQuotaKey = turnQuotaKeyAt(window, definition);
  const data: SkillActivationEventData = {
    skillId: definition.id,
    skillName: definition.name,
    effectId: definition.effectId ?? definition.id,
    generalId: ctx.generalId,
    playerId: Number(ctx.playerId),
    ...(booked ? { stableId: mintStableId(definition, ctx) } : {}),
    ...(definition.limitKey ? { limitKey: definition.limitKey } : {}),
    ...(turnQuotaKey ? { turnQuotaKey } : {}),
    ...(ctx.viaActivation === true ? { viaActivation: true } : {}),
  };
  return { type: 'SKILL_ACTIVATED', data };
}

/**
 * `stableId` 的串法。不带每回合额度的定义＝`<回合>:<定义 id>`，与 2.3.1 起逐字一致。
 * 带的那一支多一个**窗内序号**：台账的幂等门按 `stableId` 认（同一串只落一笔），
 * 而「每回合限 2 次」要的就是同一格窗里落两笔——两笔同串＝第二笔被吞掉＝次数永远扣不完。
 * 序号取"落账前这一格窗已用的次数"（唯一出处＝`perTurnQuotaUsed`，含同链内未落账的那几笔），
 * 所以第一笔是 `#0`、第二笔是 `#1`；回放／重建同序同串，幂等门照旧管得住重复投递。 */
function mintStableId(definition: DataSkillDefinition, ctx: SkillActivationContext): string {
  const base = `${ctx.turn}:${definition.id}`;
  return definition.turnQuota ? `${base}#${ctx.turnQuotaUsed ?? 0}` : base;
}

/** 回合结束那一路：每一次真发动都必进账（"每回合限一次"查的就是这笔，2.3.1 起）。
 *  不带每回合额度的定义，stableId 沿用 `<回合>:<定义 id>`＝同一枚定义一个游戏里只会落
 *  一笔带额度的账；带的那一支多一个窗内序号，因为那一格窗里允许落 N 笔（见 `mintStableId`）。 */
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
 * 限次刀起"带额度"是**两本**账：一局一次的 `limitKey` 与每回合 N 次的 `turnQuota`——
 * 后者不落账就数不出用了几次，所以它的发动**必然**是带 stableId 的那一身。
 */
export function activationRecordEvent(
  definition: DataSkillDefinition,
  ctx: SkillActivationContext,
  producedCount: number,
): GameEvent | null {
  if (producedCount === 0) return null;
  return mintActivation(
    definition,
    ctx,
    definition.limitKey !== undefined || definition.turnQuota !== undefined,
  );
}
