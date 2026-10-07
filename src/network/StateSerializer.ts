import type { StateSnapshot } from './types';
import type { EngineState } from '../core/GameState';

export const NETWORK_SNAPSHOT_VERSION = 1;

function assertState(value: unknown): asserts value is EngineState {
  if (!value || typeof value !== 'object') throw new Error('Invalid EngineState snapshot.');
  const state = value as Partial<EngineState>;
  if (!Array.isArray(state.players) || !Array.isArray(state.deck) || !Array.isArray(state.discardPile)) {
    throw new Error('Invalid EngineState snapshot.');
  }
}

export class StateSerializer {
  createSnapshot(roomId: string, state: EngineState, roomName?: string, playerCount?: number): StateSnapshot {
    assertState(state);
    const safeRoomName = typeof roomName === 'string' && roomName.trim() ? roomName.trim() : roomId;
    const safePlayerCount = Number.isFinite(playerCount) ? Number(playerCount) : state.players.length;
    return {
      version: NETWORK_SNAPSHOT_VERSION,
      roomId,
      roomName: safeRoomName,
      playerCount: safePlayerCount,
      timestamp: Date.now(),
      state: structuredClone(state),
    };
  }

  serialize(snapshot: StateSnapshot): string {
    return JSON.stringify(snapshot);
  }

  deserialize(data: string): StateSnapshot {
    const parsed = JSON.parse(data) as Partial<StateSnapshot>;
    if (!parsed || parsed.version !== NETWORK_SNAPSHOT_VERSION || typeof parsed.roomId !== 'string') {
      throw new Error('Invalid state snapshot packet.');
    }
    assertState(parsed.state);
    const safeRoomName = typeof parsed.roomName === 'string' && parsed.roomName.trim()
      ? parsed.roomName.trim()
      : parsed.roomId;
    const safePlayerCount = Number.isFinite(parsed.playerCount)
      ? Number(parsed.playerCount)
      : parsed.state.players.length;
    return {
      ...parsed,
      roomId: parsed.roomId,
      roomName: safeRoomName,
      playerCount: safePlayerCount,
      state: structuredClone(parsed.state),
    } as StateSnapshot;
  }
}
