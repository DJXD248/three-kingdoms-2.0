/**
 * 2.6.3 choice channel at the store container layer.
 *
 * Contract pinned here:
 *   - the ask window's activation of a choiceMode skill opens the debt
 *     (CHOICE_REQUIRED settles into EngineState.pendingChoice) but settles
 *     NOTHING yet — deferred settlement means the chosen branch fires only
 *     at pick time;
 *   - while the debt is outstanding the world is frozen even for the
 *     current player: endTurn is honestly rejected (CHOICE_PENDING), turn
 *     counters do not move;
 *   - chooseOption is the only release valve: it dispatches the canonical
 *     CHOOSE_OPTION for the debtor seat, returns false on any rejection
 *     (no pending / out of range), and never fabricates a second path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import type { Player } from './gameStore';
import type { EngineState } from '../core/GameState';
import type { General } from '../data/generals';
import { __resetResidentEngineContainer } from './engineExecutionBridge';
import { resetLiveReplay } from '../replay/liveReplayRecorder';

function pickGeneral(id: string): General {
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
      name: '择锋',
      description: '回合结束时：摸两张牌或摸一张牌',
      effectMode: 'choice',
      effects: [
        {
          id: 'e1',
          trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
          runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
          description: '摸两张牌',
        },
        {
          id: 'e2',
          trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
          runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
          description: '摸一张牌',
        },
      ],
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

function makeEngineState(player1Generals: General[]): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [
      {
        id: 1, name: '玩家1', hp: 4, hand: [], generalPool: [],
        fieldGenerals: player1Generals.map((g, i) => fieldGeneral(g, 1, i)),
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

function installStoreState(engineState: EngineState) {
  useGameStore.setState({
    players: engineState.players as unknown as Player[],
    currentPlayerIndex: 0,
    currentRound: 3,
    phase: 'playing',
    turnPhase: 'main',
    isTestMode: false,
    winnerId: null,
    engineState,
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

describe('gameStore · choice 冻结世界与择定释放 (2.6.3)', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  it('询问窗内发动 choice 技能：开账不落效果，欠账未清 endTurn 诚实拒绝，择定后牌落账、窗路走通', () => {
    installStoreState(makeEngineState([pickGeneral('g_pick')]));
    get().endTurn();
    const ask = get().turnEndAsk;
    expect(ask?.candidates).toHaveLength(1);
    expect(ask?.candidates[0].skillId).toBe('g_pick:择锋:choice');

    expect(get().activateTurnEndSkill('g_pick:择锋:choice', 'g_pick')).toBe(true);
    const opened = get();
    expect(opened.turnEndAsk).toBeNull(); // 单候选发动即闭窗（ask 簿记照旧）
    expect(opened.engineState.pendingChoice).toMatchObject({
      key: 'ch:5:3:g_pick:择锋:choice',
      playerId: 1,
      options: [
        { label: '摸两张牌' },
        { label: '摸一张牌' },
      ],
    });
    expect(opened.engineState.players[0].hand).toHaveLength(0); // 延后结算：开账瞬间零抽牌
    expect(opened.engineState.consumedSkills).toHaveLength(1);

    // 冻结世界：欠账未清时当前玩家自己的结束回合也是诚实拒绝
    opened.endTurn();
    expect(get().engineState.turn).toBe(5);
    expect(get().engineState.pendingChoice).not.toBeNull();

    // 择定释放：选中分支此刻才走正常结算链
    expect(get().chooseOption(0)).toBe(true);
    const settled = get();
    expect(settled.engineState.pendingChoice ?? null).toBeNull();
    expect(settled.engineState.players[0].hand).toHaveLength(2);
    expect(settled.engineState.deck).toHaveLength(2);

    // 账清后世界解冻：结束回合真实推进
    settled.endTurn();
    expect(get().engineState.turn).toBe(6);
  });

  it('chooseOption 三门守卫：无欠账 false、越界 false 且账不动、择定只欠债人动作放行', () => {
    installStoreState(makeEngineState([]));
    expect(get().chooseOption(0)).toBe(false); // 无 pendingChoice：不 dispatch 不造假

    // 手工种账：欠债人 p2 非当前回合玩家（onBecomingTarget 类场景的 store 证据）
    const seeded = makeEngineState([]);
    seeded.pendingChoice = {
      key: 'ch:5:3:seed_skill',
      playerId: 2,
      options: [
        { label: '摸两张牌', events: [{ type: 'DRAW', data: { playerId: 2, count: 2 } }] },
        { label: '摸一张牌', events: [{ type: 'DRAW', data: { playerId: 2, count: 1 } }] },
      ],
    };
    installStoreState(seeded);

    // 冻结世界（欠债人非当前玩家时同样冻结）：p1 的结束回合被拒
    get().endTurn();
    expect(get().engineState.turn).toBe(5);

    expect(get().chooseOption(7)).toBe(false); // 越界：resolver 门拒绝，账原样保留
    const untouched = get();
    expect(untouched.engineState.pendingChoice?.options).toHaveLength(2);
    expect(untouched.engineState.players[1].hand).toHaveLength(0);

    expect(untouched.chooseOption(1)).toBe(true); // store 恒以 pending.playerId 出动作
    const done = get();
    expect(done.engineState.pendingChoice ?? null).toBeNull();
    expect(done.engineState.players[1].hand).toHaveLength(1); // 选中分支落账
    expect(done.engineState.turn).toBe(5); // 择定≠结束回合
    expect(done.engineState.currentPlayerId).toBe(1); // 世界控制权未漂移
  });

  it('投影不丢账：开账后任何 store 侧重建路径仍看得见 pendingChoice（A 类槽三路同见）', () => {
    const seeded = makeEngineState([]);
    seeded.pendingChoice = {
      key: 'ch:5:3:seed_skill',
      playerId: 1,
      options: [{ label: '摸一张牌', events: [{ type: 'DRAW', data: { playerId: 1, count: 1 } }] }],
    };
    installStoreState(seeded);
    // 触发一次带引擎投影的 store 动作（此处用无候选的 endTurn 直提）前先确认账在
    expect(get().engineState.pendingChoice?.key).toBe('ch:5:3:seed_skill');
    get().endTurn(); // CHOICE_PENDING 拒绝：投影重建后账依旧可见、回合未动
    const after = get();
    expect(after.engineState.turn).toBe(5);
    expect(after.engineState.pendingChoice?.key).toBe('ch:5:3:seed_skill');
    expect(after.chooseOption(0)).toBe(true);
    expect(get().engineState.players[0].hand).toHaveLength(1);
  });
});
