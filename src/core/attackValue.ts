/**
 * Shared attack-power arithmetic (canonical home: core layer).
 *
 * Extracted from AttackResolver (same move `applyArmorDamage` made in 2.2.x)
 * so the melee attack power of a general has exactly ONE implementation.
 * The duel flow (2.8 刀9, ARCH_MAP §F "DUEL 决斗流程原语") reads each round's
 * damage through this function plus core/armorDamage.ts — a duel must never
 * carry its own copy of the damage math, or the two would drift apart the
 * moment the 攻击力增减 layer (#25/#26) lands and both sides have to pick it up
 * together.
 */
export function getAttackValue(attacker: any, ranged: boolean) {
  const explicit = ranged ? attacker?.rangedAtk : attacker?.meleeAtk;
  if (typeof explicit === 'number') return Math.max(0, explicit);
  const hp = Number(attacker?.maxHp ?? attacker?.general?.hp ?? 0);
  return ranged ? (hp >= 4 ? 1 : 2) : (hp >= 4 ? 2 : 1);
}
