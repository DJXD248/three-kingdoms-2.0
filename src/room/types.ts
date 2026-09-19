
export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED';

export interface PlayerSession {
  id: string;
  name: string;
  ready: boolean;
  isAI?: boolean;
}

export interface Room {
  id: string;
  ownerId: string;
  status: RoomStatus;
  players: PlayerSession[];
  maxPlayers: number;
}
