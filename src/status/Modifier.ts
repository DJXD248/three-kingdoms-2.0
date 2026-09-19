import type { Modifier } from './types';

export function applyModifiers(baseValue: number, modifiers: Modifier[]): number {
  let value = baseValue;
  for (const modifier of modifiers) {
    if (modifier.operation === 'ADD') value += modifier.value;
    else if (modifier.operation === 'MULTIPLY') value *= modifier.value;
    else if (modifier.operation === 'SET') value = modifier.value;
  }
  return value;
}
