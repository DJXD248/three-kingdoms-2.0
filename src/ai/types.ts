
export interface DecisionContext {
  state: unknown;
  playerId: string;
  availableActions: unknown[];
}

export interface AIStrategy {
  chooseAction(context: DecisionContext): unknown;
}
