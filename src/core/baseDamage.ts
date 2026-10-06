/**
 * 营地这一格的血量规则（v2.8.29「封」，裁决原文见 PROJECT_HANDOFF §12-96）。
 *
 * 规则一句话：营地单次受到的伤害最多 1 点，并且**这一格不吃「受到的伤害」修正**
 * （它不是任何一员将，账本里没有它那一笔）。
 *
 * 为什么这个数住在**发射点**而不住在结算口（`core/eventProcessors/damageEvents.ts`）：
 * 结算口的职责是"照事件里写着的数值落账"，把规则常量塞进去＝同一件事在两处算、
 * 两处都可能改。所以两条能打到营地的发射路——普攻（`AttackResolver`）与技能伤害
 * （`SkillTriggerBridge`）——都从这里取同一个数，别处不再算第二遍。
 */
export const BASE_MAX_DAMAGE_PER_HIT = 1;

/** 打营地的那一下实际记多少点。负数／0 原样放行：这一路今天不存在"把 0 抬成 1"，
 *  抬数＝改行为，而本刀只裁了上限。 */
export function capDamageToBase(amount: number): number {
  return Math.min(BASE_MAX_DAMAGE_PER_HIT, amount);
}
