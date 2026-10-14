/**
 * 受到伤害那一格的算术（2.8 刀5＝#26，PROJECT_ARCH_MAP §F「可改量注册表」DAMAGE_TAKEN 行）。
 *
 * 形状是一句顺序：**原始伤害 → 造成伤害修正（`core/damageDealt.ts`）→ 受到伤害修正 →
 * 护甲抵扣 → 最终扣血**。本文件只管**受方**那一格：修正挂在护甲**之前**（用户 2026-10-02 裁决：
 * 「受到的伤害固定为 1」作用在进护甲之前的那个数，护甲照旧 2 甲抵 1）；既有护甲单点出口
 * `core/armorDamage.ts` 消费的永远是它的**结果**，本刀一个字都不改写它——把"+1"挂到扣完护甲的
 * 出口上，语义会变成"最终伤害+1"，那是另一个数字。
 *
 * 一次读数的算术（增减累加／固定优先／一次性账最多销最早那一笔／被固定压住的那笔不算用掉）
 * 自 2.9.4 起住在 `core/damageLedgerRun.ts`，与造方那一格**共用同一份**——两条腿的规矩是同
 * 一套规矩，抄两遍就是给未来的分叉留门。
 *
 * 三个进料口都调这一个函数，绝不在别处再算一遍：
 *  - 普攻（`core/attackBlow.ts`）：预解，与护甲算术同批落定；
 *  - 决斗逐轮（`core/eventProcessors/duelEvents.ts`）：预解，逐轮线程同一本账（一次性账
 *    每一轮各用掉一笔＝用户 2026-10-03 裁决"2 次算两轮"）；
 *  - 技能伤害（`core/eventProcessors/damageEvents.ts`）：结算时读（那条路刻意不预解，
 *    同一技能连发两笔伤害时第二笔必须看见第一笔之后的血量）。
 *
 * 跨侧固定碰撞（造方"固定为 3"×受方"固定为 1"）的赢家＝**受方**，实现方式是**入算次序**
 * 而不是问窗先后：造方侧先入算、受方侧后入算，后读的覆写先读的。造方那一把钥匙
 * （`DAMAGE_DEALT`）自 2.9.4 起接线，入算点就排在下面每一个调用点的**这一行之前**。
 */
import type { StatModifier, StatModifierTarget } from './statModifiers';
import { resolveDamageLedgerRun, type DamageLedgerOutcome } from './damageLedgerRun';

/**
 * 受方那一格的唯一读数（纯函数：同一本账、同一个原始数⇒同一个结果，
 * 所以"结算侧现读"与"派生侧复核"不会各执一词）。
 */
export function resolveDamageTaken(
  ledger: readonly StatModifier[] | undefined,
  target: StatModifierTarget,
  rawDamage: number,
): DamageLedgerOutcome {
  return resolveDamageLedgerRun(ledger, 'DAMAGE_TAKEN', target, rawDamage);
}
