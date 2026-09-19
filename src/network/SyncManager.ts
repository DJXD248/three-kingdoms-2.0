import type { EngineState } from '../core/GameState';
import type { StateSnapshotPacket } from './types';

export class SyncManager {
  createSnapshot(roomId: string, state: EngineState): StateSnapshotPacket {
    return {
      roomId,
      version: state.version,
      state: structuredClone(state),
    };
  }
}
