
import type { DataSkillDefinition } from './dataTypes';

export class SkillDataRegistry {
  private skills = new Map<string, DataSkillDefinition>();

  register(skill: DataSkillDefinition) {
    this.skills.set(skill.id, skill);
  }

  get(id: string) {
    return this.skills.get(id);
  }

  getAll() {
    return Array.from(this.skills.values());
  }

  import(skills: DataSkillDefinition[]) {
    skills.forEach(skill => this.register(skill));
  }
}
