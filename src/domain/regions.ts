export type RegionKind = "CAMP" | "FRONTLINE" | "BATTLEFIELD";

export function canEnterRegion(
  region: RegionKind,
  controllerId: string,
  occupantPlayerId?: string
) {
  if (region === "BATTLEFIELD" || region === "CAMP") return true;
  return !occupantPlayerId || occupantPlayerId === controllerId;
}
