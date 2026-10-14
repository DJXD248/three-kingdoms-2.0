/**
 * Pure-computation attack preview — mirrors damagePhase() arithmetic
 * without emitting any events or mutating state.
 *
 * Used by the render layer to predict "what would happen if I attack X"
 * before the player clicks to commit.
 */
import { applyArmorDamage } from './armorDamage';
import { resolveDamageTaken } from './damageTaken';
import { attackDealtContext, resolveDamageDealt } from './damageDealt';
import type { StatModifier, StatModifierTarget } from './statModifiers';

export interface AttackPrediction {
  /** Base damage read from attacker's ATK at aim time. */
  baseDamage: number;
  /** Damage after DAMAGE_TAKEN ledger modifications (before armor). */
  takenDamage: number;
  /** HP lost to actual damage points. */
  hpLost: number;
  /** Armor points destroyed. */
  armorLost: number;
  /** Resulting HP (clamped ≥ 0). */
  newHp: number;
  /** Resulting armor points remaining. */
  newArmor: number;
  /** Source current HP (for preview display). */
  currentHp?: number;
  /** Source max HP (for preview display). */
  maxHp?: number;
  /** Is base target (no armor). */
  isBase?: true;
}

/**
 * 预览＝引擎那一刀的**同一段算术**（`damageLedgerRun` 那一份，两条腿同一顺序：
 * 造成伤害→受到伤害→护甲）。攻方那一员将必须进来：没有攻方键＝造方那一格压根没得读，
 * 于是"平A预览显示 2 点、点下去结算 3 点"这种分叉就从这里长出来（§12 那族"两处各算一遍"）。
 */
export function predictAttack(
  baseDamage: number,
  currentHp: number,
  currentArmor: number,
  statModifiers: readonly StatModifier[] | undefined,
  targetPlayerId: number,
  targetGeneralId: string,
  maxHp: number | undefined,
  attacker: StatModifierTarget,
  ranged: boolean,
): AttackPrediction {
  const dealt = resolveDamageDealt(
    statModifiers,
    attacker,
    baseDamage,
    attackDealtContext(ranged, currentArmor),
  );
  const taken = resolveDamageTaken(statModifiers, { playerId: targetPlayerId, generalId: targetGeneralId }, dealt.damage);
  const armorResult = applyArmorDamage(Math.max(0, currentHp), Math.max(0, currentArmor), taken.damage);
  return {
    baseDamage,
    takenDamage: taken.damage,
    hpLost: armorResult.hpLost,
    armorLost: armorResult.armorLost,
    newHp: armorResult.hp,
    newArmor: armorResult.armor,
    currentHp,
    maxHp: maxHp ?? currentHp,
  };
}

export function predictBaseAttack(baseDamage: number): AttackPrediction & { isBase: true } {
  return {
    baseDamage,
    takenDamage: baseDamage,
    hpLost: baseDamage,
    armorLost: 0,
    newHp: 0, // placeholder — base doesn't have meaningful HP here
    newArmor: 0,
    isBase: true,
  };
}
