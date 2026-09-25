/**
 * v2.3.2 · P7 存档恢复真实回归矩阵（八格）。
 *
 * 每格的判据统一为一句话：恢复态=存档态，或被诚实拒绝+清理，
 * **不允许无痕吞档**。存储层拒绝（隐私模式/配额）是 C 类诊断：
 * 上报一次、降级不抛，绝不反噬对局链（自动保存挂在 endTurn 提交路径上）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore } from './gameStore';
import type { Player } from './gameStore';
import type { EngineState } from '../core/GameState';
import { __resetResidentEngineContainer } from './engineExecutionBridge';
import { resetLiveReplay } from '../replay/liveReplayRecorder';
import {
  LOCAL_GAME_SNAPSHOT_KEY,
  clearLocalGameSnapshot,
  readLocalGameSnapshot,
  saveLocalGameSnapshot,
  __resetLocalGameSnapshotDiagnostics,
} from './localGameSnapshot';
import { isRestorableEngineState } from './gameStateAdapter';

function makeEngineState(): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [
      {
        id: 1, name: '玩家1', hp: 4,
        hand: [{ id: 'hand_1', name: '粮草', type: '粮草' }],
        generalPool: [], fieldGenerals: [], graveyard: [],
        baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
      },
      {
        id: 2, name: '玩家2', hp: 3,
        hand: [], generalPool: [], fieldGenerals: [], graveyard: [],
        baseHp: 9, baseMaxHp: 10, isAlive: true, statuses: [],
      },
    ],
    currentPlayerId: 2,
    turn: 7,
    round: 4,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
    ],
    discardPile: [{ id: 'deck_9', name: '调令', type: '调令' }],
    drawState: null,
    isFirstTurn: false,
    rngState: { s: 4242 },
    consumedSkills: [{ stableId: '6:s1', skillId: 's1', turn: 6, playerId: 1 }],
  } as unknown as EngineState;
}

/** 生产镜像不变量（同 turnEndAsk 夹具口径）：展示 players/cardDeck 与
 *  engineState 同引用，任何不含 engineState 的 set() 都走展示字段重建。 */
function installMidGame(engineState: EngineState) {
  useGameStore.setState({
    phase: 'playing',
    turnPhase: 'main',
    roomName: '回归房',
    playerCount: 2,
    isTestMode: false,
    winnerId: null,
    engineState,
    players: engineState.players as unknown as Player[],
    cardDeck: engineState.deck as any,
    discardPile: engineState.discardPile as any,
    currentPlayerIndex: 1,
    currentRound: engineState.round,
    turnEndAsk: null,
    reactionWindow: null,
    pendingTurnTransition: null,
    skillActivations: [],
    drawContext: null,
    revealedDrawCards: [],
    gameOverBanner: null,
    defeatEvent: null,
    isFirstTurn: false,
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

function wipeStoreBackToMenu() {
  useGameStore.setState({
    phase: 'menu',
    turnPhase: 'start',
    roomName: '',
    playerCount: 0,
    winnerId: null,
    engineState: {
      version: 1, phase: 'menu', timelinePhase: undefined,
      players: [], currentPlayerId: null, turn: 0, round: 1,
      deck: [], discardPile: [], drawState: null,
    } as unknown as EngineState,
    players: [], cardDeck: [], discardPile: [],
    currentPlayerIndex: 0, currentRound: 1,
    turnEndAsk: null, reactionWindow: null, pendingTurnTransition: null,
    skillActivations: [], drawContext: null, revealedDrawCards: [],
    gameOverBanner: null, defeatEvent: null,
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

const get = () => useGameStore.getState();

describe('gameStoreRecovery · 八格存档回归矩阵 (2.3.2)', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
    __resetLocalGameSnapshotDiagnostics();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 格 1：正常档恢复——恢复态=存档态，逐项核对 ──
  it('格1 正常档：局中快照→回菜单→恢复，游戏事实逐项相等', () => {
    installMidGame(makeEngineState());
    const data = get().createSerializedSnapshot(get().roomName);

    wipeStoreBackToMenu();
    expect(get().engineState.turn).toBe(0);

    expect(get().restoreSerializedSnapshot(data)).toBe(true);
    const restored = get();
    expect(restored.engineState.turn).toBe(7);
    expect(restored.engineState.round).toBe(4);
    expect(restored.engineState.currentPlayerId).toBe(2);
    expect(restored.currentPlayerIndex).toBe(1);
    expect(restored.players[0].hand).toHaveLength(1);
    expect((restored.players[1] as unknown as { hp: number }).hp).toBe(3);
    expect(restored.cardDeck).toHaveLength(3);
    expect(restored.discardPile).toHaveLength(1);
    expect(restored.engineState.rngState).toEqual({ s: 4242 });
    expect(restored.engineState.consumedSkills).toEqual([
      { stableId: '6:s1', skillId: 's1', turn: 6, playerId: 1 },
    ]);
    expect(restored.phase).toBe('playing');
    expect(restored.turnPhase).toBe('main');
    expect(restored.roomName).toBe('回归房');
    expect(restored.playerCount).toBe(2);
  });

  it('格1b createSerializedSnapshot 空房间号=显式抛错（不产出无名档）', () => {
    installMidGame(makeEngineState());
    expect(() => get().createSerializedSnapshot('   ')).toThrow(/room ID is required/);
  });

  // ── 格 2：旧版形态档——宽松字段照恢复；版本不符/缺版本显式拒收 ──
  it('格2 旧形态：缺 roomName/playerCount 的 v1 档走兜底恢复', () => {
    installMidGame(makeEngineState());
    const legacy = JSON.stringify({
      version: 1,
      roomId: 'legacy-room',
      timestamp: 1,
      state: get().engineState,
    });
    expect(get().restoreSerializedSnapshot(legacy)).toBe(true);
    expect(get().roomName).toBe('legacy-room');
    expect(get().playerCount).toBe(2);
    expect(get().engineState.turn).toBe(7);
  });

  it('格2b 版本超界(2)/缺版本的档：诚实拒收返回 false，store 分毫不动', () => {
    installMidGame(makeEngineState());
    const good = get().createSerializedSnapshot(get().roomName);
    const bumped = JSON.stringify({ ...JSON.parse(good), version: 2 });
    const noVersion = JSON.stringify(
      Object.fromEntries(Object.entries(JSON.parse(good)).filter(([k]) => k !== 'version')),
    );
    wipeStoreBackToMenu();

    expect(get().restoreSerializedSnapshot(bumped)).toBe(false);
    expect(get().restoreSerializedSnapshot(noVersion)).toBe(false);
    expect(get().phase).toBe('menu');
    expect(get().engineState.turn).toBe(0);
  });

  // ── 格 3：损坏档——坏 JSON/缺骨架/半坏玩家：拒收+清理，不许无痕吞档 ──
  it('格3 JSON 坏死档：restore false 且清掉存储（恢复链路不吞档）', () => {
    saveLocalGameSnapshot('{not valid json');
    const data = readLocalGameSnapshot();
    expect(data).not.toBeNull();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(get().restoreSerializedSnapshot(data!)).toBe(false);
    expect(localStorage.getItem(LOCAL_GAME_SNAPSHOT_KEY)).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      '[Recovery] Serialized snapshot rejected', expect.anything());
  });

  it('格3b state 缺 players/deck 骨架：同走拒收+清理', () => {
    saveLocalGameSnapshot(JSON.stringify({
      version: 1, roomId: 'r', state: { players: null },
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(get().restoreSerializedSnapshot(readLocalGameSnapshot()!)).toBe(false);
    expect(localStorage.getItem(LOCAL_GAME_SNAPSHOT_KEY)).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it('格3c 深坏档（players 数组里混入 null）：deserialize 放行、isRestorableEngineState 拦住并清档', () => {
    installMidGame(makeEngineState());
    const deepBroken = JSON.stringify({
      version: 1, roomId: 'r', roomName: 'r', playerCount: 2,
      state: { ...makeEngineState(), players: [null] },
    });
    expect(isRestorableEngineState(JSON.parse(deepBroken).state)).toBe(false);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(get().restoreSerializedSnapshot(deepBroken)).toBe(false);
    // restoreEngineState 拒绝路径自带 clearLocalGameSnapshot，且现场不被半恢复污染
    expect(get().engineState.turn).toBe(7);
    expect(get().phase).toBe('playing');
    expect(errSpy).toHaveBeenCalledWith('[Recovery] Invalid EngineState snapshot rejected');
  });

  // ── 格 4：缺失档——读空不炸；对空串恢复=诚实拒绝 ──
  it('格4 无档：read 得 null；对空串 restore=false（不抛、不误清别的键）', () => {
    localStorage.setItem('other_key', 'keep-me');
    expect(readLocalGameSnapshot()).toBeNull();
    expect(get().restoreSerializedSnapshot('')).toBe(false);
    expect(localStorage.getItem('other_key')).toBe('keep-me');
  });

  // ── 格 5：重复/冲突档——房间号不匹配在 store 层诚实拒收且不误删档；后档覆盖前档 ──
  it('格5 expectedRoomId 不符：false + 存档保留（是否清理由调用方决策）', () => {
    installMidGame(makeEngineState());
    saveLocalGameSnapshot(get().createSerializedSnapshot(get().roomName));
    wipeStoreBackToMenu();

    expect(get().restoreSerializedSnapshot(readLocalGameSnapshot()!, '别的房')).toBe(false);
    expect(localStorage.getItem(LOCAL_GAME_SNAPSHOT_KEY)).not.toBeNull();
    // 正确房号则照常恢复
    expect(get().restoreSerializedSnapshot(readLocalGameSnapshot()!, '回归房')).toBe(true);
    expect(get().engineState.turn).toBe(7);
  });

  it('格5b 重复保存：同键后档覆盖前档（latest wins）', () => {
    installMidGame(makeEngineState());
    saveLocalGameSnapshot(get().createSerializedSnapshot(get().roomName));
    const first = JSON.parse(readLocalGameSnapshot()!);
    // 推进回合再存第二次：turn 计数器变化必须进后档
    useGameStore.setState({
      engineState: { ...get().engineState, turn: 99 } as EngineState,
    });
    saveLocalGameSnapshot(get().createSerializedSnapshot(get().roomName));
    const second = JSON.parse(readLocalGameSnapshot()!);
    expect(first.state.turn).toBe(7);
    expect(second.state.turn).toBe(99);
  });

  // ── 格 6：自动保存链路——开关真实生效，档落在存储且可回读 ──
  function enableAutoSave(on: boolean) {
    useGameStore.setState({
      settings: { ...get().settings, autoSave: on },
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  }

  it('格6 autoSave=true：结束回合提交后档已写，回读 turn 与内存一致', () => {
    installMidGame({ ...makeEngineState(), turn: 5 } as EngineState);
    enableAutoSave(true);
    get().endTurn(); // 无候选人类座：直提交（2.3.1 口径）
    expect(get().engineState.turn).toBe(6);
    const data = readLocalGameSnapshot();
    expect(data).not.toBeNull();
    expect(JSON.parse(data!).state.turn).toBe(6);
    expect(JSON.parse(data!).version).toBe(1);
  });

  it('格6b autoSave=false：结束回合不写档', () => {
    installMidGame({ ...makeEngineState(), turn: 5 } as EngineState);
    enableAutoSave(false);
    get().endTurn();
    expect(get().engineState.turn).toBe(6);
    expect(readLocalGameSnapshot()).toBeNull();
  });

  // ── 格 7：手动另存路径——游戏档只落 localStorage，永不触碰系统保存框 ──
  it('格7 存档链路零系统弹窗：showSaveFilePicker 探针计数恒 0', () => {
    const picker = vi.fn();
    (window as any).showSaveFilePicker = picker;
    installMidGame(makeEngineState());
    saveLocalGameSnapshot(get().createSerializedSnapshot(get().roomName));
    get().restoreSerializedSnapshot(readLocalGameSnapshot()!);
    expect(picker).not.toHaveBeenCalled();
    delete (window as any).showSaveFilePicker;
  });

  it('格7b 恢复后继续对局：恢复态可正常 dispatch（常驻容器 adopt 存档态）', () => {
    installMidGame({ ...makeEngineState(), turn: 5 } as EngineState);
    const data = get().createSerializedSnapshot(get().roomName);
    wipeStoreBackToMenu();
    expect(get().restoreSerializedSnapshot(data)).toBe(true);
    get().endTurn(); // 无候选：真实 END_TURN 提交
    expect(get().engineState.turn).toBe(6);
  });

  // ── 格 8：存储 API 不可用降级——写/读/清三处全哑火也不抛，诊断恰一次 ──
  // jsdom 的 localStorage 是 [LegacyOverrideBuiltIns] proxy，既不能
  // defineProperty 也不能直接赋值覆盖方法；只能压 Storage.prototype。
  it('格8 setItem 抛错：save=false、warn 恰一次（去重）、endTurn 链照常推进不误伤对局', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = () => { throw new Error('SecurityError: storage disabled'); };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    installMidGame({ ...makeEngineState(), turn: 5 } as EngineState);
    enableAutoSave(true);

    expect(saveLocalGameSnapshot('x')).toBe(false);
    expect(saveLocalGameSnapshot('x')).toBe(false);
    get().endTurn(); // 自动保存写档失败不得打断回合链
    expect(get().engineState.turn).toBe(6);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('localStorage save unavailable');
  });

  it('格8b getItem 抛错=读空；removeItem 抛错=静默哑火（都不上抛）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLocalGameSnapshot()).toBeNull();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => clearLocalGameSnapshot()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(2); // read/clear 各一条，条目内去重不跨条目
  });
});
