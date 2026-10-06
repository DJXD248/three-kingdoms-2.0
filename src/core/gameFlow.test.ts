/**
 * 核心玩法流程自动化测试（GameAction 直驱）
 *
 * 覆盖范围：开局抽牌 → 部署将领 → 移动 → 攻击（含护甲扣伤）→ 击杀与补偿 →
 * 营地伤害 → 结束回合推进 → 空将池扣营地 → 投降 → 胜负判定，
 * 以及一条从开局打到获胜的"完整一局"冒烟测试。
 *
 * 硬性约束（用户要求）：所有玩法推进一律通过引擎既有的 GameAction 接口
 * （engine.dispatch(createAction(...))），绝不绕过引擎直接改状态。
 * 初始 EngineState 允许手工构造（这是现有引擎测试的通用夹具做法）。
 *
 * 一个重要的引擎事实：EventProcessor 在结算中自动追加的连锁事件
 * （PLAYER_DEFEATED / GAME_OVER / 补偿 DRAW_REQUIRED）不会出现在
 * dispatch() 的返回值里，只能通过 engine.state 断言，不要断事件数组。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameEngine } from './GameEngine';
import { createAction } from '../action/ActionTypes';
import type { ActionType } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from './GameState';
import type { Faction, General } from '../data/generals';
import { cloneWithRuntimeInstance } from '../utils/runtimeIdentity';

const RESOURCE_TYPES = new Set(['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT']);

afterEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────── 夹具工厂 ──────────────────────────────

/** hp>=4 为武将（近战2/远程1），hp<=3 为文将（近战1/远程2），与 generals.ts 头部注释一致 */
function makeGeneral(id: string, name: string, hp: number, faction: Faction = '魏'): General {
  const warrior = hp >= 4;
  return {
    id,
    name,
    faction,
    hp,
    type: warrior ? '武将' : '文将',
    meleeAtk: warrior ? 2 : 1,
    rangedAtk: warrior ? 1 : 2,
    armor: 0,
    skills: [],
  };
}

function makeResource(id: string, type: '粮草' | '材料' | '军备' = '材料') {
  return { id, name: `资源牌-${id}`, type, description: '测试资源牌' };
}

function makeDeck(n: number) {
  return Array.from({ length: n }, (_, i) => makeResource(`deck_${i + 1}`));
}

function makeGeneralPool(prefix: string, faction: Faction, count = 10) {
  return Array.from({ length: count }, (_, i) =>
    cloneWithRuntimeInstance(makeGeneral(`${prefix}${i + 1}`, `将${faction}${i + 1}`, 4, faction)),
  );
}

function makePlayer(id: number, name: string, faction: Faction, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id,
    name,
    faction,
    hand: [],
    generalPool: [],
    fieldGenerals: [],
    graveyard: [],
    baseHp: 6,
    baseMaxHp: 6,
    isAlive: true,
    statuses: [],
    ...overrides,
  };
}

/** 默认进入"可行动"状态（playing / ACTION），回合数由各测试自行覆盖 */
function makePlayingState(players: EnginePlayer[], overrides: Partial<EngineState> = {}): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0]?.id ?? null,
    turn: 1,
    round: 2,
    deck: makeDeck(60),
    discardPile: [],
    drawState: null,
    ...overrides,
  };
}

type Zone = 'camp' | 'front' | 'battle';
interface FixturePosition { zone: Zone; slot: number; areaOwnerId: number | null }

function makeFieldGeneral(
  general: General,
  ownerId: number,
  position: FixturePosition,
  overrides: Record<string, unknown> = {},
) {
  const warrior = general.hp >= 4;
  return {
    general,
    currentHp: general.hp,
    maxHp: general.hp,
    meleeAtk: warrior ? 2 : 1,
    rangedAtk: warrior ? 1 : 2,
    armor: general.armor,
    currentArmor: 0,
    armorCards: [],
    isArming: false,
    hasMoved: false,
    hasAttacked: false,
    hasSupplied: false,
    justDeployed: false,
    ownerId,
    position,
    ...overrides,
  };
}

function isGeneralCard(card: unknown): boolean {
  const c = card as any;
  return !!c && typeof c === 'object' && typeof c.hp === 'number' && !RESOURCE_TYPES.has(String(c.type));
}

// ────────────────────────────── 驱动助手 ──────────────────────────────

function dispatchOk(
  engine: GameEngine,
  type: ActionType,
  playerId: number,
  payload?: unknown,
) {
  const events = engine.dispatch(createAction(type, playerId, payload));
  const rejected = events.find(event => event.type === 'ACTION_REJECTED');
  expect(rejected, `action ${type} 被意外拒绝: ${JSON.stringify((rejected as any)?.data?.reason)}`).toBeUndefined();
  return events;
}

/** 断言动作被拒绝、且状态完全未被改动，返回拒绝原因 */
function rejectedReason(
  engine: GameEngine,
  type: ActionType,
  playerId: number,
  payload?: unknown,
): string {
  const before = structuredClone(engine.state);
  const events = engine.dispatch(createAction(type, playerId, payload));
  const rejected = events.find(event => event.type === 'ACTION_REJECTED');
  expect(rejected, `action ${type} 本应被拒绝却成功了`).toBeDefined();
  expect(engine.state).toEqual(before);
  return String((rejected as any).data.reason);
}

/** 走完一个抽牌窗口：DRAW（默认全部从公共牌堆抽，保证确定性）+ CONFIRM_DRAW */
function settleDraw(engine: GameEngine, playerId: number, fromGeneralPool = 0) {
  const draw = engine.state.drawState;
  expect(draw, `玩家 ${playerId} 应存在待结算抽牌窗口`).toBeTruthy();
  expect(draw!.playerId).toBe(playerId);
  const generals = Math.min(fromGeneralPool, draw!.totalCards);
  dispatchOk(engine, 'DRAW', playerId, { fromGeneralPool: generals, fromCardPool: draw!.totalCards - generals });
  dispatchOk(engine, 'CONFIRM_DRAW', playerId);
}

function deployOk(engine: GameEngine, playerId: number, general: General, slot: number, consumeCards: unknown[]) {
  return dispatchOk(engine, 'DEPLOY_GENERAL', playerId, { general, slot, consumeCards });
}

function playerOf(engine: GameEngine, id: number) {
  return engine.state.players.find(p => p.id === id) as any;
}

function fieldGeneralOf(engine: GameEngine, playerId: number, runtimeId: string) {
  return playerOf(engine, playerId).fieldGenerals.find(
    (fg: any) => String(fg.general?.instanceId ?? fg.general?.id) === runtimeId,
  );
}

function runtimeIdOf(card: any): string {
  return String(card?.instanceId ?? card?.id ?? '');
}

// ────────────────────────────── 测试主体 ──────────────────────────────

describe('核心玩法流程（GameAction 直驱，不绕过引擎）', () => {

  describe('① 开局抽牌', () => {
    it('双方依次完成初始 5 张抽取后进入行动阶段，且抽牌窗口有严格门禁', () => {
      // D-2：将池洗牌改由 EngineState.rngState 驱动（不再受 Math.random mock 影响），
      // 具体抽到哪张由种子游标决定，这里只断言阵营纯度与数量。

      const p1 = makePlayer(1, '玩家1', '魏', { generalPool: makeGeneralPool('wei_', '魏') });
      const p2 = makePlayer(2, '玩家2', '蜀', { generalPool: makeGeneralPool('shu_', '蜀') });
      const engine = new GameEngine(
        makePlayingState([p1, p2], { phase: 'menu', timelinePhase: 'MENU', turn: 0, round: 1, deck: makeDeck(52) }),
      );

      dispatchOk(engine, 'BEGIN_DRAW', 1, { reason: 'initial', playerId: 1, totalCards: 5 });
      expect(engine.state.phase).toBe('drawing');
      expect(engine.state.drawState).toMatchObject({ reason: 'initial', playerId: 1, totalCards: 5 });

      // 抽牌窗口内非抽牌玩家不能行动；数量不匹配的 DRAW 被拒绝
      expect(rejectedReason(engine, 'DRAW', 2, { fromGeneralPool: 0, fromCardPool: 5 })).toBe('NOT_DRAW_PLAYER');
      expect(rejectedReason(engine, 'DRAW', 1, { fromGeneralPool: 1, fromCardPool: 3 })).toBe('DRAW_TOTAL_MISMATCH');

      dispatchOk(engine, 'DRAW', 1, { fromGeneralPool: 1, fromCardPool: 4 });
      const hand1 = engine.state.players[0].hand as any[];
      expect(hand1).toHaveLength(5);
      expect(hand1.filter(isGeneralCard)).toHaveLength(1);
      expect(hand1.find(isGeneralCard).id).toMatch(/^wei_/);
      expect(engine.state.players[0].generalPool).toHaveLength(9);
      expect(engine.state.deck).toHaveLength(48);

      dispatchOk(engine, 'CONFIRM_DRAW', 1);
      // 确认后自动链到下一名玩家的初始抽牌窗口
      expect(engine.state.drawState).toMatchObject({ reason: 'initial', playerId: 2, totalCards: 5 });

      dispatchOk(engine, 'DRAW', 2, { fromGeneralPool: 1, fromCardPool: 4 });
      dispatchOk(engine, 'CONFIRM_DRAW', 2);

      expect(engine.state.phase).toBe('playing');
      expect(engine.state.timelinePhase).toBe('ACTION');
      expect(engine.state.currentPlayerId).toBe(1);
      expect(engine.state.drawState).toBeNull();
      expect(engine.state.deck).toHaveLength(44);
      expect(playerOf(engine, 2).hand).toHaveLength(5);

      // 无待确认窗口时确认被拒绝
      expect(rejectedReason(engine, 'CONFIRM_DRAW', 1)).toBe('NO_PENDING_DRAW_CONFIRMATION');
    });
  });

  describe('② 部署将领', () => {
    function deploymentFixture() {
      const generalA = cloneWithRuntimeInstance(makeGeneral('wei_a', '武将A', 4, '魏'));
      const generalB = cloneWithRuntimeInstance(makeGeneral('wei_b', '文将B', 3, '魏'));
      const costs = [makeResource('cost_1'), makeResource('cost_2'), makeResource('cost_3'), makeResource('cost_4')];
      const p1 = makePlayer(1, '玩家1', '魏', {
        hand: [generalA, generalB, ...costs],
        generalPool: makeGeneralPool('pool_', '魏', 5),
      });
      const p2 = makePlayer(2, '玩家2', '蜀', { generalPool: makeGeneralPool('enemy_', '蜀', 5) });
      const engine = new GameEngine(makePlayingState([p1, p2]));
      return { engine, generalA, generalB, costs };
    }

    it('登场消耗手牌、血量等于消耗张数、落位己方营地槽位', () => {
      const { engine, generalA, generalB, costs } = deploymentFixture();
      const idA = runtimeIdOf(generalA);

      // 前置校验：代价为空 / 槽位非法 / 将领不在手牌 / 重复消耗
      expect(rejectedReason(engine, 'DEPLOY_GENERAL', 1, { general: generalA, slot: 0, consumeCards: [] }))
        .toBe('INVALID_DEPLOY_COST');
      expect(rejectedReason(engine, 'DEPLOY_GENERAL', 1, { general: generalA, slot: 5, consumeCards: [costs[0]] }))
        .toBe('INVALID_CAMP_SLOT');
      expect(rejectedReason(engine, 'DEPLOY_GENERAL', 1, {
        general: makeGeneral('nobody', '不在场', 4), slot: 0, consumeCards: [costs[0]],
      })).toBe('GENERAL_NOT_IN_HAND');
      expect(rejectedReason(engine, 'DEPLOY_GENERAL', 1, { general: generalA, slot: 0, consumeCards: [costs[0], costs[0]] }))
        .toBe('DUPLICATE_CONSUMED_CARD');

      const events = deployOk(engine, 1, generalA, 0, [costs[0], costs[1]]);
      expect(events.some(e => e.type === 'GENERAL_DEPLOYED')).toBe(true);

      const deployed = fieldGeneralOf(engine, 1, idA);
      expect(deployed).toBeTruthy();
      expect(deployed.currentHp).toBe(2);          // 用 2 张牌登场 → 2 点血
      expect(deployed.maxHp).toBe(4);
      expect(deployed.position).toEqual({ zone: 'camp', slot: 0, areaOwnerId: 1 });
      expect(deployed.justDeployed).toBe(true);

      const hand = playerOf(engine, 1).hand as any[];
      expect(hand.map(card => runtimeIdOf(card))).toEqual([runtimeIdOf(generalB), 'cost_3', 'cost_4']);
      const discardIds = (engine.state.discardPile as any[]).map(card => runtimeIdOf(card));
      expect(discardIds).toContain('cost_1');
      expect(discardIds).toContain('cost_2');
      expect(playerOf(engine, 1).generalPool).toHaveLength(5); // 资源牌不进将领头池

      expect(rejectedReason(engine, 'DEPLOY_GENERAL', 1, { general: generalA, slot: 1, consumeCards: [costs[2]] }))
        .toBe('GENERAL_NOT_IN_HAND');
    });

    it('营地槽位互斥：同槽位被占时第二张将领部署被拒绝', () => {
      const { engine, generalA, generalB, costs } = deploymentFixture();
      deployOk(engine, 1, generalA, 0, [costs[0]]);
      expect(rejectedReason(engine, 'DEPLOY_GENERAL', 1, { general: generalB, slot: 0, consumeCards: [costs[1]] }))
        .toBe('CAMP_SLOT_OCCUPIED');
      deployOk(engine, 1, generalB, 2, [costs[1]]);
      expect(playerOf(engine, 1).fieldGenerals).toHaveLength(2);
    });
  });

  describe('③ 移动将领', () => {
    function movedFixture() {
      const generalA = cloneWithRuntimeInstance(makeGeneral('mv_a', '行军武将A', 4, '魏'));
      const generalB = cloneWithRuntimeInstance(makeGeneral('mv_b', '行军文将B', 3, '魏'));
      const costs = [makeResource('mv_cost_1'), makeResource('mv_cost_2'), makeResource('mv_cost_3')];
      const p1 = makePlayer(1, '玩家1', '魏', {
        hand: [generalA, generalB, ...costs],
        generalPool: makeGeneralPool('mv_pool_', '魏', 3),
      });
      const p2 = makePlayer(2, '玩家2', '蜀', { generalPool: makeGeneralPool('mv_enemy_', '蜀', 3) });
      const engine = new GameEngine(makePlayingState([p1, p2]));
      return { engine, generalA, generalB, costs };
    }

    it('营地→己方前线成功后每回合限一次，非法目标被拒绝', () => {
      const { engine, generalA, costs } = movedFixture();
      deployOk(engine, 1, generalA, 0, [costs[0]]);
      const idA = runtimeIdOf(generalA);

      // 营地不能一步跳进战斗区
      expect(rejectedReason(engine, 'MOVE_GENERAL', 1, {
        generalId: idA, target: { zone: 'battle', slot: 0, areaOwnerId: null },
      })).toBe('INVALID_MOVE_TARGET');

      // 武将移动不消耗手牌；带上消耗牌反而非法
      expect(rejectedReason(engine, 'MOVE_GENERAL', 1, {
        generalId: idA, target: { zone: 'front', slot: 0, areaOwnerId: 1 }, consumeCard: costs[1],
      })).toBe('WARRIOR_MOVE_HAS_NO_COST');

      const events = dispatchOk(engine, 'MOVE_GENERAL', 1, {
        generalId: idA, target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });
      expect(events.some(e => e.type === 'GENERAL_MOVED')).toBe(true);
      const moved = fieldGeneralOf(engine, 1, idA);
      expect(moved.position).toEqual({ zone: 'front', slot: 0, areaOwnerId: 1 });
      expect(moved.hasMoved).toBe(true);

      // 每回合只能移动一次
      expect(rejectedReason(engine, 'MOVE_GENERAL', 1, {
        generalId: idA, target: { zone: 'battle', slot: 0, areaOwnerId: null },
      })).toBe('GENERAL_ALREADY_MOVED');
    });

    it('文将移动必须消耗一张手牌，武将从前线可进入战斗区', () => {
      const { engine, generalB, costs } = movedFixture();
      deployOk(engine, 1, generalB, 2, [costs[0]]);
      const idB = runtimeIdOf(generalB);

      expect(rejectedReason(engine, 'MOVE_GENERAL', 1, {
        generalId: idB, target: { zone: 'front', slot: 2, areaOwnerId: 1 },
      })).toBe('SCHOLAR_REQUIRES_MOVE_COST');

      dispatchOk(engine, 'MOVE_GENERAL', 1, {
        generalId: idB, target: { zone: 'front', slot: 2, areaOwnerId: 1 }, consumeCard: costs[1],
      });
      expect(fieldGeneralOf(engine, 1, idB).position).toEqual({ zone: 'front', slot: 2, areaOwnerId: 1 });
      const handIds = (playerOf(engine, 1).hand as any[]).map(card => runtimeIdOf(card));
      expect(handIds).not.toContain('mv_cost_2');
      expect((engine.state.discardPile as any[]).map(card => runtimeIdOf(card))).toContain('mv_cost_2');
    });
  });

  describe('④ 攻击与护甲扣伤', () => {
    function combatFixture(defenderOverrides: Record<string, unknown> = {}) {
      const attackerGeneral = makeGeneral('atk_1', '攻击者', 4, '魏');
      const defenderGeneral = makeGeneral('def_1', '防御者', 4, '蜀');
      const p1 = makePlayer(1, '玩家1', '魏', { hand: [makeResource('atk_cost_1'), makeResource('atk_cost_2')] });
      const p2 = makePlayer(2, '玩家2', '蜀');
      p1.fieldGenerals = [makeFieldGeneral(attackerGeneral, 1, { zone: 'battle', slot: 0, areaOwnerId: null })];
      p2.fieldGenerals = [makeFieldGeneral(defenderGeneral, 2, { zone: 'battle', slot: 1, areaOwnerId: null }, defenderOverrides)];
      const engine = new GameEngine(makePlayingState([p1, p2]));
      return { engine };
    }

    function attackPayload(extra: Record<string, unknown> = {}) {
      return { attackerId: 'atk_1', targetId: 'def_1', ranged: false, consumeCard: makeResource('atk_cost_1'), ...extra };
    }

    it('攻击必须带合法消耗牌，且每回合每将领一次', () => {
      const { engine } = combatFixture();
      const bad = attackPayload();
      delete (bad as any).consumeCard;
      expect(rejectedReason(engine, 'ATTACK', 1, bad)).toBe('INVALID_ATTACK_PAYLOAD');
      expect(rejectedReason(engine, 'ATTACK', 1, attackPayload({ consumeCard: makeResource('ghost') })))
        .toBe('ATTACK_COST_CARD_NOT_IN_HAND');
      expect(rejectedReason(engine, 'ATTACK', 1, attackPayload({ targetId: 'atk_1' })))
        .toBe('INVALID_ATTACK_TARGET');

      const events = dispatchOk(engine, 'ATTACK', 1, attackPayload());
      const damage = events.find(e => e.type === 'DAMAGE') as any;
      expect(damage).toBeTruthy();
      expect(damage.data.newHp).toBe(2);            // 近战 2 点伤害，无甲直扣
      expect(damage.data.hpLost).toBe(2);
      expect(fieldGeneralOf(engine, 2, 'def_1').currentHp).toBe(2);
      expect(fieldGeneralOf(engine, 1, 'atk_1').hasAttacked).toBe(true);
      const discardIds = (engine.state.discardPile as any[]).map(card => runtimeIdOf(card));
      expect(discardIds).toContain('atk_cost_1');

      expect(rejectedReason(engine, 'ATTACK', 1, attackPayload({ consumeCard: makeResource('atk_cost_2') })))
        .toBe('GENERAL_ALREADY_ATTACKED');
    });

    it('护甲规则：每 2 点护甲吸收 1 点伤害，1 点护甲不足以吸收则原地保留', () => {
      // 2 点护甲吸收 2 点伤害中的 1 点：掉光护甲，仍受 1 点血量伤害
      const full = combatFixture({
        currentArmor: 2,
        armorCards: [makeResource('arm_1', '军备'), makeResource('arm_2', '军备')],
      });
      const events = dispatchOk(full.engine, 'ATTACK', 1, attackPayload());
      const damage = events.find(e => e.type === 'DAMAGE') as any;
      expect(damage.data.armorLost).toBe(2);
      expect(damage.data.hpLost).toBe(1);
      expect(fieldGeneralOf(full.engine, 2, 'def_1').currentHp).toBe(3);
      expect(fieldGeneralOf(full.engine, 2, 'def_1').currentArmor).toBe(0);
      const discardIds = (full.engine.state.discardPile as any[]).map(card => runtimeIdOf(card));
      expect(discardIds).toContain('arm_1');
      expect(discardIds).toContain('arm_2');

      // 1 点护甲挡不住任何伤害，血量直扣、护甲保留
      const odd = combatFixture({ currentArmor: 1, armorCards: [makeResource('arm_odd', '军备')] });
      const oddEvents = dispatchOk(odd.engine, 'ATTACK', 1, attackPayload());
      const oddDamage = oddEvents.find(e => e.type === 'DAMAGE') as any;
      expect(oddDamage.data.hpLost).toBe(2);
      expect(oddDamage.data.armorLost).toBe(0);
      expect(fieldGeneralOf(odd.engine, 2, 'def_1').currentHp).toBe(2);
      expect(fieldGeneralOf(odd.engine, 2, 'def_1').currentArmor).toBe(1);
    });
  });

  describe('⑤ 将领阵亡与补偿抽牌', () => {
    it('致命攻击触发 DEATH，被杀方自动获得 1 张补偿抽牌并恢复现场', () => {
      const attackerGeneral = makeGeneral('killer_1', '斩杀者', 4, '魏');
      const victimGeneral = makeGeneral('victim_1', '阵亡者', 4, '蜀');
      const p1 = makePlayer(1, '玩家1', '魏', { hand: [makeResource('kill_cost')] });
      const p2 = makePlayer(2, '玩家2', '蜀', { generalPool: makeGeneralPool('vic_pool_', '蜀', 3) });
      p1.fieldGenerals = [makeFieldGeneral(attackerGeneral, 1, { zone: 'battle', slot: 0, areaOwnerId: null })];
      p2.fieldGenerals = [makeFieldGeneral(victimGeneral, 2, { zone: 'battle', slot: 1, areaOwnerId: null }, { currentHp: 1 })];
      const engine = new GameEngine(makePlayingState([p1, p2]));

      const events = dispatchOk(engine, 'ATTACK', 1, {
        attackerId: 'killer_1', targetId: 'victim_1', ranged: false, consumeCard: makeResource('kill_cost'),
      });
      expect(events.some(e => e.type === 'DEATH')).toBe(true);

      // 阵亡将领离场并进入墓地，对局未结束
      expect(playerOf(engine, 2).fieldGenerals).toHaveLength(0);
      expect(playerOf(engine, 2).graveyard).toHaveLength(1);
      expect(playerOf(engine, 2).isAlive).toBe(true);
      expect(engine.state.phase).not.toBe('gameOver');

      // 补偿抽牌窗口：属于被杀方，并登记了恢复现场信息
      expect(engine.state.phase).toBe('drawing');
      expect(engine.state.drawState).toMatchObject({
        reason: 'compensation', playerId: 2, totalCards: 1, resumePlayerId: 1,
      });

      settleDraw(engine, 2);
      expect(engine.state.phase).toBe('playing');
      expect(engine.state.timelinePhase).toBe('ACTION');
      expect(engine.state.currentPlayerId).toBe(1); // 现场还给攻击方回合
    });
  });

  describe('⑥ 营地伤害与胜负判定', () => {
    function baseFixture(baseHp: number, attackerArea: number) {
      const siegeGeneral = makeGeneral('siege_1', '攻城者', 4, '魏');
      const p1 = makePlayer(1, '玩家1', '魏', {
        hand: [makeResource('s_cost_1'), makeResource('s_cost_2'), makeResource('s_cost_3')],
      });
      const p2 = makePlayer(2, '玩家2', '蜀', { baseHp, baseMaxHp: baseHp });
      p1.fieldGenerals = [makeFieldGeneral(siegeGeneral, 1, { zone: 'front', slot: 0, areaOwnerId: attackerArea })];
      const engine = new GameEngine(makePlayingState([p1, p2], { round: 2 }));
      return { engine };
    }

    function siegeAttack(consumeId: string) {
      return { attackerId: 'siege_1', targetId: 'base_2', ranged: false, consumeCard: makeResource(consumeId) };
    }

    it('营地只能在敌方前线/营地近战打到，每次攻击固定扣 1 点', () => {
      // 站在自己前线的攻城者打不到 2 号营地
      const wrong = baseFixture(3, 1);
      expect(rejectedReason(wrong.engine, 'ATTACK', 1, siegeAttack('s_cost_1'))).toBe('INVALID_ATTACK_TARGET');

      const ok = baseFixture(3, 2);
      const events = dispatchOk(ok.engine, 'ATTACK', 1, siegeAttack('s_cost_1'));
      const damage = events.find(e => e.type === 'DAMAGE') as any;
      expect(damage.data.isBase).toBe(true);
      expect(damage.data.value).toBe(1);            // 近战 2 点对营地仍只扣 1
      expect(playerOf(ok.engine, 2).baseHp).toBe(2);
      expect(playerOf(ok.engine, 2).isAlive).toBe(true);
    });

    it('营地被摧毁 → PLAYER_DEFEATED → GAME_OVER，胜者登记在 metadata.winnerId', () => {
      const { engine } = baseFixture(2, 2);

      dispatchOk(engine, 'ATTACK', 1, siegeAttack('s_cost_1'));
      expect(playerOf(engine, 2).baseHp).toBe(1);

      // 完整过一轮让攻城者的 hasAttacked 复位
      dispatchOk(engine, 'END_TURN', 1);
      settleDraw(engine, 2);
      dispatchOk(engine, 'END_TURN', 2);
      settleDraw(engine, 1);
      expect(fieldGeneralOf(engine, 1, 'siege_1').hasAttacked).toBe(false);

      dispatchOk(engine, 'ATTACK', 1, siegeAttack('s_cost_2'));

      const loser = playerOf(engine, 2);
      expect(loser.baseHp).toBe(0);
      expect(loser.isAlive).toBe(false);
      expect(loser.hand).toHaveLength(0);
      expect(loser.fieldGenerals).toHaveLength(0);
      // 内联追加的 PLAYER_DEFEATED/GAME_OVER 不出现在 dispatch 返回值中，
      // 胜负结论一律以状态为准：
      expect(engine.state.phase).toBe('gameOver');
      expect(engine.state.timelinePhase).toBe('GAME_OVER');
      expect(engine.state.metadata?.winnerId).toBe(1);
      expect(engine.state.currentPlayerId).toBe(1);
    });
  });

  describe('⑦ 结束回合推进', () => {
    it('END_TURN 产出固定四事件链，回合开始抽牌数按座位/轮次推进', () => {
      const p1 = makePlayer(1, '玩家1', '魏', { generalPool: makeGeneralPool('t1_', '魏', 3) });
      const p2 = makePlayer(2, '玩家2', '蜀', { generalPool: makeGeneralPool('t2_', '蜀', 3) });
      p1.fieldGenerals = [makeFieldGeneral(makeGeneral('t_g', '旧将', 4, '魏'), 1,
        { zone: 'camp', slot: 0, areaOwnerId: 1 },
        { hasMoved: true, hasAttacked: true, hasSupplied: true, isArming: true, justDeployed: true })];
      const engine = new GameEngine(makePlayingState([p1, p2], { round: 1, turn: 0 }));

      const events = dispatchOk(engine, 'END_TURN', 1);
      const types = events.map(e => e.type);
      const chain = ['TURN_END', 'TURN_START', 'TURN_ACTIONS_RESET', 'DRAW_REQUIRED'] as const;
      const positions = chain.map(name => types.indexOf(name));
      expect(positions.every(index => index >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b)); // 顺序正确

      // 首轮第 2 座位抽 1 张
      expect(engine.state.drawState).toMatchObject({ reason: 'turnStart', playerId: 2, totalCards: 1 });
      expect(engine.state.phase).toBe('drawing');
      expect(engine.state.currentPlayerId).toBe(2);
      expect(engine.state.turn).toBe(1);
      expect(engine.state.round).toBe(1);

      settleDraw(engine, 2);
      expect(engine.state.phase).toBe('playing');
      expect(engine.state.currentPlayerId).toBe(2);

      // 回到 1 号位时轮次 +1，抽满 5 张，并重置上一家的行动标记
      dispatchOk(engine, 'END_TURN', 2);
      expect(engine.state.round).toBe(2);
      expect(engine.state.drawState).toMatchObject({ playerId: 1, totalCards: 5 });
      settleDraw(engine, 1);

      const reset = fieldGeneralOf(engine, 1, 't_g');
      expect(reset.hasMoved).toBe(false);
      expect(reset.hasAttacked).toBe(false);
      expect(reset.hasSupplied).toBe(false);
      expect(reset.isArming).toBe(false);
      expect(reset.justDeployed).toBe(false);
    });

    it('将池抽空时回合开始强制扣 1 点营地（RESOLVE_BASE_LOSS）', () => {
      const p1 = makePlayer(1, '玩家1', '魏', { generalPool: makeGeneralPool('bl1_', '魏', 3) });
      const p2 = makePlayer(2, '玩家2', '蜀', { generalPool: [] }); // 将池已空
      const engine = new GameEngine(makePlayingState([p1, p2], { round: 2 }));

      expect(rejectedReason(engine, 'RESOLVE_BASE_LOSS', 1)).toBe('NO_PENDING_BASE_LOSS');

      dispatchOk(engine, 'END_TURN', 1);
      expect(engine.state.drawState).toMatchObject({ playerId: 2, baseLossPending: true });

      dispatchOk(engine, 'RESOLVE_BASE_LOSS', 2);
      expect(playerOf(engine, 2).baseHp).toBe(5);
      expect(engine.state.drawState).toMatchObject({ playerId: 2, baseLossPending: false });
      expect(engine.state.phase).toBe('drawing');

      settleDraw(engine, 2);
      expect(engine.state.currentPlayerId).toBe(2);
      expect(engine.state.phase).toBe('playing');
    });
  });

  describe('⑧ 投降判负', () => {
    it('当前回合玩家投降后对手直接获胜', () => {
      const p1 = makePlayer(1, '玩家1', '魏');
      const p2 = makePlayer(2, '玩家2', '蜀');
      const engine = new GameEngine(makePlayingState([p1, p2], { currentPlayerId: 2 }));

      expect(rejectedReason(engine, 'SURRENDER', 1)).toBe('NOT_CURRENT_PLAYER');
      dispatchOk(engine, 'SURRENDER', 2);

      expect(playerOf(engine, 2).isAlive).toBe(false);
      expect(engine.state.phase).toBe('gameOver');
      expect(engine.state.metadata?.winnerId).toBe(1);
    });
  });

  describe('⑨ 完整一局冒烟（开局抽牌→部署→三段推进→摧毁营地获胜）', () => {
    it('全程只通过 GameAction 驱动，从 menu 一路打到 gameOver', () => {
      // D-2：抽将洗牌走 rngState 游标，可精确断言的只剩阵营纯度。

      const p1 = makePlayer(1, '玩家1', '魏', { generalPool: makeGeneralPool('fw1_', '魏') });
      const p2 = makePlayer(2, '玩家2', '蜀', { generalPool: makeGeneralPool('fw2_', '蜀'), baseHp: 2, baseMaxHp: 2 });
      const engine = new GameEngine(
        makePlayingState([p1, p2], { phase: 'menu', timelinePhase: 'MENU', turn: 0, round: 1, deck: makeDeck(120) }),
      );

      // ── 开局：双方各抽 5 张（含 1 张将领）──
      dispatchOk(engine, 'BEGIN_DRAW', 1, { reason: 'initial', playerId: 1, totalCards: 5 });
      settleDraw(engine, 1, 1);
      settleDraw(engine, 2, 1);
      vi.restoreAllMocks();
      expect(engine.state.phase).toBe('playing');
      expect(engine.state.currentPlayerId).toBe(1);

      // ── 第 1 回合：部署 + 营地→己方前线 ──
      const hand1 = () => playerOf(engine, 1).hand as any[];
      const general = hand1().find(isGeneralCard);
      expect(general.id).toMatch(/^fw1_/);
      const generalId = runtimeIdOf(general);
      const costCard = () => hand1().find(card => !isGeneralCard(card));
      deployOk(engine, 1, general, 0, [costCard()]);
      expect(playerOf(engine, 1).fieldGenerals).toHaveLength(1);
      dispatchOk(engine, 'MOVE_GENERAL', 1, {
        generalId, target: { zone: 'front', slot: 0, areaOwnerId: 1 },
      });
      dispatchOk(engine, 'END_TURN', 1);

      // ── 对手回合空过（每次都会触发回合开始抽牌窗口）──
      const passP2Turn = () => { settleDraw(engine, 2); dispatchOk(engine, 'END_TURN', 2); settleDraw(engine, 1); };
      passP2Turn(); // 先走完第 1 轮 P2 的回合，把行动权交还 P1

      // ── 第 2 回合：前线→战斗区 ──
      dispatchOk(engine, 'MOVE_GENERAL', 1, {
        generalId, target: { zone: 'battle', slot: 0, areaOwnerId: null },
      });
      dispatchOk(engine, 'END_TURN', 1);
      passP2Turn();

      // ── 第 3 回合：战斗区→敌方前线 ──
      dispatchOk(engine, 'MOVE_GENERAL', 1, {
        generalId, target: { zone: 'front', slot: 0, areaOwnerId: 2 },
      });
      dispatchOk(engine, 'END_TURN', 1);
      passP2Turn();

      // ── 第 4 回合：第一次攻营地（2→1）──
      dispatchOk(engine, 'ATTACK', 1, {
        attackerId: generalId, targetId: 'base_2', ranged: false, consumeCard: costCard(),
      });
      expect(playerOf(engine, 2).baseHp).toBe(1);
      expect(playerOf(engine, 2).isAlive).toBe(true);
      dispatchOk(engine, 'END_TURN', 1);
      passP2Turn();

      // ── 终结前账本守恒：牌不增不减（牌堆 + 双方将池 + 双方手牌 + 弃牌堆 + 场上将领）──
      const totalCards =
        hand1().length +
        (playerOf(engine, 2).hand as any[]).length +
        playerOf(engine, 1).generalPool.length +
        playerOf(engine, 2).generalPool.length +
        (engine.state.discardPile as any[]).length +
        engine.state.deck.length +
        playerOf(engine, 1).fieldGenerals.length +
        playerOf(engine, 2).fieldGenerals.length;
      expect(totalCards).toBe(120 + 10 + 10); // 初始牌堆 120 + 双方将池各 10

      // ── 第 5 回合：终结一击（1→0），胜负判定生效 ──
      dispatchOk(engine, 'ATTACK', 1, {
        attackerId: generalId, targetId: 'base_2', ranged: false, consumeCard: costCard(),
      });
      expect(engine.state.phase).toBe('gameOver');
      expect(engine.state.timelinePhase).toBe('GAME_OVER');
      expect(engine.state.metadata?.winnerId).toBe(1);
      expect(playerOf(engine, 2).isAlive).toBe(false);
      // 战败方手牌/场上随败局清空（引擎既定规则）
      expect(playerOf(engine, 2).hand).toHaveLength(0);
      expect(playerOf(engine, 2).fieldGenerals).toHaveLength(0);
    });
  });
});
