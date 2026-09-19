import type { GameEvent } from '../core/Event';

export type SkillTrigger =
  | 'onDeploy'
  | 'onTurnStart'
  | 'onDamageTaken'
  | 'onDamageDealt'
  | 'onKill'
  | 'onDeath';

export interface SkillContext {
  event: GameEvent;
  state: unknown;
  ownerId?: string | number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  trigger: SkillTrigger;
  description?: string;
  execute(context: SkillContext): GameEvent[];
}
