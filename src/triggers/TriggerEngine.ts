
import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type { TriggerDefinition, TriggerContext, TriggerProcessResult } from './types';
import { orderReactionCandidates, victimRefOf } from './reactionOrder';

const MAX_TRIGGER_DEPTH = 32;
const MAX_EVENTS_PER_CHAIN = 256;

export class TriggerEngine {
  private triggers = new Map<string, TriggerDefinition>();

  register(trigger: TriggerDefinition) {
    this.triggers.set(trigger.id, { enabled: true, ...trigger });
    return () => this.triggers.delete(trigger.id);
  }

  unregister(id: string) {
    this.triggers.delete(id);
  }

  get(id: string) {
    return this.triggers.get(id);
  }

  getAll() {
    return [...this.triggers.values()];
  }

  setEnabled(id: string, enabled: boolean) {
    const trigger = this.triggers.get(id);
    if (!trigger) return false;
    trigger.enabled = enabled;
    return true;
  }

  unregisterByOwner(ownerId: number | string) {
    for (const [id, trigger] of this.triggers) {
      if (trigger.ownerId === ownerId) this.triggers.delete(id);
    }
  }

  getByOwner(ownerId: number | string) {
    return [...this.triggers.values()].filter(trigger => trigger.ownerId === ownerId);
  }

  process(
    state: EngineState,
    event: GameEvent,
    depth = 0,
    rootEventId = event.id ?? `${event.type}:${event.timestamp ?? Date.now()}`,
    /** v2.8.32：同一条展开链里已落账的「一局一次」额度键（见 `TriggerContext.quotaSpent`）。 */
    quotaSpent?: Set<string>,
    /** v2.9.13（按需池第一刀）：只让这一批 id 的监听听这一声。用途＝部署步的
     *  补注册重放（v2.5.1，§12-26）：那一步的事件**已经喂给派发前的链一次**了，
     *  重放只为"这一步刚上册的那几位"而存在。缺省＝不限（其余调用点逐字不变）。
     *  不这么做的实测后果＝挂了「听场上／听除自身以外／听敌方」的登场技，别人登场
     *  那一步响两遍（派发前一遍＋重放一遍）；`self` 档因为身份键只认自己那一员，
     *  结构上撞不到这条，所以两锚至今看不见它。 */
    restrictToIds?: ReadonlySet<string>,
  ): TriggerProcessResult {
    if (depth >= MAX_TRIGGER_DEPTH) {
      return { events: [], depth, truncated: true };
    }

    // 唯一顺序根＝reactionOrder（档位在上、受击组整组先、组内座次绕圈、席位内注册顺序）。
    // 曾经这里是 `sort(priority desc)`⇒同档内悄悄用注册顺序，与座次和"谁挨的打"无关。
    const matching = orderReactionCandidates(
      this.getAll()
        .filter(trigger => trigger.enabled !== false && trigger.eventType === event.type)
        .filter(trigger => restrictToIds === undefined || restrictToIds.has(trigger.id))
        .map(trigger => ({
          trigger,
          ownerId: trigger.ownerId ?? '',
          generalId: trigger.generalId,
          priority: trigger.priority ?? 0
        })),
      { seatOrder: (state.players ?? []).map(player => player.id), ...victimRefOf(event) }
    ).map(entry => entry.trigger);

    const emitted: GameEvent[] = [];
    const fired = new Set<string>();

    for (const trigger of matching) {
      if (trigger.oncePerEvent && fired.has(trigger.id)) continue;

      const context: TriggerContext = {
        state,
        event,
        depth,
        rootEventId,
        ownerId: trigger.ownerId,
        skillId: trigger.skillId,
        quotaSpent,
      };

      if (trigger.condition && !trigger.condition(context)) continue;

      const created = trigger.createEvents(context) ?? [];
      if (created.length === 0) continue;

      fired.add(trigger.id);
      emitted.push(
        ...created.map(createdEvent => ({
          ...createdEvent,
          data: {
            ...(typeof createdEvent.data === 'object' && createdEvent.data !== null
              ? createdEvent.data
              : { value: createdEvent.data }),
            triggerId: trigger.id,
            triggerDepth: depth + 1,
            rootEventId,
            ownerId: trigger.ownerId,
            skillId: trigger.skillId
          }
        }))
      );

      if (emitted.length >= MAX_EVENTS_PER_CHAIN) break;
    }

    return {
      events: emitted.slice(0, MAX_EVENTS_PER_CHAIN),
      depth,
      truncated: emitted.length > MAX_EVENTS_PER_CHAIN
    };
  }
}
