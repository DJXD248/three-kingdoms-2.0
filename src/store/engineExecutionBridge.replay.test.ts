/**
 * 2.2.6 wiring guard: every store dispatch (the single choke point all game
 * modes share) must land in the live replay capture, accepted or rejected.
 */
import { describe, expect, it } from 'vitest';
import { createAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import { dispatchStoreAction } from './engineExecutionBridge';
import {
  getLiveReplayDocument,
  getLiveReplayEntryCount,
  resetLiveReplay,
} from '../replay/liveReplayRecorder';

function makeEngineState(): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [
      {
        id: 1,
        name: '刘备',
        faction: '蜀',
        isAlive: true,
        hand: [],
        generalPool: [],
        fieldGenerals: [],
        graveyard: [],
        baseHp: 5,
      },
      {
        id: 2,
        name: '曹操',
        faction: '魏',
        isAlive: true,
        hand: [],
        generalPool: [],
        fieldGenerals: [],
        graveyard: [],
        baseHp: 5,
      },
    ],
    currentPlayerId: 1,
    deck: [],
    discardPile: [],
    metadata: { roomId: '桥接测试房' },
  } as unknown as EngineState;
}

describe('dispatchStoreAction → liveReplayRecorder 接线', () => {
  it('初始 BEGIN_DRAW 建档，后续调度（含被拒动作）逐步入账', () => {
    resetLiveReplay();
    const storeState = { engineState: makeEngineState() };

    dispatchStoreAction(storeState, createAction('BEGIN_DRAW', 1, { reason: 'initial', playerId: 1, totalCards: 5 }));
    const docAfterStart = getLiveReplayDocument();
    expect(docAfterStart).not.toBeNull();
    expect(docAfterStart!.roomId).toBe('桥接测试房');
    expect(getLiveReplayEntryCount()).toBe(0);

    dispatchStoreAction(storeState, createAction('END_TURN', 1));
    expect(getLiveReplayEntryCount()).toBe(1);

    // 不存在的玩家：无论引擎接受还是拒绝，都必须留下可审计的一步
    dispatchStoreAction(storeState, createAction('SURRENDER', 999));
    expect(getLiveReplayEntryCount()).toBe(2);

    const types = getLiveReplayDocument()!.entries.map(e => e.action.type);
    expect(types).toEqual(['END_TURN', 'SURRENDER']);
    resetLiveReplay();
  });
});
