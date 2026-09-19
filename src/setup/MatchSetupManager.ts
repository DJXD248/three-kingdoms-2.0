import { MatchSetupState } from "./types";

export class MatchSetupManager {
  constructor(public state: MatchSetupState) {}

  startDiceOrder() {
    this.state.phase = "DICE_ORDER";
  }

  assignFactionPhase() {
    this.state.phase = "FACTION_ASSIGN";
  }

  startGeneralDraft() {
    this.state.phase = "GENERAL_DRAFT";
  }

  startInitialDraw() {
    this.state.phase = "INITIAL_DRAW";
  }

  finishSetup() {
    this.state.phase = "READY";
  }
}
