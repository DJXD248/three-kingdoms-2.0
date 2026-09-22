/**
 * Canonical skill system barrel (Phase 5 uniqueness convergence).
 *
 * One runtime pipeline only:
 *   data (Skill + runtime payload) → skillCompiler → DataSkillDefinition
 *   → SkillTriggerBridge → TriggerEngine → GameEngine events → EventProcessor
 *
 * The former parallel stacks (imperative SkillEngine/SkillRegistry/
 * EffectResolver and the hardcoded data/skillEffects registry) were removed
 * after a zero-reference re-audit. Importing arbitrary runtime code as a
 * skill is not supported by design.
 */
export * from './dataTypes';
export * from './SkillTriggerBridge';
export * from './SkillDataRegistry';
export * from './skillCompiler';
