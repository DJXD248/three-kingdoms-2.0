import { describe, it, expect } from 'vitest';
import { BeginDrawResolver } from './BeginDrawResolver';
import { createAction } from '../ActionTypes';
import type { EngineState, EnginePlayer } from '../../core/GameState';

function createTestPlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [],
    fieldGenerals: [], graveyard: [], baseHp: 10, baseMaxHp: 10,
    isAlive: true, statuses: [], ...overrides,
  };
}

function createTestState(players: EnginePlayer[]): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: [], discardPile: [], drawState: null,
  };
}

describe('BeginDrawResolver', () => {
  const resolver = new BeginDrawResolver();

  it('resolves BEGIN_DRAW only', () => {
    expect(resolver.canResolve(createAction('BEGIN_DRAW', 1, {}))).toBe(true);
    expect(resolver.canResolve(createAction('DRAW', 1, {}))).toBe(false);
  });

  it('rejects when player not found', () => {
    const state = createTestState([createTestPlayer(1)]);
    const events = resolver.resolve(state, createAction('BEGIN_DRAW', 99, { reason: 'turnStart' }));
    expect(events[0].type).toBe('ACTION_REJECTED');
    expect((events[0].data as any).reason).toBe('DRAW_PLAYER_NOT_FOUND');
  });

  it('emits DRAW_REQUIRED with defaults', () => {
    const state = createTestState([createTestPlayer(1)]);
    const events = resolver.resolve(state, createAction('BEGIN_DRAW', 1, { reason: 'turnStart' }));
    expect(events[0].type).toBe('DRAW_REQUIRED');
    const data = events[0].data as any;
    expect(data.playerId).toBe(1);
    expect(data.reason).toBe('turnStart');
    expect(data.totalCards).toBe(5);
    expect(data.baseLossPending).toBe(false);
  });

  it('uses explicit totalCards and clamps negatives', () => {
    const state = createTestState([createTestPlayer(1)]);
    const events = resolver.resolve(state, createAction('BEGIN_DRAW', 1, { reason: 'initial', totalCards: 3 }));
    expect((events[0].data as any).totalCards).toBe(3);
    const neg = resolver.resolve(state, createAction('BEGIN_DRAW', 1, { reason: 'initial', totalCards: -5 }));
    expect((neg[0].data as any).totalCards).toBe(0);
  });

  it('prefers payload.playerId over action.playerId', () => {
    const state = createTestState([createTestPlayer(1), createTestPlayer(2)]);
    const events = resolver.resolve(state, createAction('BEGIN_DRAW', 1, { reason: 'turnStart', playerId: 2 }));
    expect((events[0].data as any).playerId).toBe(2);
  });

  it('propagates baseLossPending', () => {
    const state = createTestState([createTestPlayer(1)]);
    const events = resolver.resolve(state, createAction('BEGIN_DRAW', 1, { reason: 'turnStart', baseLossPending: true }));
    expect((events[0].data as any).baseLossPending).toBe(true);
  });
});
