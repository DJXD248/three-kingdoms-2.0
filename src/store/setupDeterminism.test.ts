/**
 * D-2 second cut (2.2.19): the store's setup steps (createRoom → rollDice →
 * assignFactions → distributeDraftGenerals) draw their randomness from the
 * EngineState.rngState cursor instead of the global Math.random, so the same
 * cursor replays the same lobby, deck and draft candidates — and the advanced
 * cursor itself is committed back for the in-play draws to continue from.
 */
import { describe, expect, it } from 'vitest';
import { useGameStore } from './gameStore';
import { defaultSeatModes } from '../setup/runtimeSetup';
import { createRngState } from '../core/rng';

function runSetup(seed: number): string {
  useGameStore.setState({
    phase: 'menu', players: [], currentPlayerIndex: 0, currentRound: 1,
    roomName: '建局确定性房', playerCount: 2,
    seatModes: defaultSeatModes(),
    draftGenerals: [], draftQunGenerals: [], selectedDraftGenerals: [], draftPlayerIndex: 0,
    engineState: { ...useGameStore.getState().engineState, rngState: createRngState(seed) },
  } as Partial<ReturnType<typeof useGameStore.getState>>);

  const s = () => useGameStore.getState();
  s().createRoom();
  s().rollDice();
  s().assignFactions();
  s().distributeDraftGenerals();

  const st = s();
  return JSON.stringify({
    players: st.players,
    cardDeck: st.cardDeck,
    draftGenerals: st.draftGenerals,
    draftQunGenerals: st.draftQunGenerals,
    cursor: st.engineState.rngState,
  });
}

describe('store setup steps consume rngState (D-2 second cut)', () => {
  it('same cursor → identical lobby, deck, candidates and post-setup cursor', () => {
    expect(runSetup(4242)).toBe(runSetup(4242));
  });

  it('different cursor → different setup (entropy really flows through rngState)', () => {
    expect(runSetup(11)).not.toBe(runSetup(22));
  });

  it('setup steps advance the cursor the in-play draws continue from', () => {
    useGameStore.setState({
      phase: 'menu', players: [], roomName: '房', playerCount: 2,
      seatModes: defaultSeatModes(),
      engineState: { ...useGameStore.getState().engineState, rngState: createRngState(77) },
    } as Partial<ReturnType<typeof useGameStore.getState>>);
    useGameStore.getState().createRoom();
    const after = useGameStore.getState().engineState.rngState;
    expect(after?.s).toBeGreaterThan(0);
    expect(after?.s).not.toBe(77);
  });
});
