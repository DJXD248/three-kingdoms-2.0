/**
 * 造成伤害那一格的算术（2.9.4 刀＝#54，PROJECT_ARCH_MAP §F「可改量注册表」DAMAGE_DEALT 行）。
 *
 * 它是**受方那一格之前的那一格**：全库那句顺序仍然是
 * **攻击力 → 造成伤害 → 受到伤害 → 护甲抵扣 → 最终扣血**。用户 2026-10-14 当面裁的就是这
 * 一格的位置（原话「第4条，扣护甲前算」）——"+1"作用在进护甲之前那个数上，护甲出口
 * `core/armorDamage.ts` 一个字不改，仍然只消费它下游的结果。跨侧固定碰撞的赢家恒＝受方，
 * 靠的是**入算次序**（造方先、受方后），不是任何一处再判断一次。
 *
 * 一次读数的算术（增减累加／固定优先／一次性账最多销最早那一笔）**不在本文件**，
 * 与受方共用 `core/damageLedgerRun.ts` 那一份。本文件只多问两句：读哪一把钥匙、
 * 这一侧带场合的那几笔该怎么筛。
 *
 * ## 场合为什么是封闭枚举
 *
 * 怒斩的卡面原文（用户 2026-10-08 逐字给的）是「你进行决斗计算**或**近战攻击有护甲的角色时
 * 伤害+1」，而他 2026-10-08 稍晚又裁「决斗不算近战攻击，所以不存在+2」⇒ 两条腿各给一次 +1、
 * 结构性不同时成立。这一枚技能按用户 2026-10-14 的裁决挂在「在场即生效」那一型上（当面问的
 * 原话是"允不允许由这型被动去读造方伤害点"，他回「允许」）——而在场笔只在登场那一刻落一次账、
 * 之后全库没有中途重算的发射器（编译器 `PASSIVE_CONDITION_UNSUPPORTED` 就是那条纪律）。
 * 所以这两条腿**不能**写成门槛，只能让那一笔账自带"我在哪个时刻算数"，由读数点当场对表。
 * 枚举只有两枚，都不接任意谓词。
 *
 * ## 营地那一格刻意不接
 *
 * 打营地的那两路在**发射点**就被 `core/baseDamage.ts` 摁成"单次最多 1 点"，而营地不是任何
 * 一员将⇒账本的键（座次＋将领实例）结构上没有它那一笔（与用户 2026-10-03 裁"营地不吃
 * 受到伤害那一格"是同一条口径的两半）。⇒ 造成伤害修正今天**进不了营地那一格**，这条边界
 * 如实登记在 HANDOFF 本轮条里，不靠代码注释存活。
 */
import {
  type DamageDealtOccasion,
  type StatModifier,
  type StatModifierTarget,
} from './statModifiers';
import {
  resolveDamageLedgerRun,
  type DamageLedgerOutcome,
} from './damageLedgerRun';

/**
 * 读数点当场知道的那三格事实。三颗都由**调用点**给，绝不事后回头推断：
 *  - `inDuel`＝这一笔是决斗逐轮计算里打出来的；
 *  - `meleeAttack`＝这一笔是近战攻击（普攻且非远程）。**决斗里恒为 false**——那一句
 *    "决斗不算近战攻击"是用户裁的，落点就在下面的 `duelDealtContext` 里，不在别处；
 *  - `targetArmor`＝受方此刻的护甲点数，「有护甲」的判据＝**≥1**（用户 2026-10-08 裁）。
 */
export interface DamageDealtContext {
  inDuel: boolean;
  meleeAttack: boolean;
  targetArmor: number;
}

/** 普攻／远程攻击那一路：近战与否直接取发射点的 `ranged`（营地那一支不会走到这里）。 */
export function attackDealtContext(ranged: boolean, targetArmor: number): DamageDealtContext {
  return { inDuel: false, meleeAttack: !ranged, targetArmor };
}

/** 决斗逐轮那一路：吃 `duel`，而"近战"这一格在这里**永远是 false**（决斗不算近战攻击）。 */
export function duelDealtContext(targetArmor: number): DamageDealtContext {
  return { inDuel: true, meleeAttack: false, targetArmor };
}

/** 技能伤害那一路：既不是决斗也不是近战攻击⇒只有不带场合的那几笔算数。 */
export function skillDealtContext(targetArmor: number): DamageDealtContext {
  return { inDuel: false, meleeAttack: false, targetArmor };
}

/** 这一笔账的生效场合，在当下这个时刻算不算数。不带场合＝任何时候都算。 */
export function occasionHolds(occasion: DamageDealtOccasion, ctx: DamageDealtContext): boolean {
  if (occasion === 'duel') return ctx.inDuel;
  return ctx.meleeAttack && Number(ctx.targetArmor) >= 1;
}

const matchesOccasion = (ctx: DamageDealtContext) => (mod: StatModifier): boolean =>
  mod.occasion === undefined || occasionHolds(mod.occasion, ctx);

/**
 * 造方那一格的唯一读数：`attacker`＝**打出去的那一员将**（座次＋将领实例），
 * 不是被打通的那一位——这是它与 `resolveDamageTaken` 唯一的身份差别。
 */
export function resolveDamageDealt(
  ledger: readonly StatModifier[] | undefined,
  attacker: StatModifierTarget,
  rawDamage: number,
  ctx: DamageDealtContext,
): DamageLedgerOutcome {
  return resolveDamageLedgerRun(ledger, 'DAMAGE_DEALT', attacker, rawDamage, matchesOccasion(ctx));
}

/** 一条伤害事件里"谁打出去的"那两格（结算侧与派生侧读的是同一条事件的同一对键）。 */
export interface DamageSourceRef {
  sourcePlayerId?: number | null;
  sourceGeneralId?: string | number | null;
}

/**
 * **只有某一员将打出去的伤害才有造方这一格**：账本的键是（座次＋将领实例），解不出来源
 * ＝结构上没有它那一笔⇒返回 `null`，由调用点原样把 raw 交给下一格。这一句必须只有
 * 一个写法，因为结算侧（`damageEvents.ts` 现读）与派生侧（`chainedConsequences.ts` 复核
 * 销账清单）两处要算出**同一个**数——两处各猜各的，被用掉的那笔账就会一边销、一边没销。
 */
export function resolveDamageDealtFromSource(
  ledger: readonly StatModifier[] | undefined,
  source: DamageSourceRef | undefined,
  rawDamage: number,
  ctx: DamageDealtContext,
): DamageLedgerOutcome | null {
  const generalId = source?.sourceGeneralId;
  const playerId = source?.sourcePlayerId;
  if (generalId === undefined || generalId === null || typeof playerId !== 'number') return null;
  return resolveDamageDealt(ledger, { playerId, generalId: String(generalId) }, rawDamage, ctx);
}

/** 事件读数用的那一格：解不出来源＝不修正，但仍然把 raw 夹到 ≥0（与纯函数同一口径）。 */
export function dealtDamageOrRaw(
  ledger: readonly StatModifier[] | undefined,
  source: DamageSourceRef | undefined,
  rawDamage: number,
  ctx: DamageDealtContext,
): DamageLedgerOutcome {
  return resolveDamageDealtFromSource(ledger, source, rawDamage, ctx)
    ?? { damage: Math.max(0, Number(rawDamage) || 0), consumedIds: [] };
}
