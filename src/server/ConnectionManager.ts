import type { ClientConnection } from './types';

export class ConnectionManager {
  private connections = new Map<string, ClientConnection>();

  add(connection: ClientConnection) {
    this.connections.set(connection.id, connection);
  }

  remove(id: string) {
    this.connections.delete(id);
  }

  get(id: string) {
    return this.connections.get(id);
  }
}
