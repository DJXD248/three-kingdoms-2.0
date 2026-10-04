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
): GameEvent[] {
  const result: GameEvent[] = [];
  const queue = [...initialEvents];
  let depth = 0;
  let generatedCount = 0;
  // v2.8.32 限定技额度：整条展开读的是同一个（落账前的）state，所以"这条链里已经
  // 响过的那一枚一局一次"必须在这里记一笔，否则一条链上两声命中＝技能结两遍、台账
  // 只扣一次。跨调用不共享——每次调用之间已经落过账，账本才是真相。
  const quotaSpent = new Set<string>();

  while (queue.length > 0 && depth < MAX_TRIGGER_DEPTH && generatedCount < MAX_EVENTS_PER_CHAIN) {
    const next = queue.shift();
    if (!next) break;

    result.push(next);

    const triggerResult = triggers.process(state, next, depth, next.id, quotaSpent);
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
