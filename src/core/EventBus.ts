import type { GameEvent, GameEventType } from './Event';

type Handler<T = unknown> = (event: GameEvent<T>) => void;

export class EventBus {
  private handlers = new Map<GameEventType, Set<Handler>>();

  on<T = unknown>(type: GameEventType, handler: Handler<T>) {
    const list = this.handlers.get(type) ?? new Set();
    list.add(handler as Handler);
    this.handlers.set(type, list);
    return () => this.off(type, handler);
  }

  off<T = unknown>(type: GameEventType, handler: Handler<T>) {
    this.handlers.get(type)?.delete(handler as Handler);
  }

  emit<T = unknown>(event: GameEvent<T>) {
    event.id ??= crypto.randomUUID?.() ?? String(Date.now());
    event.timestamp ??= Date.now();

    for (const handler of this.handlers.get(event.type) ?? []) {
      handler(event);
    }
  }

  clear() {
    this.handlers.clear();
  }
}
