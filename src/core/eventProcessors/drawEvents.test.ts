import { describe, it, expect } from 'vitest';
import { EventProcessor } from '../EventProcessor';
import type { EngineState, EnginePlayer } from '../GameState';
import type { GameEvent } from '../Event';
import { createRngState } from '../rng';

function player(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'P' + id, hp: 4, hand: [],
    generalPool: [{ id: `g${id}a` }, { id: `g${id}b` }, { id: `g${id}c` }],
    fieldGenerals: [], graveyard: [], baseHp: 6, baseMaxHp: 6,
    isAlive: true, statuses: [], ...overrides,
  };
}

function baseState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    players: [player(1)], currentPlayerId: 1, turn: 2, round: 2,
    deck: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }, { id: 'd4' }],
    discardPile: [{ id: 'x1' }, { id: 'x2' }],
    drawState: null, rngState: createRngState(777), ...overrides,
  } as EngineState;
}

const drawEvent = (data: Record<string, unknown>): GameEvent =>
  ({ type: 'DRAW', data: { playerId: 1, ...data } });

const hand = (s: EngineState) => (s.players[0]?.hand ?? []) as { id: string }[];

describe('applyDrawEvent (D-2: seeded selection in processor)', () => {
  const processor = new EventProcessor();

  it('is reproducible from state alone: same seeded state → same outcome', () => {
    const st = baseState();
    const ev = drawEvent({ requestedGeneral: 1, requestedCards: 2, count: 3 });
    const a = processor.process(st, [ev]);
    const b = processor.process(structuredClone(st), [ev]);
    expect(hand(a).map(c => c.id)).toEqual(hand(b).map(c => c.id));
    expect(a.rngState).toEqual(b.rngState);
    expect(a.deck).toEqual(b.deck);
  });

  it('advances the cursor only when a random choice is made', () => {
    const st = baseState();
    // Pure deck draws take the top cards and consume no RNG.
    const deckOnly = processor.process(st, [drawEvent({ requestedGeneral: 0, requestedCards: 1, count: 1 })]);
    expect(deckOnly.rngState!.s).toBe(st.rngState!.s);
    // A general-pool draw shuffles, advancing the cursor.
    const afterGeneral = processor.process(st, [drawEvent({ requestedGeneral: 1, requestedCards: 1, count: 2 })]);
    expect(afterGeneral.rngState!.s).not.toBe(st.rngState!.s);
    const twice = processor.process(afterGeneral, [drawEvent({ requestedGeneral: 1, requestedCards: 0, count: 1 })]);
    expect(hand(twice)).toHaveLength(3);
    // Deck picks always come off the top in order:
    expect(hand(twice).filter(c => /^d/.test(c.id)).map(c => c.id)).toEqual(['d1']);
  });

  it('draws generals via the seeded shuffle and removes them from the pool', () => {
    const st = baseState();
    const after = processor.process(st, [drawEvent({ requestedGeneral: 2, requestedCards: 0, count: 2 })]);
    const pool = after.players[0]!.generalPool as { id: string }[];
    const drawn = hand(after).map(c => c.id);
    expect(drawn).toHaveLength(2);
    expect(pool).toHaveLength(1);
    for (const id of drawn) expect(id).toMatch(/^g1/);
    expect(pool.some(g => drawn.includes(g.id))).toBe(false);
  });

  it('reshuffles the discard pile with the cursor when the deck runs short', () => {
    const st = baseState({ deck: [{ id: 'd1' }], discardPile: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }] });
    const after = processor.process(st, [drawEvent({ requestedGeneral: 0, requestedCards: 3, count: 3 })]);
    expect(hand(after).map(c => c.id)[0]).toBe('d1');
    expect(hand(after)).toHaveLength(3);
    const drawnIds = hand(after).map(c => c.id);
    expect(drawnIds.filter(id => id.startsWith('x'))).toHaveLength(2);
    expect(after.deck).toHaveLength(0);
    expect(after.discardPile).toHaveLength(1);
  });

  it('supports bare-count skill draws (DRAW_CARD bridge payload)', () => {
    const st = baseState();
    const after = processor.process(st, [drawEvent({ count: 1, skillId: 's1', skillName: '演練・勤学', effectType: 'DRAW_CARD' })]);
    expect(hand(after).map(c => c.id)).toEqual(['d1']);
    expect(after.deck).toHaveLength(3);
  });

  it('lazily seeds a legacy state without rngState and writes the cursor back', () => {
    const st = baseState();
    delete (st as { rngState?: unknown }).rngState;
    const ev = drawEvent({ requestedGeneral: 1, requestedCards: 1, count: 2 });
    const a = processor.process(st, [ev]);
    const b = processor.process(structuredClone(st), [ev]);
    expect(a.rngState).toBeDefined();
    expect(hand(a).map(c => c.id)).toEqual(hand(b).map(c => c.id));
    // Replaying the SAME resulting state continues the stream, not a reseed.
    const c = processor.process(a, [ev]);
    const d = processor.process(structuredClone(a), [ev]);
    expect(hand(c).map(x => x.id)).toEqual(hand(d).map(x => x.id));
    expect(c.rngState).toEqual(d.rngState);
  });

  it('threads the cursor across a multi-event queue', () => {
    const st = baseState();
    const queue = [
      drawEvent({ requestedGeneral: 1, requestedCards: 1, count: 2 }),
      { type: 'PHASE_CHANGED', data: { to: 'ACTION' } } as GameEvent,
      drawEvent({ requestedGeneral: 0, requestedCards: 1, count: 1 }),
    ];
    const after = processor.process(st, queue);
    expect(hand(after)).toHaveLength(3);
    expect(after.rngState!.s).not.toBe(st.rngState!.s);
    const replay = processor.process(structuredClone(st), queue);
    expect(after.rngState).toEqual(replay.rngState);
    expect(hand(replay).map(c => c.id)).toEqual(hand(after).map(c => c.id));
  });

  it('is a no-op for unknown players and zero-count events', () => {
    const st = baseState();
    expect(processor.process(st, [drawEvent({ requestedGeneral: 1, count: 1, playerId: 99 })])).toEqual(st);
    const same = processor.process(st, [drawEvent({ requestedGeneral: 0, requestedCards: 0, count: 0 })]);
    expect(hand(same)).toHaveLength(0);
    expect(same.rngState!.s).toBe(st.rngState!.s);
  });
});
