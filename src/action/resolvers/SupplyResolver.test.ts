import { describe, it, expect } from 'vitest';
import { SupplyResolver } from './SupplyResolver';
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

function makeFieldGeneral(generalId: string, overrides: Record<string, any> = {}) {
  return {
    general: { id: generalId, hp: 4 },
    ownerId: 1,
    currentHp: 4,
    maxHp: 4,
    alive: true,
    hasSupplied: false,
    position: { zone: 'camp', areaOwnerId: 1, slot: 0 },
    ...overrides,
  };
}

describe('SupplyResolver', () => {
  const resolver = new SupplyResolver();

  describe('canResolve', () => {
    it('should resolve SUPPLY action', () => {
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [] });
      expect(resolver.canResolve(action)).toBe(true);
    });

    it('should not resolve other actions', () => {
      const action = createAction('ATTACK', 1, { targetPlayerId: 2 });
      expect(resolver.canResolve(action)).toBe(false);
    });
  });

  describe('validation', () => {
    it('should reject invalid payload', () => {
      const player = createTestPlayer(1);
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, {} as any);

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('INVALID_SUPPLY_PAYLOAD');
    });

    it('should reject if supply target not found', () => {
      const player = createTestPlayer(1);
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [{ id: 'c1' }] });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('SUPPLY_TARGET_NOT_FOUND');
    });

    it('should reject if supply target not controlled by player', () => {
      const enemyGeneral = makeFieldGeneral('g1', { ownerId: 2 });
      const player = createTestPlayer(1, { fieldGenerals: [enemyGeneral] });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [{ id: 'c1' }] });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('SUPPLY_TARGET_NOT_CONTROLLED');
    });

    it('should reject if supply target is dead', () => {
      const deadGeneral = makeFieldGeneral('g1', { alive: false, ownerId: 1 });
      const player = createTestPlayer(1, { fieldGenerals: [deadGeneral] });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [{ id: 'c1' }] });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('SUPPLY_TARGET_DEAD');
    });

    it('should reject if general already supplied this turn', () => {
      const suppliedGeneral = makeFieldGeneral('g1', { hasSupplied: true, ownerId: 1 });
      const player = createTestPlayer(1, { fieldGenerals: [suppliedGeneral] });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [{ id: 'c1' }] });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_ALREADY_SUPPLIED');
    });

    it('should reject if general already at full HP', () => {
      const fullHpGeneral = makeFieldGeneral('g1', { currentHp: 4, maxHp: 4, ownerId: 1 });
      const player = createTestPlayer(1, { fieldGenerals: [fullHpGeneral] });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [{ id: 'c1' }] });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_ALREADY_FULL_HP');
    });

    it('should reject if no consume cards provided', () => {
      const damagedGeneral = makeFieldGeneral('g1', { currentHp: 2, maxHp: 4, ownerId: 1 });
      const player = createTestPlayer(1, { fieldGenerals: [damagedGeneral] });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [] });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('SUPPLY_REQUIRES_CARD_COST');
    });

    it('should reject if consume card not in hand', () => {
      const damagedGeneral = makeFieldGeneral('g1', { currentHp: 2, maxHp: 4, ownerId: 1 });
      const player = createTestPlayer(1, {
        fieldGenerals: [damagedGeneral],
        hand: [{ id: 'other' }],
      });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [{ id: 'c1' }] });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('SUPPLY_COST_CARD_NOT_IN_HAND');
    });

    it('should reject duplicate consumed cards', () => {
      const damagedGeneral = makeFieldGeneral('g1', { currentHp: 2, maxHp: 4, ownerId: 1 });
      const consumeCard = { id: 'c1' };
      const player = createTestPlayer(1, {
        fieldGenerals: [damagedGeneral],
        hand: [consumeCard],
      });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, {
        generalId: 'g1',
        consumeCards: [consumeCard, consumeCard],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('DUPLICATE_CONSUMED_CARD');
    });
  });

  describe('supply calculation', () => {
    it('should heal with valid consume cards', () => {
      const damagedGeneral = makeFieldGeneral('g1', { currentHp: 2, maxHp: 4, ownerId: 1 });
      const consumeCards = [{ id: 'c1' }, { id: 'c2' }];
      const player = createTestPlayer(1, {
        fieldGenerals: [damagedGeneral],
        hand: [...consumeCards],
      });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('SUPPLY_RESOLVED');
      // healAmount = min(2 - 0, 2) = 2, consumeCount = min(2, 2 + 0) = 2
      expect((events[0].data as any).healAmount).toBe(2);
      expect((events[0].data as any).extraCost).toBe(0);
      expect((events[0].data as any).consumedCards).toHaveLength(2);
    });

    it('should cap heal at missing HP', () => {
      const slightlyDamaged = makeFieldGeneral('g1', { currentHp: 3, maxHp: 4, ownerId: 1 });
      const consumeCards = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
      const player = createTestPlayer(1, {
        fieldGenerals: [slightlyDamaged],
        hand: [...consumeCards],
      });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('SUPPLY_RESOLVED');
      // healAmount = min(3 - 0, 1) = 1, consumeCount = min(3, 1 + 0) = 1
      expect((events[0].data as any).healAmount).toBe(1);
      expect((events[0].data as any).consumedCards).toHaveLength(1);
    });

    it('should apply extra cost in enemy territory', () => {
      const damagedGeneral = makeFieldGeneral('g1', {
        currentHp: 2,
        maxHp: 4,
        ownerId: 1,
        position: { zone: 'battle', areaOwnerId: 2, slot: 0 },
      });
      const consumeCards = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
      const player = createTestPlayer(1, {
        fieldGenerals: [damagedGeneral],
        hand: [...consumeCards],
      });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('SUPPLY_RESOLVED');
      // inEnemyTerritory: zone !== 'battle' is FALSE (zone === 'battle'), so extraCost = 0
      // healAmount = min(3 - 0, 2) = 2, consumeCount = min(3, 2 + 0) = 2
      expect((events[0].data as any).healAmount).toBe(2);
      expect((events[0].data as any).extraCost).toBe(0);
      expect((events[0].data as any).inEnemyTerritory).toBe(false);
      expect((events[0].data as any).consumedCards).toHaveLength(2);
    });

    it('should apply extra cost when in non-battle enemy zone', () => {
      const damagedGeneral = makeFieldGeneral('g1', {
        currentHp: 2,
        maxHp: 4,
        ownerId: 1,
        position: { zone: 'camp', areaOwnerId: 2, slot: 0 },
      });
      const consumeCards = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
      const player = createTestPlayer(1, {
        fieldGenerals: [damagedGeneral],
        hand: [...consumeCards],
      });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('SUPPLY_RESOLVED');
      // inEnemyTerritory: zone !== 'battle' is TRUE && areaOwnerId !== playerId, so extraCost = 1
      // healAmount = min(3 - 1, 2) = 2, consumeCount = min(3, 2 + 1) = 3
      expect((events[0].data as any).healAmount).toBe(2);
      expect((events[0].data as any).extraCost).toBe(1);
      expect((events[0].data as any).inEnemyTerritory).toBe(true);
      expect((events[0].data as any).consumedCards).toHaveLength(3);
    });

    it('should reject if insufficient cost after enemy territory penalty', () => {
      const damagedGeneral = makeFieldGeneral('g1', {
        currentHp: 3,
        maxHp: 4,
        ownerId: 1,
        position: { zone: 'camp', areaOwnerId: 2, slot: 0 },
      });
      const player = createTestPlayer(1, {
        fieldGenerals: [damagedGeneral],
        hand: [{ id: 'c1' }],
      });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, {
        generalId: 'g1',
        consumeCards: [{ id: 'c1' }],
      });

      const events = resolver.resolve(state, action);
      // inEnemyTerritory: TRUE, extraCost = 1
      // healAmount = min(1 - 1, 1) = 0, should reject
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('INSUFFICIENT_SUPPLY_COST');
    });

    it('should not consume more cards than needed for heal', () => {
      const damagedGeneral = makeFieldGeneral('g1', { currentHp: 1, maxHp: 4, ownerId: 1 });
      const consumeCards = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }];
      const player = createTestPlayer(1, {
        fieldGenerals: [damagedGeneral],
        hand: [...consumeCards],
      });
      const state = createTestState([player]);
      const action = createAction('SUPPLY', 1, { generalId: 'g1', consumeCards });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('SUPPLY_RESOLVED');
      // healAmount = min(4 - 0, 3) = 3, consumeCount = min(4, 3 + 0) = 3
      expect((events[0].data as any).healAmount).toBe(3);
      expect((events[0].data as any).consumedCards).toHaveLength(3);
    });
  });
});