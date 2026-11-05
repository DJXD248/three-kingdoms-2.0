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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from './gameStore';
import type { Player } from './gameStore';
import type { EngineState } from '../core/GameState';
import type { General } from '../data/generals';
import { __resetResidentEngineContainer } from './engineExecutionBridge';
import { storeStateToEngineState } from './gameStateAdapter';
import { resetLiveReplay, getLiveReplayEntryCount } from '../replay/liveReplayRecorder';
// 末片第一刀那条静态链的证人要用：客人交回的席位号由这张表绑出，动手走的是生产那个翻译出口。
import type { GameAction } from '../action/ActionTypes';
import { applyCanonicalAction } from './applyCanonicalAction';
import { buildSeatMap, seatOfPeer } from '../network/netSeat';

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

function installStoreState(engineState: EngineState, firstSeatIsAi = false, currentPlayerIndex = 0) {
  if (firstSeatIsAi) (engineState.players[0] as any).isAi = true;
  // Production invariant (mirrored on purpose): the display player array IS
  // the engine player array — the engine-aware setter rebuilds engineState
  // from the display fields on every set() that omits it (ask-open does),
  // so a handcrafted display array without fieldGenerals would be wiped.
  // 末片第一刀多出来的第三个参数＝"现在轮到展示面第几位"，默认 0＝既有各枚证人一位未动。
  useGameStore.setState({
    players: engineState.players as unknown as Player[],
    currentPlayerIndex,
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

/**
 * 2.8.17 (#42) 技能提示两档：默认「智能」＝上面的全部行为一位未变；
 * 「完整」＝场上只要有回合结束技能就开窗，不可发动的置灰写明原因。
 * 两档唯一的出口都是同一个动作（skipTurnEndAsk → 真 END_TURN），
 * 合法集合始终只有 listTurnEndSkillCandidates 那一处。
 */
describe('gameStore · 技能提示两档 (2.8.17 #42)', () => {
  /** 门槛录在效果上，编译后成为该定义的 conditions（v2.8.3 刀 B 那条链）。 */
  function gatedGeneral(id: string, skillName: string): General {
    return {
      id,
      instanceId: id,
      name: '将' + id,
      faction: '蜀',
      hp: 3,
      type: '武将',
      meleeAtk: 2,
      rangedAtk: 1,
      armor: 0,
      skills: [{
        name: skillName,
        description: '体力充沛时补充手牌',
        effects: [{
          id: 'e1',
          trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
          runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
          conditions: [{ metric: 'GENERAL_HP', op: 'GTE', value: 99 }],
        }],
      }],
    } as unknown as General;
  }

  const setMode = (skillPromptMode: 'smart' | 'full') =>
    useGameStore.setState(st => ({ settings: { ...st.settings, skillPromptMode } }));

  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  afterEach(() => setMode('smart'));

  it('默认档位＝智能（设置一位没落地时，endTurn 的行为与 2.3.1 完全一致）', () => {
    installStoreState(makeEngineState([watchGeneral('g_watch', '守夜')]));
    expect(get().settings.skillPromptMode).toBe('smart');
  });

  it('智能档：门槛不满足＝没有可发动的＝不开窗，直接提交 END_TURN', () => {
    installStoreState(makeEngineState([gatedGeneral('g_gate', '蓄锐')]));
    setMode('smart');
    get().endTurn();
    expect(get().turnEndAsk).toBeNull();
    expect(get().engineState.turn).toBe(6);
  });

  it('完整档：同一个状态开窗，技能照旧列出、置灰、写明不满足的门槛', () => {
    installStoreState(makeEngineState([gatedGeneral('g_gate', '蓄锐')]));
    setMode('full');
    get().endTurn();

    const ask = get().turnEndAsk;
    expect(ask).not.toBeNull();
    expect(ask?.candidates).toHaveLength(1);
    expect(ask?.candidates[0]).toMatchObject({
      skillId: 'g_gate:蓄锐:e1',
      activatable: false,
      disabledReason: '不满足发动门槛：体力≥99',
    });
    // 开窗本身仍是 B 类：零 dispatch，引擎计数器停在原地。
    expect(get().engineState.turn).toBe(5);
  });

  it('完整档：置灰项的发动被引擎诚实拒绝（合法集合一位未放宽），窗仍留着', () => {
    installStoreState(makeEngineState([gatedGeneral('g_gate', '蓄锐')]));
    setMode('full');
    get().endTurn();

    expect(get().activateTurnEndSkill('g_gate:蓄锐:e1', 'g_gate')).toBe(false);
    const state = get();
    expect(state.engineState.consumedSkills ?? []).toHaveLength(0);
    expect(state.engineState.turn).toBe(5);
    expect(state.turnEndAsk?.candidates).toHaveLength(1);
  });

  it('完整档：「都不发动」＝同一个出口，闭窗并提交真 END_TURN', () => {
    installStoreState(makeEngineState([gatedGeneral('g_gate', '蓄锐')]));
    setMode('full');
    get().endTurn();
    get().skipTurnEndAsk();

    const state = get();
    expect(state.turnEndAsk).toBeNull();
    expect(state.reactionWindow).toBeNull();
    expect(state.engineState.turn).toBe(6);
  });

  it('完整档：能发动的照旧发动；用完后窗不闭，把刚用过的改列「本回合已发动过」', () => {
    installStoreState(makeEngineState([
      watchGeneral('g_watch', '守夜'),
      gatedGeneral('g_gate', '蓄锐'),
    ]));
    setMode('full');
    get().endTurn();

    const opened = get().turnEndAsk;
    expect(opened?.candidates.map(c => c.activatable)).toEqual([true, false]);

    expect(get().activateTurnEndSkill('g_watch:守夜:e1', 'g_watch')).toBe(true);
    const after = get();
    expect(after.engineState.turn).toBe(5);
    expect(after.turnEndAsk?.candidates).toHaveLength(2);
    expect(after.turnEndAsk?.candidates[0]).toMatchObject({
      skillId: 'g_watch:守夜:e1',
      activatable: false,
      disabledReason: '本回合已发动过',
    });
    expect(after.turnEndAsk?.candidates[1].disabledReason).toBe('不满足发动门槛：体力≥99');
    // 出口仍然只有一个，按下去就走真实结束回合。
    after.skipTurnEndAsk();
    expect(get().turnEndAsk).toBeNull();
    expect(get().engineState.turn).toBe(6);
  });

  it('同一状态切回智能档：可发动的照旧进窗，且窗内一位不多（两档只差可见性）', () => {
    installStoreState(makeEngineState([
      watchGeneral('g_watch', '守夜'),
      gatedGeneral('g_gate', '蓄锐'),
    ]));
    setMode('smart');
    get().endTurn();
    const candidates = get().turnEndAsk?.candidates ?? [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].skillId).toBe('g_watch:守夜:e1');
    expect(candidates[0].activatable).toBe(true);
    expect(candidates[0].disabledReason).toBeNull();
  });
});

/**
 * v2.9.17「强制发动·全覆盖」刀。用户 2026-10-21 两句裁决原文＝
 *   「强制发动永远是强制发动，无论什么节点，但是一定要通知玩家有什么技能发动了」
 *   「哪些官方卡是强制发动，这部分由我自己来填写」
 * 前半句把最后一格交回技能身上：回合结束那扇窗从 v2.3.1 起是"逢人就问、一个都不放过"，
 * 与「强制发动不问」正面相撞；从今天起勾了这一格的定义**不进窗**，由系统在同一次
 * `ACTIVATE_SKILL` 规范动作里替这一席发动（人席／AI 席／热座／沙盒一律，判据不看座位）。
 * 后半句是配套的硬义务＝不问可以、看不见不行⇒自动那一路也必须飘出"谁【哪枚技能】发动了"，
 * 由 `store/activationNotices.ts` 从事件流单点推导（三条发动路共用一处，见该文件注释）。
 *
 * 后半句还钉住"到点自己响"发生在**别的那一格**的情形：`TurnResolver` 在 END_TURN 那一次
 * dispatch 里发 `TURN_START`，所以下一席的强制发动回合开始技能正是在提交结束回合那一刻
 * 自己响⇒通知必须接得上（本轮施工时先写了一句"这一身压根不可能产出 SKILL_ACTIVATED"的
 * 错注释，被这条证人当场逮到）。
 */
describe('gameStore · 强制发动不进询问窗＋每一次发动都要通知 (v2.9.17)', () => {
  /** 录入面那一格（`Skill.forced`）＝结算侧唯一的"问不问"开关，这里就勾它。 */
  function forcedGeneral(general: General): General {
    return {
      ...general,
      skills: general.skills.map(skill => ({ ...skill, forced: true })),
    } as General;
  }

  /** 门槛写在效果上（编译后成为该定义的 conditions）——强制发动也不放宽合法判定。 */
  function gatedForcedGeneral(id: string, skillName: string): General {
    return forcedGeneral({
      ...watchGeneral(id, skillName),
      skills: [{
        name: skillName,
        description: '体力充沛时补充手牌',
        effects: [{
          id: 'e1',
          trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
          runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
          conditions: [{ metric: 'GENERAL_HP', op: 'GTE', value: 99 }],
        }],
      }],
    } as unknown as General);
  }

  /** 「回合开始时」那一型：只在 END_TURN 那一次 dispatch 内（`TURN_START`）才有机会响。 */
  function turnStartGeneral(id: string, forced: boolean): General {
    return {
      ...watchGeneral(id, '迎晓'),
      skills: [{
        name: '迎晓',
        description: '回合开始时抽一张',
        ...(forced ? { forced: true } : {}),
        effects: [{
          id: 'e1',
          trigger: { type: 'onTurnStart' },
          runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
        }],
      }],
    } as unknown as General;
  }

  /** 两席都摆上将领：`makeEngineState` 只给第一席，第二席要自己接。 */
  function installTwoSeats(first: General[], second: General[]) {
    const engineState = makeEngineState(first);
    engineState.players[1].fieldGenerals = second.map((general, slot) => fieldGeneral(general, 2, slot));
    installStoreState(engineState);
  }

  const setMode = (skillPromptMode: 'smart' | 'full') =>
    useGameStore.setState(st => ({ settings: { ...st.settings, skillPromptMode } }));

  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  afterEach(() => setMode('smart'));

  it('人类座位＋只有强制发动：不开窗、替玩家发动、同一次按键就把回合结束掉', () => {
    installStoreState(makeEngineState([forcedGeneral(watchGeneral('g_forced', '夜袭'))]));
    get().endTurn();

    const state = get();
    expect(state.turnEndAsk).toBeNull();
    expect(state.reactionWindow).toBeNull();
    // 发动与结束回合都出自这一次按键，走的是同一本账（consumedSkills 落笔）
    expect(state.engineState.consumedSkills).toEqual([{
      stableId: '5:g_forced:夜袭:e1',
      skillId: 'g_forced:夜袭:e1',
      turn: 5,
      playerId: 1,
    }]);
    expect(state.engineState.players[0].hand).toHaveLength(1); // 效果照旧结算
    expect(state.engineState.turn).toBe(6);
    // 硬义务：不问可以，看不见不行
    expect(state.skillActivations).toHaveLength(1);
    expect(state.skillActivations[0]).toMatchObject({
      id: '5:g_forced:夜袭:e1',
      generalName: '将g_forced',
      skillName: '夜袭',
      message: '回合结束时可发动',
    });
  });

  it('AI 座位同一判据（不问靠技能身上那一格，不靠坐在那一席的是谁）', () => {
    installStoreState(makeEngineState([forcedGeneral(watchGeneral('g_forced', '夜袭'))]), true);
    get().endTurn();

    const state = get();
    expect(state.engineState.consumedSkills).toHaveLength(1);
    expect(state.engineState.turn).toBe(6);
    expect(state.skillActivations).toHaveLength(1);
  });

  it('强制＋需人点头混合：窗里只剩后者，绝不把刚替玩家发动的那一枚再问一遍', () => {
    installStoreState(makeEngineState([
      forcedGeneral(watchGeneral('g_forced', '夜袭')),
      watchGeneral('g_watch', '守夜'),
    ]));
    get().endTurn();

    const state = get();
    expect(state.engineState.turn).toBe(5); // 仍停在询问（开窗＝零 dispatch 那条契约没变）
    expect(state.engineState.consumedSkills).toHaveLength(1);
    expect(state.skillActivations).toHaveLength(1);
    const candidates = state.turnEndAsk?.candidates ?? [];
    expect(candidates.map(c => c.skillId)).toEqual(['g_watch:守夜:e1']);
    expect(candidates[0]).toMatchObject({ activatable: true, disabledReason: null });

    state.skipTurnEndAsk();
    expect(get().engineState.turn).toBe(6);
  });

  it('完整档：刚替玩家发动的那一枚照旧列出、置灰、写明「本回合已发动过」', () => {
    installStoreState(makeEngineState([
      forcedGeneral(watchGeneral('g_forced', '夜袭')),
      watchGeneral('g_watch', '守夜'),
    ]));
    setMode('full');
    get().endTurn();

    const candidates = get().turnEndAsk?.candidates ?? [];
    expect(candidates.map(c => c.skillId)).toEqual(['g_forced:夜袭:e1', 'g_watch:守夜:e1']);
    expect(candidates[0]).toMatchObject({ activatable: false, disabledReason: '本回合已发动过' });
    expect(candidates[1]).toMatchObject({ activatable: true, disabledReason: null });
  });

  it('两枚都勾强制＝两枚都替玩家发动（发完一枚按新状态重推下一枚）', () => {
    installStoreState(makeEngineState([
      forcedGeneral(watchGeneral('g_a', '先手')),
      forcedGeneral(watchGeneral('g_b', '后手')),
    ]));
    get().endTurn();

    const state = get();
    expect(state.engineState.consumedSkills).toHaveLength(2);
    expect(state.engineState.players[0].hand).toHaveLength(2);
    expect(state.skillActivations.map(notice => notice.skillName)).toEqual(['先手', '后手']);
    expect(state.engineState.turn).toBe(6);
  });

  it('门槛不满足的强制发动＝照旧不发动、也不通知（强制不放宽合法判定）', () => {
    installStoreState(makeEngineState([gatedForcedGeneral('g_gate', '蓄锐')]));
    get().endTurn();

    const state = get();
    expect(state.engineState.consumedSkills ?? []).toHaveLength(0);
    expect(state.skillActivations).toHaveLength(0);
    expect(state.turnEndAsk).toBeNull();
    expect(state.engineState.turn).toBe(6); // 智能档：没有可发动的＝照常直接提交
  });

  it('完整档下门槛不满足的强制发动＝置灰写明原因，仍不发动', () => {
    installStoreState(makeEngineState([gatedForcedGeneral('g_gate', '蓄锐')]));
    setMode('full');
    get().endTurn();

    const state = get();
    expect(state.engineState.consumedSkills ?? []).toHaveLength(0);
    expect(state.skillActivations).toHaveLength(0);
    expect(state.turnEndAsk?.candidates[0]).toMatchObject({
      activatable: false,
      disabledReason: '不满足发动门槛：体力≥99',
    });
  });

  it('自动发动那一路只飘一条通知（两处手写提示已删，不会再与通用推导叠加）', () => {
    installStoreState(makeEngineState([forcedGeneral(watchGeneral('g_forced', '夜袭'))]));
    get().endTurn();
    expect(get().skillActivations).toHaveLength(1);
  });

  it('下一席勾了强制发动的「回合开始时」＝在提交结束回合那一次里自己响，通知照样接得上', () => {
    installTwoSeats([], [turnStartGeneral('g_dawn', true)]);
    get().endTurn();

    const state = get();
    expect(state.engineState.turn).toBe(6);
    expect(state.engineState.currentPlayerId).toBe(2);
    expect(state.engineState.consumedSkills ?? []).toHaveLength(0); // 自动路不带 stableId＝不落账（v2.9.15 口径）
    expect(state.skillActivations).toHaveLength(1);
    expect(state.skillActivations[0]).toMatchObject({ generalName: '将g_dawn', skillName: '迎晓' });
  });

  it('那一声通知活得过下一席的抽卡窗口＝换人不消音（界面只有两条清除路，都不在这条路上）', () => {
    // 下一席一进回合先扣营地损耗、再抽 5 张；`makeEngineState` 那 4 张牌不够，
    // `executeDraw` 会诚实回 false⇒这一条要真的走完抽卡窗口，所以现场把牌堆加厚。
    const engineState = makeEngineState([]);
    engineState.deck = [...engineState.deck, ...Array.from(
      { length: 10 },
      (_, i) => ({ id: `deck_extra_${i}`, name: '粮草', type: '粮草' }),
    )] as EngineState['deck'];
    engineState.players[1].fieldGenerals = [fieldGeneral(turnStartGeneral('g_dawn', true), 2, 0)];
    installStoreState(engineState);

    get().endTurn();
    expect(get().skillActivations).toHaveLength(1);
    expect(get().drawContext).not.toBeNull(); // 下一席的回合开始抽卡窗口开着
    get().resolvePendingDrawLoss(); // 界面上那一步由「抽卡确认」页自己点，先按顺序走

    const total = get().drawContext?.totalCards ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(get().executeDraw(0, total)).toBe(true);
    get().confirmDraw();

    const state = get();
    expect(state.phase).toBe('playing');
    expect(state.skillActivations.map(item => item.skillName)).toContain('迎晓');
  });

  it('同一格没勾强制发动＝照旧停下来问（这一刀没把回合开始也变成不问）', () => {
    installTwoSeats([], [turnStartGeneral('g_dawn', false)]);
    get().endTurn();

    const state = get();
    expect(state.skillActivations).toHaveLength(0);
    expect(state.engineState.pendingReaction?.nodes ?? []).toHaveLength(1);
  });

  it('勾了强制发动但择一逐项门槛全不过＝一次诚实退回就收手（绝不空耗，也不谎报发动）', () => {
    // 定义级门槛过（所以窗里照旧列得出来），拦下的是引擎里那一道逐项门槛⇒解析器
    // 如实报 `SKILL_CONDITION_UNMET`。这一条钉的是循环里的 `declined`：同一枚被反复
    // 重试＝往录像里灌 64 笔一模一样的空动作（重置后首笔只开文档，所以 0 笔才是对的）。
    const general = {
      ...watchGeneral('g_choice', '二选一'),
      skills: [{
        name: '二选一',
        description: '回合结束时二选一',
        forced: true,
        effectMode: 'choice',
        effects: [
          {
            id: 'a',
            trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
            runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
            conditions: [{ metric: 'HAND_COUNT', subject: 'SELF', op: 'GTE', value: 99 }],
          },
          {
            id: 'b',
            trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
            runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' },
            conditions: [{ metric: 'HAND_COUNT', subject: 'SELF', op: 'GTE', value: 99 }],
          },
        ],
      }],
    } as unknown as General;
    installStoreState(makeEngineState([general]));
    get().endTurn();

    const state = get();
    expect(state.engineState.consumedSkills ?? []).toHaveLength(0);
    expect(state.skillActivations).toHaveLength(0);
    expect(getLiveReplayEntryCount()).toBe(0); // 只有那一次被退回的尝试，没有第二十三次
    // 仍然照旧问人：合法判定一位没放宽，也没因为"自动试过"就把它藏起来
    expect(state.turnEndAsk?.candidates.map(c => c.skillId)).toEqual(['g_choice:二选一:choice']);
    expect(state.engineState.turn).toBe(5);
    state.skipTurnEndAsk();
    expect(get().engineState.turn).toBe(6);
  });

  it('发动完已经是终局＝到此为止，绝不再多提交一次结束回合（录像里不多那一笔空动作）', () => {
    // 引擎侧那一格先落成终局（`deriveResultState` 读的就是这个键）：这一条钉的是
    // 出口守卫本身＝"替玩家发动完、再一看已经结束了，就到此为止"。真对局里触发它的
    // 是那几发自己响的效果把最后一席打死，这里用一个已是终局的局面复现同一个出口条件。
    const engineState = makeEngineState([forcedGeneral(watchGeneral('g_forced', '夜袭'))]);
    engineState.phase = 'gameOver';
    installStoreState(engineState);
    get().endTurn();

    const state = get();
    expect(state.engineState.consumedSkills).toHaveLength(1);
    expect(state.skillActivations).toHaveLength(1);
    // 重置后第一笔 dispatch 只开录像文档、不记步；多提交一次 END_TURN 就会变成 1 步。
    expect(getLiveReplayEntryCount()).toBe(0);
    expect(state.engineState.turn).toBe(5);
    expect(state.phase).toBe('gameOver');
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

/**
 * 乙 线末片第一刀（2026-11-05）：把「客人按结束回合 ⇒ **房主这屏**替那一席开窗、且没提交」
 * 这条一路上只写在注释里的推理链变成实测。链路逐字是生产那一条：
 * `components/NetRoomBridge.tsx:116` 的 `execute` ＝ `applyCanonicalAction(useGameStore.getState(), seat, action)`
 * → `store/applyCanonicalAction.ts:93` 的 `case 'END_TURN'` → `gameStore.endTurn`（`:719`）
 * → 人类席闸门（`:751-752`）。席位号由 `network/netSeat.ts` 的 `buildSeatMap` 绑出（只列非 AI 席），
 * 客人那一席在闸门看来就是人。这里**没有**动 `src/network/` 任何实现，只是把现成的两块接起来验一次。
 */
describe('乙 末片第一刀 · 客人交回席位号 ⇒ 房主浏览器开窗且不提交（那条静态链落地）', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  it('席位表把非 AI 那一席绑给客人；房主侧收到该席的 END_TURN 只开窗，回合号与账本一位未动', () => {
    const rows = buildSeatMap({
      seats: [{ seat: 1, isAi: false, label: '房主席' }, { seat: 2, isAi: false, label: '客人席' }],
      host: { id: 'peer_host', name: '房主' },
      guests: [{ id: 'peer_guest', name: '客人' }],
    });
    expect(seatOfPeer(rows, 'peer_guest'), '客人那一席＝席位号 2').toBe(2);

    // 房主本机那份账：轮到客人那一席（第 2 位），它场上挂着一枚要人点头的回合结束技能。
    const engineState = makeEngineState([]);
    engineState.currentPlayerId = 2;
    engineState.players[1]!.fieldGenerals = [watchGeneral('g_guest_watch', '守夜')].map((g, i) => fieldGeneral(g, 2, i));
    installStoreState(engineState, false, 1);

    expect(get().engineState.currentPlayerId, '闸门读引擎真值：现在轮到客人那一席').toBe(2);
    expect((engineState.players[1] as { isAi?: boolean }).isAi, '客人那一席不是 AI——在闸门看来就是人').not.toBe(true);
    const turnBefore = get().engineState.turn;

    // 生产那一句执行口，逐字照抄 `NetRoomBridge.tsx:116`（席位号由客人交回，账本住房主这边）。
    const accepted = applyCanonicalAction(get(), 2, { type: 'END_TURN', playerId: 2 } as unknown as GameAction);

    expect(accepted, '这一枚动作该被牌桌收下（收下＝开了窗）').toBe(true);
    const state = get();
    expect(state.turnEndAsk, '客人按下结束回合⇒房主这屏该替那一席开窗问').toMatchObject({
      playerId: 2,
      candidates: [{ skillId: 'g_guest_watch:守夜:e1', generalId: 'g_guest_watch', generalName: '将g_guest_watch', skillName: '守夜' }],
    });
    // "没提交"的凭据：回合号没走、这一席一枚都没记进账本。（录像那格在这里当不了凭据：
    // `liveReplayRecorder` 复位后的**第一笔** dispatch 只开档、不计数，所以计数为 0 既可能真是没提交、
    // 也可能只是刚开档——一句两头都真的话不配当证人。）
    expect(state.engineState.turn).toBe(turnBefore);
    expect(state.engineState.consumedSkills ?? []).toHaveLength(0);

    // 反向钉住上面两句不是空话：同一格答完（跳过＝提交）回合号才走。
    get().skipTurnEndAsk();
    expect(get().engineState.turn).toBe(turnBefore + 1);
  });
});
