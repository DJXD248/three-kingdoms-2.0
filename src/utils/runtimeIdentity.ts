/** Runtime identity helpers for repeated physical card instances.
 *
 * Definition ids (e.g. wei_001) identify WHAT a card is; instanceId identifies
 * WHICH physical copy is being manipulated. This is especially important in
 * the test arena where the same general can intentionally be injected multiple
 * times for debugging.
 */
export type RuntimeCardLike = { id: string; instanceId?: string };

let runtimeSequence = 0;

export function getRuntimeCardId(card: RuntimeCardLike | null | undefined): string {
  if (!card) return '';
  return String(card.instanceId ?? card.id);
}

export function getRuntimeGeneralId(general: RuntimeCardLike | null | undefined): string {
  return getRuntimeCardId(general);
}

export function createRuntimeInstanceId(definitionId: string): string {
  const now = Date.now().toString(36);
  const seq = (++runtimeSequence).toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${definitionId}__inst_${now}_${seq}_${random}`;
}

export function cloneWithRuntimeInstance<T extends RuntimeCardLike>(card: T): T {
  return { ...card, instanceId: createRuntimeInstanceId(String(card.id)) };
}
