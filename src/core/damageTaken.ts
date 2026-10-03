/**
 * 受到伤害那一格的算术（2.8 刀5＝#26，PROJECT_ARCH_MAP §F「可改量注册表」DAMAGE_TAKEN 行）。
 *
 * 形状是一句顺序，全库只此一处：**原始伤害 → 受到伤害修正 → 护甲抵扣 → 最终扣血**。
 * 修正挂在护甲**之前**（用户 2026-10-02 裁决：「受到的伤害固定为 1」作用在进护甲之前的
 * 那个数，护甲照旧 2 甲抵 1）；既有护甲单点出口 `core/armorDamage.ts` 消费的永远是它的
 * **结果**，本刀一个字都不改写它——把"+1"挂到扣完护甲的出口上，语义会变成"最终伤害+1"，
 * 那是另一个数字。
 *
 * 三个进料口都调这一个函数，绝不在别处再算一遍：
 *  - 普攻（`action/resolvers/AttackResolver.ts`）：预解，与护甲算术同批落定；
 *  - 决斗逐轮（`core/eventProcessors/duelEvents.ts`）：预解，逐轮线程同一本账（一次性账
 *    每一轮各用掉一笔＝用户 2026-10-03 裁决"2 次算两轮"）；
 *  - 技能伤害（`core/eventProcessors/damageEvents.ts`）：结算时读（那条路刻意不预解，
 *    同一技能连发两笔伤害时第二笔必须看见第一笔之后的血量）。
 *
 * 跨侧固定碰撞（造方"固定为 3"×受方"固定为 1"）的赢家＝**受方**，实现方式是**入算次序**
 * 而不是问窗先后：造方侧先入算、受方侧后入算，后读的覆写先读的。本刀只接了受方这一把
 * 钥匙（`DAMAGE_DEALT` 用户已裁＝本刀不接），所以今天还没有第二个入算点，次序格留着
 * 注释占位，等那一刀接线时插在**这一行之前**。
 */
import {
  modifiersFor,
  type StatModifier,
  type StatModifierTarget,
} from './statModifiers';

/** 一次性周期（「本次伤害」／「下次受到伤害−1」）：用掉就销，不跟回合边界走。 */
export const ONESHOT_DAMAGE_DURATION = 'thisDamage';

export interface DamageTakenOutcome {
  /** 进护甲算术的那个数字（已含修正、已夹到 ≥0——伤害不是负数，掉血另说）。 */
  damage: number;
  /** 这一刀用掉的那几笔一次性账的 id，由调用点落成 canonical `STAT_MODIFY{op:'REMOVE'}`。 */
  consumedIds: string[];
}

/** 这一笔是不是一次性账。 */
export function isOneshotModifier(mod: StatModifier): boolean {
  return mod.expire === ONESHOT_DAMAGE_DURATION;
}

/**
 * 读数＋消费清单，一次算完（纯函数：同一本账、同一个原始数⇒同一个结果，
 * 所以"结算侧现读"与"派生侧复核"不会各执一词）。
 *
 * 覆写优先与增减互斥那条规矩住在 `resolveStatNumber` 里，这里只多问两句：
 *  1. **一笔一次性账只挡一笔伤害**（用户 2026-10-03 裁决 7：决斗里"下 1 次受到伤害−1"
 *     只算一轮，"2 次"算两轮）。所以同一次读数里最多销掉**一笔**一次性增减——按发动
 *     先后取最早那一笔；其余一次性笔留在账上等下一刀。持续（非一次性）的增减照常累加。
 *  2. **没被读到的那一笔不销**：固定压着增减时（第 4 条：账一直在、只是不被读），
 *     被压住的那笔一次性增减还得留着等下一次。
 */
export function resolveDamageTaken(
  ledger: readonly StatModifier[] | undefined,
  target: StatModifierTarget,
  rawDamage: number,
): DamageTakenOutcome {
  const base = Math.max(0, Number(rawDamage) || 0);
  const mods = modifiersFor(ledger, 'DAMAGE_TAKEN', target);
  if (mods.length === 0) return { damage: base, consumedIds: [] };

  const sets = mods.filter(mod => mod.mode === 'set');
  if (sets.length > 0) {
    const winner = sets[sets.length - 1];
    return {
      damage: Math.max(0, winner.value),
      consumedIds: isOneshotModifier(winner) ? [winner.id] : [],
    };
  }

  const spend = mods.find(isOneshotModifier);
  const participating = spend ? mods.filter(mod => mod === spend || !isOneshotModifier(mod)) : mods;
  return {
    damage: Math.max(0, participating.reduce((sum, mod) => sum + mod.value, base)),
    consumedIds: spend ? [spend.id] : [],
  };
}

/**
 * 一次性账被用掉之后的**本地**账本（只给决斗逐轮那条线程用：它要在同一趟里连打六轮，
 * 每一轮都得看见上一轮销掉的那笔）。销账按 id 直删，**不读 `locked`**——理由与
 * `applyStatModifyEvent` 的 REMOVE 分支同一句话：用掉不是"别人无效化你这笔账"，
 * 是"这一刀把它消费了"，生命周期本身结束了。真正移走别人那笔账的入口只有
 * `revokeModifier`。
 */
export function pruneSpentModifiers(
  ledger: readonly StatModifier[] | undefined,
  consumedIds: readonly string[],
): StatModifier[] {
  const current = [...(ledger ?? [])];
  if (consumedIds.length === 0) return current;
  const spent = new Set(consumedIds.map(String));
  return current.filter(mod => !spent.has(mod.id));
}
