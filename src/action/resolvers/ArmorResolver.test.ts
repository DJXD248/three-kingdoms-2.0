import { describe, it, expect } from 'vitest';
import { ArmorResolver } from './ArmorResolver';
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

function makeFieldGeneral(generalId: string, overrides: Record<string, any> = {}) {
  return {
    general: { id: generalId, hp: 4 }, ownerId: 1, currentHp: 4,
    maxHp: 4, currentArmor: 0, isArming: false,
    position: { zone: 'camp', areaOwnerId: 1, slot: 0 }, ...overrides,
  };
}

const armament = (id: string) => ({ id, type: '军备' });

describe('ArmorResolver', () => {
  const resolver = new ArmorResolver();

  describe('canResolve', () => {
    it('resolves EQUIP_ARMOR', () => {
      expect(resolver.canResolve(createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [] }))).toBe(true);
    });
    it('does not resolve other actions', () => {
      expect(resolver.canResolve(createAction('ATTACK', 1, {}))).toBe(false);
    });
  });

  describe('validation', () => {
    it('rejects invalid payload', () => {
      const state = createTestState([createTestPlayer(1)]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, {} as any));
      expect((events[0].data as any).reason).toBe('INVALID_ARMOR_PAYLOAD');
    });
    it('rejects when general not on field', () => {
      const state = createTestState([createTestPlayer(1)]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [armament('c1')] }));
      expect((events[0].data as any).reason).toBe('GENERAL_NOT_ON_FIELD');
    });
    it('rejects when general not controlled', () => {
      const fg = makeFieldGeneral('g1', { ownerId: 2 });
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [armament('c1')] }));
      expect((events[0].data as any).reason).toBe('GENERAL_NOT_CONTROLLED');
    });
    it('rejects when general already arming', () => {
      const fg = makeFieldGeneral('g1', { isArming: true });
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [armament('c1')] }));
      expect((events[0].data as any).reason).toBe('GENERAL_ALREADY_ARMING');
    });
    it('rejects when general defeated', () => {
      const fg = makeFieldGeneral('g1', { currentHp: 0 });
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [armament('c1')] }));
      expect((events[0].data as any).reason).toBe('GENERAL_DEFEATED');
    });
    it('rejects when no armor selected', () => {
      const fg = makeFieldGeneral('g1');
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [] }));
      expect((events[0].data as any).reason).toBe('NO_ARMOR_SELECTED');
    });
    it('rejects duplicate armor cards', () => {
      const fg = makeFieldGeneral('g1');
      const card = armament('c1');
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg], hand: [card] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [card, card] }));
      expect((events[0].data as any).reason).toBe('DUPLICATE_OR_INVALID_ARMOR_CARD');
    });
    it('rejects non-armament card', () => {
      const fg = makeFieldGeneral('g1');
      const card = { id: 'c1', type: '杀' };
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg], hand: [card] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [card] }));
      expect((events[0].data as any).reason).toBe('NON_ARMAMENT_CARD_SELECTED');
    });
    it('rejects armor card not in hand', () => {
      const fg = makeFieldGeneral('g1');
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg], hand: [] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [armament('c1')] }));
      expect((events[0].data as any).reason).toBe('ARMOR_CARD_NOT_IN_HAND');
    });
    it('rejects when armor capacity exceeded', () => {
      const fg = makeFieldGeneral('g1', { maxHp: 1, currentArmor: 0 });
      const c1 = armament('c1'), c2 = armament('c2');
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg], hand: [c1, c2] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [c1, c2] }));
      expect((events[0].data as any).reason).toBe('ARMOR_CAPACITY_EXCEEDED');
      expect((events[0].data as any).capacity).toBe(1);
    });
  });

  describe('valid equip', () => {
    it('produces ARMOR_EQUIPPED event', () => {
      const fg = makeFieldGeneral('g1', { maxHp: 4, currentArmor: 1 });
      const c1 = armament('c1');
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg], hand: [c1] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [c1] }));
      expect(events[0].type).toBe('ARMOR_EQUIPPED');
      const data = events[0].data as any;
      expect(data.armorAdded).toBe(1);
      expect(data.newArmor).toBe(2);
      expect(data.isArming).toBe(true);
      expect(data.armorCards).toHaveLength(1);
    });
    it('accepts ARMAMENT english type', () => {
      const fg = makeFieldGeneral('g1', { maxHp: 4, currentArmor: 0 });
      const c1 = { id: 'c1', type: 'ARMAMENT' };
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [fg], hand: [c1] })]);
      const events = resolver.resolve(state, createAction('EQUIP_ARMOR', 1, { generalId: 'g1', armorCards: [c1] }));
      expect(events[0].type).toBe('ARMOR_EQUIPPED');
    });
  });
});
