import type { EngineState } from '../core/GameState';
import type { GameAction } from '../action/ActionTypes';
import type { GameEvent } from '../core/Event';
import type { ReplayDocument, ReplayEvent } from './types';
import { ReplayRecorder } from './ReplayRecorder';

/** Room-scoped replay sessions backed by one canonical document format. */
export class ReplayManager {
  private sessions = new Map<string, ReplayDocument>();

  start(roomId: string, initialState: EngineState): ReplayDocument {
    const recorder = new ReplayRecorder();
    recorder.start(initialState, roomId);
    const document = recorder.getDocument()!;
    this.sessions.set(roomId, document);
    return structuredClone(document);
  }

  record(roomId: string, action: GameAction, events: GameEvent[], beforeState: EngineState, afterState: EngineState): ReplayEvent {
    let document = this.sessions.get(roomId);
    if (!document) document = this.start(roomId, beforeState);

    const entry: ReplayEvent = {
      sequence: document.entries.length + 1,
      timestamp: Date.now(),
      action: structuredClone(action),
      events: structuredClone(events),
      beforeState: structuredClone(beforeState),
      afterState: structuredClone(afterState),
    };
    document.entries.push(entry);
    return structuredClone(entry);
  }

  get(roomId: string): ReplayEvent[] {
    return structuredClone(this.sessions.get(roomId)?.entries ?? []);
  }

  getDocument(roomId: string): ReplayDocument | undefined {
    const document = this.sessions.get(roomId);
    return document ? structuredClone(document) : undefined;
  }

  export(roomId: string): string | undefined {
    const document = this.sessions.get(roomId);
    return document ? JSON.stringify(document) : undefined;
  }

  clear(roomId?: string): void {
    if (roomId === undefined) this.sessions.clear();
    else this.sessions.delete(roomId);
  }
}
