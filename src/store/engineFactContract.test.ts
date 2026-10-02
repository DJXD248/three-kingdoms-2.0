/**
 * 2.7.1 fact/presentation contract anchors (§12-37②, GPT third-review Q4).
 *
 * The zustand compatibility mirror (`storeStateToEngineState`, reached by every
 * display-only store `set()` via `createEngineAwareSetter`) rebuilds EngineState
 * from DISPLAY fields. These tests pin the boundary the 2.6.4 observation item
 * asked for: game facts ride through the mirror untouched, presentation
 * vocabulary never gets written into a fact field, and a mirror rebuild can
 * neither create nor pollute a recorded fact event.
 */
import { describe, expect, it } from 'vitest';
import { createAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import {
  getLiveReplayDocument,
  getLiveReplayEntryCount,
  resetLiveReplay,
} from '../replay/liveReplayRecorder';
import { createEngineAwareSetter } from './engineAwareSetter';
import { __resetResidentEngineContainer, dispatchStoreAction } from './engineExecutionBridge';
import { storeStateToEngineState } from './gameStateAdapter';

function makeCanonical(): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [
      { id: 1, name: '刘备', faction: '蜀', isAlive: true, hand: [], generalPool: [], fieldGenerals: [], graveyard: [], baseHp: 5 },
      { id: 2, name: '曹操', faction: '魏', isAlive: true, hand: [], generalPool: [], fieldGenerals: [], graveyard: [], baseHp: 5 },
    ],
    currentPlayerId: 1,
    turn: 5,
    round: 3,
    deck: [],
    discardPile: [],
    metadata: { roomId: '事实契约房', winnerId: null },
    rngState: { s: 123456 },
    consumedSkills: [{ stableId: '5:sk:e1', skillId: 'sk:e1', turn: 5, playerId: 1 }],
    pendingChoice: null,
  } as unknown as EngineState;
}

/** Production-shaped display projection: the store aliases the very arrays the
 * engine owns, so a rebuild can never smuggle in a re-derived copy. */
function displayOf(state: EngineState, overrides: Record<string, unknown> = {}) {
  return {
    phase: 'playing',
    turnPhase: 'main',
    currentRound: state.round,
    players: state.players,
    currentPlayerIndex: 0,
    cardDeck: state.deck,
    discardPile: state.discardPile,
    engineState: state,
    ...overrides,
  };
}

describe('storeStateToEngineState · 呈现词表不得写入事实字段 (2.7.1)', () => {
  it('turnPhase 反向映射回 canonical 词表，绝不落 ' + "'MAIN' 这类方言", () => {
    const state = makeCanonical();
    const cases: Array<[string, string]> = [
      ['main', 'ACTION'],
      ['draw', 'DRAW'],
      ['end', 'GAME_OVER'],
      ['start', 'MENU'],
    ];
    for (const [display, canonical] of cases) {
      expect(storeStateToEngineState(displayOf(state, { turnPhase: display })).timelinePhase)
        .toBe(canonical);
    }
  });

  it("'start' 是塌缩桶：TURN_START 血统保留，其余归 MENU；无显示信号则原样带走", () => {
    const turnStart = makeCanonical();
    turnStart.timelinePhase = 'TURN_START';
    expect(storeStateToEngineState(displayOf(turnStart, { turnPhase: 'start' })).timelinePhase)
      .toBe('TURN_START');
    expect(storeStateToEngineState(displayOf(makeCanonical(), { turnPhase: 'start' })).timelinePhase)
      .toBe('MENU');
    // No display field at all → carry the fact over instead of inventing one.
    const drawn = makeCanonical();
    drawn.timelinePhase = 'DRAW';
    expect(storeStateToEngineState({ engineState: drawn }).timelinePhase).toBe('DRAW');
    // Legacy store shapes without any engineState still read as undefined.
    expect(storeStateToEngineState({ currentRound: 4 }).timelinePhase).toBeUndefined();
  });

  it('canonical metadata 键存活过镜，adapter 自记账保持层叠在最上、且不留陈旧值', () => {
    const state = makeCanonical();
    state.metadata = { roomId: '事实契约房', winnerId: 2, customFact: { kept: true } };
    const rebuilt = storeStateToEngineState(displayOf(state, {
      drawContext: { playerId: 1, reason: 'turnStart', totalCards: 2 },
    }));
    expect(rebuilt.metadata).toMatchObject({
      roomId: '事实契约房',
      winnerId: 2,
      customFact: { kept: true },
      drawPlayerId: 1,
      drawReason: 'turnStart',
      drawTotalCards: 2,
      source: 'zustand-compatibility-adapter',
    });
    // The draw context is display state: once it is gone the observations reset.
    const after = storeStateToEngineState(displayOf(rebuilt));
    expect(after.metadata).toMatchObject({ roomId: '事实契约房', winnerId: 2 });
    expect(after.metadata?.drawPlayerId).toBeNull();
    expect(after.metadata?.drawReason).toBeNull();
  });

  it('turn / rngState / consumedSkills / pendingChoice 逐字过镜', () => {
    const state = makeCanonical();
    state.pendingChoice = { key: 'ch:5:3:sk:choice', playerId: 2, options: [] };
    // v2.8 刀4（#25）：账本没有 store 呈现字段（只有 EventProcessor 写它），第四遍
    // 同一个教训——过镜必须原样带过去，否则重建＝把正在生效的改数当场抹掉。
    state.statModifiers = [{
      id: 'sm:1', seq: 1, key: 'MAX_HP', mode: 'delta', value: -1,
      targetPlayerId: 1, targetId: 'g1', ownerPlayerId: 1, ownerGeneralId: 'g1',
      ownerSkillId: 'sk:1', locked: false, passive: false, expire: 'untilSelfTurnEnd',
    }];
    const rebuilt = storeStateToEngineState(displayOf(state, { currentRound: 99 }));
    // Re-deriving turn from currentRound would rewind the counter and shift
    // every once-per-turn / choice ledger key.
    expect(rebuilt.turn).toBe(5);
    expect(rebuilt.round).toBe(99);
    expect(rebuilt.rngState).toEqual({ s: 123456 });
    expect(rebuilt.consumedSkills).toEqual(state.consumedSkills);
    expect(rebuilt.pendingChoice).toEqual(state.pendingChoice);
    expect(rebuilt.statModifiers).toEqual(state.statModifiers);
  });
});

describe('呈现层 set() 不得污染事实流（engineAwareSetter → 桥 → liveReplayRecorder）', () => {
  it('display-only set() 零事件零记账，下一次派发的快照仍是正字事实', () => {
    resetLiveReplay();
    __resetResidentEngineContainer();
    let store: any = displayOf(makeCanonical());
    const set = createEngineAwareSetter<{ [k: string]: any }>(updater => {
      store = { ...store, ...updater(store) };
    });

    const entryCountBefore = getLiveReplayEntryCount();
    const docBefore = getLiveReplayDocument();
    set({ roomName: '只是改个标题' });

    // ① The mirror itself no longer speaks display vocabulary.
    expect(store.engineState.timelinePhase).toBe('ACTION');
    expect(store.engineState.metadata.roomId).toBe('事实契约房');
    expect(store.engineState.turn).toBe(5);
    // ② A mirror rebuild is not a dispatch: no replay entry, no document change.
    expect(getLiveReplayEntryCount()).toBe(entryCountBefore);
    expect(getLiveReplayDocument()).toBe(docBefore);

    const { events, engineState } = dispatchStoreAction(
      store,
      createAction('END_TURN', 1),
    );
    const changed = events.find(event => event.type === 'STATE_CHANGED') as {
      data?: { snapshot?: EngineState };
    } | undefined;
    expect(changed?.data?.snapshot?.metadata?.roomId).toBe('事实契约房');
    expect(engineState.metadata?.roomId).toBe('事实契约房');
    // END_TURN 是真的转移：计数器必须从镜像带过来的事实（5）继续往前走，而不是
    // 被 display 字段的 round（3）回卷。
    expect(engineState.turn).toBe(6);
    // ③ The recorded document keeps the real room, not the 'local' fallback.
    // 首个派发的职责是建档（recordLiveDispatch 语义：开档不落条目），所以计数器
    // 要第二次派发才动——房间号必须在开档那一刻就读到真值。
    const doc = getLiveReplayDocument();
    expect(doc?.roomId).toBe('事实契约房');
    expect(getLiveReplayEntryCount()).toBe(0);

    dispatchStoreAction(store, createAction('END_TURN', 2));
    expect(getLiveReplayEntryCount()).toBe(1);
    expect(getLiveReplayDocument()?.roomId).toBe('事实契约房');

    resetLiveReplay();
    __resetResidentEngineContainer();
  });
});
