/**
 * v2.2.25 (§12-9c) reaction-window business entry.
 * Scope = entry mechanism: deterministic window identity (D-2 e① closed),
 * open/pass lifecycle events on the container EventBus, resident-bridge
 * entry functions, and the invariant that the window NEVER touches
 * EngineState (so replays/four-way reconciliation are structurally
 * unaffected). No skill auto-opens a window in this cut.
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createInitialEngineState, type EngineState, type EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type { ReactionWindowState } from './types';
import {
  __resetResidentEngineContainer,
  openReactionWindowStore,
  passReactionStore,
  resetReactionWindowStore,
} from '../store/engineExecutionBridge';
import { useGameStore } from '../store/gameStore';

function player(id: number): EnginePlayer {
  return {
    id,
    name: `P${id}`,
    hp: 4,
    hand: [],
    generalPool: [],
    fieldGenerals: [],
    graveyard: [],
    baseHp: 10,
    baseMaxHp: 10,
    isAlive: true,
    statuses: [],
  };
}

function testState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    ...createInitialEngineState(),
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [player(1), player(2)],
    currentPlayerId: 1,
    turn: 2,
    round: 3,
    ...overrides,
  };
}

const customEvent: GameEvent = { type: 'CUSTOM', timestamp: 1700000000000, data: { reason: 'test-window' } };

function collectEmitted(engine: GameEngine) {
  const emitted: GameEvent[] = [];
  engine.events.on('REACTION_WINDOW_OPENED', e => emitted.push(e));
  engine.events.on('REACTION_WINDOW_CLOSED', e => emitted.push(e));
  return emitted;
}

describe('ReactionWindow deterministic identity (D-2 e①)', () => {
  it('window id is rw:<turn>:<round>:<sourceEventKey>:<seq> from pure data', () => {
    const engine = new GameEngine(testState(), { recordHistory: false });
    const win = engine.openReactionWindow(customEvent);
    expect(win.id).toBe('rw:2:3:CUSTOM:1');
  });

  it('stableId on the source event becomes the key; seq increments per open', () => {
    const engine = new GameEngine(testState(), { recordHistory: false });
    const damage: GameEvent = { type: 'DAMAGE', data: { stableId: 'ro:2:3:1:0' } };
    const first = engine.openReactionWindow(damage, [1]);
    const second = engine.openReactionWindow(damage, [1, 2]);
    expect(first.id).toBe('rw:2:3:ro:2:3:1:0:1');
    expect(second.id).toBe('rw:2:3:ro:2:3:1:0:2');
  });

  it('same inputs on two fresh engines produce identical windows (no clock in the id)', () => {
    const a = new GameEngine(testState(), { recordHistory: false }).openReactionWindow(customEvent, [1, 2]);
    const b = new GameEngine(testState(), { recordHistory: false }).openReactionWindow(customEvent, [1, 2]);
    expect({ ...a, openedAt: 0 }).toEqual({ ...b, openedAt: 0 });
    // identity segments contain no digits-only timestamps: strictly shorter
    // than the legacy reaction_<13-digit>_<rand> shape and prefix-clean.
    expect(a.id.startsWith('rw:')).toBe(true);
    expect(a.id).not.toMatch(/^\d+$/);
  });

  it('participants default to all engine players and dedupe', () => {
    const engine = new GameEngine(testState(), { recordHistory: false });
    const win = engine.openReactionWindow(customEvent, [1, 1, 2]);
    expect(win.participants).toEqual([1, 2]);
  });
});

describe('ReactionWindow open/pass lifecycle (container layer)', () => {
  it('emits OPENED on open, then exactly one CLOSED when the last participant passes', () => {
    const engine = new GameEngine(testState(), { recordHistory: false });
    const emitted = collectEmitted(engine);
    engine.openReactionWindow(customEvent);
    expect(emitted.map(e => e.type)).toEqual(['REACTION_WINDOW_OPENED']);
    expect((emitted[0].data as ReactionWindowState).id).toBe('rw:2:3:CUSTOM:1');

    expect(engine.passReaction(1)).toBe(true);
    expect(engine.reactions.isOpen()).toBe(true);
    expect(emitted.map(e => e.type)).toEqual(['REACTION_WINDOW_OPENED']);

    expect(engine.passReaction(2)).toBe(true);
    expect(engine.reactions.isOpen()).toBe(false);
    expect(emitted.map(e => e.type)).toEqual(['REACTION_WINDOW_OPENED', 'REACTION_WINDOW_CLOSED']);
    expect((emitted[1].data as ReactionWindowState).passed).toEqual([1, 2]);
  });

  it('rejects passes from non-participants and passes after close', () => {
    const engine = new GameEngine(testState(), { recordHistory: false });
    engine.openReactionWindow(customEvent, [1]);
    expect(engine.passReaction(2)).toBe(false);
    expect(engine.passReaction(1)).toBe(true);
    expect(engine.passReaction(1)).toBe(false);
  });

  it('the window never touches EngineState (dispatch/replay surface untouched)', () => {
    const engine = new GameEngine(testState(), { recordHistory: false });
    const before = JSON.stringify(engine.snapshot());
    engine.openReactionWindow(customEvent);
    engine.passReaction(1);
    engine.passReaction(2);
    expect(JSON.stringify(engine.snapshot())).toBe(before);
  });
});

describe('resident bridge entry (store layer, 2.2.25)', () => {
  it('open/pass through the resident container mirrors the window and closes on all-pass', () => {
    __resetResidentEngineContainer();
    const storeState = { engineState: testState() };
    const win = openReactionWindowStore(storeState, customEvent);
    expect(win.id).toBe('rw:2:3:CUSTOM:1');

    const afterFirst = passReactionStore(storeState, 1);
    expect(afterFirst.accepted).toBe(true);
    expect(afterFirst.window?.closed).toBe(false);
    expect(afterFirst.window?.passed).toEqual([1]);

    const afterSecond = passReactionStore(storeState, 2);
    expect(afterSecond.accepted).toBe(true);
    expect(afterSecond.window?.closed).toBe(true);

    const stranger = passReactionStore(storeState, 99);
    expect(stranger.accepted).toBe(false);
    __resetResidentEngineContainer();
  });

  it('resetReactionWindowStore drops an open window (new match hygiene)', () => {
    __resetResidentEngineContainer();
    const storeState = { engineState: testState() };
    openReactionWindowStore(storeState, customEvent);
    resetReactionWindowStore();
    const orphan = passReactionStore(storeState, 1);
    expect(orphan.accepted).toBe(false);
    expect(orphan.window).toBeNull();
    __resetResidentEngineContainer();
  });
});

describe('gameStore reaction actions (2.2.25 §12-9c)', () => {
  it('openReactionWindow is a no-op with an empty seat list', () => {
    const state = useGameStore.getState();
    expect(typeof state.openReactionWindow).toBe('function');
    expect(typeof state.passReaction).toBe('function');
    if (state.players.length === 0) {
      expect(state.openReactionWindow()).toBeNull();
      expect(state.reactionWindow).toBeNull();
    }
  });
});
