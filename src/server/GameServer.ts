import type { RoomManager } from '../room/RoomManager';

export class GameServer {
  constructor(private roomManager: RoomManager) {}

  receiveAction(roomId: string, _action: unknown) {
    const room = this.roomManager.getRoom(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    return room;
  }
}
