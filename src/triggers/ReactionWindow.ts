
import type { GameEvent } from '../core/Event';
import { PrioritySystem } from '../timeline/PrioritySystem';
import type { ReactionWindowState } from './types';

export class ReactionWindow {
  readonly priority = new PrioritySystem();
  private current: ReactionWindowState | null = null;

  open(event: GameEvent, participants: number[]) {
    const uniqueParticipants = [...new Set(participants)];
    this.priority.reset(uniqueParticipants);

    this.current = {
      id: `reaction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceEventId: event.id ?? `${event.type}:${event.timestamp ?? Date.now()}`,
      sourceEventType: event.type,
      participants: uniqueParticipants,
      passed: [],
      openedAt: Date.now(),
      closed: false
    };

    return this.current;
  }

  pass(playerId: number) {
    if (!this.current || this.current.closed) return false;
    if (!this.current.participants.includes(playerId)) return false;

    this.priority.pass(playerId);
    this.current.passed = this.current.participants.filter(id => this.priority.hasPassed(id));

    if (this.priority.allPassed(this.current.participants)) {
      this.current.closed = true;
    }

    return true;
  }

  revoke(playerId: number) {
    if (!this.current || this.current.closed) return false;
    this.priority.revoke(playerId);
    this.current.passed = this.current.participants.filter(id => this.priority.hasPassed(id));
    return true;
  }

  isOpen() {
    return this.current !== null && !this.current.closed;
  }

  getState() {
    return this.current ? { ...this.current, passed: [...this.current.passed] } : null;
  }

  close() {
    if (this.current) this.current.closed = true;
  }

  clear() {
    this.current = null;
  }
}
