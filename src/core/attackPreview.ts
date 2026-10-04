/**
 * Pure-computation attack preview — mirrors damagePhase() arithmetic
 * without emitting any events or mutating state.
 *
 * Used by the render layer to predict "what would happen if I attack X"
 * before the player clicks to commit.
 */
import { applyArmorDamage } from './armorDamage';
import { resolveDamageTaken } from './damageTaken';

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

export function predictAttack(
  baseDamage: number,
  currentHp: number,
  currentArmor: number,
  statModifiers: readonly import('./statModifiers').StatModifier[] | undefined,
  targetPlayerId: number,
  targetGeneralId: string,
  maxHp?: number,
): AttackPrediction {
  const taken = resolveDamageTaken(statModifiers, { playerId: targetPlayerId, generalId: targetGeneralId }, baseDamage);
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
