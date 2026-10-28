import type { GameEvent } from './Event';
import type { EngineState } from './GameState';
import type { TriggerEngine } from '../triggers/TriggerEngine';

const MAX_TRIGGER_DEPTH = 32;
const MAX_EVENTS_PER_CHAIN = 256;

/**
 * Expands skill-triggered events before the event processor mutates state.
 * Keeping this traversal outside GameEngine makes dispatch orchestration
 * independent from trigger-chain safety limits.
 */
export function resolveTriggerChain(
  state: EngineState,
  triggers: TriggerEngine,
  initialEvents: GameEvent[],
  /** v2.9.13：只让这些监听 id 听（部署步补注册重放专用，见 `TriggerEngine.process`）。 */
  restrictToIds?: ReadonlySet<string>,
): GameEvent[] {
  const result: GameEvent[] = [];
  const queue = [...initialEvents];
  let depth = 0;
  let generatedCount = 0;
  // v2.8.32 限定技额度／限次刀：整条展开读的是同一个（落账前的）state，所以"这条链里
  // 那一枚额度已经用掉几次"必须在这里记着，否则一条链上两声命中＝技能结两遍、台账
  // 只扣一次。跨调用不共享——每次调用之间已经落过账，账本才是真相。
  // 限次刀起容器从 `Set`（只答"响过没"）换成按次数计的 `Map`：一局一次那条判据读的
  // 仍是"有没有"（`> 0`），每回合 N 次那条读的才是"几次"，两本账共用这一份。
  const quotaSpent = new Map<string, number>();

  while (queue.length > 0 && depth < MAX_TRIGGER_DEPTH && generatedCount < MAX_EVENTS_PER_CHAIN) {
    const next = queue.shift();
    if (!next) break;

    result.push(next);

    const triggerResult = triggers.process(state, next, depth, next.id, quotaSpent, restrictToIds);
    if (triggerResult.truncated) {
      result.push({ type: 'CUSTOM', data: { kind: 'TRIGGER_CHAIN_LIMIT', sourceEvent: next } });
    }

    if (triggerResult.events.length > 0) {
      const remaining = Math.max(0, MAX_EVENTS_PER_CHAIN - generatedCount);
      const generated = triggerResult.events.slice(0, remaining);
      generatedCount += generated.length;
      result.push({
        type: 'TRIGGERED',
        data: { sourceEvent: next, count: generated.length, depth },
      });
      queue.push(...generated);
    }

    depth += 1;
  }

  if (queue.length > 0) {
    result.push({
      type: 'CUSTOM',
      data: { kind: 'TRIGGER_PROCESSING_STOPPED', remaining: queue.length },
    });
  }

  return result;
}
