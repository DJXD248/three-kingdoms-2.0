export interface GeneralDraftCandidate {
  id: string;
  name: string;
  faction: "WEI" | "SHU" | "WU" | "QUN" | "JIN";
}

export interface GeneralDraftState {
  playerId: string;
  candidates: GeneralDraftCandidate[];
  selected: GeneralDraftCandidate[];
  confirmed: boolean;
}

export interface GeneralDraftConfig {
  mainFactionCandidates: number;
  qunCandidates: number;
  selectionCount: number;
  minQun: number;
  maxQun: number;
}

export const DEFAULT_GENERAL_DRAFT_CONFIG: GeneralDraftConfig = {
  mainFactionCandidates: 10,
  qunCandidates: 5,
  selectionCount: 10,
  minQun: 1,
  maxQun: 3,
};

export function validateGeneralSelection(
  selected: GeneralDraftCandidate[],
  config = DEFAULT_GENERAL_DRAFT_CONFIG
): boolean {
  if (selected.length !== config.selectionCount) return false;

  const qunCount = selected.filter(
    general => general.faction === "QUN"
  ).length;

  return qunCount >= config.minQun &&
    qunCount <= config.maxQun;
}
