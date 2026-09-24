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

// D-2 second cut (2.2.19): ids are minted from a process-local counter only —
// no clock, no entropy. Consumers match ids by equality (never parse them),
// and seeded AI battles overwrite them with stamp() ids, so uniqueness within
// a session is the whole contract.
export function createRuntimeInstanceId(definitionId: string): string {
  return `${definitionId}__inst_${(++runtimeSequence).toString(36)}`;
}

export function cloneWithRuntimeInstance<T extends RuntimeCardLike>(card: T): T {
  return { ...card, instanceId: createRuntimeInstanceId(String(card.id)) };
}
