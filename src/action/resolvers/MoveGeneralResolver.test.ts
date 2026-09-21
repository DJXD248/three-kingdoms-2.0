import { describe, it, expect } from 'vitest';
import { MoveGeneralResolver } from './MoveGeneralResolver';
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
    general: { id, hp: 4, type: 'warrior', generalType: 'WARRIOR' },
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
    position: { zone: 'camp' as const, slot: 0, areaOwnerId: 1 },
    ...overrides,
  };
}

describe('MoveGeneralResolver', () => {
  const resolver = new MoveGeneralResolver();

  describe('canResolve', () => {
    it('should return true for MOVE_GENERAL actions', () => {
      const action = createAction('MOVE_GENERAL', 1, { generalId: 'g1', target: { zone: 'front', slot: 0, areaOwnerId: 1 } });
      expect(resolver.canResolve(action)).toBe(true);
    });

    it('should return false for non-MOVE_GENERAL actions', () => {
      const action = createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false });
      expect(resolver.canResolve(action)).toBe(false);
    });
  });

  describe('resolve - validation', () => {
    it('should reject move with missing payload', () => {
      const state = createTestState([createTestPlayer(1)]);
      const action = createAction('MOVE_GENERAL', 1);
      const events = resolver.resolve(state, action as any);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ACTION_REJECTED');
    });

    it('should reject move when general is not on field', () => {
      const player = createTestPlayer(1, { fieldGenerals: [] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });

      const events = resolver.resolve(state, action as any);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_NOT_ON_FIELD');
    });

    it('should reject move when general has already moved', () => {
      const general = makeFieldGeneral('g1', { hasMoved: true, ownerId: 1 });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });

      const events = resolver.resolve(state, action as any);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_ALREADY_MOVED');
    });

    it('should reject move to invalid target', () => {
      const general = makeFieldGeneral('g1', { ownerId: 1, position: { zone: 'camp', slot: 0, areaOwnerId: 1 } });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'battle', slot: 0, areaOwnerId: null },
      });

      const events = resolver.resolve(state, action as any);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('INVALID_MOVE_TARGET');
    });
  });

  describe('resolve - valid moves', () => {
    it('should emit GENERAL_MOVED for valid camp-to-front move', () => {
      const general = makeFieldGeneral('g1', { ownerId: 1, position: { zone: 'camp', slot: 0, areaOwnerId: 1 } });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });

      const events = resolver.resolve(state, action as any);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('GENERAL_MOVED');
      expect((events[0].data as any).generalId).toBe('g1');
      expect((events[0].data as any).target.zone).toBe('front');
    });

    it('should require cost for scholar general move', () => {
      const general = makeFieldGeneral('g1', {
        ownerId: 1,
        general: { id: 'g1', hp: 4, type: 'scholar', generalType: 'SCHOLAR' },
        position: { zone: 'camp', slot: 0, areaOwnerId: 1 },
      });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });

      const events = resolver.resolve(state, action as any);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('SCHOLAR_REQUIRES_MOVE_COST');
    });

    it('should reject warrior move with cost', () => {
      const general = makeFieldGeneral('g1', { ownerId: 1, position: { zone: 'camp', slot: 0, areaOwnerId: 1 } });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
        consumeCard: { id: 'c1' },
      });

      const events = resolver.resolve(state, action as any);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('WARRIOR_MOVE_HAS_NO_COST');
    });

    it('should allow scholar move with valid cost card', () => {
      const general = makeFieldGeneral('g1', {
        ownerId: 1,
        general: { id: 'g1', hp: 4, type: 'scholar', generalType: 'SCHOLAR' },
        position: { zone: 'camp', slot: 0, areaOwnerId: 1 },
      });
      const costCard = { id: 'c1', type: 'supply' };
      const player = createTestPlayer(1, { fieldGenerals: [general], hand: [costCard] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
        consumeCard: costCard,
      });

      const events = resolver.resolve(state, action as any);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('GENERAL_MOVED');
    });
  });
});