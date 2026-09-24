import type { GameAction } from '../action/ActionTypes';
import type { GameEvent } from '../core/Event';
import type { EngineState } from '../core/GameState';
import { cloneEngineState } from '../core/GameState';
import { REPLAY_SCHEMA_VERSION, type ReplayDocument, type ReplayEvent } from './types';
import pkg from '../../package.json';

/** Records deterministic action/event steps together with before/after engine state. */
export class ReplayRecorder {
  private document: ReplayDocument | null = null;

  start(initialState: EngineState, roomId = 'local'): void {
    this.document = {
      version: 1,
      header: { schemaVersion: REPLAY_SCHEMA_VERSION, gameVersion: pkg.version },
      roomId,
      createdAt: Date.now(),
      initialState: cloneEngineState(initialState),
      entries: [],
    };
  }

  record(
    action: GameAction,
    events: GameEvent[] = [],
    beforeState?: EngineState,
    afterState?: EngineState,
  ): ReplayEvent {
    if (!this.document) {
      const seedState = afterState ?? beforeState;
      if (!seedState) throw new Error('ReplayRecorder must be started before recording.');
      this.start(seedState, String(seedState.metadata?.roomId ?? 'local'));
    }

    const before = beforeState ?? this.document!.entries.at(-1)?.afterState ?? this.document!.initialState;
    const after = afterState ?? before;
    const entry: ReplayEvent = {
      sequence: this.document!.entries.length + 1,
      timestamp: Date.now(),
      action: structuredClone(action),
      events: structuredClone(events),
      beforeState: cloneEngineState(before),
      afterState: cloneEngineState(after),
    };
    this.document!.entries.push(entry);
    return structuredClone(entry);
  }

  getDocument(): ReplayDocument | null {
    return this.document ? structuredClone(this.document) : null;
  }

  export(): ReplayEvent[] {
    return this.document ? structuredClone(this.document.entries) : [];
  }

  serialize(): string {
    if (!this.document) return '';
    return JSON.stringify(this.document);
  }

  clear(): void {
    this.document = null;
  }

  /** D-4 read口径: documents without a header (pre-2.2.24) are schemaVersion 1. */
  static schemaVersionOf(document: ReplayDocument): number {
    return document.header?.schemaVersion ?? 1;
  }

  static deserialize(data: string): ReplayDocument {
    const document = JSON.parse(data) as ReplayDocument;
    if (!document || document.version !== 1 || !document.initialState || !Array.isArray(document.entries)) {
      throw new Error('Invalid replay document.');
    }
    const schema = ReplayRecorder.schemaVersionOf(document);
    if (!Number.isInteger(schema) || schema < 1 || schema > REPLAY_SCHEMA_VERSION) {
      throw new Error(`Unsupported replay schema version: ${schema}`);
    }
    return structuredClone(document);
  }
}
