import type { StatusEffect } from './types';
import { applyModifiers } from './Modifier';

export class StatusManager {
  private byPlayer = new Map<number, StatusEffect[]>();

  add(playerId: number, status: StatusEffect) {
    const current = this.byPlayer.get(playerId) ?? [];
    const index = current.findIndex(item => item.id === status.id);
    if (index >= 0) current[index] = structuredClone(status);
    else current.push(structuredClone(status));
    this.byPlayer.set(playerId, current);
  }

  remove(playerId: number, statusId: string) {
    this.byPlayer.set(
      playerId,
      (this.byPlayer.get(playerId) ?? []).filter(status => status.id !== statusId)
    );
  }

  getAll(playerId: number) {
    return [...(this.byPlayer.get(playerId) ?? [])];
  }

  modifyValue(playerId: number, stat: string, baseValue: number) {
    const modifiers = this.getAll(playerId)
      .flatMap(status => status.modifiers ?? [])
      .filter(modifier => modifier.stat === stat);
    return applyModifiers(baseValue, modifiers);
  }

  tick(playerId?: number) {
    const ids = playerId === undefined ? [...this.byPlayer.keys()] : [playerId];
    for (const id of ids) {
      const next = (this.byPlayer.get(id) ?? [])
        .map(status => status.duration == null ? status : { ...status, duration: status.duration - 1 })
        .filter(status => status.duration == null || status.duration > 0);
      this.byPlayer.set(id, next);
    }
  }
}
