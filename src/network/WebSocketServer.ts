
import type { ServerActionPacket, StateSnapshotPacket } from './types';

export class WebSocketServer {
  private clients = new Map<string, unknown>();

  connect(id: string, socket: unknown) {
    this.clients.set(id, socket);
  }

  disconnect(id: string) {
    this.clients.delete(id);
  }

  receive(packet: ServerActionPacket) {
    return packet;
  }

  broadcast(snapshot: StateSnapshotPacket) {
    return snapshot;
  }
}
