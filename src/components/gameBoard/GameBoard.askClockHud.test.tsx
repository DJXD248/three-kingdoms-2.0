/**
 * 问窗 HUD 那两行的证人（乙 线末片第二刀 · 刀 1 拍 3 ㈁，2026-11-06）。
 *
 * 这里钉的是 v5 的 C7 与 C8＝**画面只读一个数、只报一份名单**：
 *  ㈁ 剩余秒数＝`askClock.remainingAskSec` 算的那一个数（`GameBoard.tsx` 一位不自己减）；
 *  ㈂ 读不到锚（热座／测试台／没开窗）⇒**整块不渲染**，既不许显示 0 秒也不许显示"∞"；
 *  ㈃ 响应链那扇多一行"还差谁没答"＝`askClock.waitingSeatsOf(参加者, 已答)`，名字从既有
 *     `players` 按**席位号**（`Player.id`，不是数组下标）认；
 *  ㈄ 回合结束那扇只有该答那一席⇒一句"就等你一席：〈名字〉"。
 *
 * 时钟口径与 `AskClockDirector.test.tsx` 一致＝只用 `vi.useFakeTimers()`。本文件把导演
 * **真的挂进来**（不是手搓一个 `askDeadline`）：HUD 那个"现在"由导演采样交出来
 * （`askClockNowMs()`），手搓锚会绕开这一整条路、量不到真东西。
 * ⚠️ 因此本文件**不用** `vi.getTimerCount()`——`GameBoard.tsx` 受击闪红那一组定时器是
 * 故意不做 cleanup 的，那个读数在这里天生量不干净（表是否清干净归导演那份文件钉）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import GameBoard from '../GameBoard';
import AskClockDirector from '../AskClockDirector';
import { useGameStore, type Player } from '../../store/gameStore';
import type { General } from '../../data/generals';
import type { EngineState } from '../../core/GameState';
import { __resetResidentEngineContainer } from '../../store/engineExecutionBridge';
import { resetLiveReplay } from '../../replay/liveReplayRecorder';

const get = () => useGameStore.getState();
const T0 = 1_760_000_000_000;

function turnEndGeneral(id: string, skillName: string): General {
  return {
    id, instanceId: id, name: `将${id}`, faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0,
    skills: [{
      name: skillName, description: '回合结束时可发动',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    }],
  } as unknown as General;
}

/** 「受到伤害后」：席 1 那一员听场上（`field`），席 2 那一员只听自己挨的那一刀。 */
function injuryGeneral(id: string, skillName: string, scope?: 'field'): General {
  return {
    id, instanceId: id, name: `将${id}`, faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0,
    skills: [{
      name: skillName, description: '受到伤害后可发动',
      effects: [{
        id: 'e1',
        trigger: scope ? { type: 'onDamageTaken', listenerScope: scope } : { type: 'onDamageTaken' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    }],
  } as unknown as General;
}

function seatPlayer(id: number, name: string, generals: General[], isAi: boolean): Player {
  return {
    id, name, faction: '魏', seatOrder: id, diceRoll: 10 + id,
    hand: [], generalPool: [], graveyard: [],
    baseHp: 6, baseMaxHp: 6, isAlive: true, isSpectating: false, avatarGeneral: null,
    statuses: [], isAi,
    fieldGenerals: generals.map((general, slot) => ({
      general, currentHp: general.hp, maxHp: general.hp,
      meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk, armor: 0, currentArmor: 0,
      armorCards: [], isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false,
      justDeployed: false, ownerId: id, position: { zone: 'front', slot, areaOwnerId: id },
    })),
  } as unknown as Player;
}

function baseState(players: Player[]): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    currentPlayerId: 1, turn: 5, round: 3, isFirstTurn: false,
    players,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
      { id: 'deck_4', name: '粮草', type: '粮草' },
    ],
    discardPile: [], drawState: null, statModifiers: [],
    rngState: { s: 20261106 },
  } as unknown as EngineState;
}

function install(players: Player[], engineState: EngineState, askTimeoutSec = 45) {
  act(() => {
    useGameStore.setState({
      phase: 'playing', turnPhase: 'main', playerCount: players.length, isTestMode: false,
      winnerId: null, gameOverBanner: null, defeatEvent: null,
      engineState, players, currentPlayerIndex: 0, currentRound: 3,
      cardDeck: engineState.deck as never, discardPile: [] as never,
      turnEndAsk: null, reactionWindow: null, pendingChoice: null, askDeadline: null,
      pendingTurnTransition: null, drawContext: null, revealedDrawCards: [], skillActivations: [],
      askTimeoutSec,
      settings: { ...useGameStore.getState().settings, skillPromptMode: 'full' },
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });
}

/** 回合结束那扇：一位真人（席 1）＋一位电脑（席 2）⇒非热座⇒该套表。 */
function installTurnEndAsk(humanSeatCount: 1 | 2 = 1) {
  const first = seatPlayer(1, '甲', [turnEndGeneral('g_blue', '守夜'), turnEndGeneral('g_yellow', '察更')], false);
  const second = seatPlayer(2, '乙', [], humanSeatCount === 1);
  const players = [first, second];
  install(players, baseState(players));
  act(() => { get().endTurn(); });
  expect(get().turnEndAsk, '前提自证：这一桌该问⇒窗开了').not.toBeNull();
}

/** 响应链那扇：容器窗两人欠答＋引擎那一格两个候选（席位 1 与 2）。 */
function installReactionAsk() {
  const first = seatPlayer(1, '甲', [injuryGeneral('g_answer', '应一', 'field')], false);
  const second = seatPlayer(2, '乙', [injuryGeneral('g_next', '应二')], true);
  const players = [first, second];
  const engineState = baseState(players);
  engineState.pendingReaction = {
    turn: 5,
    serial: 1,
    nodes: [{
      key: 'rn:5:1',
      sourceEvent: { type: 'INJURY', data: { targetPlayerId: 2, targetId: 'g_next', damage: 1 } },
      answered: [],
    }],
  } as never;
  install(players, engineState);
  // ⚠️ 故意把参加者写成 `[2, 1]`（与名册下标反着）：这一行名字若被实现成"按下标取"，
  // 出来的就是"甲、乙"⇒下面那句逐字比对当场红。席位号＝`Player.id` 才是这两串的口径。
  act(() => { get().openReactionWindow(undefined, [2, 1]); });
  expect(get().reactionWindow, '前提自证：容器窗开了').not.toBeNull();
}

const body = (container: HTMLElement) => container.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __resetResidentEngineContainer();
  resetLiveReplay();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('㈁ C7 回合结束那扇：秒数只读导演那一个数，一秒跳一下', () => {
  it('开窗＋挂表⇒显 45 秒；跳 5 秒⇒40 秒；到点前最后一拍⇒1 秒', () => {
    installTurnEndAsk(1);
    render(<GameBoard />);
    expect(body(document.body), '前提自证：表没挂⇒整块秒数不渲染').not.toContain('⏳');

    render(<AskClockDirector />);
    expect(body(document.body)).toContain('⏳ 45 秒');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(body(document.body)).toContain('⏳ 40 秒');
    act(() => { vi.advanceTimersByTime(39_000); });
    // 假值自查：若 HUD 自己减（或把到点那拍也算进去），这里要么提前归 0 要么显示负数。
    expect(body(document.body)).toContain('⏳ 1 秒');
    expect(body(document.body)).not.toContain('⏳ 0 秒');
  });

  it('到点那一下：HUD 上这扇窗跟着收掉，秒数一位都不留在牌桌上', () => {
    installTurnEndAsk(1);
    render(<GameBoard />);
    render(<AskClockDirector />);
    expect(get().turnEndAsk).not.toBeNull();
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(get().turnEndAsk, '到点＝替这一席按「都不发动」').toBeNull();
    expect(body(document.body)).not.toContain('⏳');
    expect(get().askDeadline).toBeNull();
  });

  it('热座那一形（本机两位真人、无联机房间）⇒牌桌上一行秒数都没有，也没有 0 秒／∞ 那种占位', () => {
    installTurnEndAsk(2);
    render(<GameBoard />);
    render(<AskClockDirector />);
    expect(get().askDeadline).toBeNull();
    const text = body(document.body);
    expect(text).not.toContain('⏳');
    // 假值自查：把"读不到锚就显 0"当实现的话，下面这两句当场红。
    expect(text).not.toContain('0 秒');
    expect(text).not.toContain('∞');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(body(document.body)).not.toContain('⏳');
  });
});

describe('㈁ C8 两扇 HUD 各自那句"等谁"', () => {
  it('回合结束那扇＝就等你一席：〈名字〉（名字读既有 `players`，席位号＝`Player.id`）', () => {
    installTurnEndAsk(1);
    render(<GameBoard />);
    expect(body(document.body)).toContain('就等你一席：甲');
  });

  it('响应链那扇＝还差谁没答：乙、甲；一席答完只剩还没答的那一位（名字＝席位号对上名册）', () => {
    installReactionAsk();
    render(<GameBoard />);
    render(<AskClockDirector />);
    expect(body(document.body)).toContain('⏳ 45 秒');
    expect(body(document.body), '两名参与者一位都没答⇒名册全量、跟着参加者原序 `[2,1]`').toContain('还差谁没答：乙、甲');

    act(() => { get().passReaction(2); });
    const text = body(document.body);
    expect(text).toContain('还差谁没答：甲');
    expect(text).not.toContain('乙、甲');
    // 正向自证：这一格用的确实是既有名册里的名字，不是第二份"席位 1／席位 2"那种编号。
    expect(get().players.map(p => p.name)).toEqual(['甲', '乙']);
    expect(get().reactionWindow?.passed).toEqual([2]);
  });
});
