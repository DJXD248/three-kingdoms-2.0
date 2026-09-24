/**
 * RandomOutcome event stream (decision D-2a, v2.2.22, §12-16a):
 * every random draw selection made on the live engine path leaves the
 * dispatch as a RANDOM_OUTCOME event (purpose/value/stableId). Replay
 * consumes those recorded results instead of re-running the RNG — proven
 * by tampering with the seeded cursor: a result-fed playback still ends in
 * the exact live state, while the legacy re-roll path (results stripped,
 * cursor intact) keeps working for pre-2.2.22 documents. Corrupt results
 * fall back to the re-roll instead of throwing — and since 2.2.23 every
 * fallback is reported out-of-band (overrideFailures + one console.warn),
 * never silently.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GameEngine } from './GameEngine';
import { cloneEngineState } from './GameState';
import type { EngineState, EnginePlayer } from './GameState';
import type { GameEvent, RandomOutcomeData } from './Event';
import { createAction } from '../action/ActionTypes';
import { createRngState } from './rng';
import { ReplayPlayer } from '../replay/ReplayPlayer';
import { dispatchStoreAction, __resetResidentEngineContainer } from '../store/engineExecutionBridge';
import { resetLiveReplay, getLiveReplayDocument } from '../replay/liveReplayRecorder';
import type { ReplayDocument } from '../replay/types';

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id,
    name: 'Player ' + id,
    hp: 4,
    hand: [],
    generalPool: [
      { id: 'pg1', name: '池将1' },
      { id: 'pg2', name: '池将2' },
      { id: 'pg3', name: '池将3' },
    ],
    fieldGenerals: [],
    graveyard: [],
    baseHp: 10,
    baseMaxHp: 10,
    isAlive: true,
    statuses: [],
    ...overrides,
  };
}

/** Pending draw window open, small deck forcing one discard-pile reshuffle. */
function buildInitial(): EngineState {
  return {
    version: 1,
    phase: 'drawing',
    timelinePhase: 'DRAW',
    players: [makePlayer(1)],
    currentPlayerId: 1,
    turn: 2,
    round: 2,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
    ],
    discardPile: [
      { id: 'dis_1', name: '军备', type: '军备' },
      { id: 'dis_2', name: '锦囊', type: '锦囊' },
    ],
    drawState: { reason: 'turnStart', playerId: 1, totalCards: 4 },
    rngState: createRngState(123456789),
  };
}

const DRAW_ACTION = createAction('DRAW', 1, { fromGeneralPool: 1, fromCardPool: 3 });

function randomOutcomes(events: GameEvent[]): RandomOutcomeData[] {
  return events
    .filter(event => event.type === 'RANDOM_OUTCOME')
    .map(event => event.data as RandomOutcomeData);
}

function stateHash(state: EngineState): string {
  return JSON.stringify(state);
}

let originalRandom = Math.random;
afterEach(() => { Math.random = originalRandom; });

describe('RANDOM_OUTCOME recording on the live path', () => {
  it('a seeded draw emits one RANDOM_OUTCOME whose value describes the exact selection', () => {
    const engine = new GameEngine(cloneEngineState(buildInitial()));
    const events = engine.dispatch(DRAW_ACTION);

    const outcomes = randomOutcomes(events);
    expect(outcomes).toHaveLength(1);
    const { purpose, stableId, value } = outcomes[0];
    expect(purpose).toBe('DRAW_SELECTION');
    expect(stableId).toBe('ro:2:2:1:0');
    expect(value.playerId).toBe(1);
    expect(value.generalKeys).toHaveLength(1);
    expect(value.deckTake).toBe(2);
    expect(value.reshuffleKeys).toHaveLength(1);
    expect(value.cursorAfter.s).not.toBe(123456789 >>> 0);

    // The state really consumed what the outcome recorded.
    const player = engine.state.players[0];
    expect(player.hand).toHaveLength(4);
    expect(player.generalPool).toHaveLength(2);
    expect(engine.state.deck).toHaveLength(0);
    expect(engine.state.discardPile).toHaveLength(1);
    expect(engine.state.rngState).toEqual(value.cursorAfter);
  });

  it('draws that only take from the deck top still record the selection (cursor may be untouched)', () => {
    const initial = buildInitial();
    initial.deck = [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
    ];
    initial.drawState = { reason: 'turnStart', playerId: 1, totalCards: 2 };
    const engine = new GameEngine(cloneEngineState(initial));
    const events = engine.dispatch(createAction('DRAW', 1, { fromGeneralPool: 0, fromCardPool: 2 }));

    const outcomes = randomOutcomes(events);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].value.generalKeys).toEqual([]);
    expect(outcomes[0].value.deckTake).toBe(2);
    expect(outcomes[0].value.reshuffleKeys).toEqual([]);
    expect(engine.state.rngState?.s).toBe(outcomes[0].value.cursorAfter.s);
  });

  it('the store bridge records outcomes into the production live-replay document', () => {
    __resetResidentEngineContainer();
    resetLiveReplay();
    const opening: EngineState = { ...buildInitial(), phase: 'playing', timelinePhase: 'ACTION', drawState: null };
    const begin = createAction('BEGIN_DRAW', 1, { reason: 'initial', playerId: 1, totalCards: 4 });
    const opened = dispatchStoreAction({ engineState: opening }, begin);
    const result = dispatchStoreAction({ engineState: opened.engineState }, DRAW_ACTION);

    const document = getLiveReplayDocument();
    expect(document).not.toBeNull();
    const drawEntry = document!.entries.at(-1)!;
    const recorded = randomOutcomes(drawEntry.events);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].value.deckTake).toBe(2);
    // The same selection the document recorded is the one the state applied.
    expect(result.engineState.players[0].hand).toHaveLength(4);
    resetLiveReplay();
    __resetResidentEngineContainer();
  });
});

describe('replay consumes results, not re-rolls', () => {
  function recordMatch(): { document: ReplayDocument; liveFinal: EngineState } {
    const engine = new GameEngine(cloneEngineState(buildInitial()));
    engine.dispatch(DRAW_ACTION);
    engine.dispatch(createAction('CONFIRM_DRAW', 1, { completed: true, reason: 'turnStart' }));
    return {
      document: engine.replay.getDocument()!,
      liveFinal: engine.state,
    };
  }

  it('playing back with a TAMPERED cursor still reproduces the exact live state (outcome-fed)', () => {
    const { document, liveFinal } = recordMatch();
    const tampered = structuredClone(document) as ReplayDocument;
    tampered.initialState.rngState = { s: 0xdeadbeef };

    const playback = new ReplayPlayer().play(tampered);
    expect(stateHash(playback.state)).toBe(stateHash(liveFinal));
  });

  it('the same tampered document WITHOUT outcomes drifts — proving the outcome channel carries the load', () => {
    const { document, liveFinal } = recordMatch();
    const stripped = structuredClone(document) as ReplayDocument;
    for (const entry of stripped.entries) {
      entry.events = entry.events.filter(event => event.type !== 'RANDOM_OUTCOME');
    }
    stripped.initialState.rngState = { s: 0xdeadbeef };

    const playback = new ReplayPlayer().play(stripped);
    expect(stateHash(playback.state)).not.toBe(stateHash(liveFinal));
  });

  it('legacy dual-read: outcome-less documents replay exactly via the seeded re-roll (pre-2.2.22 replays)', () => {
    const { document, liveFinal } = recordMatch();
    const legacy = structuredClone(document) as ReplayDocument;
    for (const entry of legacy.entries) {
      entry.events = entry.events.filter(event => event.type !== 'RANDOM_OUTCOME');
    }

    const playback = new ReplayPlayer().play(legacy);
    expect(stateHash(playback.state)).toBe(stateHash(liveFinal));
  });

  it('corrupt recorded selections fall back to the seeded re-roll instead of throwing', () => {
    const { document, liveFinal } = recordMatch();
    const corrupted = structuredClone(document) as ReplayDocument;
    for (const entry of corrupted.entries) {
      for (const event of entry.events) {
        if (event.type === 'RANDOM_OUTCOME') {
          (event.data as RandomOutcomeData).value.generalKeys = ['no-such-general'];
        }
      }
    }

    const playback = new ReplayPlayer().play(corrupted);
    expect(stateHash(playback.state)).toBe(stateHash(liveFinal));
  });

  it('replay never consults a global random source while outcomes are available', () => {
    const { document, liveFinal } = recordMatch();
    originalRandom = Math.random;
    Math.random = () => { throw new Error('replay touched Math.random'); };
    try {
      const playback = new ReplayPlayer().play(structuredClone(document) as ReplayDocument);
      expect(stateHash(playback.state)).toBe(stateHash(liveFinal));
    } finally {
      Math.random = originalRandom;
      originalRandom = Math.random;
    }
  });
});

describe('override validation diagnostics (2.2.23 bypass, GPT Q4)', () => {
  function recordMatch(): { document: ReplayDocument; liveFinal: EngineState } {
    const engine = new GameEngine(cloneEngineState(buildInitial()));
    engine.dispatch(DRAW_ACTION);
    engine.dispatch(createAction('CONFIRM_DRAW', 1, { completed: true, reason: 'turnStart' }));
    return {
      document: engine.replay.getDocument()!,
      liveFinal: engine.state,
    };
  }

  function mutateOutcome(corrupted: ReplayDocument, mutate: (outcome: RandomOutcomeData) => void): void {
    for (const entry of corrupted.entries) {
      for (const event of entry.events) {
        if (event.type === 'RANDOM_OUTCOME') mutate(event.data as RandomOutcomeData);
      }
    }
  }

  it('unresolvable recorded keys are reported as UNRESOLVABLE_KEY (fallback keeps working)', () => {
    const { document, liveFinal } = recordMatch();
    const corrupted = structuredClone(document) as ReplayDocument;
    mutateOutcome(corrupted, outcome => { outcome.value.generalKeys = ['no-such-general']; });

    const playback = new ReplayPlayer().play(corrupted);
    expect(stateHash(playback.state)).toBe(stateHash(liveFinal));
    expect(playback.overrideFailures).toEqual([
      { stableId: 'ro:2:2:1:0', playerId: 1, reason: 'UNRESOLVABLE_KEY', sequence: 1 },
    ]);
  });

  it('tampered counts are reported as COUNT_MISMATCH', () => {
    const { document } = recordMatch();
    const corrupted = structuredClone(document) as ReplayDocument;
    mutateOutcome(corrupted, outcome => { outcome.value.deckTake = 99; });

    const playback = new ReplayPlayer().play(corrupted);
    expect(playback.overrideFailures).toHaveLength(1);
    expect(playback.overrideFailures[0].reason).toBe('COUNT_MISMATCH');
    expect(playback.overrideFailures[0].stableId).toBe('ro:2:2:1:0');
  });

  it('misaligned slots (playerId disagreement) are reported as MISMATCHED_SLOTS', () => {
    const { document } = recordMatch();
    const corrupted = structuredClone(document) as ReplayDocument;
    mutateOutcome(corrupted, outcome => { outcome.value.playerId = 7; });

    const playback = new ReplayPlayer().play(corrupted);
    expect(playback.overrideFailures).toEqual([
      { stableId: 'ro:2:2:1:0', playerId: 1, reason: 'MISMATCHED_SLOTS', sequence: 1 },
    ]);
  });

  it('clean and legacy (outcome-less) playbacks report zero failures', () => {
    const { document } = recordMatch();
    expect(new ReplayPlayer().play(structuredClone(document) as ReplayDocument).overrideFailures).toEqual([]);

    const legacy = structuredClone(document) as ReplayDocument;
    for (const entry of legacy.entries) {
      entry.events = entry.events.filter(event => event.type !== 'RANDOM_OUTCOME');
    }
    expect(new ReplayPlayer().play(legacy).overrideFailures).toEqual([]);
  });

  it('live dispatches leave the engine diagnostic channel structurally empty', () => {
    const engine = new GameEngine(cloneEngineState(buildInitial()));
    engine.dispatch(DRAW_ACTION);
    engine.dispatch(createAction('DRAW', 99, { fromGeneralPool: 1, fromCardPool: 1 }));
    expect(engine.lastOverrideFailures).toEqual([]);
    expect(engine.outcomeOverrides).toBeNull();
  });

  it('a failing playback warns exactly once; a clean one never warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { document } = recordMatch();
      const corrupted = structuredClone(document) as ReplayDocument;
      mutateOutcome(corrupted, outcome => { outcome.value.reshuffleKeys = ['ghost']; });
      new ReplayPlayer().play(corrupted);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('[replay]');

      warn.mockClear();
      new ReplayPlayer().play(structuredClone(document) as ReplayDocument);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
