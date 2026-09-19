export type AttackMode = "MELEE" | "RANGED";

export interface AttackProfile {
  meleeAttack: number;
  rangedAttack: number;
}

export function getAttackValue(profile: AttackProfile, mode: AttackMode) {
  return mode === "MELEE" ? profile.meleeAttack : profile.rangedAttack;
}

export function canUseRangedAttack(
  attackerRegion: "CAMP" | "FRONTLINE" | "BATTLEFIELD",
  targetRegion: "CAMP" | "FRONTLINE" | "BATTLEFIELD"
) {
  if (attackerRegion === "CAMP") return targetRegion === "BATTLEFIELD";
  if (attackerRegion === "FRONTLINE") return targetRegion === "FRONTLINE";
  return targetRegion === "CAMP";
}
