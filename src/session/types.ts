export interface PlayerSession {
  id: string;
  playerId: string;
  roomId?: string;
  reconnectToken: string;
  connected: boolean;
  lastSeen: number;
}

export interface ReconnectInfo {
  playerId: string;
  roomId?: string;
  token: string;
}
