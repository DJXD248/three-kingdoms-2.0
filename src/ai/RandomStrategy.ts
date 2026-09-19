
import type { AIStrategy, DecisionContext } from './types';

export class RandomStrategy implements AIStrategy {
  chooseAction(context: DecisionContext) {
    if (context.availableActions.length === 0) {
      return null;
    }

    const index = Math.floor(
      Math.random() * context.availableActions.length
    );

    return context.availableActions[index];
  }
}
