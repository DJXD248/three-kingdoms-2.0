
import type { DataSkillDefinition, DataSkillTrigger } from './dataTypes';
import type { EngineState } from '../core/GameState';
import type { GameEvent, GameEventType } from '../core/Event';
import type { TriggerEngine } from '../triggers/TriggerEngine';

const TRIGGER_EVENT_MAP: Partial<Record<DataSkillTrigger, GameEventType>> = {
  onDeploy: 'CUSTOM',
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

/**
 * Adapts data-driven skills into the Phase 5.24 TriggerEngine.
 * This is intentionally a bridge: imported skill data remains data,
 * while runtime ownership and trigger registration live in the engine.
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
    _state: EngineState,
    event: GameEvent
  ): GameEvent[] {
    const sourceId = String(binding.ownerId);
    const targetId = this.extractTargetId(event);

    return binding.skill.effects.map(effect => {
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
        return { type: 'DRAW', data };
      }

      if (effect.type === 'DAMAGE') {
        return { type: 'DAMAGE', data };
      }

      return {
        type: 'CUSTOM',
        data: { ...data, kind: effect.type }
      };
    });
  }

  private extractTargetId(event: GameEvent) {
    const data = event.data;
    if (!data || typeof data !== 'object') return undefined;
    const record = data as Record<string, unknown>;
    const value = record.targetId ?? record.targetPlayerId ?? record.target;
    return value === undefined ? undefined : String(value);
  }
}
