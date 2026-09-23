// Snapshot recovery/serialization slice extracted from gameStore.ts
// (stabilization stage B, D-6 first split). Behavior is a verbatim move;
// the store wires these in via `...buildRecoveryActions(get, set)`.
import { StateSerializer } from '../network/StateSerializer';
import { clearLocalGameSnapshot } from './localGameSnapshot';
import { resetLiveReplay } from '../replay/liveReplayRecorder';
import { applyEngineStateToStore, isRestorableEngineState } from './gameStateAdapter';
import type { GameState } from './gameStoreTypes';

type SetState = (patch: Partial<GameState>) => void;
type GetState = () => GameState;

export function buildRecoveryActions(
  get: GetState,
  set: SetState,
): Pick<
  GameState,
  'restoreEngineState' | 'createSerializedSnapshot' | 'restoreSerializedSnapshot'
> {
  return {
    restoreEngineState: snapshot => {
      if (!isRestorableEngineState(snapshot)) {
        console.error('[Recovery] Invalid EngineState snapshot rejected');
        return false;
      }
      // Restored matches have no in-memory action history before this point:
      // the live replay capture restarts from the recovery position.
      resetLiveReplay();
      applyEngineStateToStore(snapshot, patch => set(patch as Partial<GameState>));
      return true;
    },

    createSerializedSnapshot: roomId => {
      const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
      if (!normalizedRoomId) {
        throw new Error('[Recovery] Snapshot room ID is required');
      }
      const serializer = new StateSerializer();
      const snapshotRoomName = get().roomName || normalizedRoomId;
      const snapshotPlayerCount = Number.isFinite(get().playerCount)
        ? Number(get().playerCount)
        : Math.max(get().players.length, get().engineState.players.length || 0);
      return serializer.serialize(serializer.createSnapshot(normalizedRoomId, get().engineState, snapshotRoomName, snapshotPlayerCount));
    },

    restoreSerializedSnapshot: (data, expectedRoomId) => {
      try {
        const snapshot = new StateSerializer().deserialize(data);
        if (expectedRoomId !== undefined && snapshot.roomId !== expectedRoomId) {
          console.error('[Recovery] Snapshot room mismatch rejected');
          return false;
        }
        const restored = get().restoreEngineState(snapshot.state);
        if (!restored) {
          clearLocalGameSnapshot();
          return false;
        }
        set({
          roomName: snapshot.roomName || snapshot.roomId || get().roomName,
          playerCount: Number.isFinite(snapshot.playerCount) ? snapshot.playerCount : snapshot.state.players.length,
        });
        return true;
      } catch (error) {
        clearLocalGameSnapshot();
        console.error('[Recovery] Serialized snapshot rejected', error);
        return false;
      }
    },
  };
}
