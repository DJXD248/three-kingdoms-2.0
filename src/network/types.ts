import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';


export interface NetworkActionPacket {
  id: string;
  roomId: string;
  playerId: string;
  timestamp: number;
  action: GameAction;
}

export interface StateSnapshot {
  version: number;
  roomId: string;
  roomName: string;
  playerCount: number;
  timestamp: number;
  state: EngineState;
}

export interface ReplayEntry {
  timestamp: number;
  action: GameAction;
  events?: unknown[];
}

export interface ServerActionPacket {
  roomId: string;
  playerId: string;
  action: GameAction;
  timestamp: number;
}

export interface StateSnapshotPacket {
  roomId: string;
  roomName?: string;
  playerCount?: number;
  version: number;
  state: EngineState;
}
