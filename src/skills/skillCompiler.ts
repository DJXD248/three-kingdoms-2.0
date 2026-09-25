/**
 * Skill compiler — the single gateway from game data (data/generals.ts Skill
 * configurations, including DIY-edited skills) into the canonical runtime
 * model consumed by SkillTriggerBridge/TriggerEngine inside GameEngine.
 *
 * Convergence rules (Phase 5 skill uniqueness):
 *   - Only skills with a structured runtime effect payload are compiled.
 *     Built-in generals keep descriptive text only, so nothing fires until a
 *     designer attaches real numbers — the compiler never invents gameplay.
 *   - Only the event-backed triggers are supported; the remaining
 *     trigger kinds (modify*, onBase*, passive, active*, untilExpire, …) are
 *     skipped with an explicit reason. onTurnEnd (2.3.1) is the exception
 *     that proves the rule: it compiles, but NEVER auto-fires — TURN_END is
 *     deliberately absent from TRIGGER_EVENT_MAP, and its sole activation
 *     path is the canonical ACTIVATE_SKILL action (ask-window driven).
 *   - HEAL / GAIN_ARMOR settle in EventProcessor as hp restore (capped at
 *     maxHp) and armor points; DISCARD (2.5.0) settles as a hand-card move
 *     (resources to the discard pile, general cards back to the owner's
 *     pool); GIVE (2.5.3) settles as a deterministic hand-to-hand transfer and
 *     derives the CARD_LOST/CARD_GAINED notification events its new triggers
 *     listen to; EQUIP_STRIP (2.6.0) settles as a deterministic detach from a
 *     field general's armorCards (the project's only equipment surface) with
 *     one armor point deducted per detached card; effect types beyond the
 *     seven supported ones are still skipped rather than emitting no-op
 *     events.
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

/** Skill triggers that map 1:1 onto real engine events.
 * onBecomingTarget maps to BEFORE_DAMAGE (2.3.0): a pure notification emitted
 * by AttackResolver right before damage settlement — no new event type, no
 * state change. Base-targeted BEFORE_DAMAGE carries no targetPlayerId, so a
 * general skill legitimately never fires on base attacks. */
const SUPPORTED_TRIGGER_MAP: Partial<Record<SkillTriggerType, DataSkillTrigger>> = {
  onDeploy: 'onDeploy',
  onTurnStart: 'onTurnStart',
  onDamageTaken: 'onDamageTaken',
  onDamageDealt: 'onDamageDealt',
  onKill: 'onKill',
  onDeath: 'onDeath',
  onBecomingTarget: 'onBecomingTarget',
  // 2.5.3: card-loss/gain triggers ride on the CARD_LOST/CARD_GAINED
  // notification events derived by the GIVE settlement (first batch of
  // emission sources — see PROJECT_ARCH_MAP §F twelve-cell tables).
  onCardLost: 'onCardLost',
  onCardGained: 'onCardGained',
  // 2.3.1: compiles for the ACTIVATE_SKILL path only — deliberately NOT in
  // TRIGGER_EVENT_MAP, so TURN_END never auto-fires it (single activation
  // path, double-fire ban).
  onTurnEnd: 'onTurnEnd',
};

/** Effect types EventProcessor can actually settle today. */
const SUPPORTED_EFFECT_TYPES = new Set<DataSkillEffectType>([
  'DRAW_CARD',
  'DAMAGE',
  'HEAL',
  'GAIN_ARMOR',
  'DISCARD',
  'GIVE',
  'EQUIP_STRIP',
]);

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
    if ((mapped === 'onTurnStart' || mapped === 'onTurnEnd') && triggerConfig.turnSubType === 'otherTurn') {
      // The ask window only ever belongs to the current turn's owner, so an
      // otherTurn onTurnEnd has no honest activation path (2.3.1, same
      // discipline as the pre-existing onTurnStart guard).
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
      // ACTIVATE_SKILL addressing (2.3.1): id doubles as `<general>:<skill>:<effect>`,
      // these two fields let resolvers/UI read the parts without parsing.
      effectId: effect.id,
      turnSubType: (mapped === 'onTurnStart' || mapped === 'onTurnEnd')
        ? triggerConfig.turnSubType
        : undefined,
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
 * Registration is always re-derived from EngineState (never cached gameplay
 * state): the resident store container unregisters its previous owners and
 * calls this before every dispatch, which reproduces the fresh-engine
 * semantics of the rebuild path — a general that left the field cannot keep
 * triggering. Compiled, data-driven registration only — no gameplay rules
 * live here.
 *
 * Compile honesty (2.3.0, D-9 class C): skipped skill entries used to vanish
 * silently here (the 演練・回刺 onBecomingTarget case). They now land in an
 * out-of-band diagnostics channel — never the event stream, never state —
 * and each DISTINCT skipped entry earns exactly one aggregated console.warn
 * on first appearance. Dedup is per entry, not per engine and not per
 * skip-set: the battleRunner/reconcile paths mint a fresh engine per step and
 * the resident path resyncs per dispatch, so either coarser key would turn
 * field churn into log spam.
 */
export function syncPlayerSkills(engine: GameEngine, state: EngineState): number {
  let registered = 0;
  const skips: SkillSkip[] = [];
  for (const player of state.players) {
    const fieldGenerals = Array.isArray(player.fieldGenerals)
      ? (player.fieldGenerals as Array<Record<string, unknown>>)
      : [];
    for (const fg of fieldGenerals) {
      const general = fg?.general as General | undefined;
      if (!general || !Array.isArray(general.skills) || general.skills.length === 0) continue;
      const runtimeId = getRuntimeCardId(general as never) || general.id;
      const { definitions, skipped } = compileGeneralSkills(general, runtimeId);
      skips.push(...skipped);
      if (definitions.length === 0) continue;
      engine.registerPlayerSkills(player.id, definitions);
      registered += definitions.length;
    }
  }
  recordCompileSkips(engine, skips);
  return registered;
}

/**
 * Out-of-band view of the compile skips seen for an engine's latest skill
 * sync. Observation only (mirrors GameEngine.lastOverrideFailures, 2.2.23):
 * the editor/Excel input layer and tests consume this; the event stream
 * never carries it.
 */
export interface SkillCompileDiagnostics {
  skips: SkillSkip[];
  /** Aggregated distinct entries: `${skillName}|${effectId}|${reason}`. */
  signature: string;
}

const diagnosticsByEngine = new WeakMap<GameEngine, SkillCompileDiagnostics>();
const warnedEntries = new Set<string>();

function recordCompileSkips(engine: GameEngine, skips: SkillSkip[]): void {
  if (skips.length === 0) return;
  const distinct = [...new Set(
    skips.map(skip => `${skip.skillName}|${skip.effectId ?? ''}|${skip.reason}`),
  )].sort();
  diagnosticsByEngine.set(engine, { skips, signature: distinct.join(';') });
  const fresh = distinct.filter(entry => !warnedEntries.has(entry));
  if (fresh.length === 0) return;
  fresh.forEach(entry => warnedEntries.add(entry));
  console.warn(
    `[skillCompiler] ${fresh.length} skill effect(s) skipped at compile time — ` +
    fresh.map(entry => {
      const [skillName, effectId, reason] = entry.split('|');
      return `${skillName}${effectId ? `#${effectId}` : ''}: ${reason}`;
    }).join(', ') +
    '. Skipped skills never fire until the engine gains support for them.',
  );
}

export function getCompileDiagnostics(engine: GameEngine): SkillCompileDiagnostics | null {
  return diagnosticsByEngine.get(engine) ?? null;
}

/** Test seam: forget warned entries so dedup can be re-observed. */
export function __resetCompileWarnDedup(): void {
  warnedEntries.clear();
}
