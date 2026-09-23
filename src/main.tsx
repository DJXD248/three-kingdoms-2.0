import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { useGameStore } from "./store/gameStore";
import * as liveReplay from "./replay/liveReplayRecorder";

if (import.meta.env.DEV) {
  // Dev-only test hook for browser E2E (production bundle drops this branch).
  (window as unknown as Record<string, unknown>).__TK__ = { useGameStore, liveReplay };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
