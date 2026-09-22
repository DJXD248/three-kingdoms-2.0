/**
 * Shared armor-damage arithmetic (canonical home: core layer).
 *
 * Extracted from AttackResolver so that both attack resolution and
 * skill-triggered damage events apply the exact same rule:
 * 2 armor absorbs 1 damage; a single armor stays in place.
 */
export function applyArmorDamage(currentHp: number, currentArmor: number, rawDamage: number) {
  let remainingDamage = Math.max(0, rawDamage);
  let armor = Math.max(0, currentArmor);
  let armorLost = 0;

  // Existing game rule: 2 armor absorbs 1 damage; a single armor is insufficient
  // to absorb a damage point and therefore remains in place until enough armor exists.
  while (remainingDamage > 0 && armor >= 2) {
    armor -= 2;
    armorLost += 2;
    remainingDamage -= 1;
  }

  const hpLost = Math.min(Math.max(0, currentHp), remainingDamage);
  return {
    hp: Math.max(0, currentHp - remainingDamage),
    armor,
    hpLost,
    armorLost,
    actualDamage: hpLost + armorLost,
  };
}
