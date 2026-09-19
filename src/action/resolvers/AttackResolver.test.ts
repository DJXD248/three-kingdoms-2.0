import { describe, it, expect } from 'vitest';
import { AttackResolver } from './AttackResolver';
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

function makeFieldGeneral(id: string, overrides: Record<string, any> = {}) {
  return {
    general: { id, hp: 4, meleeAtk: 2, rangedAtk: 1 },
    currentHp: 4,
    maxHp: 4,
    meleeAtk: 2,
    rangedAtk: 1,
    armor: 0,
    currentArmor: 0,
    armorCards: [],
    isArming: false,
    hasMoved: false,
    hasAttacked: false,
    hasSupplied: false,
    justDeployed: false,
    ownerId: 1,
    position: { zone: 'front' as const, slot: 0, areaOwnerId: 1 },
    ...overrides,
  };
}

describe('AttackResolver', () => {
  const resolver = new AttackResolver();

  describe('canResolve', () => {
    it('should return true for ATTACK actions', () => {
      const action = createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false });
      expect(resolver.canResolve(action)).toBe(true);
    });

    it('should return false for non-ATTACK actions', () => {
      const action = createAction('END_TURN', 1);
      expect(resolver.canResolve(action)).toBe(false);
    });
  });

  describe('resolve - validation', () => {
    it('should reject attack with missing payload', () => {
      const state = createTestState([createTestPlayer(1)]);
      const action = createAction('ATTACK', 1);
      const events = resolver.resolve(state, action);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ACTION_REJECTED');
    });

    it('should reject attack when attacker is not controlled by player', () => {
      const general = makeFieldGeneral('g1', { ownerId: 2 });
      const player1 = createTestPlayer(1, { fieldGenerals: [] });
      const player2 = createTestPlayer(2, { fieldGenerals: [general] });
      const state = createTestState([player1, player2]);

      const action = createAction('ATTACK', 1, {
        attackerId: 'g1',
        targetId: 'g2',
        ranged: false,
        consumeCard: { id: 'c1' },
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('ATTACKER_NOT_CONTROLLED');
    });

    it('should reject attack when general is arming', () => {
      const general = makeFieldGeneral('g1', { isArming: true, ownerId: 1 });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('ATTACK', 1, {
        attackerId: 'g1',
        targetId: 'base_2',
        ranged: false,
        consumeCard: { id: 'c1' },
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_IS_ARMING');
    });

    it('should reject attack when general has already attacked', () => {
      const general = makeFieldGeneral('g1', { hasAttacked: true, ownerId: 1 });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('ATTACK', 1, {
        attackerId: 'g1',
        targetId: 'base_2',
        ranged: false,
        consumeCard: { id: 'c1' },
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_ALREADY_ATTACKED');
    });

    it('should reject attack without consumeCard', () => {
      const general = makeFieldGeneral('g1', { ownerId: 1 });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('ATTACK', 1, {
        attackerId: 'g1',
        targetId: 'base_2',
        ranged: false,
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('ATTACK_REQUIRES_CARD_COST');
    });
  });

  describe('resolve - base attack', () => {
    it('should emit BEFORE_DAMAGE, DAMAGE, ATTACK_RESOLVED, AFTER_DAMAGE for base attack', () => {
      const general = makeFieldGeneral('g1', {
        ownerId: 1,
        position: { zone: 'front', slot: 0, areaOwnerId: 2 },
      });
      const consumeCard = { id: 'c1', type: 'supply' };
      const player1 = createTestPlayer(1, { fieldGenerals: [general], hand: [consumeCard] });
      const player2 = createTestPlayer(2, { baseHp: 10 });
      const state = createTestState([player1, player2]);

      const action = createAction('ATTACK', 1, {
        attackerId: 'g1',
        targetId: 'base_2',
        ranged: false,
        consumeCard,
      });

      const events = resolver.resolve(state, action);

      expect(events.map(e => e.type)).toEqual([
        'BEFORE_DAMAGE',
        'DAMAGE',
        'ATTACK_RESOLVED',
        'AFTER_DAMAGE',
      ]);

      const damageEvent = events.find(e => e.type === 'DAMAGE');
      expect((damageEvent?.data as any).isBase).toBe(true);
      expect((damageEvent?.data as any).targetPlayerId).toBe(2);
    });

    it('should reject base attack when target player is dead', () => {
      const general = makeFieldGeneral('g1', { ownerId: 1 });
      const player1 = createTestPlayer(1, { fieldGenerals: [general] });
      const player2 = createTestPlayer(2, { isAlive: false });
      const state = createTestState([player1, player2]);

      const action = createAction('ATTACK', 1, {
        attackerId: 'g1',
        targetId: 'base_2',
        ranged: false,
        consumeCard: { id: 'c1' },
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
    });
  });

  describe('resolve - general attack', () => {
    it('should emit DAMAGE and DEATH events when general is defeated', () => {
      const attacker = makeFieldGeneral('g1', { ownerId: 1, position: { zone: 'front', slot: 0, areaOwnerId: 1 } });
      const target = makeFieldGeneral('g2', { ownerId: 2, currentHp: 1, maxHp: 2, position: { zone: 'front', slot: 0, areaOwnerId: 1 } });
      const consumeCard = { id: 'c1', type: 'supply' };

      const player1 = createTestPlayer(1, { fieldGenerals: [attacker], hand: [consumeCard] });
      const player2 = createTestPlayer(2, { fieldGenerals: [target] });
      const state = createTestState([player1, player2]);

      const action = createAction('ATTACK', 1, {
        attackerId: 'g1',
        targetId: 'g2',
        ranged: false,
        consumeCard,
      });

      const events = resolver.resolve(state, action);

      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('DAMAGE');
      expect(eventTypes).toContain('DEATH');
      expect(eventTypes).toContain('ATTACK_RESOLVED');
    });

    it('should reject attack on own general', () => {
      const general1 = makeFieldGeneral('g1', { ownerId: 1 });
      const general2 = makeFieldGeneral('g2', { ownerId: 1 });
      const consumeCard = { id: 'c1' };
      const player = createTestPlayer(1, { fieldGenerals: [general1, general2], hand: [consumeCard] });
      const state = createTestState([player]);

      const action = createAction('ATTACK', 1, {
        attackerId: 'g1',
        targetId: 'g2',
        ranged: false,
        consumeCard,
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('INVALID_ATTACK_TARGET');
    });
  });
});