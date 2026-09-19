export interface ClientConnection {
  id: string;
  playerId?: string;
  roomId?: string;
  connectedAt: number;
}

export interface ServerActionPacket {
  roomId: string;
  playerId: string;
  action: unknown;
  timestamp: number;
}

export interface StateSnapshotPacket {
  roomId: string;
  version: number;
  state: unknown;
}
