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

  describe('DISCARD event（2.5.0 弃牌原语）', () => {
    const supply = { id: 'dp_supply', name: '粮草', type: '粮草' };
    const generalCard = { id: 'dp_general', name: '旧部', type: '武将' };

    it('固定数量：从手牌头部取 N 张，资源牌入弃牌堆、将领牌回拥有者将池', () => {
      const player = createTestPlayer(1, { hand: [{ ...supply }, { ...generalCard }, { ...supply }] });
      const state = createTestState([player, createTestPlayer(2)]);

      const result = processor.process(state, [
        { type: 'DISCARD', data: { playerId: 1, count: 2 } },
      ]);
      const p1 = result.players.find(p => p.id === 1)!;

      expect(p1.hand).toHaveLength(1);
      expect((p1.hand as Array<{ id: string }>)[0].id).toBe('dp_supply'); // 剩最后那张
      expect((p1.generalPool as Array<{ id: string }>).map(c => c.id)).toEqual(['dp_general']);
      expect(result.discardPile.map(c => (c as { id: string }).id)).toEqual(['dp_supply']);
    });

    it('count=0 为弃光哨兵：整手清空', () => {
      const player = createTestPlayer(1, { hand: [{ ...supply }, { ...generalCard }] });
      const state = createTestState([player]);

      const result = processor.process(state, [{ type: 'DISCARD', data: { playerId: 1, count: 0 } }]);
      const p1 = result.players.find(p => p.id === 1)!;

      expect(p1.hand).toHaveLength(0);
      expect(p1.generalPool).toHaveLength(1);
      expect(result.discardPile).toHaveLength(1);
    });

    it('数量超出手牌=弃到空为止（诚实少弃，不报错）', () => {
      const player = createTestPlayer(1, { hand: [{ ...supply }] });
      const state = createTestState([player]);

      const result = processor.process(state, [{ type: 'DISCARD', data: { playerId: 1, count: 5 } }]);

      expect(result.players.find(p => p.id === 1)!.hand).toHaveLength(0);
      expect(result.discardPile).toHaveLength(1);
    });

    it('空手诚实空转：状态与弃牌堆均不动', () => {
      const state = createTestState([createTestPlayer(1), createTestPlayer(2)]);

      const result = processor.process(state, [{ type: 'DISCARD', data: { playerId: 1, count: 1 } }]);

      expect(result.players.find(p => p.id === 1)!.hand).toHaveLength(0);
      expect(result.discardPile).toEqual([]);
    });

    it('载荷缺 playerId：no-op', () => {
      const player = createTestPlayer(1, { hand: [{ ...supply }] });
      const state = createTestState([player]);

      const result = processor.process(state, [{ type: 'DISCARD', data: { count: 1 } }]);

      expect(result.players.find(p => p.id === 1)!.hand).toHaveLength(1);
    });
  });

  describe('GIVE event（2.5.3 发放原语=DISCARD 镜像）', () => {
    const supply = { id: 'gv_supply', name: '粮草', type: '粮草' };
    const generalCard = { id: 'gv_general', name: '旧部', type: '武将' };

    it('手→手整卡转移：头部确定性选取，将领卡随卡走（不回将池、不进弃牌堆）', () => {
      const state = createTestState([
        createTestPlayer(1, { hand: [{ ...supply }, { ...generalCard }] }),
        createTestPlayer(2, { hand: [] }),
      ]);

      const result = processor.process(state, [
        { type: 'GIVE', data: { fromPlayerId: 1, toPlayerId: 2, count: 1 } },
      ]);
      const p1 = result.players.find(p => p.id === 1)!;
      const p2 = result.players.find(p => p.id === 2)!;

      expect(p1.hand).toHaveLength(1);
      expect((p1.hand as Array<{ id: string }>)[0].id).toBe('gv_general');
      expect((p2.hand as Array<{ id: string }>).map(c => c.id)).toEqual(['gv_supply']);
      expect(result.discardPile).toEqual([]);
      expect(p2.generalPool).toHaveLength(0); // 发放不折向将池
    });

    it('count=0 全手哨兵与数量超出自洽（诚实少给）', () => {
      const state = createTestState([
        createTestPlayer(1, { hand: [{ ...supply }, { ...generalCard }] }),
        createTestPlayer(2, { hand: [] }),
      ]);
      const all = processor.process(state, [
        { type: 'GIVE', data: { fromPlayerId: 1, toPlayerId: 2, count: 0 } },
      ]);
      expect(all.players.find(p => p.id === 1)!.hand).toHaveLength(0);
      expect(all.players.find(p => p.id === 2)!.hand).toHaveLength(2);

      const tooMany = processor.process(state, [
        { type: 'GIVE', data: { fromPlayerId: 1, toPlayerId: 2, count: 9 } },
      ]);
      expect(tooMany.players.find(p => p.id === 1)!.hand).toHaveLength(0);
      expect(tooMany.players.find(p => p.id === 2)!.hand).toHaveLength(2);
    });

    it('诚实空转三门：同一玩家/接收者缺席/接收者阵亡——手牌不动', () => {
      const state = createTestState([
        createTestPlayer(1, { hand: [{ ...supply }] }),
        createTestPlayer(2, { hand: [], isAlive: false }),
      ]);

      const same = processor.process(state, [
        { type: 'GIVE', data: { fromPlayerId: 1, toPlayerId: 1, count: 1 } },
      ]);
      expect(same.players.find(p => p.id === 1)!.hand).toHaveLength(1);

      const absent = processor.process(state, [
        { type: 'GIVE', data: { fromPlayerId: 1, toPlayerId: 9, count: 1 } },
      ]);
      expect(absent.players.find(p => p.id === 1)!.hand).toHaveLength(1);

      const dead = processor.process(state, [
        { type: 'GIVE', data: { fromPlayerId: 1, toPlayerId: 2, count: 1 } },
      ]);
      expect(dead.players.find(p => p.id === 1)!.hand).toHaveLength(1);
      expect(dead.players.find(p => p.id === 2)!.hand).toHaveLength(0);
    });

    it('发放者空手/载荷缺 id：no-op 不报错', () => {
      const state = createTestState([
        createTestPlayer(1, { hand: [] }),
        createTestPlayer(2, { hand: [] }),
      ]);
      const empty = processor.process(state, [
        { type: 'GIVE', data: { fromPlayerId: 1, toPlayerId: 2, count: 1 } },
      ]);
      expect(empty.players.find(p => p.id === 2)!.hand).toHaveLength(0);

      const noIds = processor.process(state, [{ type: 'GIVE', data: { count: 1 } }]);
      expect(noIds.players.find(p => p.id === 1)).toBeTruthy();
    });
  });

  describe('EQUIP_STRIP event (v2.6.0)', () => {
    function stripTarget(armorCards: Array<{ id: string }>, currentArmor: number, isArming = false) {
      return {
        general: { id: 'ep_g', name: '剥离靶', faction: '魏', hp: 4, type: '武将', meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [] },
        currentHp: 4, maxHp: 4, meleeAtk: 2, rangedAtk: 1, armor: 0,
        currentArmor, armorCards, isArming,
        hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
        ownerId: 2, position: { zone: 'front' as const, slot: 0, areaOwnerId: 1 },
      };
    }
    const arm = (i: number) => ({ id: `ep_arm_${i}`, name: '军备', type: '军备' });
    const build = (target: unknown) => createTestState([
      createTestPlayer(1),
      createTestPlayer(2, { fieldGenerals: [target] as never }),
    ]);

    it('头部剥离：count 张取头、护甲点数同步扣减、资源卡入弃牌堆', () => {
      const state = build(stripTarget([arm(1), arm(2), arm(3)], 3, true));
      const result = processor.process(state, [
        { type: 'EQUIP_STRIP', data: { targetPlayerId: 2, targetId: 'ep_g', count: 2 } },
      ]);
      const fg = (result.players.find(p => p.id === 2)!.fieldGenerals as unknown as Array<Record<string, unknown>>)[0];
      expect((fg.armorCards as unknown[]).map((c: unknown) => (c as { id: string }).id)).toEqual(['ep_arm_3']);
      expect(fg.currentArmor).toBe(1); // 3 - 剥离 2 张
      expect(fg.isArming).toBe(true); // 仍有余装，不强制解除武装态
      expect((result.discardPile as Array<{ id: string }>).map(c => c.id)).toEqual(['ep_arm_1', 'ep_arm_2']);
    });

    it('剥空收场：isArming 解除、点数扣到 0 封底不为负', () => {
      const state = build(stripTarget([arm(1)], 0));
      const result = processor.process(state, [
        { type: 'EQUIP_STRIP', data: { targetPlayerId: 2, targetId: 'ep_g', count: 5 } },
      ]);
      const fg = (result.players.find(p => p.id === 2)!.fieldGenerals as unknown as Array<Record<string, unknown>>)[0];
      expect(fg.armorCards).toEqual([]);
      expect(fg.currentArmor).toBe(0); // 点数 0 封底（卡曾给点已在别处消耗）
      expect(fg.isArming).toBe(false);
      expect((result.discardPile as unknown[])).toHaveLength(1);
    });

    it('诚实空转：空装填/离场目标/缺载荷 → 状态原样返回', () => {
      const empty = processor.process(
        build(stripTarget([], 0)),
        [{ type: 'EQUIP_STRIP', data: { targetPlayerId: 2, targetId: 'ep_g', count: 1 } }],
      );
      expect((empty.players.find(p => p.id === 2)!.fieldGenerals as unknown as Array<{ armorCards: unknown[] }>)[0].armorCards).toEqual([]);
      expect(empty.discardPile).toHaveLength(0);

      const offField = processor.process(
        build(stripTarget([arm(1)], 1)),
        [{ type: 'EQUIP_STRIP', data: { targetPlayerId: 2, targetId: 'ep_ghost', count: 1 } }],
      );
      expect((offField.players.find(p => p.id === 2)!.fieldGenerals as unknown as Array<{ armorCards: unknown[] }>)[0].armorCards).toHaveLength(1);
      expect(offField.discardPile).toHaveLength(0);

      const noPayload = processor.process(
        build(stripTarget([arm(1)], 1)),
        [{ type: 'EQUIP_STRIP', data: { count: 1 } }],
      );
      expect(noPayload.discardPile).toHaveLength(0);
    });
  });

  describe('REVEAL event (v2.6.1 观顶原语·非内容刀)', () => {
    const deckOf = (ids: string[]) => ids.map(id => ({ id }));

    it('观看即原样返回：状态逐字不变、零 rng 消耗', () => {
      const state = createTestState([createTestPlayer(1)]);
      state.deck = deckOf(['d1', 'd2', 'd3']);
      const rngBefore = JSON.stringify(state.rngState ?? null);

      const result = processor.process(state, [
        { type: 'REVEAL', data: { viewerPlayerId: 1, count: 2 } },
      ]);

      expect(result.deck).toEqual([{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]);
      expect(result.players.find(p => p.id === 1)!.hand).toHaveLength(0);
      expect(JSON.stringify(result.rngState ?? null)).toBe(rngBefore);
    });

    it('畸形载荷同样诚实空转（观看本就不动状态）', () => {
      const state = createTestState([createTestPlayer(1)]);
      state.deck = deckOf(['d1']);
      const noViewer = processor.process(state, [{ type: 'REVEAL', data: { count: 1 } }]);
      expect(noViewer.deck).toEqual([{ id: 'd1' }]);
      const badViewer = processor.process(state, [
        { type: 'REVEAL', data: { viewerPlayerId: 'one', count: 1 } },
      ]);
      expect(badViewer.deck).toEqual([{ id: 'd1' }]);
    });
  });

  describe('DECK_PLACE event (v2.6.1 置牌入堆原语·GIVE 的手牌→牌堆镜像)', () => {
    const handOf = (ids: string[]) => ids.map(id => ({ id }));
    const placeState = (hand: string[], deck: string[]) => {
      const state = createTestState([createTestPlayer(1, { hand: handOf(hand) as never })]);
      state.deck = handOf(deck);
      return state;
    };
    const deckIds = (s: { deck: unknown }) =>
      (s.deck as Array<{ id: string }>).map(c => c.id);

    it('默认置底：从手牌头部取 count 张、按序接在牌堆尾', () => {
      const result = processor.process(placeState(['h1', 'h2', 'h3'], ['d1', 'd2']), [
        { type: 'DECK_PLACE', data: { playerId: 1, count: 2 } },
      ]);
      expect(deckIds(result)).toEqual(['d1', 'd2', 'h1', 'h2']);
      expect((result.players[0].hand as Array<{ id: string }>).map(c => c.id)).toEqual(['h3']);
    });

    it('dest=TOP：整段扣在牌堆顶且保持相对顺序', () => {
      const result = processor.process(placeState(['h1', 'h2', 'h3'], ['d1']), [
        { type: 'DECK_PLACE', data: { playerId: 1, dest: 'TOP', count: 2 } },
      ]);
      expect(deckIds(result)).toEqual(['h1', 'h2', 'd1']);
      expect((result.players[0].hand as Array<{ id: string }>).map(c => c.id)).toEqual(['h3']);
    });

    it('count=0 全手牌哨兵：整副手牌入堆、手牌清空', () => {
      const result = processor.process(placeState(['h1', 'h2'], ['d1']), [
        { type: 'DECK_PLACE', data: { playerId: 1, count: 0 } },
      ]);
      expect(deckIds(result)).toEqual(['d1', 'h1', 'h2']);
      expect(result.players[0].hand).toHaveLength(0);
    });

    it('超额 clamp 与重放逐字：count 超手牌数按实际取、rngState 不动', () => {
      const st = placeState(['h1'], ['d1', 'd2']);
      const a = processor.process(st, [{ type: 'DECK_PLACE', data: { playerId: 1, count: 9 } }]);
      expect(deckIds(a)).toEqual(['d1', 'd2', 'h1']);
      const b = processor.process(structuredClone(st), [{ type: 'DECK_PLACE', data: { playerId: 1, count: 9 } }]);
      expect(b.deck).toEqual(a.deck);
      expect(b.rngState).toEqual(a.rngState);
    });

    it('诚实空转：空手/未知玩家/缺载荷 → 牌堆与手牌原样', () => {
      const emptyHand = processor.process(placeState([], ['d1']), [
        { type: 'DECK_PLACE', data: { playerId: 1, count: 1 } },
      ]);
      expect(deckIds(emptyHand)).toEqual(['d1']);

      const unknown = processor.process(placeState(['h1'], ['d1']), [
        { type: 'DECK_PLACE', data: { playerId: 99, count: 1 } },
      ]);
      expect(deckIds(unknown)).toEqual(['d1']);
      expect((unknown.players[0].hand as unknown[])).toHaveLength(1);

      const noIds = processor.process(placeState(['h1'], ['d1']), [
        { type: 'DECK_PLACE', data: { count: 1 } },
      ]);
      expect(deckIds(noIds)).toEqual(['d1']);
    });
  });

  describe('DUEL event (2.8 刀9)', () => {
    function duelist(
      id: string,
      ownerId: number,
      hp: number,
      meleeAtk: number,
      currentArmor = 0,
      armorCards: Array<{ id: string; name?: string; type?: string }> = [],
    ) {
      return {
        general: { id, name: `决斗者${id}`, faction: '魏', hp, type: '武将', meleeAtk, rangedAtk: 1, armor: 0, skills: [] },
        currentHp: hp, maxHp: hp, meleeAtk, rangedAtk: 1, armor: 0,
        currentArmor, armorCards, isArming: armorCards.length > 0,
        hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
        ownerId, position: { zone: 'front' as const, slot: 0, areaOwnerId: ownerId === 1 ? 2 : 1 },
      };
    }
    const build = (a: unknown, b: unknown) => createTestState([
      createTestPlayer(1, { fieldGenerals: [a] as never }),
      createTestPlayer(2, { fieldGenerals: [b] as never }),
    ]);
    const duel = (data: Record<string, unknown> = {}): GameEvent => ({
      type: 'DUEL',
      data: {
        sourcePlayerId: 1, sourceGeneralId: 'du_a',
        targetPlayerId: 2, targetId: 'du_b',
        skillId: 'du_skill', skillName: '搦战', effectType: 'DUEL', value: 0,
        ...data,
      },
    });
    const fieldOf = (state: EngineState, playerId: number, id: string) =>
      (state.players.find(p => p.id === playerId)?.fieldGenerals as unknown as Array<Record<string, any>> | undefined)
        ?.find(fg => fg?.general?.id === id);
    const roundsOf = (collected: GameEvent[]) => collected
      .filter(e => e.type === 'DAMAGE')
      .map(e => e.data as Record<string, any>);

    it('满六轮：双方各打满三次、逐轮交替、块内六条伤害按序入队（§H9 第六轮①）', () => {
      const state = build(duelist('du_a', 1, 20, 2), duelist('du_b', 2, 20, 3));
      const collected: GameEvent[] = [];
      const result = processor.process(state, [duel()], collected);
      const rounds = roundsOf(collected);

      expect(rounds).toHaveLength(6);
      expect(rounds.map(r => r.duelRound)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(rounds.map(r => [r.sourceGeneralId, r.targetId, r.value, r.damageType])).toEqual([
        ['du_a', 'du_b', 2, 'skill'], ['du_b', 'du_a', 3, 'skill'],
        ['du_a', 'du_b', 2, 'skill'], ['du_b', 'du_a', 3, 'skill'],
        ['du_a', 'du_b', 2, 'skill'], ['du_b', 'du_a', 3, 'skill'],
      ]);
      // 先手恒为发起方一侧；每一轮都真的进了状态（预解＝计划，落子仍走唯一结算口）
      expect(fieldOf(result, 1, 'du_a')!.currentHp).toBe(11); // 20 - 3×3
      expect(fieldOf(result, 2, 'du_b')!.currentHp).toBe(14); // 20 - 3×2
      // 决斗本体零状态位移：技能载荷原样带进每一轮，报告/日志据此归属
      expect(rounds[0].skillId).toBe('du_skill');
      expect(rounds[0].effectType).toBe('DUEL');
    });

    it('致死即截断：块长止于那一轮、死者不再被轮换、善后归阵亡方（§H5-6＋§H9 第四轮③）', () => {
      const state = build(duelist('du_a', 1, 5, 2), duelist('du_b', 2, 3, 2));
      const collected: GameEvent[] = [];
      const result = processor.process(state, [duel()], collected);
      const rounds = roundsOf(collected);

      expect(rounds.map(r => r.duelRound)).toEqual([1, 2, 3]);
      expect(rounds[2]).toMatchObject({ targetId: 'du_b', newHp: 0 });
      expect(fieldOf(result, 2, 'du_b')).toBeUndefined();
      expect((result.players.find(p => p.id === 2)!.graveyard as Array<{ id: string }>).map(c => c.id)).toEqual(['du_b']);
      // 技能伤害致死沿用既有派生链：DEATH → 补偿抽归阵亡方（第 2 家），不开第二条路
      expect(collected.filter(e => e.type === 'DEATH').map(e => e.data)).toEqual([
        { targetPlayerId: 2, targetId: 'du_b', attackerPlayerId: 1, attackerId: 'du_a', skillKill: true },
      ]);
      expect(collected.filter(e => e.type === 'DRAW_REQUIRED')
        .map(e => (e.data as { playerId?: number } | undefined)?.playerId)).toEqual([2]);
      expect(result.drawState).toMatchObject({ reason: 'compensation', playerId: 2, totalCards: 1 });
      expect(fieldOf(result, 1, 'du_a')!.currentHp).toBe(3); // 第 2 轮挨的那一下仍在
    });

    it('算出 0 伤害照样占一轮并继续轮换；护甲按 2 挡 1 入算（§H5-6＋§H5-3）', () => {
      const zeroAtk = build(duelist('du_a', 1, 3, 0), duelist('du_b', 2, 3, 0));
      const zeroCollected: GameEvent[] = [];
      const zeroResult = processor.process(zeroAtk, [duel()], zeroCollected);
      expect(roundsOf(zeroCollected).map(r => r.value)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(fieldOf(zeroResult, 1, 'du_a')!.currentHp).toBe(3);
      expect(fieldOf(zeroResult, 2, 'du_b')!.currentHp).toBe(3);

      const armored = build(
        duelist('du_a', 1, 10, 2),
        duelist('du_b', 2, 10, 0, 3, [{ id: 'du_arm_1', name: '军备', type: '军备' }, { id: 'du_arm_2', name: '军备', type: '军备' }]),
      );
      const armorCollected: GameEvent[] = [];
      const armorResult = processor.process(armored, [duel()], armorCollected);
      const rounds = roundsOf(armorCollected);
      const b = fieldOf(armorResult, 2, 'du_b')!;
      expect(rounds.map(r => r.targetId)).toEqual(['du_b', 'du_a', 'du_b', 'du_a', 'du_b', 'du_a']);
      // 3 点甲吃 2 点伤害：先 2 点挡 1 点，剩 1 点不够挡、原地留着 ⇒ 掉 1 体力
      expect(rounds.map(r => r.newHp)).toEqual([9, 10, 7, 10, 5, 10]);
      expect(rounds.map(r => r.newArmor)).toEqual([1, 0, 1, 0, 1, 0]);
      expect(b.currentHp).toBe(5);
      expect(b.currentArmor).toBe(1);
      // 军备点数与卡的既有关系照单继承：技能伤害只扣点、不脱卡（普攻侧才脱）
      expect(b.armorCards).toHaveLength(2);
      expect(armorResult.discardPile).toHaveLength(0);
    });

    it('诚实空转两档：任一侧不在场／缺载荷⇒零痕迹；自己对自己⇒只喂开局那一声（§H9 第五轮③＋第九轮⑧）', () => {
      const make = () => build(duelist('du_a', 1, 5, 2), duelist('du_b', 2, 5, 2));
      for (const event of [
        duel({ targetId: 'du_ghost' }),
        duel({ sourceGeneralId: 'du_ghost' }),
        { type: 'DUEL' as const, data: {} },
      ]) {
        const before = make();
        const collected: GameEvent[] = [];
        const after = processor.process(structuredClone(before), [event as GameEvent], collected);
        expect(collected).toEqual([]);
        expect(after).toEqual(before);
      }

      // 自己对自己：决斗本身仍零轮次零位移（"自己不能和自己决斗"），但"成为技能
      // 目标"那一声照喂——开局通知是这条流程里唯一留下的痕迹。这里当场没人有得说
      // （合成将不带技能）⇒ 标 `settled`，与"停下来问过"那一档（`opening`）分得开。
      const selfBefore = make();
      const selfCollected: GameEvent[] = [];
      const selfAfter = processor.process(structuredClone(selfBefore), [duel({ targetId: 'du_a' })], selfCollected);
      expect(selfCollected.map(e => e.type)).toEqual(['BEFORE_DAMAGE']);
      expect(selfCollected[0].data).toMatchObject({ duelStage: 'settled', targetId: 'du_a', damageType: 'skill' });
      expect(selfAfter).toEqual(selfBefore);
    });
  });

  describe('旧录像里的退役事件名（v2.8.27 刀5 把 DUEL_INJURY 折进 INJURY）', () => {
    /** 一个带血量、带护甲、账本上有笔的在场将——真被当伤害处理的话数字必然动。 */
    function stateWithCasualty(): EngineState {
      const general = {
        general: { id: 'g1', hp: 4, meleeAtk: 2, rangedAtk: 1 },
        currentHp: 4, maxHp: 4, meleeAtk: 2, rangedAtk: 1,
        armor: 2, currentArmor: 2, armorCards: [],
        isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false,
        justDeployed: false, ownerId: 1,
        position: { zone: 'front' as const, slot: 0, areaOwnerId: 1 },
      };
      const state = createTestState([createTestPlayer(1, { fieldGenerals: [general], baseHp: 6 })]);
      (state as unknown as { statModifiers: unknown[] }).statModifiers = [];
      return state;
    }

    function assertInert(eventType: string): void {
      const before = stateWithCasualty();
      const snapshot = JSON.stringify(before);
      const collected: GameEvent[] = [];

      const after = processor.process(
        before,
        [{ type: eventType, data: { targetPlayerId: 1, targetId: 'g1', value: 3, hpLost: 3, duelStage: 'injury' } } as unknown as GameEvent],
        collected,
      );

      expect(JSON.stringify(after)).toBe(snapshot);
      expect(collected).toEqual([]);
    }

    it('旧名 `DUEL_INJURY` 喂进来＝逐字不动：既不二次扣血，也不衍生任何事件', () => {
      assertInert('DUEL_INJURY');
    });

    it('现名 `INJURY` 同样纯通知：这一声扣过的血由 `DAMAGE` 那一格负责，这里不再扣第二遍', () => {
      assertInert('INJURY');
    });

    it('控制组：根本没登记过的事件名也一样静默穿过（旧录像永不因新增名字而崩）', () => {
      assertInert('SOMETHING_RETIRED_EVER_SO');
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