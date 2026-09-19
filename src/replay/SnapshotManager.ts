import type { EngineState } from '../core/GameState';
import type { SnapshotRecord } from './types';

/**
 * Keeps an ordered snapshot timeline per room.
 * Snapshots are immutable clones so callers cannot mutate replay history by reference.
 */
export class SnapshotManager {
  private snapshots = new Map<string, SnapshotRecord[]>();

  save(snapshot: SnapshotRecord): SnapshotRecord {
    const roomSnapshots = this.snapshots.get(snapshot.roomId) ?? [];
    const stored = {
      ...snapshot,
      state: structuredClone(snapshot.state),
    };
    roomSnapshots.push(stored);
    roomSnapshots.sort((a, b) => a.sequence - b.sequence || a.timestamp - b.timestamp);
    this.snapshots.set(snapshot.roomId, roomSnapshots);
    return structuredClone(stored);
  }

  capture(
    roomId: string,
    state: EngineState,
    sequence: number,
    reason: SnapshotRecord['reason'] = 'action',
    actionId?: string,
  ): SnapshotRecord {
    return this.save({
      version: state.version,
      timestamp: Date.now(),
      roomId,
      sequence,
      state,
      reason,
      actionId,
    });
  }

  get(roomId: string, sequence?: number): SnapshotRecord | undefined {
    const list = this.snapshots.get(roomId) ?? [];
    const match = sequence === undefined
      ? list[list.length - 1]
      : list.find(snapshot => snapshot.sequence === sequence);
    return match ? structuredClone(match) : undefined;
  }

  getAll(roomId: string): SnapshotRecord[] {
    return structuredClone(this.snapshots.get(roomId) ?? []);
  }

  restore(roomId: string, sequence?: number): EngineState | undefined {
    return this.get(roomId, sequence)?.state;
  }

  clear(roomId?: string): void {
    if (roomId === undefined) this.snapshots.clear();
    else this.snapshots.delete(roomId);
  }
}
