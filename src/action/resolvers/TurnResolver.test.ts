import { describe, it, expect } from 'vitest';
import { TurnResolver } from './TurnResolver';
import { createAction } from '../ActionTypes';
import type { EngineState, EnginePlayer } from '../../core/GameState';

function createTestPlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [{ id: 'g' + id }],
    fieldGenerals: [], graveyard: [], baseHp: 10, baseMaxHp: 10,
    isAlive: true, statuses: [], ...overrides,
  };
}

function createTestState(players: EnginePlayer[], overrides: Partial<EngineState> = {}): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: [], discardPile: [], drawState: null, ...overrides,
  };
}

describe('TurnResolver', () => {
  const resolver = new TurnResolver();

  describe('canResolve', () => {
    it('resolves END_TURN', () => {
      expect(resolver.canResolve(createAction('END_TURN', 1))).toBe(true);
    });
    it('does not resolve other actions', () => {
      expect(resolver.canResolve(createAction('ATTACK', 1, {}))).toBe(false);
    });
  });

  describe('turn progression', () => {
    it('emits four events in order for normal advance', () => {
      const players = [createTestPlayer(1), createTestPlayer(2)];
      const state = createTestState(players);
      const events = resolver.resolve(state, createAction('END_TURN', 1));
      expect(events.map(e => e.type)).toEqual([
        'TURN_END', 'TURN_START', 'TURN_ACTIONS_RESET', 'DRAW_REQUIRED',
      ]);
      expect((events[0].data as any).nextPlayerId).toBe(2);
      expect((events[0].data as any).fromIndex).toBe(0);
      expect((events[0].data as any).toIndex).toBe(1);
    });

    it('skips dead players when choosing next', () => {
      const players = [
        createTestPlayer(1),
        createTestPlayer(2, { isAlive: false }),
        createTestPlayer(3),
      ];
      const state = createTestState(players);
      const events = resolver.resolve(state, createAction('END_TURN', 1));
      expect((events[0].data as any).nextPlayerId).toBe(3);
      expect((events[0].data as any).toIndex).toBe(2);
    });

    it('increments round when wrapping back to an earlier index', () => {
      const players = [createTestPlayer(1), createTestPlayer(2)];
      const state = createTestState(players, { round: 1 });
      const events = resolver.resolve(state, createAction('END_TURN', 2));
      expect((events[0].data as any).nextPlayerId).toBe(1);
      expect((events[0].data as any).nextRound).toBe(2);
    });

    it('keeps round when advancing forward within same cycle', () => {
      const players = [createTestPlayer(1), createTestPlayer(2)];
      const state = createTestState(players, { round: 3 });
      const events = resolver.resolve(state, createAction('END_TURN', 1));
      expect((events[0].data as any).nextRound).toBe(3);
    });
  });

  describe('draw count and base-loss', () => {
    it('wrapping to first player bumps round to 2 and draws 5', () => {
      const players = [createTestPlayer(1), createTestPlayer(2)];
      const state = createTestState(players, { round: 1 });
      const events = resolver.resolve(state, createAction('END_TURN', 2));
      const draw = events[3].data as any;
      expect((events[0].data as any).nextRound).toBe(2);
      expect(draw.totalCards).toBe(5);
    });

    it('round 1 non-first player draws 1', () => {
      const players = [createTestPlayer(1), createTestPlayer(2)];
      const state = createTestState(players, { round: 1 });
      const events = resolver.resolve(state, createAction('END_TURN', 1));
      const draw = events[3].data as any;
      expect(draw.totalCards).toBe(1);
    });

    it('round 2 onward draws 5', () => {
      const players = [createTestPlayer(1), createTestPlayer(2)];
      const state = createTestState(players, { round: 2 });
      const events = resolver.resolve(state, createAction('END_TURN', 1));
      const draw = events[3].data as any;
      expect(draw.totalCards).toBe(5);
    });

    it('marks baseLossPending when next player has empty pool', () => {
      const players = [
        createTestPlayer(1),
        createTestPlayer(2, { generalPool: [] }),
      ];
      const state = createTestState(players);
      const events = resolver.resolve(state, createAction('END_TURN', 1));
      expect((events[3].data as any).baseLossPending).toBe(true);
    });

    it('baseLossPending false when next player has pool cards', () => {
      const players = [createTestPlayer(1), createTestPlayer(2)];
      const state = createTestState(players);
      const events = resolver.resolve(state, createAction('END_TURN', 1));
      expect((events[3].data as any).baseLossPending).toBe(false);
    });
  });
});
