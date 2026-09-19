
import type { DataSkillDefinition, SkillEffectData } from "./dataTypes";

export class EffectResolver {
  resolveEffect(
    effect: SkillEffectData,
    context: {
      sourceId: string;
      targetId?: string;
    }
  ) {
    return {
      type: effect.type,
      data: {
        sourceId: context.sourceId,
        targetId: context.targetId,
        value: effect.value ?? 0,
      },
    };
  }

  resolveSkill(
    skill: DataSkillDefinition,
    context: {
      sourceId: string;
      targetId?: string;
    }
  ) {
    return skill.effects.map(effect =>
      this.resolveEffect(effect, context)
    );
  }
}
