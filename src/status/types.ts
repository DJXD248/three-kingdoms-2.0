export type StatusKind = 'BUFF' | 'DEBUFF' | 'CONTROL' | 'DAMAGE_OVER_TIME' | 'SHIELD' | 'CUSTOM';

export interface Modifier {
  id: string;
  stat: string;
  operation: 'ADD' | 'MULTIPLY' | 'SET';
  value: number;
  sourceId?: string;
}

export interface StatusEffect {
  id: string;
  kind: StatusKind;
  name: string;
  duration?: number | null;
  stacks?: number;
  modifiers?: Modifier[];
  metadata?: Record<string, unknown>;
}

export interface StatusContainer {
  statuses: StatusEffect[];
}
