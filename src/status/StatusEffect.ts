import type { StatusEffect as StatusEffectData } from './types';

export class StatusEffectManager {
  private statuses = new Map<string, StatusEffectData>();

  add(status: StatusEffectData) {
    this.statuses.set(status.id, structuredClone(status));
  }

  remove(id: string) {
    this.statuses.delete(id);
  }

  get(id: string) {
    return this.statuses.get(id);
  }

  getAll() {
    return [...this.statuses.values()];
  }

  tick() {
    for (const status of this.statuses.values()) {
      if (status.duration == null) continue;
      status.duration -= 1;
      if (status.duration <= 0) this.statuses.delete(status.id);
    }
  }
}
