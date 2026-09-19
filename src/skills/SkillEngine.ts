import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { SkillRegistry } from './SkillRegistry';
import type { SkillDefinition } from './types';

export class SkillEngine {
  constructor(
    readonly registry = new SkillRegistry()
  ) {}

  register(skill: SkillDefinition) {
    this.registry.register(skill);
  }

  handleEvent(
    state: EngineState,
    event: GameEvent
  ): GameEvent[] {
    const result: GameEvent[] = [];

    for (const skill of this.registry.getAll()) {
      if (this.matches(skill, event)) {
        result.push(...skill.execute({
          state,
          event
        }));
      }
    }

    return result;
  }

  private matches(
    skill: SkillDefinition,
    event: GameEvent
  ) {
    const map: Record<string,string> = {
      onDamageTaken:'DAMAGE',
      onDamageDealt:'AFTER_DAMAGE',
      onDeploy:'CUSTOM',
      onTurnStart:'TURN_START',
      onDeath:'DEATH',
      onKill:'DEATH'
    };

    return map[skill.trigger] === event.type;
  }
}
