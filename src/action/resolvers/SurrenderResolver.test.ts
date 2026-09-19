import { describe, it, expect } from 'vitest';
import { SurrenderResolver } from './SurrenderResolver';
import { createAction } from '../ActionTypes';
import type { EngineState, EnginePlayer } from '../../core/GameState';

function createTestPlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id,
    name: 'Player ' + id,
    hp: 4,
    hand: [],
    generalPool: [],
    fieldGenerals: [],
    graveyard: [],
    baseHp: 10,
    baseMaxHp: 10,
    isAlive: true,
    statuses: [],
    ...overrides,
  };
}

function createTestState(players: EnginePlayer[]): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0]?.id ?? null,
    turn: 1,
    round: 1,
    deck: [],
    discardPile: [],
    drawState: null,
  };
}

describe('SurrenderResolver', () => {
  const resolver = new SurrenderResolver();

  describe('canResolve', () => {
    it('should resolve SURRENDER action', () => {
      const action = createAction('SURRENDER', 1);
      expect(resolver.canResolve(action)).toBe(true);
    });

    it('should not resolve other actions', () => {
      const action = createAction('ATTACK', 1, { targetPlayerId: 2 });
      expect(resolver.canResolve(action)).toBe(false);
    });
  });

  describe('validation', () => {
    it('should reject if player not found', () => {
      const state = createTestState([]);
      const action = createAction('SURRENDER', 999);

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('PLAYER_NOT_FOUND');
    });

    it('should reject if player already defeated', () => {
      const defeatedPlayer = createTestPlayer(1, { isAlive: false });
      const state = createTestState([defeatedPlayer]);
      const action = createAction('SURRENDER', 1);

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('PLAYER_ALREADY_DEFEATED');
    });
  });

  describe('valid surrender', () => {
    it('should produce PLAYER_DEFEATED event for alive player', () => {
      const player = createTestPlayer(1);
      const state = createTestState([player]);
      const action = createAction('SURRENDER', 1);

      const events = resolver.resolve(state, action);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('PLAYER_DEFEATED');
      expect((events[0].data as any).playerId).toBe(1);
      expect((events[0].data as any).reason).toBe('SURRENDER');
    });

    it('should allow multiple players to surrender independently', () => {
      const player1 = createTestPlayer(1);
      const player2 = createTestPlayer(2);
      const state = createTestState([player1, player2]);

      const action1 = createAction('SURRENDER', 1);
      const events1 = resolver.resolve(state, action1);
      expect(events1[0].type).toBe('PLAYER_DEFEATED');

      // Player 2 can still surrender
      const action2 = createAction('SURRENDER', 2);
      const events2 = resolver.resolve(state, action2);
      expect(events2[0].type).toBe('PLAYER_DEFEATED');
    });
  });
});