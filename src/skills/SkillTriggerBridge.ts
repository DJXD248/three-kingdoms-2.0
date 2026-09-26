
import type { DataSkillDefinition, DataSkillTrigger, SkillEffectData } from './dataTypes';
import type { EngineState, PendingChoiceOption } from '../core/GameState';
import type { GameEvent, GameEventType } from '../core/Event';
import type { TriggerEngine } from '../triggers/TriggerEngine';
import type { TriggerContext } from '../triggers/types';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { evaluateSkillConditions } from './skillConditions';
import {
  enumerateHandCardCandidates,
  enumerateTargetCandidates,
  type ChoiceCandidate,
} from './choiceCandidates';

const TRIGGER_EVENT_MAP: Partial<Record<DataSkillTrigger, GameEventType>> = {
  onDeploy: 'GENERAL_DEPLOYED',
  onTurnStart: 'TURN_START',
  onDamageTaken: 'DAMAGE',
  onDamageDealt: 'AFTER_DAMAGE',
  onKill: 'DEATH',
  onDeath: 'DEATH',
  // 2.3.0: BEFORE_DAMAGE is a pure notification (no EventProcessor case, no
  // state change) emitted by AttackResolver right before damage settlement.
  // Derived effects queue at the trigger-chain tail, so a counter hit from
  // this trigger settles AFTER the source DAMAGE within one dispatch —
  // frozen semantics, see PROJECT_ARCH_MAP "Trigger 契约表".
  onBecomingTarget: 'BEFORE_DAMAGE',
  // 2.5.3: card-loss/gain triggers listen to the pure notification events
  // derived by the GIVE settlement (chainedConsequences). CARD_* carries no
  // EventProcessor case and changes no state by itself — same "pure
  // notification in the map" shape as BEFORE_DAMAGE (2.3.0).
  onCardLost: 'CARD_LOST',
  onCardGained: 'CARD_GAINED'
  // onTurnEnd is DELIBERATELY absent (2.3.1, single-activation-path /
  // double-fire ban): TURN_END must never auto-fire the skill. Its only
  // activation path is the canonical ACTIVATE_SKILL action → the resolver,
  // which reuses the static createSkillEvents below — the same
  // effect-translation code, never a second one.
};

const PRIORITY: Partial<Record<DataSkillTrigger, number>> = {
  onDeploy: 100,
  onTurnStart: 50,
  onDamageTaken: 50,
  onDamageDealt: 50,
  onKill: 60,
  onDeath: 100,
  onBecomingTarget: 50,
  onCardLost: 50,
  onCardGained: 50
};

export interface SkillOwnerBinding {
  ownerId: number | string;
  skill: DataSkillDefinition;
  enabled?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function idEq(ownerId: number | string, candidate: unknown): boolean {
  return candidate !== undefined && candidate !== null && String(candidate) === String(ownerId);
}

/**
 * Condition per trigger so a skill only reacts to events involving its owner
 * (and, when known, its owning general instance). Without this, every DAMAGE
 * event on the table would fire every registered skill.
 */
function buildCondition(
  trigger: DataSkillTrigger,
  binding: SkillOwnerBinding
): (context: TriggerContext) => boolean {
  const { ownerId, skill } = binding;
  const generalId = skill.sourceGeneralId;
  const damageFilter = skill.damageTypeFilter;

  const identityCheck = (context: TriggerContext): boolean => {
    const data = asRecord(context.event.data);
    switch (trigger) {
      case 'onTurnStart':
        return idEq(ownerId, data.playerId);
      case 'onDeploy': {
        if (!idEq(ownerId, data.playerId)) return false;
        if (generalId) {
          const deployedId = data.general && typeof data.general === 'object'
            ? getRuntimeCardId(data.general as never)
            : data.general === undefined ? '' : String(data.general);
          if (deployedId && deployedId !== String(generalId)) return false;
        }
        return true;
      }
      case 'onDamageTaken': {
        if (!idEq(ownerId, data.targetPlayerId)) return false;
        if (generalId && !idEq(generalId, data.targetId ?? data.target)) return false;
        if (damageFilter && data.damageType !== damageFilter) return false;
        return true;
      }
      case 'onDamageDealt': {
        const action = asRecord(data.action);
        if (!idEq(ownerId, action.playerId)) return false;
        if (generalId) {
          const payload = asRecord(action.payload);
          if (!idEq(generalId, payload.attackerId ?? action.attackerId)) return false;
        }
        // AFTER_DAMAGE is currently emitted only by attack resolution, so a
        // skill-damage filter can never match here (documented engine fact).
        if (damageFilter === 'skill') return false;
        if (damageFilter === 'attack' && data.damageType !== undefined && data.damageType !== 'attack') return false;
        return true;
      }
      case 'onKill': {
        if (!idEq(ownerId, data.attackerPlayerId)) return false;
        if (generalId && !idEq(generalId, data.attackerId)) return false;
        return true;
      }
      case 'onDeath': {
        if (!idEq(ownerId, data.targetPlayerId)) return false;
        if (generalId && !idEq(generalId, data.targetId)) return false;
        return true;
      }
      case 'onBecomingTarget': {
        // BEFORE_DAMAGE for a base attack carries no targetPlayerId, so the
        // owner check below legitimately never matches — being attacked as a
        // base is not "a general becoming a target".
        if (!idEq(ownerId, data.targetPlayerId)) return false;
        if (generalId && !idEq(generalId, data.targetId ?? data.target)) return false;
        return true;
      }
      case 'onCardLost':
      case 'onCardGained': {
        // Hands live on players, not general instances (same keying lesson
        // as DISCARD, 2.5.0): CARD_* keys the losing/gaining PLAYER only.
        // sourceGeneralId never narrows these triggers.
        if (!idEq(ownerId, data.playerId)) return false;
        if (trigger === 'onCardLost' && skill.cardFilter && skill.cardFilter !== 'any') {
          // v2.6.2 emission-source predicates. The via/remainingHand facts
          // are recorded by the derivation itself (chainedConsequences), so
          // the condition reads settled truth rather than re-deriving it.
          const via = typeof data.via === 'string' ? data.via : '';
          if (skill.cardFilter === 'equipment') return via === 'EQUIP';
          if (!via || via === 'EQUIP') return false;
          if (skill.cardFilter === 'lastHand') {
            return typeof data.remainingHand === 'number' && data.remainingHand === 0;
          }
        }
        return true;
      }
      default:
        return false;
    }
  };

  // v2.7.3 gate conditions ride AFTER identity (先身份、再门槛). Pure predicate
  // over already-recorded facts, fail-closed, emits nothing by itself.
  return (context) => identityCheck(context) && evaluateSkillConditions(skill.conditions, {
    state: context.state,
    ownerId,
    sourceGeneralId: generalId,
    event: context.event,
  });
}

/**
 * Adapts data-driven skills into the Phase 5.24 TriggerEngine.
 * This is intentionally a bridge: imported skill data remains data,
 * while runtime ownership and trigger registration live in the engine.
 *
 * Effects are translated into canonical engine events:
 *   DRAW_CARD   → DRAW         { playerId, count }        (deck selection in EventProcessor)
 *   DAMAGE      → DAMAGE       { damageType: 'skill' }    (armor settlement in EventProcessor)
 *   HEAL        → HEAL         { targetPlayerId, targetId, value } (hp capped at maxHp)
 *   GAIN_ARMOR  → GAIN_ARMOR   { targetPlayerId, targetId, value } (armor points, no cards)
 *   DISCARD     → DISCARD      { playerId, count }        (2.5.0, hand move in EventProcessor;
 *                               count 0 = whole-hand sentinel; since 2.6.2 its settlement
 *                               derives CARD_LOST via='DISCARD' with remainingHand)
 *   GIVE        → GIVE         { fromPlayerId, toPlayerId, count } (2.5.3, hand-to-hand
 *                               transfer in EventProcessor; settlement derives the
 *                               CARD_LOST/CARD_GAINED notifications)
 *   EQUIP_STRIP → EQUIP_STRIP  { targetPlayerId, targetId, count } (2.6.0, general-keyed
 *                               armor-card strip in EventProcessor; since 2.6.2 its
 *                               settlement derives CARD_LOST via='EQUIP')
 *   REVEAL      → REVEAL       { viewerPlayerId, count } (2.6.1, pure observation —
 *                               settlement returns state unchanged, zero rngState)
 *   DECK_PLACE  → DECK_PLACE   { playerId, dest, count } (2.6.1, hand→deck mirror of GIVE;
 *                               dest defaults to BOTTOM, head-of-hand deterministic slice)
 */
export class SkillTriggerBridge {
  private registrations = new Map<string, string[]>();

  constructor(private readonly triggerEngine: TriggerEngine) {}

  registerSkill(binding: SkillOwnerBinding) {
    const eventType = TRIGGER_EVENT_MAP[binding.skill.trigger];
    if (!eventType) return [];

    const triggerId = `skill:${binding.ownerId}:${binding.skill.id}`;
    const unregister = this.triggerEngine.register({
      id: triggerId,
      eventType,
      priority: PRIORITY[binding.skill.trigger] ?? 0,
      enabled: binding.enabled !== false,
      ownerId: binding.ownerId,
      skillId: binding.skill.id,
      condition: buildCondition(binding.skill.trigger, binding),
      createEvents: (context) =>
        SkillTriggerBridge.createSkillEvents(binding, context.state, context.event)
    });

    const ownerKey = String(binding.ownerId);
    const ids = this.registrations.get(ownerKey) ?? [];
    ids.push(triggerId);
    this.registrations.set(ownerKey, ids);

    return [unregister];
  }

  registerSkills(ownerId: number | string, skills: DataSkillDefinition[]) {
    const unregisters: Array<() => void> = [];
    for (const skill of skills) {
      unregisters.push(...this.registerSkill({ ownerId, skill }));
    }
    return unregisters;
  }

  unregisterOwner(ownerId: number | string) {
    this.triggerEngine.unregisterByOwner(ownerId);
    this.registrations.delete(String(ownerId));
  }

  setSkillEnabled(ownerId: number | string, skillId: string, enabled: boolean) {
    return this.triggerEngine.setEnabled(
      `skill:${ownerId}:${skillId}`,
      enabled
    );
  }

  /** Effect translation — instance-free on purpose (2.3.1): the trigger path
   * and the explicit ACTIVATE_SKILL path must share ONE code, so this is a
   * static and TurnEndSkillResolver calls it directly rather than keeping a
   * second copy of the DRAW/DAMAGE/HEAL/GAIN_ARMOR translation.
   *
   * choiceMode (2.6.3): instead of one event per effect, a single
   * CHOICE_REQUIRED offer is emitted whose options are the SAME translated
   * events, one branch each — the player picks with CHOOSE_OPTION and the
   * chosen branch settles then ("延后结算时点=决策时点"). Deterministic by
   * construction: label + branch events are derived from state at trigger
   * time, zero RNG, and the choiceKey is composed like the rw: ids. */
  static createSkillEvents(
    binding: SkillOwnerBinding,
    state: EngineState,
    event: GameEvent
  ): GameEvent[] {
    const sourceId = String(binding.ownerId);

    const translateEffect = (
      effect: SkillEffectData,
      candidate?: ChoiceCandidate,
    ): GameEvent => {
      const targetId = candidate?.targetId
        ?? SkillTriggerBridge.resolveEffectTarget(effect, binding, event);
      const data = {
        sourceId,
        targetId,
        value: effect.value ?? 0,
        skillId: binding.skill.id,
        skillName: binding.skill.name,
        effectType: effect.type,
        triggerEventId: event.id
      };
      // A choice producer candidate names the exact hand cards to settle
      // (v2.7.2); every payload minted before this carries no cardKeys and
      // keeps the canonical head-of-hand slice.
      const handSelection = candidate?.cardKeys ? { cardKeys: candidate.cardKeys } : {};

      if (effect.type === 'DRAW_CARD') {
        // Card draw is always granted to the skill owner's hand.
        return {
          type: 'DRAW',
          data: {
            ...data,
            playerId: Number(sourceId),
            count: Math.max(1, Number(effect.value ?? 1))
          }
        };
      }

      if (effect.type === 'DAMAGE') {
        const targetRef = SkillTriggerBridge.findGeneralRef(state, targetId);
        return {
          type: 'DAMAGE',
          data: {
            ...data,
            sourcePlayerId: Number(sourceId),
            sourceGeneralId: binding.skill.sourceGeneralId,
            targetPlayerId: targetRef
              ? targetRef.player.id
              : SkillTriggerBridge.playerIdFromBase(targetId),
            targetId: targetId ?? data.targetId,
            damageType: 'skill',
            value: Math.max(1, Number(effect.value ?? 1))
          }
        };
      }

      if (effect.type === 'HEAL' || effect.type === 'GAIN_ARMOR') {
        const targetRef = SkillTriggerBridge.findGeneralRef(state, targetId);
        return {
          type: effect.type,
          data: {
            ...data,
            targetPlayerId: targetRef
              ? targetRef.player.id
              : SkillTriggerBridge.playerIdFromBase(targetId),
            targetId: targetId ?? data.targetId,
            value: Math.max(1, Number(effect.value ?? 1))
          }
        };
      }

      if (effect.type === 'DISCARD') {
        // Discards are keyed to a PLAYER (hands live on players), not to a
        // general instance — an attacker whose general already left the field
        // still owes the cards (断肠 settlement after a lethal hit).
        const eventData = asRecord(event.data);
        const role = effect.target ?? 'TARGET';
        const discardPlayerId = role === 'SELF'
          ? Number(sourceId)
          : role === 'ATTACKER'
            ? Number(eventData.sourcePlayerId ?? eventData.attackerPlayerId)
            : Number(eventData.targetPlayerId);
        return {
          type: 'DISCARD',
          data: {
            ...data,
            ...handSelection,
            playerId: Number.isFinite(discardPlayerId) ? discardPlayerId : undefined,
            count: Math.max(0, Math.floor(Number(effect.value ?? 1)))
          }
        };
      }

      if (effect.type === 'GIVE') {
        // Mirror of DISCARD (2.5.3): the giver is always the skill owner's
        // PLAYER (hands live on players); the receiver is resolved from the
        // effect's target role against the triggering event, same role table
        // as above. Same-player / dead-receiver / empty-hand cases settle as
        // honest no-ops inside applyGiveEvent — the GIVE event still records
        // that the trigger fired.
        const eventData = asRecord(event.data);
        const role = effect.target ?? 'TARGET';
        const toPlayerId = role === 'SELF'
          ? Number(sourceId)
          : role === 'ATTACKER'
            ? Number(eventData.sourcePlayerId ?? eventData.attackerPlayerId)
            : Number(eventData.targetPlayerId);
        return {
          type: 'GIVE',
          data: {
            ...data,
            ...handSelection,
            fromPlayerId: Number(sourceId),
            toPlayerId: Number.isFinite(toPlayerId) ? toPlayerId : undefined,
            count: Math.max(0, Math.floor(Number(effect.value ?? 1)))
          }
        };
      }

      if (effect.type === 'EQUIP_STRIP') {
        // EQUIP_STRIP (2.6.0) is keyed to a GENERAL, not a player: equipment
        // lives on the field general as armorCards. The victim's player is
        // recovered from the resolved general id via findGeneralRef (the
        // AFTER_DAMAGE payload carries no targetPlayerId — same lesson that
        // makes GIVE TARGET spin there). A general already off-field (killed
        // by the source hit) settles as an honest no-op downstream.
        const targetRef = SkillTriggerBridge.findGeneralRef(state, targetId);
        return {
          type: 'EQUIP_STRIP',
          data: {
            ...data,
            targetPlayerId: targetRef?.player.id,
            targetId: targetId ?? data.targetId,
            count: Math.max(1, Math.floor(Number(effect.value ?? 1))),
          },
        };
      }

      if (effect.type === 'REVEAL') {
        // REVEAL (2.6.1, deck-top capability layer): pure observation keyed to
        // the skill OWNER's player (who looks). It never mutates state and
        // consumes no rngState — settlement returns state unchanged; the event
        // is recorded so the log/HUD shows the look happened.
        return {
          type: 'REVEAL',
          data: {
            ...data,
            viewerPlayerId: Number(sourceId),
            count: Math.max(0, Math.floor(Number(effect.value ?? 1)))
          }
        };
      }

      if (effect.type === 'DECK_PLACE') {
        // DECK_PLACE (2.6.1, deck-top capability layer): hand→deck mirror of
        // GIVE, keyed to the skill OWNER's player (whose hand is detached and
        // re-attached onto the deck). dest defaults to BOTTOM (the dominant
        // "place under the deck" semantic); TOP is carried when the runtime
        // payload sets it. Empty-hand settles as an honest no-op downstream.
        return {
          type: 'DECK_PLACE',
          data: {
            ...data,
            ...handSelection,
            playerId: Number(sourceId),
            dest: effect.dest === 'TOP' ? 'TOP' : 'BOTTOM',
            count: Math.max(0, Math.floor(Number(effect.value ?? 1)))
          }
        };
      }

      return {
        type: 'CUSTOM',
        data: { ...data, kind: effect.type }
      };
    };

    if (binding.skill.choiceMode) {
      const options = SkillTriggerBridge.buildChoiceOptions(
        binding, state, sourceId, translateEffect);
      // An empty candidate set never opens an offer: the frozen-world gate
      // would lock the table with nothing legal to pick, so "the trigger
      // happened but there was nothing to choose" stays event-free by design.
      if (options.length === 0) return [];
      const choiceData = {
        choiceKey: `ch:${state.turn ?? 0}:${state.round ?? 0}:${binding.skill.id}`,
        chooserPlayerId: Number(sourceId),
        options,
        skillId: binding.skill.id,
        skillName: binding.skill.name,
      };
      return [{ type: 'CHOICE_REQUIRED', data: choiceData }];
    }

    return binding.skill.effects.map(effect => translateEffect(effect));
  }

  /**
   * choice 生产者面 (v2.7.2, GPT 三检 Q5 minimal verification cut): where the
   * candidate table comes from.
   *
   *  - `choiceSource` unset (every definition the compiler can produce today):
   *    v2.6.3 verbatim — one option per pre-translated effect branch.
   *  - 'TARGET' / 'HAND_CARD': one option per candidate enumerated from
   *    EngineState, each carrying the definition's SINGLE template effect with
   *    that candidate filled in (targetId / cardKeys). A producer definition
   *    with anything other than exactly one effect falls back to the
   *    effect-branch behavior — dropping effects silently would be worse than
   *    not offering a pick.
   *
   * Translation stays in one place: both shapes call the same translateEffect
   * closure handed in by createSkillEvents (no second translation path).
   */
  private static buildChoiceOptions(
    binding: SkillOwnerBinding,
    state: EngineState,
    sourceId: string,
    translate: (effect: SkillEffectData, candidate?: ChoiceCandidate) => GameEvent,
  ): PendingChoiceOption[] {
    const { effects, choiceSource } = binding.skill;
    const template = choiceSource && effects.length === 1 ? effects[0] : undefined;
    if (!template) {
      return effects.map(effect => ({
        label: effect.description ?? binding.skill.description ?? binding.skill.name,
        events: [translate(effect)],
      }));
    }
    const ownerId = Number(sourceId);
    const candidates = choiceSource === 'TARGET'
      ? enumerateTargetCandidates(state, ownerId, binding.skill.choiceTargetScope)
      : enumerateHandCardCandidates(state, ownerId);
    return candidates.map(candidate => ({
      label: candidate.label,
      events: [translate(template, candidate)],
    }));
  }

  /**
   * Resolves which entity an effect applies to, based on the effect's declared
   * target role relative to the triggering event:
   *   SELF     → the owning general (falls back to the owner player id)
   *   ATTACKER → the attacker general of the source event
   *   TARGET   → the victim/general referenced by the source event
   */
  private static resolveEffectTarget(
    effect: SkillEffectData,
    binding: SkillOwnerBinding,
    event: GameEvent
  ): string | undefined {
    const data = asRecord(event.data);
    const role = effect.target ?? 'TARGET';

    if (role === 'SELF') {
      return binding.skill.sourceGeneralId ?? String(binding.ownerId);
    }
    if (role === 'ATTACKER') {
      const action = asRecord(data.action);
      const payload = asRecord(action.payload);
      const attacker = data.sourceGeneralId ?? data.attackerId ?? payload.attackerId ?? action.attackerId;
      return attacker === undefined ? undefined : String(attacker);
    }

    const value = data.targetId ?? data.target ?? data.victimId;
    return value === undefined ? undefined : String(value);
  }

  private static findGeneralRef(state: EngineState, generalId?: string) {
    if (!generalId) return null;
    for (const player of state.players) {
      const fieldGenerals = Array.isArray(player.fieldGenerals)
        ? player.fieldGenerals as Array<Record<string, unknown>>
        : [];
      const found = fieldGenerals.find(fg =>
        getRuntimeCardId(fg?.general as never) === String(generalId));
      if (found) return { player, general: found };
    }
    return null;
  }

  private static playerIdFromBase(targetId?: string): number | undefined {
    if (!targetId || !targetId.startsWith('base_')) return undefined;
    const parsed = Number(targetId.slice('base_'.length));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
