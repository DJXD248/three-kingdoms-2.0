import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { useGameStore } from "./store/gameStore";
import * as liveReplay from "./replay/liveReplayRecorder";
import * as choiceCandidates from "./skills/choiceCandidates";
import * as skillConditions from "./skills/skillConditions";

if (import.meta.env.DEV) {
  // Dev-only test hook for browser E2E (production bundle drops this branch).
  // choiceCandidates (2.7.2): the real enumerators, so a hot-seat probe can
  // run them against live EngineState instead of a mocked copy.
  // skillConditions (2.7.3): same idea for the gate evaluator.
  (window as unknown as Record<string, unknown>).__TK__ = { useGameStore, liveReplay, choiceCandidates, skillConditions };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
