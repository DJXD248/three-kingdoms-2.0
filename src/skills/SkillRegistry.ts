import type { SkillDefinition } from './types';

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition) {
    this.skills.set(skill.id, skill);
  }

  get(id: string) {
    return this.skills.get(id);
  }

  getAll() {
    return [...this.skills.values()];
  }
}
