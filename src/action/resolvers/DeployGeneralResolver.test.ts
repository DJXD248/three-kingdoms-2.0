import { describe, it, expect } from 'vitest';
import { DeployGeneralResolver } from './DeployGeneralResolver';
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

describe('DeployGeneralResolver', () => {
  const resolver = new DeployGeneralResolver();

  describe('canResolve', () => {
    it('should resolve DEPLOY_GENERAL action', () => {
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: { id: 'g1', name: 'Guan Yu', faction: 'shu', hp: 3 },
        slot: 0,
        consumeCards: [],
      });
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
      const action = createAction('DEPLOY_GENERAL', 1, {} as any);

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('INVALID_DEPLOY_PAYLOAD');
    });

    it('should reject if general not in hand', () => {
      const player = createTestPlayer(1, { hand: [{ id: 'c1' }] });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: { id: 'g1', name: 'Guan Yu', faction: 'shu', hp: 3 },
        slot: 0,
        consumeCards: [{ id: 'c1' }],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_NOT_IN_HAND');
    });

    it('should reject if general already in pool', () => {
      const generalCard = { id: 'g1' };
      const player = createTestPlayer(1, {
        hand: [generalCard],
        generalPool: [generalCard],
      });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 0,
        consumeCards: [],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_ALREADY_IN_POOL');
    });

    it('should reject if general already deployed', () => {
      const generalCard = { id: 'g1' };
      const deployedGeneral = {
        general: generalCard,
        position: { zone: 'camp', areaOwnerId: 1, slot: 0 },
      };
      const player = createTestPlayer(1, {
        hand: [generalCard],
        fieldGenerals: [deployedGeneral],
      });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 1,
        consumeCards: [],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_ALREADY_DEPLOYED');
    });

    it('should reject invalid camp slot', () => {
      const generalCard = { id: 'g1' };
      const player = createTestPlayer(1, { hand: [generalCard] });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 5,
        consumeCards: [],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('INVALID_CAMP_SLOT');
    });

    it('should reject occupied camp slot', () => {
      const generalCard = { id: 'g1' };
      const anotherGeneral = { id: 'g2' };
      const deployedGeneral = {
        general: anotherGeneral,
        position: { zone: 'camp', areaOwnerId: 1, slot: 0 },
      };
      const player = createTestPlayer(1, {
        hand: [generalCard],
        fieldGenerals: [deployedGeneral],
      });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 0,
        consumeCards: [],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('CAMP_SLOT_OCCUPIED');
    });

    it('should reject invalid deploy cost', () => {
      const generalCard = { id: 'g1', hp: 3 };
      const player = createTestPlayer(1, { hand: [generalCard] });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 0,
        consumeCards: [],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('INVALID_DEPLOY_COST');
    });

    it('should reject duplicate consumed cards', () => {
      const generalCard = { id: 'g1', hp: 3 };
      const consumeCard = { id: 'c1' };
      const player = createTestPlayer(1, {
        hand: [generalCard, consumeCard],
      });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 0,
        consumeCards: [consumeCard, consumeCard],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('DUPLICATE_CONSUMED_CARD');
    });

    it('should reject if consumed card not in hand', () => {
      const generalCard = { id: 'g1', hp: 3 };
      const player = createTestPlayer(1, { hand: [generalCard] });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 0,
        consumeCards: [{ id: 'c1' }],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('CONSUMED_CARD_NOT_IN_HAND');
    });

    it('should reject if general consumes itself', () => {
      const generalCard = { id: 'g1', hp: 3 };
      const player = createTestPlayer(1, { hand: [generalCard] });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 0,
        consumeCards: [generalCard],
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_CANNOT_CONSUME_SELF');
    });
  });

  describe('valid deployment', () => {
    it('should produce GENERAL_DEPLOYED event with valid payload', () => {
      const generalCard = { id: 'g1', name: 'Guan Yu', faction: 'shu', hp: 3 };
      const consumeCard = { id: 'c1' };
      const player = createTestPlayer(1, {
        hand: [generalCard, consumeCard],
      });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 0,
        consumeCards: [consumeCard],
      });

      const events = resolver.resolve(state, action);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('GENERAL_DEPLOYED');
      expect((events[0].data as any).general).toEqual(generalCard);
      expect((events[0].data as any).slot).toBe(0);
      expect((events[0].data as any).consumeCards).toHaveLength(1);
    });

    it('should allow multiple consume cards up to general HP', () => {
      const generalCard = { id: 'g1', name: 'Zhang Fei', faction: 'shu', hp: 4 };
      const consumeCards = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
      const player = createTestPlayer(1, {
        hand: [generalCard, ...consumeCards],
      });
      const state = createTestState([player]);
      const action = createAction('DEPLOY_GENERAL', 1, {
        general: generalCard,
        slot: 1,
        consumeCards,
      });

      const events = resolver.resolve(state, action);
      expect(events[0].type).toBe('GENERAL_DEPLOYED');
      expect((events[0].data as any).consumeCards).toHaveLength(3);
    });

    it('should accept different valid slots (0, 1, 2)', () => {
      const generalCard = { id: 'g1', hp: 2 };
      const consumeCard = { id: 'c1' };
      const player = createTestPlayer(1, {
        hand: [generalCard, consumeCard],
      });
      const state = createTestState([player]);

      for (let slot = 0; slot <= 2; slot++) {
        const action = createAction('DEPLOY_GENERAL', 1, {
          general: generalCard,
          slot,
          consumeCards: [consumeCard],
        });

        const events = resolver.resolve(state, action);
        expect(events[0].type).toBe('GENERAL_DEPLOYED');
        expect((events[0].data as any).slot).toBe(slot);
      }
    });
  });
});