
import type { Room, PlayerSession } from './types';

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(owner: PlayerSession, maxPlayers = 4): Room {
    const room: Room = {
      id: crypto.randomUUID(),
      ownerId: owner.id,
      status: 'WAITING',
      players: [owner],
      maxPlayers,
    };
    this.rooms.set(room.id, room);
    return room;
  }

  getRoom(id: string) {
    return this.rooms.get(id);
  }

  joinRoom(roomId: string, player: PlayerSession) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.players.length >= room.maxPlayers) throw new Error('Room full');
    room.players.push(player);
    return room;
  }
}
