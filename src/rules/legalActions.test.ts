/**
 * legalActions 枚举器一致性测试（阶段一：AI 对局的"可选动作清单"地基）。
 *
 * 核心口径：枚举器只生成候选，合法与否一律由引擎自己的 RuleEngine + resolver
 * 裁判（与真实 dispatch 同一链路，零规则复制）。本文件证明三件事：
 *   1. 试探无副作用：调用 legalActions 前后 engine.state 深相等（resolver 纯净性守卫）；
 *   2. 枚举⇒可执行：每一个被枚举出的动作，在同等状态的引擎上真实 dispatch 必须被接受；
 *   3. 典型非法不入列：非当前玩家/无消耗牌/已攻击/槽位占用等场景不得出现在清单里。
 * 另含一段纯用枚举结果驱动的随机自对局冒烟，证明"有清单就玩得下去"。
 */
import { describe, it, expect, vi } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { General } from '../data/generals';

function makeGeneral(id: string, name: string, hp: number): General {
  const warrior = hp >= 4;
  return {
    id,
    name,
    faction: '魏',
    hp,
    type: warrior ? '武将' : '文将',
    meleeAtk: warrior ? 2 : 1,
    rangedAtk: warrior ? 1 : 2,
    armor: 0,
    skills: [],
  } as unknown as General;
}

function handGeneral(general: General) {
  // 手牌中的"将领卡"：带 hp 字段、非资源类型（与 DeployGeneralResolver/getLegalActions 同口径）
  return { ...general, id: `card_${general.id}`, type: general.type };
}

function makeResource(id: string, type = '材料') {
  return { id, name: type, type };
}

function makeFieldGeneral(general: General, ownerId: number, zone: 'camp' | 'front' | 'battle', slot: number, areaOwnerId: number | null, overrides: Record<string, unknown> = {}) {
  const warrior = general.hp >= 4;
  return {
    general,
    currentHp: general.hp,
    maxHp: general.hp,
    meleeAtk: warrior ? 2 : 1,
    rangedAtk: warrior ? 1 : 2,
    armor: 0,
    currentArmor: 0,
    armorCards: [],
    isArming: false,
    hasMoved: false,
    hasAttacked: false,
    hasSupplied: false,
    justDeployed: false,
    ownerId,
    position: { zone, slot, areaOwnerId },
    ...overrides,
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id,
    name: '玩家' + id,
    hp: 4,
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

function makeState(players: EnginePlayer[], overrides: Partial<EngineState> = {}): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0]?.id ?? null,
    turn: 3,
    round: 2,
    deck: [makeResource('deck_1', '粮草'), makeResource('deck_2', '材料')],
    discardPile: [],
    drawState: null,
    ...overrides,
  };
}

function rejected(events: { type: string }[]) {
  return events.some(e => e.type === 'ACTION_REJECTED');
}

/** 与真实对局同一条裁判链路：枚举→逐个在全新引擎上 dispatch，必须全部被接受。 */
function expectAllDispatchable(state: EngineState, playerId: number) {
  const enumerator = new GameEngine(structuredClone(state));
  const actions = enumerator.legalActions(playerId);
  expect(actions.length).toBeGreaterThan(0);
  for (const action of actions) {
    const probe = new GameEngine(structuredClone(state));
    const events = probe.dispatch(action);
    expect(
      rejected(events),
      `枚举出的 ${action.type} 不应被引擎拒绝: ${JSON.stringify(events.find(e => e.type === 'ACTION_REJECTED')?.data ?? {})}`,
    ).toBe(false);
  }
  return actions;
}

describe('legalActions · 枚举器与引擎裁判一致性', () => {
  it('试探零副作用：legalActions 前后 state 深相等', () => {
    const p1 = makePlayer(1, {
      hand: [handGeneral(makeGeneral('g1', '甲', 4)), makeResource('r1'), makeResource('r2', '军备')],
      fieldGenerals: [makeFieldGeneral(makeGeneral('f1', '乙', 2), 1, 'front', 0, 1)],
      generalPool: [makeGeneral('pool1', '池将', 3)],
    });
    const p2 = makePlayer(2, {
      fieldGenerals: [makeFieldGeneral(makeGeneral('e1', '敌将', 3), 2, 'battle', 1, null)],
    });
    const engine = new GameEngine(makeState([p1, p2]));
    const before = structuredClone(engine.state);
    const list = engine.legalActions(1);
    expect(list.length).toBeGreaterThan(0);
    expect(engine.state).toEqual(before);
  });

  it('抽牌窗口：仅 DRAW 全分配组合 + CONFIRM_DRAW，且非抽牌玩家无动作', () => {
    const drawingState = makeState(
      [makePlayer(1), makePlayer(2)],
      {
        phase: 'drawing',
        timelinePhase: 'DRAW',
        metadata: { drawPlayerId: 1 },
        drawState: { reason: 'turnStart', playerId: 1, totalCards: 5 },
      },
    );
    const engine = new GameEngine(drawingState);
    const actions = engine.legalActions(1);
    const draws = actions.filter(a => a.type === 'DRAW');
    expect(draws).toHaveLength(6); // 0..5 的将/牌分配
    for (const draw of draws) {
      const payload = draw.payload as { fromGeneralPool: number; fromCardPool: number };
      expect(payload.fromGeneralPool + payload.fromCardPool).toBe(5);
    }
    expect(actions.filter(a => a.type === 'CONFIRM_DRAW')).toHaveLength(1);
    expect(actions.some(a => a.type === 'BEGIN_DRAW')).toBe(false);
    expect(actions.some(a => a.type !== 'DRAW' && a.type !== 'CONFIRM_DRAW')).toBe(false);

    // 不是我的抽牌窗口 → 两手空空
    expect(engine.legalActions(2)).toHaveLength(0);
    expectAllDispatchable(drawingState, 1);
  });

  it('行动窗口：枚举出的每个动作真实 dispatch 都必须被接受', () => {
    const attacker = makeGeneral('atk1', '攻击手', 4);
    const scholar = makeGeneral('sch1', '文将', 2);
    const enemy = makeGeneral('enemy1', '敌将', 3);
    const deployable = makeGeneral('dep1', '待登场', 2);
    const p1 = makePlayer(1, {
      hand: [handGeneral(deployable), makeResource('cost1'), makeResource('cost2', '军备')],
      fieldGenerals: [
        makeFieldGeneral(attacker, 1, 'battle', 0, null),
        makeFieldGeneral(scholar, 1, 'camp', 0, 1, { currentHp: 1 }),
      ],
    });
    const p2 = makePlayer(2, {
      fieldGenerals: [makeFieldGeneral(enemy, 2, 'battle', 1, null)],
    });
    const state = makeState([p1, p2]);
    const actions = expectAllDispatchable(state, 1);

    const types = new Set(actions.map(a => a.type));
    expect(types.has('DEPLOY_GENERAL')).toBe(true);   // dep1 hp=2，手牌另有 2 张可消耗
    expect(types.has('MOVE_GENERAL')).toBe(true);     // 文将在营地 → 需消耗卡的前线移动
    expect(types.has('ATTACK')).toBe(true);           // battle 内近战可达 enemy1
    expect(types.has('SUPPLY')).toBe(true);           // 文将受伤 1 点
    expect(types.has('EQUIP_ARMOR')).toBe(true);      // 手上有军备卡
    expect(types.has('END_TURN')).toBe(true);
    expect(types.has('SURRENDER')).toBe(true);
    // 战斗区可远程射营地（引擎实测接受）→ 清单里应出现 base 攻击候选
    expect(actions.filter(a => a.type === 'ATTACK' && (a.payload as any).targetId === 'base_2').length).toBeGreaterThan(0);
  });

  it('典型非法不入列：无消耗牌 / 已攻击 / 槽位占用 / 非当前玩家 / gameOver', () => {
    const attacker = makeGeneral('atk1', '攻击手', 4);
    const enemy = makeGeneral('enemy1', '敌将', 3);
    const p1 = makePlayer(1, {
      hand: [], // 无资源卡 → 既不能攻击也不能部署消耗
      fieldGenerals: [makeFieldGeneral(attacker, 1, 'battle', 0, null, { hasAttacked: true })],
    });
    const p2 = makePlayer(2, {
      fieldGenerals: [makeFieldGeneral(enemy, 2, 'battle', 1, null)],
    });
    const engine = new GameEngine(makeState([p1, p2]));
    const actions = engine.legalActions(1);
    expect(actions.filter(a => a.type === 'ATTACK')).toHaveLength(0);
    expect(actions.filter(a => a.type === 'DEPLOY_GENERAL')).toHaveLength(0);
    expect(actions.filter(a => a.type === 'END_TURN')).toHaveLength(1);

    // 非当前玩家：行动窗口里只有 END_TURN/DRAW 族免相位门禁，但攻击/部署必须缺席
    const p2Actions = engine.legalActions(2);
    expect(p2Actions.filter(a => a.type === 'ATTACK')).toHaveLength(0);
    expect(p2Actions.filter(a => a.type === 'DEPLOY_GENERAL')).toHaveLength(0);

    // 营地槽位占用 → 该槽部署不入列
    const deployable = makeGeneral('dep1', '待登场', 1);
    const p1b = makePlayer(1, {
      hand: [handGeneral(deployable), makeResource('cost1')],
      fieldGenerals: [makeFieldGeneral(attacker, 1, 'camp', 0, 1)],
    });
    const engine2 = new GameEngine(makeState([p1b, makePlayer(2)]));
    const deploys = engine2.legalActions(1).filter(a => a.type === 'DEPLOY_GENERAL');
    expect(deploys.length).toBeGreaterThan(0);
    for (const dep of deploys) {
      expect((dep.payload as any).slot).not.toBe(0);
    }

    // gameOver → 空清单
    const over = new GameEngine(makeState([p1, p2], { phase: 'gameOver', currentPlayerId: null }));
    expect(over.legalActions(1)).toHaveLength(0);
  });

  // v2.8.40「整备不能动」引擎侧执法闸。此前枚举器给整备中的将发 MOVE（`isArming` 只在攻击那一路被读），
  // 而界面早就拦着（GameBoard.tsx:724）⇒"合法集里有一条界面拦你的动作"。这一枚同时钉枚举侧与裁判侧。
  it('整备中的将领：MOVE 与 ATTACK 都不入列，且直发 MOVE 被引擎拒绝', () => {
    const armingGeneral = makeGeneral('arm1', '整备手', 4);
    const idleGeneral = makeGeneral('idle1', '待动手', 4);
    const p1 = makePlayer(1, {
      hand: [makeResource('r1'), makeResource('r2', '军备')],
      fieldGenerals: [
        makeFieldGeneral(armingGeneral, 1, 'camp', 0, 1, { isArming: true, currentArmor: 1, armorCards: [makeResource('a1', '军备')] }),
        makeFieldGeneral(idleGeneral, 1, 'camp', 2, 1),
      ],
    });
    const p2 = makePlayer(2, {
      fieldGenerals: [makeFieldGeneral(makeGeneral('enemy1', '敌将', 3), 2, 'battle', 1, null)],
    });
    const engine = new GameEngine(makeState([p1, p2]));
    const actions = engine.legalActions(1);

    // 整备那一员：既不出现在攻击者里，也不出现在移动者里（同席那员没整备的照常入列）。
    expect(actions.filter(a => a.type === 'ATTACK' && (a.payload as any).attackerId === 'arm1')).toHaveLength(0);
    const moves = actions.filter(a => a.type === 'MOVE_GENERAL');
    expect(moves.length).toBeGreaterThan(0); // 对照：同席那员没整备的将照样能动
    for (const move of moves) expect((move.payload as any).generalId).not.toBe('arm1');

    // 裁判侧：绕过枚举器直发一条 MOVE_GENERAL，必须由引擎本人拒掉。
    const probe = new GameEngine(structuredClone(makeState([p1, p2])));
    const events = probe.dispatch(createAction('MOVE_GENERAL', 1, {
      generalId: 'arm1',
      target: { zone: 'front', slot: 0, areaOwnerId: 1 },
    }) as any);
    const rejection = events.find(e => e.type === 'ACTION_REJECTED');
    expect(rejection).toBeTruthy();
    expect((rejection?.data as any).reason).toBe('GENERAL_IS_ARMING');
  });

  it('随机自对局冒烟：只凭清单驱动也能打到终局（2 个随机 AI，种子可复现）', () => {
    // 抽牌堆恒等排列（Fisher-Yates 在 random=0.99 下不动），决策随机用自带 LCG，互不污染
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      let seed = 20260923;
      const pick = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return Math.floor((seed / 2147483648) * n);
      };

      const p1 = makePlayer(1, { generalPool: [makeGeneral('a2', '甲二', 2), makeGeneral('a3', '甲三', 4), makeGeneral('a4', '甲四', 3)] });
      const p2 = makePlayer(2, { generalPool: [makeGeneral('b2', '乙二', 4), makeGeneral('b3', '乙三', 2), makeGeneral('b4', '乙四', 3)] });
      const deck: unknown[] = [];
      for (let i = 0; i < 40; i += 1) deck.push(makeResource('deck_' + i, i % 4 === 0 ? '军备' : '材料'));
      const engine = new GameEngine(makeState([p1, p2], { deck }));

      // 初始抽卡由对局运行器显式发起（BEGIN_DRAW 不进默认枚举）
      const begin = engine.dispatch(createAction('BEGIN_DRAW', 1, { reason: 'initial', playerId: 1, totalCards: 5 }));
      expect(rejected(begin)).toBe(false);

      let steps = 0;
      while (engine.state.phase !== 'gameOver' && steps < 2000) {
        steps += 1;
        const draw = engine.state.drawState;
        const actorId = engine.state.phase === 'drawing' && draw
          ? draw.playerId
          : engine.state.currentPlayerId;
        expect(actorId).not.toBeNull();
        const actions = engine.legalActions(actorId as number);
        expect(actions.length, `第 ${steps} 步无合法动作（actor=${actorId}, phase=${engine.state.phase}）`).toBeGreaterThan(0);
        const chosen = actions[pick(actions.length)];
        const events = engine.dispatch(chosen);
        expect(
          rejected(events),
          `枚举动作被拒: ${chosen.type} ${JSON.stringify(chosen.payload ?? {})} → ${JSON.stringify(events.find(e => e.type === 'ACTION_REJECTED')?.data ?? {})}`,
        ).toBe(false);
      }
      expect(engine.state.phase).toBe('gameOver');
      expect(steps).toBeLessThan(2000);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
