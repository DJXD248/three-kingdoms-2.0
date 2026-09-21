import { describe, it, expect } from 'vitest';
import { DrawResolver } from './DrawResolver';
import { createAction } from '../ActionTypes';
import type { EngineState, EnginePlayer } from '../../core/GameState';

function createTestPlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [],
    generalPool: [{ id: 'pg1' }, { id: 'pg2' }],
    fieldGenerals: [], graveyard: [], baseHp: 10, baseMaxHp: 10,
    isAlive: true, statuses: [], ...overrides,
  };
}

function state(opts: { drawState: EngineState['drawState']; players?: EnginePlayer[]; deck?: unknown[]; discard?: unknown[] }): EngineState {
  const players = opts.players ?? [createTestPlayer(1)];
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: opts.deck ?? [], discardPile: opts.discard ?? [], drawState: opts.drawState,
  };
}

const ds = (playerId: number, totalCards: number) => ({ reason: 'turnStart' as const, playerId, totalCards });

describe('DrawResolver', () => {
  const resolver = new DrawResolver();

  it('resolves DRAW only', () => {
    expect(resolver.canResolve(createAction('DRAW', 1, {}))).toBe(true);
    expect(resolver.canResolve(createAction('CONFIRM_DRAW', 1, {}))).toBe(false);
  });

  it('rejects when no pending draw', () => {
    const events = resolver.resolve(state({ drawState: null }), createAction('DRAW', 1, { fromGeneralPool: 1, fromCardPool: 1 }));
    expect((events[0].data as any).reason).toBe('NO_PENDING_DRAW');
  });

  it('rejects when draw belongs to another player', () => {
    const events = resolver.resolve(state({ drawState: ds(1, 2) }), createAction('DRAW', 2, { fromGeneralPool: 1, fromCardPool: 1 }));
    expect((events[0].data as any).reason).toBe('NO_PENDING_DRAW');
  });

  it('rejects when player dead', () => {
    const st = state({ drawState: ds(1, 2), players: [createTestPlayer(1, { isAlive: false })] });
    const events = resolver.resolve(st, createAction('DRAW', 1, { fromGeneralPool: 1, fromCardPool: 1 }));
    expect((events[0].data as any).reason).toBe('DRAW_PLAYER_NOT_FOUND');
  });

  it('rejects on total mismatch', () => {
    const st = state({ drawState: ds(1, 5) });
    const events = resolver.resolve(st, createAction('DRAW', 1, { fromGeneralPool: 1, fromCardPool: 1 }));
    expect((events[0].data as any).reason).toBe('DRAW_TOTAL_MISMATCH');
    expect((events[0].data as any).expected).toBe(5);
  });

  it('splits general and card draws', () => {
    const deck = [{ id: 'd1' }, { id: 'd2' }];
    const st = state({ drawState: ds(1, 3), deck });
    const events = resolver.resolve(st, createAction('DRAW', 1, { fromGeneralPool: 1, fromCardPool: 2 }));
    expect(events[0].type).toBe('DRAW');
    const data = events[0].data as any;
    expect(data.generalCards).toHaveLength(1);
    expect(data.cardCards).toHaveLength(2);
    expect(data.count).toBe(3);
    expect(data.reshuffleUsed).toBe(false);
  });

  it('reshuffles discard pile when deck is short', () => {
    const deck = [{ id: 'd1' }];
    const discard = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }];
    const st = state({ drawState: ds(1, 3), deck, discard });
    const events = resolver.resolve(st, createAction('DRAW', 1, { fromGeneralPool: 0, fromCardPool: 3 }));
    const data = events[0].data as any;
    expect(data.reshuffleUsed).toBe(true);
    expect(data.cardCards.length).toBe(3);
    expect(data.reshuffledCardCards.length).toBe(2);
  });

  it('never selects more generals than the pool holds', () => {
    const st = state({ drawState: ds(1, 5), players: [createTestPlayer(1, { generalPool: [{ id: 'pg1' }] })] });
    const events = resolver.resolve(st, createAction('DRAW', 1, { fromGeneralPool: 5, fromCardPool: 0 }));
    const data = events[0].data as any;
    expect(data.generalCards).toHaveLength(1);
    expect(data.count).toBe(1);
  });
});
