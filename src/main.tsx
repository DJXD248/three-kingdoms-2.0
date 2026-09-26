import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { useGameStore } from "./store/gameStore";
import * as liveReplay from "./replay/liveReplayRecorder";
import * as choiceCandidates from "./skills/choiceCandidates";

if (import.meta.env.DEV) {
  // Dev-only test hook for browser E2E (production bundle drops this branch).
  // choiceCandidates (2.7.2): the real enumerators, so a hot-seat probe can
  // run them against live EngineState instead of a mocked copy.
  (window as unknown as Record<string, unknown>).__TK__ = { useGameStore, liveReplay, choiceCandidates };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
