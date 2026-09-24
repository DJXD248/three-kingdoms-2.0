/**
 * 2.3.1 turn-end ask window at the store container layer.
 *
 * Contract pinned here (D-3c 钉死句 first real consumption of the 2.2.25
 * openReactionWindow entry):
 *   - the ask is class B: opening it dispatches NOTHING (engine turn frozen);
 *   - every decision inside it is class A canonical: activation is a real
 *     ACTIVATE_SKILL dispatch, the skip is the real END_TURN dispatch — the
 *     same commitEndTurn the ungated path uses;
 *   - human seats with candidates are deferred; AI seats / candidate-free
 *     humans see zero behavior change;
 *   - a second 结束Turn press while the ask is open IS the honest skip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import type { Player } from './gameStore';
import type { EngineState } from '../core/GameState';
import type { General } from '../data/generals';
import { __resetResidentEngineContainer } from './engineExecutionBridge';
import { storeStateToEngineState } from './gameStateAdapter';
import { resetLiveReplay } from '../replay/liveReplayRecorder';

function watchGeneral(id: string, skillName: string): General {
  return {
    id,
    instanceId: id,
    name: '将' + id,
    faction: '魏',
    hp: 3,
    type: '武将',
    meleeAtk: 2,
    rangedAtk: 1,
    armor: 0,
    skills: [{
      name: skillName,
      description: '回合结束时可发动',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    }],
  } as unknown as General;
}

function fieldGeneral(general: General, ownerId: number, slot: number) {
  return {
    general,
    currentHp: general.hp,
    maxHp: general.hp,
    meleeAtk: general.meleeAtk,
    rangedAtk: 1,
    armor: 0,
    currentArmor: 0,
    armorCards: [],
    isArming: false,
    hasMoved: false,
    hasAttacked: false,
    hasSupplied: false,
    justDeployed: false,
    ownerId,
    position: { zone: 'front', slot, areaOwnerId: ownerId },
  };
}

function makeEngineState(fieldGenerals: General[]): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [
      {
        id: 1, name: '玩家1', hp: 4, hand: [], generalPool: [],
        fieldGenerals: fieldGenerals.map((g, i) => fieldGeneral(g, 1, i)),
        graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
      },
      {
        id: 2, name: '玩家2', hp: 4, hand: [], generalPool: [],
        fieldGenerals: [], graveyard: [], baseHp: 10, baseMaxHp: 10,
        isAlive: true, statuses: [],
      },
    ],
    currentPlayerId: 1,
    turn: 5,
    round: 3,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
      { id: 'deck_4', name: '粮草', type: '粮草' },
    ],
    discardPile: [],
    drawState: null,
  } as EngineState;
}

function installStoreState(engineState: EngineState, firstSeatIsAi = false) {
  if (firstSeatIsAi) (engineState.players[0] as any).isAi = true;
  // Production invariant (mirrored on purpose): the display player array IS
  // the engine player array — the engine-aware setter rebuilds engineState
  // from the display fields on every set() that omits it (ask-open does),
  // so a handcrafted display array without fieldGenerals would be wiped.
  useGameStore.setState({
    players: engineState.players as unknown as Player[],
    currentPlayerIndex: 0,
    currentRound: 3,
    phase: 'playing',
    turnPhase: 'main',
    isTestMode: false,
    winnerId: null,
    engineState,
    // Deck/discard ride the display fields too — the ask-open rebuild re-derives
    // engineState.deck from cardDeck, so a missing cardDeck would empty the deck.
    cardDeck: engineState.deck as any,
    discardPile: engineState.discardPile as any,
    turnEndAsk: null,
    reactionWindow: null,
    skillActivations: [],
    drawContext: null,
    revealedDrawCards: [],
    gameOverBanner: null,
    defeatEvent: null,
    pendingTurnTransition: null,
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

const get = () => useGameStore.getState();

describe('gameStore · 回合结束询问窗 (2.3.1)', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  it('有人座位+有候选：endTurn 只开窗，不 dispatch END_TURN（窗是 B 类）', () => {
    installStoreState(makeEngineState([watchGeneral('g_watch', '守夜')]));
    get().endTurn();

    const state = get();
    expect(state.turnEndAsk).toMatchObject({
      playerId: 1,
      candidates: [{
        skillId: 'g_watch:守夜:e1',
        generalId: 'g_watch',
        generalName: '将g_watch',
        skillName: '守夜',
      }],
    });
    expect(state.turnEndAsk?.windowId).toMatch(/^rw/);
    expect(state.reactionWindow).not.toBeNull();
    // 零 dispatch 证据：引擎计数器与账本都停在开窗前。
    expect(state.engineState.turn).toBe(5);
    expect(state.engineState.consumedSkills ?? []).toHaveLength(0);
  });

  it('skipTurnEndAsk：闭窗后走真实 END_TURN 提交（A 类决策进 canonical 链）', () => {
    installStoreState(makeEngineState([watchGeneral('g_watch', '守夜')]));
    get().endTurn();
    get().skipTurnEndAsk();

    const state = get();
    expect(state.turnEndAsk).toBeNull();
    expect(state.reactionWindow).toBeNull();
    expect(state.engineState.turn).toBe(6); // END_TURN 在一次 dispatch 内推进回合
  });

  it('询问窗开启时再按结束回合 = 诚实跳过（同一条 commitEndTurn，不留残窗）', () => {
    installStoreState(makeEngineState([watchGeneral('g_watch', '守夜')]));
    get().endTurn();
    expect(get().turnEndAsk).not.toBeNull();
    get().endTurn(); // 第二次按键就是 skip 决策

    expect(get().turnEndAsk).toBeNull();
    expect(get().reactionWindow).toBeNull();
    expect(get().engineState.turn).toBe(6);
  });

  it('窗内发动技能：真 ACTIVATE_SKILL 消费账本+抽牌入账，单候选闭窗', () => {
    installStoreState(makeEngineState([watchGeneral('g_watch', '守夜')]));
    get().endTurn();

    expect(get().activateTurnEndSkill('g_watch:守夜:e1', 'g_watch')).toBe(true);

    const state = get();
    expect(state.engineState.turn).toBe(5); // 发动≠结束回合
    expect(state.engineState.consumedSkills).toEqual([{
      stableId: '5:g_watch:守夜:e1',
      skillId: 'g_watch:守夜:e1',
      turn: 5,
      playerId: 1,
    }]);
    expect(state.engineState.players[0].hand).toHaveLength(1); // DRAW 已结算
    expect(state.turnEndAsk).toBeNull();
    expect(state.reactionWindow).toBeNull();
    expect(state.skillActivations).toHaveLength(1);
    expect(state.skillActivations[0]).toMatchObject({
      skillName: '守夜',
      id: '5:g_watch:守夜:e1',
    });
  });

  it('多候选：发动一个后窗内只剩下一个，全部用完才闭窗', () => {
    installStoreState(makeEngineState([
      watchGeneral('g_watch', '守夜'),
      watchGeneral('g_watch2', '守夜二'),
    ]));
    get().endTurn();
    expect(get().turnEndAsk?.candidates).toHaveLength(2);

    expect(get().activateTurnEndSkill('g_watch:守夜:e1', 'g_watch')).toBe(true);
    const afterFirst = get();
    expect(afterFirst.turnEndAsk?.candidates).toHaveLength(1);
    expect(afterFirst.turnEndAsk?.candidates[0].skillId).toBe('g_watch2:守夜二:e1');
    expect(afterFirst.reactionWindow).not.toBeNull();

    expect(afterFirst.activateTurnEndSkill('g_watch2:守夜二:e1', 'g_watch2')).toBe(true);
    const afterSecond = get();
    expect(afterSecond.turnEndAsk).toBeNull();
    expect(afterSecond.reactionWindow).toBeNull();
    expect(afterSecond.engineState.consumedSkills).toHaveLength(2);
    expect(afterSecond.engineState.players[0].hand).toHaveLength(2);

    // 账本扣减后继续走真实结束回合提交
    afterSecond.endTurn();
    expect(get().engineState.turn).toBe(6);
    expect(get().turnEndAsk).toBeNull();
  });

  it('未知 skillId 的发动被引擎拒绝：返回 false 且不动窗', () => {
    installStoreState(makeEngineState([watchGeneral('g_watch', '守夜')]));
    get().endTurn();

    expect(get().activateTurnEndSkill('g_watch:守夜:e9', 'g_watch')).toBe(false);
    const state = get();
    expect(state.turnEndAsk?.candidates).toHaveLength(1);
    expect(state.engineState.consumedSkills ?? []).toHaveLength(0);
    expect(state.engineState.turn).toBe(5);
  });

  it('无候选的人类座位：endTurn 零行为变化直接提交', () => {
    installStoreState(makeEngineState([]));
    get().endTurn();
    expect(get().turnEndAsk).toBeNull();
    expect(get().reactionWindow).toBeNull();
    expect(get().engineState.turn).toBe(6);
  });

  it('AI 座位不进询问门（其发动走 policy 的普通 ACTIVATE_SKILL 动作）', () => {
    installStoreState(makeEngineState([watchGeneral('g_watch', '守夜')]), true);
    get().endTurn();
    expect(get().turnEndAsk).toBeNull();
    expect(get().engineState.turn).toBe(6);
  });
});

describe('gameStateAdapter · turn/consumedSkills 保留 (2.3.1)', () => {
  it('storeStateToEngineState 直通 store 里的 engineState 计数器与账本', () => {
    const engineState = makeEngineState([watchGeneral('g_watch', '守夜')]);
    engineState.consumedSkills = [{
      stableId: '5:g_watch:守夜:e1',
      skillId: 'g_watch:守夜:e1',
      turn: 5,
      playerId: 1,
    }];
    const rebuilt = storeStateToEngineState({ engineState, currentRound: 99 });
    // 从 display 字段重推 turn 会把计数器回卷成 99——账本键会整批错位。
    expect(rebuilt.turn).toBe(5);
    expect(rebuilt.consumedSkills).toEqual(engineState.consumedSkills);
  });

  it('engineState 缺失时回退 display 推导（旧形态 store 不炸）', () => {
    const rebuilt = storeStateToEngineState({
      currentRound: 4,
      players: [
        { id: 1, name: 'a', hp: 4, hand: [], generalPool: [], fieldGenerals: [], graveyard: [], baseHp: 6, baseMaxHp: 6, isAlive: true, statuses: [] },
        { id: 2, name: 'b', hp: 4, hand: [], generalPool: [], fieldGenerals: [], graveyard: [], baseHp: 6, baseMaxHp: 6, isAlive: true, statuses: [] },
      ],
    });
    expect(rebuilt.turn).toBe(4);
    expect(rebuilt.consumedSkills).toBeUndefined();
  });
});
