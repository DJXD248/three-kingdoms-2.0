import type { EngineState, PendingReaction, ReactionNode } from '../GameState';
import type { GameEvent } from '../Event';

/**
 * 响应链问答的状态落账（v2.8.22 响应链执法刀＝#71；ARCH_MAP §F 响应链行）。
 *
 * 两个定居者围着状态里的那一个槽 `EngineState.pendingReaction` 对称工作，形态与
 * `choiceEvents.ts` 一路（A 类槽、单点写入、纯 `(state, event) => state`）：
 *
 *  - `REACTION_ANSWERED`＝某一席的某一员在某一格上表了态（发动或跳过都算）。它只
 *    往那一格的台账上**并**一个键，绝不覆盖、绝不删格：格什么时候消失由下一次
 *    结算后扫描（`REACTION_QUEUE_SYNCED`）决定，两件事分开记，回放里才看不出先后。
 *  - `REACTION_QUEUE_SYNCED`＝扫描给出的队列视图。队列本身由
 *    `skills/reactionChain.ts` 从（已结算状态＋本次 dispatch 事件序列）**纯派生**，
 *    这里只负责把它原样写进槽里，形状不合法就当没听见（诚实空转）。
 *
 * 本模块刻意不 import `skills/`：状态突变层只认事件形状，不认候选是怎么算出来的，
 * 否则"谁该被问"就有了第二个推导点（§12-79）。
 */

/** 表态单位：`<playerId>:<generalId>`（与 `reactionSubjectKey` 同一拼法）。 */
function subjectKeyOf(data: Record<string, unknown>): string {
  return `${String(data.playerId)}:${String(data.generalId)}`;
}

/**
 * 收到一句表态：把 `playerId:generalId` 并进那一格的台账。
 * 找不到那格（已收掉／陈旧回答）＝原样返回，绝不新建格。
 */
export function applyReactionAnsweredEvent(state: EngineState, event: GameEvent): EngineState {
  const queue = state.pendingReaction;
  if (!queue || queue.nodes.length === 0) return state;
  const data = (event.data ?? {}) as Record<string, unknown>;
  if (typeof data.nodeKey !== 'string' || !data.nodeKey) return state;
  if (typeof data.playerId !== 'number' || typeof data.generalId !== 'string') return state;

  const subjectKey = subjectKeyOf(data);
  const node = queue.nodes.find(entry => entry.key === data.nodeKey);
  if (!node) return state;
  if (node.answered.includes(subjectKey)) return state;

  return {
    ...state,
    pendingReaction: {
      ...queue,
      nodes: queue.nodes.map(entry => entry.key === data.nodeKey
        ? { ...entry, answered: [...entry.answered, subjectKey] }
        : entry),
    },
  };
}

/** 只认结构，不认语义：队列里每一格都必须带键、带那一声明、带一个键列表。 */
type QueueView = { queue: PendingReaction | null };

function sanitizeQueue(raw: unknown): QueueView | null {
  if (raw === null) return { queue: null };
  if (typeof raw !== 'object') return null;
  const queue = raw as Record<string, unknown>;
  if (typeof queue.turn !== 'number' || typeof queue.serial !== 'number') return null;
  if (!Array.isArray(queue.nodes)) return null;
  const nodes: ReactionNode[] = [];
  for (const entry of queue.nodes) {
    if (typeof entry !== 'object' || entry === null) return null;
    const node = entry as Record<string, unknown>;
    if (typeof node.key !== 'string' || !node.key) return null;
    const sourceEvent = node.sourceEvent as Record<string, unknown> | undefined;
    if (!sourceEvent || typeof sourceEvent.type !== 'string') return null;
    if (!Array.isArray(node.answered)) return null;
    nodes.push({
      key: node.key,
      sourceEvent: { type: sourceEvent.type as ReactionNode['sourceEvent']['type'], data: sourceEvent.data },
      answered: node.answered.filter((key): key is string => typeof key === 'string'),
    });
  }
  // 没有格＝槽清空：派生侧本来也返回 null，两条写法收敛成同一个形状。
  if (nodes.length === 0) return { queue: null };
  return { queue: { turn: queue.turn, serial: queue.serial, nodes } };
}

/**
 * 扫描结果写入：`queue===null` 或没有格⇒槽清空；其余原样落槽。
 * 空事件/坏形状＝原样返回（今天这条路径上没有任何东西会伪造队列）。
 */
export function applyReactionQueueSyncedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = (event.data ?? {}) as Record<string, unknown>;
  if (!('queue' in data)) return state;
  const view = sanitizeQueue(data.queue);
  if (!view) return state;
  return { ...state, pendingReaction: view.queue };
}
