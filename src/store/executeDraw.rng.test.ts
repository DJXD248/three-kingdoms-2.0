/**
 * D-2 (stage D) store-level draw determinism: the production store path
 * (createRoom → draft → executeDraw) must reproduce identical hands from an
 * identical EngineState (incl. rngState), and different rng seeds must
 * actually steer the general-pool shuffle. This is the headless stand-in
 * verified in-suite for what earlier cuts checked via browser console.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import type { Player } from './gameStore';
import { assignFactions, createLobbyPlayers, defaultSeatModes } from '../setup/runtimeSetup';
import { resetAiControllers, runAiStep } from '../ai/aiTurnDriver';
import { createRngState } from '../core/rng';

function freshStore() {
  resetAiControllers();
  useGameStore.setState({
    phase: 'menu', players: [], currentPlayerIndex: 0, currentRound: 1,
    roomName: 'RNG测试房', winnerId: null, isTestMode: false,
    draftPlayerIndex: 0, selectedDraftGenerals: [], draftGenerals: [], draftQunGenerals: [],
    drawContext: null, revealedDrawCards: [], engineState: useGameStore.getState().engineState,
    seatModes: defaultSeatModes(), skillEdits: {}, generalEdits: {},
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

/** Drive the production store up to the first player's initial draw window. */
function setupUntilDraw() {
  useGameStore.setState({
    seatModes: [
      { isAi: true, tier: 'balanced' },
      { isAi: true, tier: 'conservative' },
    ],
    playerCount: 2, roomName: 'RNG测试房',
  } as Partial<ReturnType<typeof useGameStore.getState>>);
  useGameStore.getState().createRoom();
  useGameStore.setState(st => ({ players: assignFactions(st.players) as Player[] }));
  useGameStore.getState().distributeDraftGenerals();
  for (let i = 0; i < 200; i += 1) {
    const s = useGameStore.getState();
    if (s.phase === 'drawing' && s.drawContext) return;
    expect(runAiStep(s), 'driver stalled before draw window').toBe(true);
  }
  throw new Error('unreachable: draft phase never opened a draw window');
}

const revealedIds = () =>
  useGameStore.getState().revealedDrawCards.map(c => String((c as { id?: string }).id ?? ''));

describe('executeDraw — RNG lives in EngineState.rngState (D-2)', () => {
  beforeEach(freshStore);

  it('createRoom seeds a serializable rngState cursor', () => {
    useGameStore.setState({ roomName: 'RNG测试房', playerCount: 2 } as Partial<ReturnType<typeof useGameStore.getState>>);
    useGameStore.getState().createRoom();
    const cursor = useGameStore.getState().engineState.rngState;
    expect(typeof cursor?.s).toBe('number');
    expect(cursor!.s).toBeGreaterThan(0);
    expect(cursor).toEqual(JSON.parse(JSON.stringify(cursor)));
  });

  it('identical EngineState replays the identical draw, seed for seed', () => {
    setupUntilDraw();
    const snapshot = JSON.stringify(useGameStore.getState().engineState);

    expect(useGameStore.getState().executeDraw(5, 0)).toBe(true);
    const first = revealedIds();
    expect(first).toHaveLength(5);

    useGameStore.setState({ engineState: JSON.parse(snapshot), revealedDrawCards: [] } as Partial<ReturnType<typeof useGameStore.getState>>);
    expect(useGameStore.getState().executeDraw(5, 0)).toBe(true);
    expect(revealedIds()).toEqual(first);
  });

  it('re-seeding rngState changes the general-pool draw (no draft-order bias)', () => {
    setupUntilDraw();
    const snapshot = JSON.stringify(useGameStore.getState().engineState);

    const runWith = (seed: number) => {
      const engineState = JSON.parse(snapshot);
      engineState.rngState = createRngState(seed);
      useGameStore.setState({ engineState, revealedDrawCards: [] } as Partial<ReturnType<typeof useGameStore.getState>>);
      expect(useGameStore.getState().executeDraw(5, 0)).toBe(true);
      return revealedIds();
    };
    expect(runWith(1)).not.toEqual(runWith(2));
  });
});
