
import type { SkillDataRegistry } from "../skills/SkillDataRegistry";

export class SkillImporter {
  constructor(private registry: SkillDataRegistry) {}

  import(data: any[]) {
    this.registry.import(data);
  }
}
