import type { GameAction } from '../action/ActionTypes';
import { ResolverRegistry } from '../action/ResolverRegistry';
import type { EngineState } from './GameState';
import type { GameEvent } from './Event';
import { EventBus } from './EventBus';
import { EventProcessor } from './EventProcessor';
import { TriggerEngine } from '../triggers/TriggerEngine';
import { ReactionWindow } from '../triggers/ReactionWindow';
import { SkillTriggerBridge } from '../skills/SkillTriggerBridge';
import { RuleEngine } from '../rules/RuleEngine';
import type { DataSkillDefinition } from '../skills/dataTypes';
import { ReplayRecorder } from '../replay/ReplayRecorder';
import { SnapshotManager } from '../replay/SnapshotManager';
import { resolveTriggerChain } from './EngineDispatchFlow';
import { getLegalActions } from '../rules/legalActions';

export interface GameEngineOptions {
  /** Record replay entries + state snapshots (default true). AI battle runs
   * turn this off: thousands of deep clones per soak would exhaust memory,
   * and headless runs log their own action lists instead. */
  recordHistory?: boolean;
}

export class GameEngine {
  readonly events = new EventBus();
  readonly processor = new EventProcessor();
  readonly triggers = new TriggerEngine();
  readonly reactions = new ReactionWindow();
  readonly skillTriggers = new SkillTriggerBridge(this.triggers);
  readonly resolvers = new ResolverRegistry();
  readonly rules = new RuleEngine();
  readonly replay = new ReplayRecorder();
  readonly snapshots = new SnapshotManager();

  private readonly recordHistory: boolean;

  constructor(public state: EngineState, options: GameEngineOptions = {}) {
    this.recordHistory = options.recordHistory !== false;
    if (this.recordHistory) {
      this.replay.start(state, String(state.metadata?.roomId ?? 'local'));
      this.snapshots.capture(String(state.metadata?.roomId ?? 'local'), state, 0, 'initial');
    }
  }

  dispatch(action: GameAction): GameEvent[] {
    const beforeState = this.recordHistory ? this.snapshot() : this.state;
    const events: GameEvent[] = [];
    const validation = this.rules.validateAction(this.state, action);
    if (!validation.valid) {
      const rejected: GameEvent = {
        type: 'ACTION_REJECTED',
        data: { action, reason: validation.reason ?? 'INVALID_ACTION' },
      };
      this.events.emit(rejected);
      if (this.recordHistory) this.replay.record(action, [rejected], beforeState, beforeState);
      return [rejected];
    }

    const resolver = this.resolvers.getResolver(action);

    if (!resolver) {
      const rejected: GameEvent = {
        type: 'ACTION_REJECTED',
        data: { action, reason: `NO_RESOLVER:${action.type}` },
      };
      this.events.emit(rejected);
      if (this.recordHistory) this.replay.record(action, [rejected], beforeState, beforeState);
      return [rejected];
    }

    const accepted: GameEvent = { type: 'ACTION_ACCEPTED', data: { action } };
    events.push(accepted);

    const resolvedEvents = resolver.resolve(this.state, action);
    const triggeredEvents = resolveTriggerChain(this.state, this.triggers, resolvedEvents);
    events.push(...triggeredEvents);

    this.state = this.processor.process(this.state, events);

    const afterState = this.recordHistory ? this.snapshot() : this.state;
    const changed: GameEvent = {
      type: 'STATE_CHANGED',
      data: { action, snapshot: afterState },
    };
    events.push(changed);

    for (const event of events) this.events.emit(event);

    if (this.recordHistory) {
      const sequence = this.replay.export().length + 1;
      this.replay.record(action, events, beforeState, afterState);
      const roomId = String(afterState.metadata?.roomId ?? 'local');
      this.snapshots.capture(roomId, afterState, sequence, 'action', action.id);
    }
    return events;
  }

  registerPlayerSkills(ownerId: number | string, skills: DataSkillDefinition[]) {
    return this.skillTriggers.registerSkills(ownerId, skills);
  }

  /** Every action `playerId` can currently dispatch without being rejected.
   * Candidates are generated from the state; legality is decided by the same
   * RuleEngine + resolvers that judge real dispatches (see rules/legalActions). */
  legalActions(playerId: number): GameAction[] {
    return getLegalActions(this, playerId);
  }

  unregisterPlayerSkills(ownerId: number | string) {
    this.skillTriggers.unregisterOwner(ownerId);
  }

  openReactionWindow(event: GameEvent, participants?: number[]) {
    const ids = participants ?? this.state.players.map(player => player.id);
    const window = this.reactions.open(event, ids);
    this.events.emit({ type: 'REACTION_WINDOW_OPENED', data: window });
    return window;
  }

  passReaction(playerId: number) {
    const accepted = this.reactions.pass(playerId);
    if (accepted && !this.reactions.isOpen()) {
      this.events.emit({ type: 'REACTION_WINDOW_CLOSED', data: this.reactions.getState() });
    }
    return accepted;
  }

  snapshot() {
    return structuredClone(this.state);
  }
}
