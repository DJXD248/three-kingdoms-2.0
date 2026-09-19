export function movementCost(isScholar: boolean) {
  return isScholar ? 1 : 0;
}

export function attackCost() {
  return 1;
}

export function supplyCost(recovery: number, enteredEnemyArea: boolean) {
  return recovery + (enteredEnemyArea ? 1 : 0);
}
