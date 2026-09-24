/**
 * ReplayHeader (decision D-4, v2.2.24): new documents carry
 * {schemaVersion, gameVersion}; pre-2.2.24 archives without a header stay
 * readable read-only as schemaVersion 1 and are NEVER rewritten; documents
 * from a future schema are rejected with an explicit口径 instead of being
 * silently misinterpreted.
 */
import { describe, expect, it } from 'vitest';
import type { EngineState } from '../core/GameState';
import { ReplayRecorder } from './ReplayRecorder';
import { REPLAY_SCHEMA_VERSION, type ReplayDocument } from './types';
import pkg from '../../package.json';

function makeState(): EngineState {
  return {
    version: 1,
    phase: 'playing',
    players: [{ id: 1, name: '头部测试', faction: '蜀', isAlive: true } as never],
    currentPlayerId: 1,
    metadata: { roomId: '房间H', winnerId: null } as never,
  } as unknown as EngineState;
}

function legacyDocument(): ReplayDocument {
  return {
    version: 1,
    roomId: '房间H',
    createdAt: 1700000000000,
    initialState: makeState(),
    entries: [],
  };
}

describe('ReplayHeader（D-4，2.2.24）', () => {
  it('新录像文档携带 header，schema/gameVersion 与构建期 package.json 一致，序列化往返保真', () => {
    const recorder = new ReplayRecorder();
    recorder.start(makeState(), '房间H');
    const doc = recorder.getDocument()!;
    expect(doc.version).toBe(1);
    expect(doc.header).toEqual({ schemaVersion: REPLAY_SCHEMA_VERSION, gameVersion: pkg.version });

    const roundTripped = ReplayRecorder.deserialize(recorder.serialize());
    expect(roundTripped.header).toEqual(doc.header);
    expect(ReplayRecorder.schemaVersionOf(roundTripped)).toBe(REPLAY_SCHEMA_VERSION);
  });

  it('缺 header 的旧档照常只读加载，按 schemaVersion 1 解释，字段一字不动', () => {
    const doc = ReplayRecorder.deserialize(JSON.stringify(legacyDocument()));
    expect(doc.header).toBeUndefined();
    expect(ReplayRecorder.schemaVersionOf(doc)).toBe(1);
    expect(doc.roomId).toBe('房间H');
  });

  it('header.schemaVersion 在已支持范围内（1 与当前值）均可读', () => {
    for (const schemaVersion of [1, REPLAY_SCHEMA_VERSION]) {
      const doc = { ...legacyDocument(), header: { schemaVersion, gameVersion: '2.2.24' } };
      const loaded = ReplayRecorder.deserialize(JSON.stringify(doc));
      expect(ReplayRecorder.schemaVersionOf(loaded)).toBe(schemaVersion);
    }
  });

  it('超界 schemaVersion（未来格式）被显式拒读，报出具体版本号', () => {
    const future = {
      ...legacyDocument(),
      header: { schemaVersion: REPLAY_SCHEMA_VERSION + 1, gameVersion: '9.9.9' },
    };
    expect(() => ReplayRecorder.deserialize(JSON.stringify(future))).toThrow(
      new RegExp(`Unsupported replay schema version: ${REPLAY_SCHEMA_VERSION + 1}`),
    );
  });

  it('实况捕获链路（liveReplayRecorder 同款 ReplayRecorder.start）自动带上 header', async () => {
    const { recordLiveDispatch, getLiveReplayDocument, resetLiveReplay } = await import('./liveReplayRecorder');
    resetLiveReplay();
    recordLiveDispatch(
      { id: 'a_begin', type: 'BEGIN_DRAW', playerId: 1, payload: { reason: 'initial' } } as never,
      [],
      makeState(),
    );
    expect(getLiveReplayDocument()!.header?.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    resetLiveReplay();
  });
});
