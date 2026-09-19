export type SetupPhase =
  | "LOBBY"
  | "DICE_ORDER"
  | "FACTION_ASSIGN"
  | "GENERAL_DRAFT"
  | "INITIAL_DRAW"
  | "READY";

export interface PlayerSeat {
  playerId: string;
  seat: number;
  diceValue?: number;
  faction?: string;
}

export interface DraftState {
  candidates: string[];
  selected: string[];
  confirmed: boolean;
}

export interface MatchSetupState {
  phase: SetupPhase;
  seats: PlayerSeat[];
  currentPlayerIndex: number;
  drafts: Record<string, DraftState>;
}
