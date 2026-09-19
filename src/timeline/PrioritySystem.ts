export interface PriorityParticipant {
  playerId: number;
  passed: boolean;
}

export class PrioritySystem {
  private passes = new Map<number, boolean>();

  reset(players: number[]) {
    this.passes.clear();
    players.forEach(id => this.passes.set(id, false));
  }

  pass(playerId: number) {
    this.passes.set(playerId, true);
  }

  revoke(playerId: number) {
    this.passes.set(playerId, false);
  }

  allPassed(players: number[]) {
    return players.length > 0 && players.every(id => this.passes.get(id) === true);
  }

  hasPassed(playerId: number) {
    return this.passes.get(playerId) === true;
  }
}
