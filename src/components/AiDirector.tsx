/**
 * v2.2.9 — invisible driver that lets AI seats act in a normal game.
 *
 * Mounted once inside App (never in the #ai-battle window, which early-returns
 * before this point). A single interval calls `runAiStep` with the freshest
 * store snapshot; the step itself decides whether the current interaction
 * belongs to an AI seat, so human hot-seat flow is completely untouched
 * (the driver is a no-op whenever no AI seat owns the turn).
 *
 * Cadence is deliberately slow-ish (~700ms): a human-vs-AI board should read
 * as "the AI is thinking", and every store call also feeds the live replay
 * recorder + animations exactly as a click would.
 */
import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { resetAiControllers, runAiStep } from '../ai/aiTurnDriver';

const AI_TICK_MS = 700;

export default function AiDirector() {
  const phase = useGameStore(s => s.phase);

  // A fresh lobby means a fresh match: drop per-seat policy closures so their
  // draw-window bookkeeping can't leak into the next game.
  useEffect(() => {
    if (phase === 'lobby') resetAiControllers();
  }, [phase]);

  useEffect(() => {
    const tick = () => {
      const state = useGameStore.getState();
      // The test arena sandbox is human-instrumented; never auto-play there.
      if (state.isTestMode) return;
      try {
        runAiStep(state);
      } catch (error) {
        // A driver error must not kill the timer — log loudly and let the
        // human keep playing (the seat just won't auto-act).
        console.error('[AiDirector] step failed', error);
      }
    };
    const id = window.setInterval(tick, AI_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
