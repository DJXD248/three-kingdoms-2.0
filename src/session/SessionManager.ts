import type { PlayerSession } from './types';

export class SessionManager {
  private sessions = new Map<string, PlayerSession>();

  create(session: PlayerSession) {
    this.sessions.set(session.playerId, session);
    return session;
  }

  get(playerId: string) {
    return this.sessions.get(playerId);
  }

  disconnect(playerId: string) {
    const session = this.sessions.get(playerId);
    if (session) {
      session.connected = false;
      session.lastSeen = Date.now();
    }
  }

  reconnect(playerId: string, token: string) {
    const session = this.sessions.get(playerId);

    if (!session || session.reconnectToken !== token) {
      return false;
    }

    session.connected = true;
    session.lastSeen = Date.now();
    return true;
  }
}
