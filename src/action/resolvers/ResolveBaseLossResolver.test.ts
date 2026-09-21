import { describe, it, expect } from 'vitest';
import { ResolveBaseLossResolver } from './ResolveBaseLossResolver';
import { createAction } from '../ActionTypes';
import type { EngineState, EnginePlayer } from '../../core/GameState';

function createTestPlayer(id: number): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [],
    fieldGenerals: [], graveyard: [], baseHp: 10, baseMaxHp: 10,
    isAlive: true, statuses: [],
  };
}

function createStateWithDraw(playerId: number, baseLossPending: boolean): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    players: [createTestPlayer(1), createTestPlayer(2)],
    currentPlayerId: playerId, turn: 1, round: 1, deck: [], discardPile: [],
    drawState: { reason: 'turnStart', playerId, totalCards: 0, baseLossPending },
  };
}

describe('ResolveBaseLossResolver', () => {
  const resolver = new ResolveBaseLossResolver();

  it('resolves RESOLVE_BASE_LOSS only', () => {
    expect(resolver.canResolve(createAction('RESOLVE_BASE_LOSS', 1, {}))).toBe(true);
    expect(resolver.canResolve(createAction('DRAW', 1, {}))).toBe(false);
  });

  it('rejects when no pending base loss', () => {
    const state = createStateWithDraw(1, false);
    const events = resolver.resolve(state, createAction('RESOLVE_BASE_LOSS', 1, {}));
    expect(events[0].type).toBe('ACTION_REJECTED');
    expect((events[0].data as any).reason).toBe('NO_PENDING_BASE_LOSS');
  });

  it('rejects when draw belongs to another player', () => {
    const state = createStateWithDraw(1, true);
    const events = resolver.resolve(state, createAction('RESOLVE_BASE_LOSS', 2, {}));
    expect((events[0].data as any).reason).toBe('NO_PENDING_BASE_LOSS');
  });

  it('emits BASE_DAMAGE of 1 using draw reason', () => {
    const state = createStateWithDraw(1, true);
    const events = resolver.resolve(state, createAction('RESOLVE_BASE_LOSS', 1, {}));
    expect(events[0].type).toBe('BASE_DAMAGE');
    expect((events[0].data as any).amount).toBe(1);
    expect((events[0].data as any).playerId).toBe(1);
    expect((events[0].data as any).reason).toBe('turnStart');
  });

  it('prefers payload reason over draw reason', () => {
    const state = createStateWithDraw(1, true);
    const events = resolver.resolve(state, createAction('RESOLVE_BASE_LOSS', 1, { reason: 'compensation' }));
    expect((events[0].data as any).reason).toBe('compensation');
  });
});
