/**
 * Skill compiler — the single gateway from game data (data/generals.ts Skill
 * configurations, including DIY-edited skills) into the canonical runtime
 * model consumed by SkillTriggerBridge/TriggerEngine inside GameEngine.
 *
 * Convergence rules (Phase 5 skill uniqueness):
 *   - Only skills with a structured runtime effect payload are compiled.
 *     Built-in generals keep descriptive text only, so nothing fires until a
 *     designer attaches real numbers — the compiler never invents gameplay.
 *   - Only the six event-backed triggers are supported; the remaining trigger
 *     kinds (modify*, onBase*, passive, active*, untilExpire, …) are skipped
 *     with an explicit reason.
 *   - HEAL / GAIN_ARMOR effects have no state handler in EventProcessor yet
 *     and are skipped rather than emitting no-op events.
 *   - effectMode 'choice' needs the (not yet wired) ReactionWindow prompt and
 *     is skipped.
 */

import type { General, Skill, SkillEffect, SkillTriggerType } from '../data/generals';
import type {
  DataSkillDefinition,
  DataSkillEffectType,
  DataSkillTrigger,
  SkillEffectData,
} from './dataTypes';
import type { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import { getRuntimeCardId } from '../utils/runtimeIdentity';

/** Skill triggers that map 1:1 onto real engine events. */
const SUPPORTED_TRIGGER_MAP: Partial<Record<SkillTriggerType, DataSkillTrigger>> = {
  onDeploy: 'onDeploy',
  onTurnStart: 'onTurnStart',
  onDamageTaken: 'onDamageTaken',
  onDamageDealt: 'onDamageDealt',
  onKill: 'onKill',
  onDeath: 'onDeath',
};

/** Effect types EventProcessor can actually settle today. */
const SUPPORTED_EFFECT_TYPES = new Set<DataSkillEffectType>(['DRAW_CARD', 'DAMAGE']);

export interface SkillSkip {
  skillName: string;
  effectId?: string;
  reason:
    | 'NO_TRIGGER'
    | 'TRIGGER_UNSUPPORTED'
    | 'TRIGGER_SUBTYPE_UNSUPPORTED'
    | 'NO_RUNTIME_PAYLOAD'
    | 'EFFECT_TYPE_UNSUPPORTED'
    | 'CHOICE_MODE_UNSUPPORTED';
}

export interface CompileResult {
  definitions: DataSkillDefinition[];
  skipped: SkillSkip[];
}

/** Structured payload attached to a data-model effect by designers/DIY. */
export interface RuntimeEffectPayload {
  type: DataSkillEffectType;
  value?: number;
  target?: 'SELF' | 'ATTACKER' | 'TARGET';
}

function toEffectData(effect: SkillEffect): SkillEffectData | SkillSkip | null {
  const runtime = effect.runtime;
  if (!runtime) return null;
  if (!SUPPORTED_EFFECT_TYPES.has(runtime.type)) {
    return {
      skillName: effect.id,
      effectId: effect.id,
      reason: 'EFFECT_TYPE_UNSUPPORTED',
    };
  }
  return {
    type: runtime.type,
    value: runtime.value,
    target: runtime.target ?? 'TARGET',
  };
}

/**
 * Compile one skill of one general instance into zero or more canonical
 * DataSkillDefinitions (one per independently-triggered runtime effect).
 */
export function compileSkill(
  general: Pick<General, 'id' | 'name'>,
  skill: Skill,
  runtimeGeneralId?: string,
): CompileResult {
  const definitions: DataSkillDefinition[] = [];
  const skipped: SkillSkip[] = [];
  const ownerKey = runtimeGeneralId ?? general.id;

  const consider = (effect: SkillEffect | undefined, fallbackTrigger: Skill['trigger']) => {
    // A skill without effect entries can never carry structured payloads.
    if (!effect) {
      skipped.push({ skillName: skill.name, reason: 'NO_RUNTIME_PAYLOAD' });
      return;
    }

    const triggerConfig = effect?.trigger ?? fallbackTrigger ?? skill.trigger;
    if (!triggerConfig?.type) {
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'NO_TRIGGER' });
      return;
    }
    if (skill.effectMode === 'choice') {
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'CHOICE_MODE_UNSUPPORTED' });
      return;
    }

    const mapped = SUPPORTED_TRIGGER_MAP[triggerConfig.type];
    if (!mapped) {
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_UNSUPPORTED' });
      return;
    }

    let damageTypeFilter: DataSkillDefinition['damageTypeFilter'];
    if (mapped === 'onTurnStart' && triggerConfig.turnSubType === 'otherTurn') {
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
      return;
    }
    if (mapped === 'onKill' && triggerConfig.killSubType === 'killAlly') {
      // The engine only emits DEATH for enemy kills — never fires; skip honestly.
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
      return;
    }
    if ((mapped === 'onDamageTaken' || mapped === 'onDamageDealt') && triggerConfig.damageSubType) {
      if (triggerConfig.damageSubType === 'attackDamage') damageTypeFilter = 'attack';
      else if (triggerConfig.damageSubType === 'skillDamage') damageTypeFilter = 'skill';
    }

    const converted = toEffectData(effect);
    if (!converted) {
      skipped.push({ skillName: skill.name, effectId: effect.id, reason: 'NO_RUNTIME_PAYLOAD' });
      return;
    }
    if ('reason' in converted) {
      converted.skillName = skill.name;
      skipped.push(converted);
      return;
    }

    definitions.push({
      id: `${ownerKey}:${skill.name}:${effect.id}`,
      name: skill.name,
      trigger: mapped,
      description: effect.description ?? skill.description ?? '',
      effects: [converted],
      sourceGeneralId: runtimeGeneralId,
      damageTypeFilter,
    });
  };

  if (skill.effects && skill.effects.length > 0) {
    for (const effect of skill.effects) consider(effect, skill.trigger);
  } else {
    consider(undefined, skill.trigger);
  }

  return { definitions, skipped };
}

/** Compile every runtime-executable skill of a general instance. */
export function compileGeneralSkills(
  general: General,
  runtimeGeneralId?: string,
): CompileResult {
  const definitions: DataSkillDefinition[] = [];
  const skipped: SkillSkip[] = [];
  for (const skill of general.skills ?? []) {
    const result = compileSkill(general, skill, runtimeGeneralId);
    definitions.push(...result.definitions);
    skipped.push(...result.skipped);
  }
  return { definitions, skipped };
}

/**
 * Register the skills of all field generals of every player into the engine.
 *
 * The store builds a fresh GameEngine per dispatch (state is the single
 * source of truth), so registration is re-derived from EngineState on every
 * dispatch instead of being kept in a long-lived registry. Compiled,
 * data-driven registration only — no gameplay rules live here.
 */
export function syncPlayerSkills(engine: GameEngine, state: EngineState): number {
  let registered = 0;
  for (const player of state.players) {
    const fieldGenerals = Array.isArray(player.fieldGenerals)
      ? (player.fieldGenerals as Array<Record<string, unknown>>)
      : [];
    for (const fg of fieldGenerals) {
      const general = fg?.general as General | undefined;
      if (!general || !Array.isArray(general.skills) || general.skills.length === 0) continue;
      const runtimeId = getRuntimeCardId(general as never) || general.id;
      const { definitions } = compileGeneralSkills(general, runtimeId);
      if (definitions.length === 0) continue;
      engine.registerPlayerSkills(player.id, definitions);
      registered += definitions.length;
    }
  }
  return registered;
}
