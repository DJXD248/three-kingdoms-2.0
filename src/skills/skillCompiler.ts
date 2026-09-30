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
 *   - effectMode 'choice' (2.6.3): effects sharing one trigger signature
 *     compile into a SINGLE choiceMode definition — the bridge translates it
 *     into CHOICE_REQUIRED with one option per effect and the player picks
 *     through the canonical CHOOSE_OPTION action. A choice skill whose
 *     runtime effects sit on different triggers degenerates honestly into
 *     independent definitions (nothing to choose between at one moment).
 *   - 门槛 (2.8.3, 刀 B; 2.8.11, 刀 2): per-effect `conditions` are passed
 *     straight through onto the compiled definition — the evaluator
 *     (skills/skillConditions.ts) and both consumers (SkillTriggerBridge /
 *     turnEndSkills) already existed since 2.7.3, so that cut added input
 *     surface, not gameplay. 刀 2 gives a choice group its two levels: the
 *     skill-level 整组门槛 lands on the definition's single conditions slot
 *     (evaluated before any option is built), and each effect carries its own
 *     逐项门槛 so the offer can grey out — with the reason visible — the
 *     branches that do not meet their gate (用户 2026-09-29 口径①/③).
 */

import type { General, Skill, SkillCondition, SkillEffect, SkillTriggerType } from '../data/generals';
import { supportsListenerScope } from '../data/generals';
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
  'REVEAL',
  'DECK_PLACE',
  'DUEL',
]);

export interface SkillSkip {
  skillName: string;
  effectId?: string;
  reason:
    | 'NO_TRIGGER'
    | 'TRIGGER_UNSUPPORTED'
    | 'TRIGGER_SUBTYPE_UNSUPPORTED'
    | 'NO_RUNTIME_PAYLOAD'
    | 'EFFECT_TYPE_UNSUPPORTED';
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
  dest?: 'TOP' | 'BOTTOM';
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
    dest: runtime.dest,
    // choice option label source (2.6.3) — display-only, never matched on.
    description: effect.description,
  };
}

/** v2.8.11 刀2：两级门槛并成一槽。求值本来就是 AND（全部成立才响），整组
 *  门槛排前面只影响可读顺序，不改变语义。两侧都空⇒undefined。 */
function mergeGates(
  groupGate: SkillCondition[] | undefined,
  effectGate: SkillCondition[] | undefined,
): SkillCondition[] | undefined {
  const out = [...(groupGate ?? []), ...(effectGate ?? [])];
  return out.length > 0 ? out : undefined;
}

/** One runtime effect that survived every gate, pre-grouping. */
interface CompiledEffect {
  effect: SkillEffect;
  data: SkillEffectData;
  mapped: DataSkillTrigger;
  damageTypeFilter?: DataSkillDefinition['damageTypeFilter'];
  cardFilter?: DataSkillDefinition['cardFilter'];
  turnSubType?: DataSkillDefinition['turnSubType'];
  targetSource?: DataSkillDefinition['targetSource'];
  listenerScope?: DataSkillDefinition['listenerScope'];
  /** v2.8.3 门槛：录在**这条效果**上，编译后成为该定义的 conditions。 */
  conditions?: SkillCondition[];
  /** Trigger identity used by the choice grouping (2.6.3): effects compiled
   * under one signature fire together, so they are choosable together. */
  signature: string;
}

/**
 * Compile one skill of one general instance into zero or more canonical
 * DataSkillDefinitions (one per independently-triggered runtime effect;
 * effectMode 'choice' groups same-trigger effects into one choiceMode
 * definition — 2.6.3).
 */
export function compileSkill(
  general: Pick<General, 'id' | 'name'>,
  skill: Skill,
  runtimeGeneralId?: string,
): CompileResult {
  const definitions: DataSkillDefinition[] = [];
  const skipped: SkillSkip[] = [];
  const ownerKey = runtimeGeneralId ?? general.id;

  const consider = (effect: SkillEffect | undefined, fallbackTrigger: Skill['trigger']): CompiledEffect | null => {
    // A skill without effect entries can never carry structured payloads.
    if (!effect) {
      skipped.push({ skillName: skill.name, reason: 'NO_RUNTIME_PAYLOAD' });
      return null;
    }

    const triggerConfig = effect?.trigger ?? fallbackTrigger ?? skill.trigger;
    if (!triggerConfig?.type) {
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'NO_TRIGGER' });
      return null;
    }

    const mapped = SUPPORTED_TRIGGER_MAP[triggerConfig.type];
    if (!mapped) {
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_UNSUPPORTED' });
      return null;
    }

    let damageTypeFilter: DataSkillDefinition['damageTypeFilter'];
    if ((mapped === 'onTurnStart' || mapped === 'onTurnEnd') && triggerConfig.turnSubType === 'otherTurn') {
      // The ask window only ever belongs to the current turn's owner, so an
      // otherTurn onTurnEnd has no honest activation path (2.3.1, same
      // discipline as the pre-existing onTurnStart guard).
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
      return null;
    }
    if (mapped === 'onKill' && triggerConfig.killSubType === 'killAlly') {
      // The engine only emits DEATH for enemy kills — never fires; skip honestly.
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
      return null;
    }
    if ((mapped === 'onDamageTaken' || mapped === 'onDamageDealt') && triggerConfig.damageSubType) {
      if (triggerConfig.damageSubType === 'attackDamage') damageTypeFilter = 'attack';
      else if (triggerConfig.damageSubType === 'skillDamage') damageTypeFilter = 'skill';
    }
    // v2.8.21 监听扩面刀·来源档：只有「成为目标时」这一型有这一维。**缺省不写＝
    // 'attack'**（扩面前 label 写死的就是"成为攻击目标时"，官方四条与 DIY 夹具
    // 那条的描述也都这么写）⇒ 这一维今日不扩响、不动两个锚池。
    let targetSource: DataSkillDefinition['targetSource'];
    if (mapped === 'onBecomingTarget') {
      const sub = triggerConfig.targetSubType;
      targetSource = sub === 'skillTarget' ? 'skill' : sub === 'anyTarget' ? 'any' : 'attack';
    }
    // v2.8.21 监听扩面刀·「我听谁」：缺省不写＝'self'＝扩面前逐字行为。
    // 只在触发型自认支持这一维时才带上（录入面认不出的组合由 Excel 侧点名，
    // 编译器这一侧绝不把"听场上"悄悄塞进一个听不懂的时机）。
    let listenerScope: DataSkillDefinition['listenerScope'];
    if (triggerConfig.listenerScope && supportsListenerScope(triggerConfig.type)) {
      listenerScope = triggerConfig.listenerScope;
    }
    // v2.6.2 card-trigger predicates (连营/枭姬 keys): 'anyLost' and an
    // absent sub-type stay the pre-expansion any-source behavior (undefined
    // filter). A sub-type that contradicts its trigger direction, or a
    // gained-side predicate with no emission source yet (only GIVE derives
    // CARD_GAINED), skips honestly rather than silently never-firing.
    let cardFilter: DataSkillDefinition['cardFilter'];
    if (mapped === 'onCardLost' || mapped === 'onCardGained') {
      const cardSub = triggerConfig.cardSubType;
      const lostOnly = cardSub === 'equipmentLost' || cardSub === 'lastHandLost' || cardSub === 'handLost';
      if (cardSub === 'anyGained' && mapped === 'onCardLost') {
        skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
        return null;
      }
      if (lostOnly && mapped === 'onCardGained') {
        skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
        return null;
      }
      if (mapped === 'onCardLost') {
        if (cardSub === 'equipmentLost') cardFilter = 'equipment';
        else if (cardSub === 'lastHandLost') cardFilter = 'lastHand';
        else if (cardSub === 'handLost') cardFilter = 'hand';
      }
    }

    const converted = toEffectData(effect);
    if (!converted) {
      skipped.push({ skillName: skill.name, effectId: effect.id, reason: 'NO_RUNTIME_PAYLOAD' });
      return null;
    }
    if ('reason' in converted) {
      converted.skillName = skill.name;
      skipped.push(converted);
      return null;
    }

    const turnSubType = (mapped === 'onTurnStart' || mapped === 'onTurnEnd')
      ? triggerConfig.turnSubType
      : undefined;
    return {
      effect,
      data: converted,
      mapped,
      damageTypeFilter,
      cardFilter,
      turnSubType,
      targetSource,
      listenerScope,
      conditions: effect.conditions && effect.conditions.length > 0 ? effect.conditions : undefined,
      signature: `${mapped}|${damageTypeFilter ?? ''}|${cardFilter ?? ''}|${turnSubType ?? ''}|${targetSource ?? ''}|${listenerScope ?? ''}`,
    };
  };

  const singleDefinition = (c: CompiledEffect): DataSkillDefinition => ({
    id: `${ownerKey}:${skill.name}:${c.effect.id}`,
    name: skill.name,
    trigger: c.mapped,
    description: c.effect.description ?? skill.description ?? '',
    effects: [c.data],
    sourceGeneralId: runtimeGeneralId,
    damageTypeFilter: c.damageTypeFilter,
    cardFilter: c.cardFilter,
    targetSource: c.targetSource,
    listenerScope: c.listenerScope,
    // ACTIVATE_SKILL addressing (2.3.1): id doubles as `<general>:<skill>:<effect>`,
    // these two fields let resolvers/UI read the parts without parsing.
    effectId: c.effect.id,
    turnSubType: c.turnSubType,
    // v2.8.11 刀2：单效果定义把两级门槛并成一槽（AND 语义，整组在前）。
    // 两侧都空⇒undefined，v2.8.10 之前的输出逐字不变。
    conditions: mergeGates(skill.conditions, c.conditions),
  });

  const candidates: CompiledEffect[] = [];
  if (skill.effects && skill.effects.length > 0) {
    for (const effect of skill.effects) {
      const compiled = consider(effect, skill.trigger);
      if (compiled) candidates.push(compiled);
    }
  } else {
    consider(undefined, skill.trigger);
  }

  if (skill.effectMode === 'choice' && candidates.length >= 2) {
    // Group by trigger signature: effects that fire at the SAME moment are
    // one choice ("select one"); an isolated effect has nothing to choose
    // against and compiles exactly as before (id shape included).
    const groups = new Map<string, CompiledEffect[]>();
    for (const c of candidates) {
      const group = groups.get(c.signature);
      if (group) group.push(c);
      else groups.set(c.signature, [c]);
    }
    for (const group of groups.values()) {
      if (group.length === 1) {
        definitions.push(singleDefinition(group[0]));
        continue;
      }
      definitions.push({
        id: `${ownerKey}:${skill.name}:choice`,
        name: skill.name,
        trigger: group[0].mapped,
        description: skill.description ?? '',
        // v2.8.11 刀2：逐项门槛随各自的效果数据走（抉择窗逐选项求值），
        // 整组门槛走定义级 conditions 槽（桥接层身份判定之后、造事件之前）。
        // 无门槛的选择组一字未变：conditions 两侧都是 undefined。
        effects: group.map(c => (c.conditions ? { ...c.data, conditions: c.conditions } : c.data)),
        sourceGeneralId: runtimeGeneralId,
        damageTypeFilter: group[0].damageTypeFilter,
        cardFilter: group[0].cardFilter,
        targetSource: group[0].targetSource,
        listenerScope: group[0].listenerScope,
        turnSubType: group[0].turnSubType,
        choiceMode: true,
        conditions: skill.conditions?.length ? skill.conditions : undefined,
      });
    }
  } else {
    for (const c of candidates) definitions.push(singleDefinition(c));
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
