
import type { DataSkillDefinition, DataSkillTrigger, SkillEffectData } from './dataTypes';
import type { EngineState } from '../core/GameState';
import type { GameEvent, GameEventType } from '../core/Event';
import type { TriggerEngine } from '../triggers/TriggerEngine';
import type { TriggerContext } from '../triggers/types';
import { getRuntimeCardId } from '../utils/runtimeIdentity';

const TRIGGER_EVENT_MAP: Partial<Record<DataSkillTrigger, GameEventType>> = {
  onDeploy: 'GENERAL_DEPLOYED',
  onTurnStart: 'TURN_START',
  onDamageTaken: 'DAMAGE',
  onDamageDealt: 'AFTER_DAMAGE',
  onKill: 'DEATH',
  onDeath: 'DEATH'
};

const PRIORITY: Partial<Record<DataSkillTrigger, number>> = {
  onDeploy: 100,
  onTurnStart: 50,
  onDamageTaken: 50,
  onDamageDealt: 50,
  onKill: 60,
  onDeath: 100
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

  return (context) => {
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
      default:
        return false;
    }
  };
}

/**
 * Adapts data-driven skills into the Phase 5.24 TriggerEngine.
 * This is intentionally a bridge: imported skill data remains data,
 * while runtime ownership and trigger registration live in the engine.
 *
 * Effects are translated into canonical engine events:
 *   DRAW_CARD → DRAW { playerId, count }      (deck selection in EventProcessor)
 *   DAMAGE    → DAMAGE { damageType: 'skill' } (armor settlement in EventProcessor)
 *   HEAL / GAIN_ARMOR → CUSTOM (recorded, not yet settled — see skillCompiler notes)
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
        this.createSkillEvents(binding, context.state, context.event)
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

  private createSkillEvents(
    binding: SkillOwnerBinding,
    state: EngineState,
    event: GameEvent
  ): GameEvent[] {
    const sourceId = String(binding.ownerId);

    return binding.skill.effects.map(effect => {
      const targetId = this.resolveEffectTarget(effect, binding, event);
      const data = {
        sourceId,
        targetId,
        value: effect.value ?? 0,
        skillId: binding.skill.id,
        skillName: binding.skill.name,
        effectType: effect.type,
        triggerEventId: event.id
      };

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
        const targetRef = this.findGeneralRef(state, targetId);
        return {
          type: 'DAMAGE',
          data: {
            ...data,
            sourcePlayerId: Number(sourceId),
            sourceGeneralId: binding.skill.sourceGeneralId,
            targetPlayerId: targetRef
              ? targetRef.player.id
              : this.playerIdFromBase(targetId),
            targetId: targetId ?? data.targetId,
            damageType: 'skill',
            value: Math.max(1, Number(effect.value ?? 1))
          }
        };
      }

      return {
        type: 'CUSTOM',
        data: { ...data, kind: effect.type }
      };
    });
  }

  /**
   * Resolves which entity an effect applies to, based on the effect's declared
   * target role relative to the triggering event:
   *   SELF     → the owning general (falls back to the owner player id)
   *   ATTACKER → the attacker general of the source event
   *   TARGET   → the victim/general referenced by the source event
   */
  private resolveEffectTarget(
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

  private findGeneralRef(state: EngineState, generalId?: string) {
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

  private playerIdFromBase(targetId?: string): number | undefined {
    if (!targetId || !targetId.startsWith('base_')) return undefined;
    const parsed = Number(targetId.slice('base_'.length));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
