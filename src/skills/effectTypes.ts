
export type SkillEffectType =
  | "DRAW_CARD"
  | "DAMAGE"
  | "HEAL"
  | "GAIN_ARMOR";

export interface SkillEffectContext {
  sourceId: string;
  targetId?: string;
  value?: number;
}

export interface SkillEffectResult {
  type: SkillEffectType;
  context: SkillEffectContext;
}
