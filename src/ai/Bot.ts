
import type { AIStrategy, DecisionContext } from './types';

export class Bot {
  constructor(
    public id: string,
    private strategy: AIStrategy
  ) {}

  decide(context: DecisionContext) {
    return this.strategy.chooseAction(context);
  }
}
