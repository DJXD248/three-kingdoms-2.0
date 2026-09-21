import { describe, it, expect } from 'vitest';
import { ConfirmDrawResolver } from './ConfirmDrawResolver';
import { createAction } from '../ActionTypes';
import type { EngineState, EnginePlayer } from '../../core/GameState';

function createTestPlayer(id: number): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [],
    fieldGenerals: [], graveyard: [], baseHp: 10, baseMaxHp: 10,
    isAlive: true, statuses: [],
  };
}

function stateWith(draw: EngineState['drawState'], players?: EnginePlayer[]): EngineState {
  const ps = players ?? [createTestPlayer(1), createTestPlayer(2)];
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players: ps,
    currentPlayerId: ps[0]?.id ?? null, turn: 1, round: 1,
    deck: [], discardPile: [], drawState: draw,
  };
}

describe('ConfirmDrawResolver', () => {
  const resolver = new ConfirmDrawResolver();

  it('resolves CONFIRM_DRAW only', () => {
    expect(resolver.canResolve(createAction('CONFIRM_DRAW', 1, {}))).toBe(true);
    expect(resolver.canResolve(createAction('DRAW', 1, {}))).toBe(false);
  });

  it('rejects when no pending draw', () => {
    const events = resolver.resolve(stateWith(null), createAction('CONFIRM_DRAW', 1, {}));
    expect(events[0].type).toBe('ACTION_REJECTED');
    expect((events[0].data as any).reason).toBe('NO_PENDING_DRAW_CONFIRMATION');
  });

  it('rejects when draw player mismatch', () => {
    const st = stateWith({ reason: 'turnStart', playerId: 1, totalCards: 5 });
    const events = resolver.resolve(st, createAction('CONFIRM_DRAW', 2, {}));
    expect((events[0].data as any).reason).toBe('NO_PENDING_DRAW_CONFIRMATION');
  });

  it('initial non-last player chains to next player DRAW_REQUIRED', () => {
    const st = stateWith({ reason: 'initial', playerId: 1, totalCards: 5 });
    const events = resolver.resolve(st, createAction('CONFIRM_DRAW', 1, {}));
    expect(events[0].type).toBe('DRAW_CONFIRMED');
    expect((events[0].data as any).completed).toBe(false);
    expect((events[0].data as any).nextPlayerId).toBe(2);
    expect(events[1].type).toBe('DRAW_REQUIRED');
    expect((events[1].data as any).playerId).toBe(2);
  });

  it('initial last player completes and moves to ACTION phase', () => {
    const st = stateWith({ reason: 'initial', playerId: 2, totalCards: 5 });
    const events = resolver.resolve(st, createAction('CONFIRM_DRAW', 2, {}));
    expect((events[0].data as any).completed).toBe(true);
    expect((events[0].data as any).nextPlayerId).toBe(1);
    expect(events[1].type).toBe('PHASE_CHANGED');
    expect((events[1].data as any).to).toBe('ACTION');
  });

  it('turnStart confirms and changes phase to ACTION', () => {
    const st = stateWith({ reason: 'turnStart', playerId: 1, totalCards: 5 });
    const events = resolver.resolve(st, createAction('CONFIRM_DRAW', 1, {}));
    expect(events[0].type).toBe('DRAW_CONFIRMED');
    expect((events[0].data as any).completed).toBe(true);
    expect(events[1].type).toBe('PHASE_CHANGED');
    expect((events[1].data as any).playerId).toBe(1);
  });

  it('compensation resumes stored phase and player', () => {
    const st = stateWith({ reason: 'compensation', playerId: 1, totalCards: 2, resumePhase: 'ACTION', resumePlayerId: 2 });
    const events = resolver.resolve(st, createAction('CONFIRM_DRAW', 1, {}));
    expect((events[0].data as any).resumePlayerId).toBe(2);
    expect((events[1].data as any).to).toBe('ACTION');
    expect((events[1].data as any).playerId).toBe(2);
  });

  it('unknown reason still confirms single event', () => {
    const st = stateWith({ reason: 'other' as any, playerId: 1, totalCards: 0 });
    const events = resolver.resolve(st, createAction('CONFIRM_DRAW', 1, {}));
    expect(events).toHaveLength(1);
    expect((events[0].data as any).completed).toBe(true);
  });
});
