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

    // v2.8.40「整备不能动」引擎侧执法闸：此前这一路只有界面拦（GameBoard.tsx:724），
    // 解析器不读 `isArming`⇒直发一条 MOVE_GENERAL 就能带着整备走一格。
    it('should reject move while the general is arming', () => {
      const general = makeFieldGeneral('g1', { ownerId: 1, isArming: true });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });

      const events = resolver.resolve(state, action as any);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ACTION_REJECTED');
      expect((events[0].data as any).reason).toBe('GENERAL_IS_ARMING');
    });

    it('整备闸排在「文将前进要消耗手牌」之前：手牌为空、没带消耗牌时也先报整备', () => {
      // 单独一枚证人：把闸摘掉的话这条会报 SCHOLAR_REQUIRES_MOVE_COST（文将＋空手牌），
      // 而不是 GENERAL_IS_ARMING⇒它钉的是"判定次序"，与上一条（武将几何合法路）不重复。
      const general = makeFieldGeneral('g1', {
        ownerId: 1,
        isArming: true,
        general: { id: 'g1', hp: 4, type: '文将', generalType: 'SCHOLAR' },
        currentArmor: 2,
        armorCards: [{ id: 'a1' }, { id: 'a2' }],
      });
      const player = createTestPlayer(1, { fieldGenerals: [general], hand: [] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });

      const events = resolver.resolve(state, action as any);
      expect(events).toHaveLength(1);
      expect((events[0].data as any).reason).toBe('GENERAL_IS_ARMING');
    });

    it('should report GENERAL_IS_ARMING ahead of GENERAL_ALREADY_MOVED (same order as the UI)', () => {
      const general = makeFieldGeneral('g1', { ownerId: 1, isArming: true, hasMoved: true });
      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const action = createAction('MOVE_GENERAL', 1, {
        generalId: 'g1',
        target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });

      const events = resolver.resolve(state, action as any);
      expect((events[0].data as any).reason).toBe('GENERAL_IS_ARMING');
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