// @vitest-environment node
/**
 * 乙 线第三片㈂ 的第四枚证人（2026-11-01）——**这一枚跑在 Node 环境里**：
 * 这一格里既没有 `localStorage`，也没有 `document`、没有 `window`。
 *
 * 为什么要有这么一枚：另一枚证人（`tableCompute.test.ts`）里那两臂对账跑在 jsdom 下，
 * 那里"进程臂没用到浏览器东西"这件事只由源码文本与行为撑着；环境本身照样给得出那些东西。
 * 这一枚不给：整局在**根本没有浏览器可借**的世界里跑出来，跑到收口。
 * 它与开局命令行（`npm run opening-compute -- --play`）同一条路，差别只在这里逐条断言、进全套闸与 CI。
 *
 * 第二句钉的是"搬出去没有引入第二份随机"：同一枚种子、同一份料跑两遍，终局读数一条不差。
 * 比对口径＝键序排序＋把 `__inst_<序号>` 那颗**进程级铸造计数器**抹平——这是 AI 擂台线在册的那条
 * 物理实话（`createRuntimeInstanceId` 只保证同一次进程内唯一，不跨进程；擂台线自己拿种子钢印盖掉它）。
 * 抹掉序号之后还剩什么在比？每一张牌是哪一张、哪一席手里有几张、体力与账本扣了哪些——一位都不许差。
 * 种子那颗游标必须显式带着走（`openingToEngineState` 里那一格）——这是 乙 线第 0 步量出来的物理实话，
 * 这一枚把它钉在 `startMatch` 里：进程那侧开局游标＝开局账算完剩下的那一颗，换成别的常数也算红。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import type { GameAction } from '../action/ActionTypes';
import { allGenerals } from '../data/generals';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { createStrategyPolicy } from '../ai/policies/strategyPolicy';
import { resetLiveReplay } from '../replay/liveReplayRecorder';
import { __resetResidentEngineContainer } from '../store/engineExecutionBridge';
import { beginInitialDraw } from '../store/engineSteps';
import { OPENING_DRAFT_TOTAL, runOpeningToDraft, type OpeningRoster, type OpeningState } from './openingCompute';
import type { AiSeatMode } from './runtimeSetup';
import { createTableHost, openingToEngineState, playTable, type TableHost } from './tableCompute';

const SEED = 20261102;

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}

const readingOf = (value: unknown): string =>
  JSON.stringify(sortDeep(value) ?? null).replace(/__inst_[0-9a-z]+/g, '__inst_#');

const roster: OpeningRoster = { pool: allGenerals, disabledIds: new Set<string>() };

const seatModes = (count: number): AiSeatMode[] =>
  Array.from({ length: count }, () => ({ isAi: true, tier: 'balanced' as const }));

function opening(playerCount: number): OpeningState {
  return runOpeningToDraft(
    { seed: SEED, playerCount, seatModes: seatModes(playerCount), roomName: '进程里那一局', draftTotal: OPENING_DRAFT_TOTAL },
    roster,
  );
}

function policyPicker() {
  const policy = createStrategyPolicy('balanced');
  return (arm: TableHost, playerId: number): GameAction | null => {
    const probe = new GameEngine(arm.engineState, { recordHistory: false });
    syncPlayerSkills(probe, arm.engineState);
    return policy(probe, playerId);
  };
}

/** 开局账 ⇒ 引擎读数 ⇒ 进程宿主 ⇒ 挂上开局抽牌（生产 `confirmDraft` 最后一席确认之后那一下）。 */
function startMatch(playerCount: number): { host: TableHost; played: EngineState; rng: number } {
  const opened = opening(playerCount);
  const played = openingToEngineState(opened);
  // 乙 线第 0 步量到的那条物理实话：生产那条路的开局游标本来来自 `Date.now()^Math.random()`，
  // 没人能指明、能复现。所以这一格里那颗游标只能由外面的种子一路带进来——钉死在**开局账上那个值**，
  // 不是"随便一个正数"：换了另一颗常数种子照样复现得动，但那已经不是这一局了。
  expect(played.rngState?.s, '进程那侧的游标＝开局账算完剩下的那一颗').toBe(opened.rng >>> 0);
  const host = createTableHost(played);
  const begin = beginInitialDraw(host, played.players[0]!.id);
  expect(begin.ok, '开局抽牌得挂得上（认 DRAW_REQUIRED 那一身，认不中就不算开局）').toBe(true);
  return { host, played, rng: opened.rng >>> 0 };
}

describe('乙 第三片㈂ ㈣ Node 环境里那一局（没有浏览器可借）', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  it('这一格确实没有 localStorage／document／window：进程臂不是"在 jsdom 里假装没用到"', () => {
    const globals = globalThis as Record<string, unknown>;
    expect(globals.localStorage, 'Node 环境不该有本机存档这一格').toBeUndefined();
    expect(globals.document).toBeUndefined();
    expect(globals.window).toBeUndefined();
    // 就算环境里没有这些东西，牌桌宿主照样造得出来、读得动。
    const { host } = startMatch(2);
    expect(host.engineState.players).toHaveLength(2);
  });

  it('三席全 AI 的一局在浏览器外面跑到收口，游标一路由进程自己那本账推进', () => {
    const { host, played } = startMatch(3);
    expect(played.players).toHaveLength(3);
    const cursorAtStart = host.engineState.rngState?.s;
    const result = playTable(host, { maxSteps: 900, pick: policyPicker() });

    expect(result.phase).toBe('gameOver');
    expect(result.steps).toBeGreaterThan(20);
    expect(result.winnerId, '收口时只剩一席在场，胜者就是那一席').not.toBeNull();
    expect(host.engineState.players.filter(player => player.isAlive !== false).map(player => player.id))
      .toEqual([result.winnerId]);
    expect(host.engineState.rngState?.s).not.toBe(cursorAtStart);
  });

  it('同一枚种子、同一份料跑两遍＝逐字同一条终局读数（搬出去没有引入第二份随机）', () => {
    const first = startMatch(2);
    const firstRun = playTable(first.host, { maxSteps: 900, pick: policyPicker() });
    const firstReading = readingOf(first.host.engineState);

    const second = startMatch(2);
    const secondRun = playTable(second.host, { maxSteps: 900, pick: policyPicker() });

    expect(secondRun.steps).toBe(firstRun.steps);
    expect(secondRun.winnerId).toBe(firstRun.winnerId);
    expect(readingOf(second.host.engineState)).toBe(firstReading);
  });

  it('往引擎读数里搬的是既有那几格：进程没有给 EngineState 添新键（牌堆走引擎本来就有的 deck）', () => {
    // 这张清单＝`core/GameState.ts` 里 `EngineState` 声明过的那些键；多出来一个＝进程自己造了新格。
    const declared = [
      'version', 'phase', 'timelinePhase', 'players', 'currentPlayerId', 'turn', 'round', 'deck',
      'discardPile', 'metadata', 'drawState', 'isFirstTurn', 'rngState', 'consumedSkills',
      'turnWindow', 'pendingChoice', 'pendingReaction', 'statModifiers',
    ];
    const { host } = startMatch(2);
    const keys = Object.keys(host.engineState);
    expect(keys.filter(key => !declared.includes(key))).toEqual([]);
    expect(Array.isArray(host.engineState.deck), '洗好的那副牌落在引擎既有的一格里').toBe(true);
    expect(host.engineState.players.every(player => Array.isArray(player.generalPool))).toBe(true);
  });
});
