/**
 * 伤害两条腿**共用**的那一次读数（2.9.4 刀＝造方钥匙 `DAMAGE_DEALT` 接线时抽出来的）。
 *
 * 为什么是一处而不是两处：「一次性账一笔只挡一刀」「固定压着增减时增减不参与」「同侧两笔
 * 固定按发动先后后发盖先发」——这三条规矩是**读数算术**的规矩，与这一笔账站在造方还是
 * 受方无关。2.8 刀5 把它写在 `damageTaken.ts` 里（那时只有受方一把钥匙）；本刀接造方那一把，
 * 如果把同一段算术再抄一遍，将来改"最多销最早那一笔"就要改两处——两处一旦分叉，
 * 普攻与预览就会各说一词（§12-55 那一族"同一件事两处都能改"）。所以：
 *  - 本文件＝**唯一**的一次读数算术（纯函数，同一本账＋同一个原始数⇒同一个结果）；
 *  - `damageTaken.ts`／`damageDealt.ts` 各自只回答两件事：读哪一把钥匙、这一侧多问哪一句。
 *
 * 顺序仍然由**调用点**决定，不由本文件决定：全库那句顺序是
 * **攻击力 → 造成伤害 → 受到伤害 → 护甲抵扣 → 最终扣血**（PROJECT_ARCH_MAP §F「数值修正器管线」
 * 与 §H5-3）。跨侧固定碰撞（造方"固定为 3"×受方"固定为 1"）的赢家＝**受方**，实现方式＝
 * **入算次序**——造方先入算、受方后入算，后读的覆写先读的，不是问窗先后。
 */
import {
  modifiersFor,
  type StatModifier,
  type StatModifierKey,
  type StatModifierTarget,
} from './statModifiers';

/** 一次性周期（「本次」／「下次」）：用掉就销，不跟回合边界走。造方／受方两把钥匙都有这一档。 */
export const ONESHOT_DAMAGE_DURATION = 'thisDamage';

export interface DamageLedgerOutcome {
  /** 交给下一格的那个数字（已含修正、已夹到 ≥0——伤害不是负数，掉血另说）。 */
  damage: number;
  /** 这一次读数用掉的那几笔一次性账的 id，由调用点落成 canonical `STAT_MODIFY{op:'REMOVE'}`。 */
  consumedIds: string[];
}

/** 这一笔是不是一次性账。 */
export function isOneshotModifier(mod: StatModifier): boolean {
  return mod.expire === ONESHOT_DAMAGE_DURATION;
}

/**
 * 读数＋消费清单，一次算完。`filter` 是**这一侧多问的那一句**：造方要按生效场合筛
 * （`damageDealt.ts`），受方今天没有额外条件⇒不传。
 *
 * 两条来自用户裁决的硬口径（逐字账＝HANDOFF §12-102／§12-117⑮）：
 *  1. **一笔一次性账只挡一笔伤害**（用户 2026-10-03 裁决 7：决斗里"下 1 次受到伤害−1"
 *     只算一轮，"2 次"算两轮）。所以同一次读数里最多销掉**一笔**一次性增减——按发动
 *     先后取最早那一笔；其余一次性笔留在账上等下一刀。持续（非一次性）的增减照常累加。
 *  2. **没被读到的那一笔不销**：固定压着增减时（第 4 条：账一直在、只是不被读），
 *     被压住的那笔一次性增减还得留着等下一次。
 */
export function resolveDamageLedgerRun(
  ledger: readonly StatModifier[] | undefined,
  key: StatModifierKey,
  target: StatModifierTarget,
  rawDamage: number,
  filter?: (mod: StatModifier) => boolean,
): DamageLedgerOutcome {
  const base = Math.max(0, Number(rawDamage) || 0);
  const matched = modifiersFor(ledger, key, target);
  const mods = filter ? matched.filter(filter) : matched;
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
 * 每一轮都得看见上一轮销掉的那笔——造方与受方的两半都要看得见）。销账按 id 直删，
 * **不读 `locked`**——理由与 `applyStatModifyEvent` 的 REMOVE 分支同一句话：用掉不是
 * "别人无效化你这笔账"，是"这一刀把它消费了"，生命周期本身结束了。真正移走别人那笔账的
 * 入口只有 `revokeModifier`。
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
