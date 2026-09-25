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