export function createReconnectToken(playerId: string) {
  return `${playerId}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
