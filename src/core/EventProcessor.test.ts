import { describe, it, expect } from 'vitest';
import { EventProcessor } from '../core/EventProcessor';
import { createInitialEngineState, type EngineState, type EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';

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
    ...createInitialEngineState(),
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0]?.id ?? null,
    turn: 1,
    round: 1,
  };
}

describe('EventProcessor', () => {
  const processor = new EventProcessor();

  describe('DAMAGE event - base target', () => {
    it('should reduce baseHp and mark player dead when baseHp reaches 0', () => {
      const player = createTestPlayer(1, { baseHp: 2 });
      const state = createTestState([player]);

      const event: GameEvent = {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: 2,
          sourceGeneralId: 'g1',
          targetPlayerId: 1,
          targetId: 'base_1',
          target: 'base_1',
          damageType: 'attack',
          value: 2,
          hpLost: 2,
          armorLost: 0,
          isBase: true,
          attackerId: 'g1',
          ranged: false,
        },
      };

      const result = processor.process(state, [event]);
      const target = result.players.find(p => p.id === 1);

      expect(target?.baseHp).toBe(0);
      expect(target?.isAlive).toBe(false);
      expect(target?.isSpectating).toBe(true);
    });

    it('should chain DAMAGE -> PLAYER_DEFEATED -> GAME_OVER for last survivor', () => {
      const player1 = createTestPlayer(1, { baseHp: 1 });
      const player2 = createTestPlayer(2, { baseHp: 10 });
      const state = createTestState([player1, player2]);

      const event: GameEvent = {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: 2,
          sourceGeneralId: 'g1',
          targetPlayerId: 1,
          targetId: 'base_1',
          target: 'base_1',
          damageType: 'attack',
          value: 1,
          hpLost: 1,
          armorLost: 0,
          isBase: true,
          attackerId: 'g1',
          ranged: false,
        },
      };

      const result = processor.process(state, [event]);

      expect(result.phase).toBe('gameOver');
      expect(result.timelinePhase).toBe('GAME_OVER');
      expect(result.metadata?.winnerId).toBe(2);
    });

    it('should not kill player if damage is less than baseHp', () => {
      const player = createTestPlayer(1, { baseHp: 5 });
      const state = createTestState([player]);

      const event: GameEvent = {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: 2,
          sourceGeneralId: 'g1',
          targetPlayerId: 1,
          targetId: 'base_1',
          target: 'base_1',
          damageType: 'attack',
          value: 3,
          hpLost: 3,
          armorLost: 0,
          isBase: true,
          attackerId: 'g1',
          ranged: false,
        },
      };

      const result = processor.process(state, [event]);
      const target = result.players.find(p => p.id === 1);

      expect(target?.baseHp).toBe(2);
      expect(target?.isAlive).toBe(true);
    });
  });

  describe('DAMAGE event - general target', () => {
    it('should apply armor damage correctly (2 armor absorbs 1 damage)', () => {
      const general = {
        general: { id: 'g1', hp: 4, meleeAtk: 2, rangedAtk: 1 },
        currentHp: 4,
        maxHp: 4,
        meleeAtk: 2,
        rangedAtk: 1,
        armor: 2,
        currentArmor: 2,
        armorCards: [],
        isArming: false,
        hasMoved: false,
        hasAttacked: false,
        hasSupplied: false,
        justDeployed: false,
        ownerId: 1,
        position: { zone: 'front' as const, slot: 0, areaOwnerId: 1 },
      };

      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const event: GameEvent = {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: 2,
          sourceGeneralId: 'g2',
          targetPlayerId: 1,
          targetId: 'g1',
          target: 'g1',
          damageType: 'attack',
          value: 2,
          hpLost: 1,
          armorLost: 2,
          actualDamage: 3,
          newHp: 3,
          newArmor: 0,
          destroyedArmorCardIds: [],
          attackerId: 'g2',
          ranged: false,
          defeated: false,
        },
      };

      const result = processor.process(state, [event]);
      const target = result.players.find(p => p.id === 1);
      const fg = target?.fieldGenerals?.[0] as any;

      expect(fg?.currentHp).toBe(3);
      expect(fg?.currentArmor).toBe(0);
    });

    it('D-4 伴随案（2.2.24）：无实体护甲点的损毁占位按弃牌堆位置定 id，同输入两次结算逐字一致', () => {
      const makeGeneral = () => ({
        general: { id: 'g1', hp: 4, meleeAtk: 2, rangedAtk: 1 },
        currentHp: 3,
        maxHp: 4,
        meleeAtk: 2,
        rangedAtk: 1,
        armor: 2,
        currentArmor: 2,
        armorCards: [],
        isArming: false,
        hasMoved: false,
        hasAttacked: false,
        hasSupplied: false,
        justDeployed: false,
        ownerId: 1,
        position: { zone: 'front' as const, slot: 0, areaOwnerId: 1 },
      });
      const event: GameEvent = {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: 2,
          sourceGeneralId: 'g2',
          targetPlayerId: 1,
          targetId: 'g1',
          target: 'g1',
          damageType: 'attack',
          value: 1,
          hpLost: 1,
          armorLost: 2,
          newHp: 3,
          newArmor: 0,
          attackerId: 'g2',
          ranged: false,
          defeated: false,
        },
      };

      const first = processor.process(createTestState([createTestPlayer(1, { fieldGenerals: [makeGeneral()] })]), [event]);
      const second = processor.process(createTestState([createTestPlayer(1, { fieldGenerals: [makeGeneral()] })]), [event]);

      expect(JSON.stringify(first.discardPile)).toBe(JSON.stringify(second.discardPile));
      expect((first.discardPile as any[]).map(card => card.id)).toEqual([
        'legacy_armor_destroyed_0',
        'legacy_armor_destroyed_1',
      ]);
    });

    it('D-4 伴随案（2.2.24）：带真实实例时损毁护甲卡原样进弃牌堆，不再生成占位卡', () => {
      const armorCard = { id: 'arm1', name: '护心镜', type: '军备', instanceId: 'arm1-i1' };
      const general = {
        general: { id: 'g1', hp: 4, meleeAtk: 2, rangedAtk: 1 },
        currentHp: 3,
        maxHp: 4,
        meleeAtk: 2,
        rangedAtk: 1,
        armor: 2,
        currentArmor: 0,
        armorCards: [armorCard],
        isArming: false,
        hasMoved: false,
        hasAttacked: false,
        hasSupplied: false,
        justDeployed: false,
        ownerId: 1,
        position: { zone: 'front' as const, slot: 0, areaOwnerId: 1 },
      };
      const event: GameEvent = {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: 2,
          sourceGeneralId: 'g2',
          targetPlayerId: 1,
          targetId: 'g1',
          target: 'g1',
          damageType: 'attack',
          value: 1,
          hpLost: 1,
          armorLost: 1,
          newHp: 3,
          newArmor: 0,
          destroyedArmorCardIds: ['arm1-i1'],
          attackerId: 'g2',
          ranged: false,
          defeated: false,
        },
      };
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [general] })]);

      const result = processor.process(state, [event]);

      expect((result.discardPile as any[]).map(card => card.id)).toEqual(['arm1']);
      expect((result.discardPile as any[]).some(card => String(card.id).startsWith('legacy_armor'))).toBe(false);
    });

    it('should remove general from field when defeated', () => {
      const general = {
        general: { id: 'g1', hp: 2, meleeAtk: 2, rangedAtk: 1 },
        currentHp: 1,
        maxHp: 2,
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
      };

      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const event: GameEvent = {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: 2,
          sourceGeneralId: 'g2',
          targetPlayerId: 1,
          targetId: 'g1',
          target: 'g1',
          damageType: 'attack',
          value: 2,
          hpLost: 1,
          armorLost: 0,
          actualDamage: 1,
          newHp: 0,
          newArmor: 0,
          destroyedArmorCardIds: [],
          attackerId: 'g2',
          ranged: false,
          defeated: true,
        },
      };

      const result = processor.process(state, [event]);
      const target = result.players.find(p => p.id === 1);

      expect(target?.fieldGenerals).toHaveLength(0);
      expect(target?.graveyard).toHaveLength(1);
    });
  });

  describe('DEATH event', () => {
    it('should trigger DRAW_REQUIRED for compensation draw', () => {
      const state = createTestState([
        createTestPlayer(1, { baseHp: 10 }),
        createTestPlayer(2, { baseHp: 10 }),
      ]);

      const event: GameEvent = {
        type: 'DEATH',
        data: {
          targetPlayerId: 1,
          targetId: 'g1',
          attackerPlayerId: 2,
          attackerId: 'g2',
        },
      };

      const result = processor.process(state, [event]);

      expect(result.phase).toBe('drawing');
      expect(result.timelinePhase).toBe('DRAW');
      expect(result.drawState?.reason).toBe('compensation');
      expect(result.drawState?.playerId).toBe(1);
      expect(result.drawState?.totalCards).toBe(1);
    });
  });

  describe('TURN_END and TURN_START events', () => {
    it('should increment turn counter on TURN_END', () => {
      const state = createTestState([
        createTestPlayer(1),
        createTestPlayer(2),
      ]);

      const event: GameEvent = {
        type: 'TURN_END',
        data: { fromIndex: 0, toIndex: 1, nextPlayerId: 2, nextRound: 1 },
      };

      const result = processor.process(state, [event]);
      expect(result.turn).toBe(2);
    });

    it('should set drawing phase on TURN_START', () => {
      const state = createTestState([
        createTestPlayer(1),
        createTestPlayer(2),
      ]);

      const event: GameEvent = {
        type: 'TURN_START',
        data: { playerId: 2, nextRound: 1 },
      };

      const result = processor.process(state, [event]);
      expect(result.phase).toBe('drawing');
      expect(result.timelinePhase).toBe('DRAW');
      expect(result.currentPlayerId).toBe(2);
    });
  });

  describe('TURN_ACTIONS_RESET event', () => {
    it('should reset all general action flags', () => {
      const general = {
        general: { id: 'g1', hp: 4 },
        currentHp: 4,
        maxHp: 4,
        hasMoved: true,
        hasAttacked: true,
        hasSupplied: true,
        justDeployed: true,
        isArming: true,
        ownerId: 1,
        position: { zone: 'front' as const, slot: 0, areaOwnerId: 1 },
      };

      const player = createTestPlayer(1, { fieldGenerals: [general] });
      const state = createTestState([player]);

      const event: GameEvent = {
        type: 'TURN_ACTIONS_RESET',
        data: { playerId: 1 },
      };

      const result = processor.process(state, [event]);
      const fg = result.players[0].fieldGenerals?.[0] as any;

      expect(fg?.hasMoved).toBe(false);
      expect(fg?.hasAttacked).toBe(false);
      expect(fg?.hasSupplied).toBe(false);
      expect(fg?.justDeployed).toBe(false);
      expect(fg?.isArming).toBe(false);
    });
  });

  describe('GAME_OVER event', () => {
    it('should set gameOver phase and record winner', () => {
      const state = createTestState([
        createTestPlayer(1),
        createTestPlayer(2),
      ]);

      const event: GameEvent = {
        type: 'GAME_OVER',
        data: { winnerId: 1 },
      };

      const result = processor.process(state, [event]);
      expect(result.phase).toBe('gameOver');
      expect(result.timelinePhase).toBe('GAME_OVER');
      expect(result.metadata?.winnerId).toBe(1);
      expect(result.drawState).toBeNull();
    });
  });

  describe('PHASE_CHANGED event', () => {
    it('should transition to playing phase on ACTION', () => {
      const state = createTestState([createTestPlayer(1)]);

      const event: GameEvent = {
        type: 'PHASE_CHANGED',
        data: { to: 'ACTION', playerId: 1 },
      };

      const result = processor.process(state, [event]);
      expect(result.phase).toBe('playing');
      expect(result.timelinePhase).toBe('ACTION');
      expect(result.drawState).toBeNull();
    });

    it('should transition to drawing phase on DRAW', () => {
      const state = createTestState([createTestPlayer(1)]);

      const event: GameEvent = {
        type: 'PHASE_CHANGED',
        data: { to: 'DRAW', playerId: 1 },
      };

      const result = processor.process(state, [event]);
      expect(result.phase).toBe('drawing');
      expect(result.timelinePhase).toBe('DRAW');
    });
  });

  describe('DRAW_CONFIRMED event', () => {
    it('should resume previous phase after compensation draw', () => {
      const state = createTestState([
        createTestPlayer(1),
        createTestPlayer(2),
      ]);
      state.drawState = {
        reason: 'compensation',
        playerId: 1,
        totalCards: 1,
        resumePhase: 'ACTION',
        resumePlayerId: 2,
      };
      state.phase = 'drawing';
      state.timelinePhase = 'DRAW';

      const event: GameEvent = {
        type: 'DRAW_CONFIRMED',
        data: { completed: true, reason: 'compensation' },
      };

      const result = processor.process(state, [event]);
      expect(result.phase).toBe('playing');
      expect(result.timelinePhase).toBe('ACTION');
      expect(result.currentPlayerId).toBe(2);
      expect(result.drawState).toBeNull();
    });
  });

  describe('PLAYER_DEFEATED event', () => {
    it('should clear player state when defeated', () => {
      const player = createTestPlayer(1, {
        baseHp: 5,
        hand: [{ id: 'c1' }],
        fieldGenerals: [{ general: { id: 'g1' } }],
      });
      const state = createTestState([player, createTestPlayer(2)]);

      const event: GameEvent = {
        type: 'PLAYER_DEFEATED',
        data: { playerId: 1 },
      };

      const result = processor.process(state, [event]);
      const target = result.players.find(p => p.id === 1);

      expect(target?.baseHp).toBe(0);
      expect(target?.isAlive).toBe(false);
      expect(target?.isSpectating).toBe(true);
      expect(target?.hand).toHaveLength(0);
      expect(target?.fieldGenerals).toHaveLength(0);
    });
  });

  describe('BASE_DAMAGE event', () => {
    it('should reduce baseHp by the specified amount', () => {
      const player = createTestPlayer(1, { baseHp: 8 });
      const state = createTestState([player]);

      const event: GameEvent = {
        type: 'BASE_DAMAGE',
        data: { playerId: 1, amount: 3 },
      };

      const result = processor.process(state, [event]);
      const target = result.players.find(p => p.id === 1);

      expect(target?.baseHp).toBe(5);
      expect(target?.isAlive).toBe(true);
    });

    it('should chain to PLAYER_DEFEATED when baseHp reaches 0', () => {
      const player = createTestPlayer(1, { baseHp: 2 });
      const state = createTestState([player, createTestPlayer(2)]);

      const event: GameEvent = {
        type: 'BASE_DAMAGE',
        data: { playerId: 1, amount: 5 },
      };

      const result = processor.process(state, [event]);
      const target = result.players.find(p => p.id === 1);

      expect(target?.baseHp).toBe(0);
      expect(target?.isAlive).toBe(false);
    });
  });

  describe('immutability', () => {
    it('should not mutate the original state', () => {
      const player = createTestPlayer(1, { baseHp: 5 });
      const state = createTestState([player]);
      const originalBaseHp = state.players[0].baseHp;

      const event: GameEvent = {
        type: 'BASE_DAMAGE',
        data: { playerId: 1, amount: 2 },
      };

      processor.process(state, [event]);

      expect(state.players[0].baseHp).toBe(originalBaseHp);
    });
  });
});