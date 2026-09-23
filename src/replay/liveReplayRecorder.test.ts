import { describe, expect, it } from 'vitest';
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { ReplayRecorder } from './ReplayRecorder';
import {
  getLiveReplayDocument,
  getLiveReplayEntryCount,
  recordLiveDispatch,
  resetLiveReplay,
  serializeLiveReplay,
} from './liveReplayRecorder';

function makeState(tag: string, roomId = '房间A'): EngineState {
  return {
    version: 1,
    phase: 'playing',
    players: [{ id: 1, name: `将-${tag}`, faction: '蜀', isAlive: true } as never],
    currentPlayerId: 1,
    metadata: { roomId, winnerId: null } as never,
    tag,
  } as unknown as EngineState;
}

function action(type: string, playerId = 1, payload?: unknown): GameAction {
  return { id: `a_${type}_${payload ?? ''}_${Date.now()}_${Math.random()}`, type, playerId, payload } as GameAction;
}

const beginInitial = action('BEGIN_DRAW', 1, { reason: 'initial', playerId: 1, totalCards: 5 });

describe('liveReplayRecorder（2.2.6 现场录像捕获）', () => {
  it('开局动作建立新文档，后续动作逐步入账，beforeState 沿上一步 afterState 链式衔接', () => {
    resetLiveReplay();
    expect(serializeLiveReplay()).toBe('');

    recordLiveDispatch(beginInitial, [{ type: 'DRAW_REQUIRED' } as GameEvent], makeState('start'));
    expect(getLiveReplayEntryCount()).toBe(0); // BEGIN_DRAW 定界为 initialState，不重复入账

    const deployed = action('DEPLOY_GENERAL', 1, { slot: 0, consumeCards: [] });
    recordLiveDispatch(deployed, [{ type: 'GENERAL_DEPLOYED' } as GameEvent], makeState('after-deploy'));
    recordLiveDispatch(action('END_TURN', 1), [{ type: 'TURN_END' } as GameEvent], makeState('after-end'));
    expect(getLiveReplayEntryCount()).toBe(2);

    const doc = getLiveReplayDocument();
    expect(doc).not.toBeNull();
    expect(doc!.roomId).toBe('房间A');
    expect(doc!.entries).toHaveLength(2);
    expect(doc!.entries[0].action.type).toBe('DEPLOY_GENERAL');
    // 第一步的 beforeState 即开局初始状态，第二步的 beforeState 即第一步的 afterState
    expect((doc!.entries[0].beforeState as { tag?: string }).tag).toBe('start');
    expect((doc!.entries[1].beforeState as { tag?: string }).tag).toBe('after-deploy');

    // 序列化产物可被官方解析器原样读回（与回放工具链兼容）
    const roundTripped = ReplayRecorder.deserialize(serializeLiveReplay());
    expect(roundTripped.entries.map(e => e.action.type)).toEqual(['DEPLOY_GENERAL', 'END_TURN']);
  });

  it('新的初始 BEGIN_DRAW 永远重开文档，绝不继承上一局历史', () => {
    recordLiveDispatch(action('SURRENDER', 1), [], makeState('tail-of-prev-match'));
    expect(getLiveReplayEntryCount()).toBe(3);

    recordLiveDispatch(beginInitial, [{ type: 'DRAW_REQUIRED' } as GameEvent], makeState('match2'));
    expect(getLiveReplayEntryCount()).toBe(0);
    recordLiveDispatch(action('END_TURN', 1), [], makeState('match2-step1'));
    const doc = getLiveReplayDocument();
    expect(doc!.entries).toHaveLength(1);
    expect((doc!.initialState as { tag?: string }).tag).toBe('match2');
  });

  it('resetLiveReplay 清空捕获', () => {
    resetLiveReplay();
    expect(getLiveReplayDocument()).toBeNull();
    expect(serializeLiveReplay()).toBe('');
    expect(getLiveReplayEntryCount()).toBe(0);
  });
});
