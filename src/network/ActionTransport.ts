import type { GameAction } from '../action/ActionTypes';
import type { NetworkActionPacket } from './types';

export class ActionTransport {
  createPacket(roomId: string, action: GameAction): NetworkActionPacket {
    return {
      id: action.id,
      roomId,
      playerId: String(action.playerId),
      timestamp: Date.now(),
      action,
    };
  }
}
