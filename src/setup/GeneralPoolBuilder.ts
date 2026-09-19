import { GeneralDraftCandidate } from "./GeneralDraftSystem";

export interface PlayerGeneralPool {
  playerId: string;
  generalIds: string[];
}

export function buildGeneralPool(
  playerId: string,
  selected: GeneralDraftCandidate[]
): PlayerGeneralPool {
  return {
    playerId,
    generalIds: selected.map(item => item.id),
  };
}
