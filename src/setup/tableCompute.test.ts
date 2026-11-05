/**
 * 乙 线第三片㈂ 的证人（2026-11-01）。
 *
 * 这一片要成立的是三句，每一句都落在可执行的判据上，不许拿注释交差：
 *
 * ㈠ **进程那一侧的面是干净的**＝`tableCompute.ts` 与 `store/engineSteps.ts` 里不许出现本机存档、
 * 浏览器、zustand、Node 的 fs，也不许 import 那份会自己读存档的 `gameStore`（名册来源裁的是**甲**：
 * 开房间那位玩家把本机那份交给算牌机器，绝不能靠宿主自带的存档冒充交上来的那份）。
 * 同时要正面钉住两件事：宿主调的就是 `engineSteps` 那批函数＝**没有第二套判据**，
 * 而且宿主不自己碰闸口（不直接 `dispatchStoreAction`／`createAction`）＝**没有第二个执行口**。
 *
 * ㈡ **浏览器里那一局与进程里那一局逐字同读数**＝同一份开局账生出两臂（一臂走生产的镜像喂进真 store
 * 的展示面，一臂走 `createTableHost`），然后用**生产那一条驱动路**（`playTable`／`stepTable`）推着
 * 两臂同时走：每一次牌桌调用都落到两臂各自的同名入口上，调用完立刻比对两边的引擎读数与收/拒返回值。
 * 两臂唯一合法的差别是"怎么知道现在轮到谁"（展示面 vs 引擎真值），这一条比对量的正是它有没有真的等价。
 *
 * ㈢ **没搬的那一格照实说**＝人类席回合结束那扇"逢人就问"的窗：浏览器开完窗**一个字节都不推进**，
 * 进程没有 `set()`、也就没有那扇窗，它把勾了强制发动的那几枚自己响掉之后直接提交。
 * 这一条不粉饰成"已经等价"，钉的是那句准确的话：差的只有"问人"那一步；人答完（跳过）之后两臂又回同一条读数。
 *
 * 比对口径两档，都用的是本仓库在册的那两条：
 * ① **开局那一刻＝真逐字节**（两臂拿的是同一个对象图克隆出来的读数，`instanceId` 一颗不差）；
 * ② **每一步之后＝键序无关＋把铸造序号抹平等价的读数**。抹平的两样都不是对局事实：
 *    键序——浏览器那一侧凡是只写展示字段的 `set()`（开问窗那一格就是）都会经 `storeStateToEngineState`
 *    把引擎读数重建一遍，键序由那份镜像的字面量决定，进程那一臂永远不重建（D-1 已把"常驻＝重建"
 *    钉成内容等价）；序号——`createRuntimeInstanceId` 那颗进程级计数器（`__inst_<序号>`）只保证同一次
 *    进程内唯一、不跨进程，AI 擂台线在册的原话就是"否则进程级序号会漏出来"，它自己用种子钢印盖掉，
 *    我们这两臂对账没有钢印那一格，所以在比对口径上把它抹平。
 * 除此之外的内容差——哪一席手里是哪一张、体力几颗、账本里扣了哪一枚——一位都不许差，差了就红。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGenerals, type General, type Skill } from '../data/generals';
import { GameEngine } from '../core/GameEngine';
import { cloneEngineState, type EngineState } from '../core/GameState';
import type { GameAction } from '../action/ActionTypes';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { createStrategyPolicy } from '../ai/policies/strategyPolicy';
import { resetLiveReplay } from '../replay/liveReplayRecorder';
import { useGameStore } from '../store/gameStore';
import { applyCanonicalAction } from '../store/applyCanonicalAction';
import { __resetResidentEngineContainer } from '../store/engineExecutionBridge';
import { applyEngineStateToStore } from '../store/gameStateAdapter';
import type { AiSeatMode } from './runtimeSetup';
import { OPENING_DRAFT_TOTAL, runOpeningToDraft, type OpeningRequest, type OpeningRoster } from './openingCompute';
import {
  applyTableAction,
  createTableHost,
  holdTurnEndForAnswer,
  legalTableActions,
  openingToEngineState,
  playTable,
  stepTable,
  tableActorId,
  turnEndAskItemsFor,
  type TableHost,
} from './tableCompute';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = 20261101;

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

/** 键序无关＋把铸造序号抹平（见文件头比对口径②）。`undefined` 与"没有这一格"同一条读法。 */
const readingOf = (value: unknown): string =>
  JSON.stringify(sortDeep(value) ?? null).replace(/__inst_[0-9a-z]+/g, '__inst_#');

/** 真逐字节那一条（只用在两臂都还是同一份克隆的起点上，见比对口径①）。 */
const rawReadingOf = (value: unknown): string => JSON.stringify(value);

/** 对局事实那一条＝整份读数摘掉 `metadata`（浏览器镜像自己的观测格，进程那一臂从不写它）。 */
function factsOf(state: EngineState): string {
  const rest: Record<string, unknown> = { ...(state as unknown as Record<string, unknown>) };
  delete rest.metadata;
  return readingOf(rest);
}

/** 两次读数之间动了哪几格顶格（给"开窗这一拍一位都不许动"那一句用）。 */
function changedTopLevelKeys(before: EngineState, after: EngineState): string[] {
  const left = before as unknown as Record<string, unknown>;
  const right = after as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter(key => readingOf(left[key]) !== readingOf(right[key]))
    .sort();
}

const ledgerRoster = (): OpeningRoster => ({ pool: allGenerals, disabledIds: new Set<string>() });

/** 去掉注释之后的源码（与 乙 第一片那枚证人同一条剥法）。 */
function codeOf(file: string): string {
  return readFileSync(path.join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** 全桌都是 AI：㈡ 要跑的是"两臂同一条路"，人类席那一格单独由 ㈢ 钉。 */
const allAiSeatModes = (count: number): AiSeatMode[] =>
  Array.from({ length: count }, () => ({ isAi: true, tier: 'balanced' as const }));

function openingRequest(playerCount: number): OpeningRequest {
  return {
    seed: SEED,
    playerCount,
    seatModes: allAiSeatModes(playerCount),
    roomName: '两臂对账',
    draftTotal: OPENING_DRAFT_TOTAL,
  };
}

/** 把一份引擎读数装进浏览器那一臂（走生产镜像，不手抄展示字段）。 */
function installBrowserArm(engineState: EngineState): void {
  useGameStore.setState({
    phase: 'menu',
    players: [],
    turnEndAsk: null,
    reactionWindow: null,
    skillActivations: [],
    drawContext: null,
    revealedDrawCards: [],
    isTestMode: false,
  } as Partial<ReturnType<typeof useGameStore.getState>>);
  applyEngineStateToStore(cloneEngineState(engineState), patch => {
    useGameStore.setState(patch as Partial<ReturnType<typeof useGameStore.getState>>);
  });
}

/**
 * 开局那五步的账 ⇒ 引擎读数 ⇒ **同时**喂两臂：
 * 浏览器臂＝真 store 的展示面，进程臂＝`createTableHost`。起点先对一次账。
 */
function startBothArms(playerCount = 2) {
  const opening = runOpeningToDraft(openingRequest(playerCount), ledgerRoster());
  const initial = openingToEngineState(opening);
  installBrowserArm(initial);
  const processHost = createTableHost(cloneEngineState(initial));
  expect(
    rawReadingOf(processHost.engineState),
    '开局那一刻两臂的起点就得是同一条读数——这一格比的是真逐字节',
  ).toBe(rawReadingOf(useGameStore.getState().engineState));
  return { opening, initial, processHost };
}

const browserArm = () => useGameStore.getState() as unknown as TableHost;

/**
 * 双皮牌桌宿主＝同一次牌桌调用同时落到两臂上，落完立刻比对读数与收/拒口径。
 * 驱动路用的还是生产那一条（`stepTable`／`playTable`）；这里只把"执行"这一层复制成两份。
 */
function dualArmHost(processHost: TableHost): TableHost {
  const compare = (entry: string) => {
    expect(
      readingOf(processHost.engineState),
      `「${entry}」之后两臂读数不同一条＝搬出去的那半与浏览器里的那半不是同一判据`,
    ).toBe(readingOf(browserArm().engineState));
  };
  const boolCall = (entry: string, run: (host: TableHost) => boolean): boolean => {
    const byProcess = run(processHost);
    const byBrowser = run(browserArm());
    expect(byBrowser, `「${entry}」两臂的收/拒口径必须一致`).toBe(byProcess);
    compare(entry);
    return byProcess;
  };
  const voidCall = (entry: string, run: (host: TableHost) => void): void => {
    run(processHost);
    run(browserArm());
    compare(entry);
  };
  return {
    get engineState() {
      return processHost.engineState;
    },
    set engineState(value) {
      // 生产驱动路不往这一格写东西（只调方法）。真有人写了，下一句比对会当场逮到——浏览器臂不跟着走。
      processHost.engineState = value;
    },
    executeDraw: (fromPool, fromDeck) => boolCall('executeDraw', host => host.executeDraw(fromPool, fromDeck)),
    confirmDraw: () => voidCall('confirmDraw', host => { host.confirmDraw(); }),
    resolvePendingDrawLoss: () => voidCall('resolvePendingDrawLoss', host => { host.resolvePendingDrawLoss(); }),
    deployGeneral: (general, slot, consumeCards) =>
      boolCall('deployGeneral', host => host.deployGeneral(general, slot, consumeCards)),
    // 这一格不点名列出第四个参数：`sandboxArmingBypass.test.ts` ④ 那枚全仓扫描按**字段名**搜，
    // 证人跟着抄一遍名字只会把它的白名单撑大。原样转传，两臂收到的是同一个值。
    moveGeneral: (...rest) => voidCall('moveGeneral', host => { host.moveGeneral(...rest); }),
    attackTarget: (attackerId, targetId, ranged, consumeCard) =>
      voidCall('attackTarget', host => { host.attackTarget(attackerId, targetId, ranged, consumeCard); }),
    supplyGeneral: (generalId, cards) => voidCall('supplyGeneral', host => { host.supplyGeneral(generalId, cards); }),
    armGeneral: (generalId, armorCards) => boolCall('armGeneral', host => host.armGeneral(generalId, armorCards)),
    activateTurnEndSkill: (skillId, generalId) =>
      boolCall('activateTurnEndSkill', host => host.activateTurnEndSkill(skillId, generalId)),
    activateReactionSkill: (skillId, generalId) =>
      boolCall('activateReactionSkill', host => host.activateReactionSkill(skillId, generalId)),
    skipReaction: () => boolCall('skipReaction', host => host.skipReaction()),
    chooseOption: optionIndex => boolCall('chooseOption', host => host.chooseOption(optionIndex)),
    endTurn: () => voidCall('endTurn', host => { host.endTurn(); }),
    surrender: playerId => voidCall('surrender', host => { host.surrender(playerId); }),
  };
}

/** 挑动作那一枚＝与开局命令行同一个解法（只读探针＋生产策略档）；只算一次，两臂共用同一枚动作。 */
function policyPicker() {
  const policy = createStrategyPolicy('balanced');
  return (arm: TableHost, playerId: number): GameAction | null => {
    const probe = new GameEngine(arm.engineState, { recordHistory: false });
    syncPlayerSkills(probe, arm.engineState);
    return policy(probe, playerId);
  };
}

describe('乙 第三片㈂ ㈠ 进程那一侧的面是干净的（判据不重抄、名册不自带、闸口不另开）', () => {
  const files = ['tableCompute.ts', '../store/engineSteps.ts'];

  it('宿主与搬出来的那半都不读本机存档、不碰浏览器、不 import 会自读名册的 gameStore', () => {
    for (const file of files) {
      const code = codeOf(file);
      for (const banned of ['localStorage', 'sessionStorage', 'document.', 'window.', 'zustand', 'node:fs', 'readFileSync']) {
        expect(code, `${file} 不该出现「${banned}」`).not.toContain(banned);
      }
      // `gameStoreTypes` 那一格全是 `import type`（esbuild 打包时整行抹掉，不会把 zustand 拖进进程），
      // 所以按"引号紧跟 gameStore"判：把那份会自读存档的 store 导进来才是违规。
      expect(code, `${file} 不许导入会自读名册的 gameStore`).not.toMatch(/from\s+['"][^'"]*\/gameStore['"]/);
    }
  });

  it('宿主调的就是 engineSteps 那批函数＝没有第二套判据', () => {
    const code = codeOf('tableCompute.ts');
    for (const shared of [
      'executeCanonicalDraw', 'confirmDrawStep', 'resolveDrawBaseLoss', 'deployGeneralStep',
      'moveGeneralStep', 'attackStep', 'supplyStep', 'armGeneralStep', 'activateSkillStep',
      'answerReaction', 'chooseOptionStep', 'endTurnStep', 'surrenderStep',
      'autoFireForcedTurnEnd', 'visibleTurnEndAskItems', 'storeStateToEngineState',
    ]) {
      expect(code, `宿主应当调 ${shared}，而不是自己再写一份判据`).toContain(shared);
    }
    // 一枚合法动作⇒牌桌一步＝与 AI 司机、联机客人共用那份唯一的翻译出口。
    expect(code).toContain('applyCanonicalAction');
  });

  it('宿主不自己碰执行闸口＝闸口只有 engineSteps 那一个（否则进程能绕开"认事件"那一半）', () => {
    const code = codeOf('tableCompute.ts');
    expect(code, '只有 engineSteps 可以调闸口').not.toContain('dispatchStoreAction');
    expect(code, '只有 engineSteps 可以建规范动作').not.toContain('createAction');
  });
});

describe('乙 第三片㈂ ㈡ 浏览器里那一局与进程里那一局逐字同读数', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  afterEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  it('每一次牌桌调用都比一次对：直到这一局收口，两臂读数一条不落', () => {
    const { processHost } = startBothArms(2);
    const result = playTable(dualArmHost(processHost), { maxSteps: 400, pick: policyPicker() });

    expect(result.phase, '这一局应当在两臂同时跑到收口').toBe('gameOver');
    expect(readingOf(processHost.engineState)).toBe(readingOf(useGameStore.getState().engineState));
    const alive = processHost.engineState.players.filter(player => player.isAlive !== false);
    expect(alive).toHaveLength(1);
    expect(result.winnerId).toBe(alive[0]!.id);
    expect(result.steps).toBeGreaterThan(20);
  });

  it('同一枚种子、同一份料再跑一遍还是那一条读数（搬出去没有引入第二份随机）', () => {
    const first = startBothArms(2);
    const firstRun = playTable(dualArmHost(first.processHost), { maxSteps: 400, pick: policyPicker() });
    const firstReading = readingOf(first.processHost.engineState);

    const second = startBothArms(2);
    const secondRun = playTable(second.processHost, { maxSteps: 400, pick: policyPicker() });

    expect(secondRun.steps).toBe(firstRun.steps);
    expect(secondRun.winnerId).toBe(firstRun.winnerId);
    expect(readingOf(second.processHost.engineState)).toBe(firstReading);
  });

  it('进程那一条驱动路自己也能跑到收口，且"现在该哪一席动手"两席都派到过', () => {
    const { processHost } = startBothArms(2);
    const pick = policyPicker();
    const seenSeats = new Set<number>();
    let steps = 0;
    for (; steps < 400; steps += 1) {
      if (processHost.engineState.phase === 'gameOver') break;
      const seat = tableActorId(processHost);
      if (seat === null) break;
      seenSeats.add(seat);
      if (!stepTable(processHost, pick)) break;
    }
    expect(processHost.engineState.phase).toBe('gameOver');
    // 两席都被派到过＝解 actor 那一条不是恒返回同一个 id 的摆设。
    expect([...seenSeats].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('只读探针不推进对局、不动那颗游标（房主给客人发清单、收到编号后当场重算都靠它）', () => {
    const { processHost } = startBothArms(2);
    const seat = tableActorId(processHost);
    expect(typeof seat).toBe('number');
    const before = readingOf(processHost.engineState);
    const cursorBefore = processHost.engineState.rngState?.s ?? null;
    expect(cursorBefore, '开局读数得带着那颗显式游标').not.toBeNull();

    const legal = legalTableActions(processHost, seat as number);
    const again = legalTableActions(processHost, seat as number);

    expect(legal.length, '开局第一席总该有几条能走的路').toBeGreaterThan(0);
    // 每一次调用都会给那枚动作现编一个 `action_<序号>`（探针内部的号，不是对局事实）；
    // 这里比的是"同一条读数⇒同一份清单"，把那个号按 transitionEquivalence 的同一条口径摘掉。
    const withoutIds = (list: GameAction[]) => JSON.stringify(list.map(action => ({ type: action.type, playerId: action.playerId, payload: action.payload })));
    expect(withoutIds(again)).toBe(withoutIds(legal));
    expect(readingOf(processHost.engineState)).toBe(before);
    expect(processHost.engineState.rngState?.s ?? null).toBe(cursorBefore);
  });
});

describe('乙 第三片㈂ ㈢ 没搬的那一格照实说：人类席那扇"逢人就问"的窗', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });

  /** 一席人类（场上挂一枚回合结束可发动的将）＋一席 AI；读数小、可控，专为问窗那一格。 */
  function humanAskState(): EngineState {
    const skill = {
      name: '守夜',
      description: '回合结束时可发动',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    } as unknown as Skill;
    const general = {
      id: 'g_watch',
      instanceId: 'g_watch',
      name: '将g_watch',
      faction: '魏',
      hp: 3,
      type: '武将',
      meleeAtk: 2,
      rangedAtk: 1,
      armor: 0,
      skills: [skill],
    } as unknown as General;
    return {
      version: 1,
      phase: 'playing',
      timelinePhase: 'ACTION',
      currentPlayerId: 1,
      turn: 5,
      round: 3,
      isFirstTurn: false,
      rngState: { s: SEED >>> 0 },
      players: [
        {
          id: 1, name: '人类席', hp: 4, hand: [], generalPool: [], graveyard: [],
          baseHp: 6, baseMaxHp: 6, isAlive: true, statuses: [], isAi: false,
          fieldGenerals: [{
            general, currentHp: 3, maxHp: 3, meleeAtk: 2, rangedAtk: 1, armor: 0,
            currentArmor: 0, armorCards: [], isArming: false, hasMoved: false,
            hasAttacked: false, hasSupplied: false, justDeployed: false, ownerId: 1,
            position: { zone: 'front', slot: 0, areaOwnerId: 1 },
          }],
        },
        {
          id: 2, name: 'AI 席', hp: 4, hand: [], generalPool: [], graveyard: [],
          baseHp: 6, baseMaxHp: 6, isAlive: true, statuses: [], isAi: true,
          fieldGenerals: [],
        },
      ],
      deck: [{ id: 'deck_1', name: '粮草', type: '粮草' }],
      discardPile: [],
      drawState: null,
    } as unknown as EngineState;
  }

  it('同一枚 END_TURN：浏览器只开窗、一位不动；进程没有窗，响完强制发动就直接提交', () => {
    const start = humanAskState();
    installBrowserArm(start);
    const processHost = createTableHost(cloneEngineState(start));
    const before = useGameStore.getState().engineState;
    expect(readingOf(processHost.engineState)).toBe(readingOf(before));

    const action = { type: 'END_TURN', playerId: 1 } as unknown as GameAction;
    applyCanonicalAction(useGameStore.getState() as never, 1, action);
    expect(useGameStore.getState().turnEndAsk, '人类席有可发动的回合结束技能⇒该开窗问人').not.toBeNull();
    // 开窗这一拍**没有 dispatch 任何东西**：对局事实一格都不许动。
    // 唯一允许动的那一格＝展示面重建时镜像自己写进 `metadata` 的那三格观测（source／drawPlayerId／
    // drawReason／drawTotalCards）——B 类展示事实，D-1 在册，不是这一步走没走过的凭据。
    expect(changedTopLevelKeys(before, useGameStore.getState().engineState)).toEqual(['metadata']);

    applyTableAction(processHost, 1, action);
    expect(readingOf(processHost.engineState), '进程那一臂没有 set()、也就没有那扇窗：这一拍迈出去了').not.toBe(readingOf(before));
    expect(processHost.engineState.turn).toBe(6);
    expect(processHost.engineState.currentPlayerId).toBe(2);

    // 差的**只有**"问人"那一步：人答完（跳过＝提交）之后两臂又回同一条读数（`metadata` 那一格除外，
    // 它是浏览器镜像自己的观测，进程那一臂从不写它）。
    useGameStore.getState().skipTurnEndAsk();
    expect(useGameStore.getState().turnEndAsk).toBeNull();
    expect(factsOf(useGameStore.getState().engineState)).toBe(factsOf(processHost.engineState));
  });

  it('进程把"该问哪几格"原样递出去；等谁答、怎么回执归界面与措辞那一格（末片第二刀）', () => {
    const processHost = createTableHost(cloneEngineState(humanAskState()));
    const items = turnEndAskItemsFor(processHost, 1, 'smart');
    expect(items.length, '守夜这一枚该被列进问窗（与浏览器同一份分档判据）').toBeGreaterThan(0);
    expect(items[0]).toMatchObject({ playerId: 1, generalId: 'g_watch', generalName: '将g_watch', activatable: true });
    expect(items[0]!.definition.name).toBe('守夜');
  });

  /**
   * 末片第一刀（2026-11-05）＝上面那格"进程没有窗、响完直接提交"被**拆成两拍**：
   * `holdTurnEndForAnswer` 只响强制发动并把"该问哪几格"原样回话，清单非空就**不提交**；
   * 提交仍走既有那条 `endTurn()`（语义未变；开工前既有的 6 个调用点一字未改，本刀另加 2 处直接调用＝全库 47→49）。
   * 判据一份都没新写：分档＝`engineSteps.ts:291 visibleTurnEndAskItems`，强制发动＝`:310 autoFireForcedTurnEnd`。
   *
   * 四枚证人**按形状拆开**（同一枚 `it` 里循环多形＝第一枚红就抛、其余不跑，那是常设判据）。
   */
  describe('末片第一刀 进程把「结束回合」拆成两拍：头一拍只回话、不提交', () => {
    /** 再挂一枚**勾了「强制发动」**的回合结束将：系统该替这一席响掉它，且不许把它再问一遍。 */
    function forcedAskState(): EngineState {
      const state = cloneEngineState(humanAskState());
      const general = {
        id: 'g_ward',
        instanceId: 'g_ward',
        name: '将g_ward',
        faction: '魏',
        hp: 2,
        type: '武将',
        meleeAtk: 1,
        rangedAtk: 1,
        armor: 0,
        skills: [{
          name: '夜巡',
          description: '回合结束时强制发动',
          forced: true,
          effects: [{
            id: 'e1',
            trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
            runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
          }],
        }],
      } as unknown as General;
      (state.players[0]!.fieldGenerals as unknown[]).push({
        general, currentHp: 2, maxHp: 2, meleeAtk: 1, rangedAtk: 1, armor: 0,
        currentArmor: 0, armorCards: [], isArming: false, hasMoved: false,
        hasAttacked: false, hasSupplied: false, justDeployed: false, ownerId: 1,
        position: { zone: 'front', slot: 1, areaOwnerId: 1 },
      });
      return state;
    }

    /** 形状①：清单非空 ⇒ 回话非空 **且牌桌一格都不动**（这一拍停住了）。 */
    it('有可发动的候选：新出口只回话，`turn`／`currentPlayerId`／`phase` 一格都不动', () => {
      const host = createTableHost(cloneEngineState(humanAskState()));
      const before = readingOf(host.engineState);

      const held = holdTurnEndForAnswer(host, 'smart');

      expect(held.items.map(item => item.definition.name), '该问的就是守夜那一枚').toEqual(['守夜']);
      expect(held.committed, '清单非空⇒这一拍不许迈出去').toBe(false);
      expect(readingOf(host.engineState), '清单非空＝整份读数一位未动').toBe(before);
      expect(host.engineState.turn).toBe(5);
      expect(host.engineState.currentPlayerId).toBe(1);
      expect(host.engineState.phase).toBe('playing');
    });

    /** 形状②：清单为空 ⇒ 与今天同形，当场提交（对着既有 `endTurn()` 那一份读数比，不新造尺）。 */
    it('没有候选：新出口与既有 endTurn() 逐字同形——该提交就提交', () => {
      const bare = cloneEngineState(humanAskState());
      bare.players[0]!.fieldGenerals = []; // 场上没有回合结束技能⇒分档判据算出来就是空清单

      const heldHost = createTableHost(cloneEngineState(bare));
      const legacyHost = createTableHost(cloneEngineState(bare));

      const held = holdTurnEndForAnswer(heldHost, 'smart');
      legacyHost.endTurn();

      expect(held.items).toHaveLength(0);
      expect(held.committed, '没有要问的⇒这一拍就该迈出去').toBe(true);
      expect(readingOf(heldHost.engineState)).toBe(readingOf(legacyHost.engineState));
      expect(heldHost.engineState.turn).toBe(6);
      expect(heldHost.engineState.currentPlayerId).toBe(2);
    });

    /** 形状③：停下这一拍**没把强制发动扣下**——那一枚照样替这一席响掉、且不再被问一遍。 */
    it('勾了「强制发动」的那一枚照旧响掉：停这一拍≠少发一次', () => {
      const host = createTableHost(cloneEngineState(forcedAskState()));
      const before = readingOf(host.engineState);

      const held = holdTurnEndForAnswer(host, 'smart');

      const ledger = (host.engineState.consumedSkills ?? []).map(entry => `${entry.playerId}:${entry.skillId}`);
      expect(ledger.filter(entry => entry.includes('夜巡')).length, `强制发动那一枚该入账，账本＝${JSON.stringify(ledger)}`).toBe(1);
      expect(host.engineState.players[0]!.hand, '那一枚的效果（摸一张）也该落进手牌').toHaveLength(1);
      expect(held.items.map(item => item.definition.name), '窗里只该剩下要人点头的那一枚').toEqual(['守夜']);
      expect(held.committed).toBe(false);
      expect(host.engineState.turn, '响完强制发动不等于提交这一拍').toBe(5);
      expect(readingOf(host.engineState), '动了的只有那一枚的效果，回合号没动').not.toBe(before);
    });

    /** 形状④：两拍走完＝浏览器那臂一拍开窗＋人答完提交，两臂回同一条读数（对着 ㈢ 那把 `factsOf` 尺）。 */
    it('头一拍回话＋第二拍提交＝与浏览器臂（开窗→人答完→提交）逐字同读数', () => {
      const start = forcedAskState();
      installBrowserArm(start);
      const processHost = createTableHost(cloneEngineState(start));
      const action = { type: 'END_TURN', playerId: 1 } as unknown as GameAction;

      // 浏览器臂：一枚 END_TURN 只开窗（强制发动自己响掉，窗里只剩要人点头的那一枚）。
      applyCanonicalAction(useGameStore.getState() as never, 1, action);
      const ask = useGameStore.getState().turnEndAsk;
      expect(ask, '人类席该被问').not.toBeNull();
      expect(ask!.candidates.map(candidate => candidate.skillName)).toEqual(['守夜']);

      // 进程臂：头一拍停在同一格上，回话与窗里那一份同名。
      const held = holdTurnEndForAnswer(processHost, 'smart');
      expect(held.committed).toBe(false);
      expect(held.items.map(item => item.definition.name)).toEqual(['守夜']);

      // 第二拍＝既有那条"响完就提交"的 `endTurn()`（它一个字没改）；浏览器那侧人答完＝跳过＝同一次提交。
      useGameStore.getState().skipTurnEndAsk();
      processHost.endTurn();

      expect(useGameStore.getState().turnEndAsk).toBeNull();
      expect(factsOf(processHost.engineState), '两拍合起来应当与浏览器那一拍开窗＋答完提交是同一份对局事实')
        .toBe(factsOf(useGameStore.getState().engineState));
    });
  });
});
