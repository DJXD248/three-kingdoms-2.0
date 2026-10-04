import type { ActionResolver } from './ResolverTypes';
import type { GameAction, SkipReactionPayload } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import { getReactionAsk, reactionAnsweredOf } from '../../skills/reactionChain';

/**
 * SKIP_REACTION (v2.8.22 响应链执法刀＝#71) — 「这一格我不响应」的唯一正身。
 *
 * 它和 `ACTIVATE_SKILL` 的响应分支是同一句问答的两个出口（§12-61：问窗必须有出
 * 口），形状照 `ChooseOptionResolver`：只把已经冻结在状态里的那一句问话翻译成
 * 一条事实（`REACTION_ANSWERED`，`skillId===null`），不碰任何效果机制、不产生
 * `SKILL_ACTIVATED`——**这一条到今天仍然成立**：不发动就不是"发动了一次技能"，
 * 一局一次的额度因此不会被一次跳过扣掉（v2.8.32 更正的是发动那两条路也进台账，
 * 跳过这一条始终不进）。
 *
 * 合法性全部从 EngineState 现算：问句由 `getReactionAsk` 派生，载荷里的 `nodeKey`
 * 只用来核对"答的是不是当前这一格"，绝不反过来决定问谁。
 */
export class SkipReactionResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'SKIP_REACTION';
  }

  resolve(state: EngineState, action: GameAction): GameEvent[] {
    const payload = (action.payload ?? {}) as Partial<SkipReactionPayload>;
    if (typeof payload.nodeKey !== 'string' || !payload.nodeKey) {
      return [rejected(action, 'MALFORMED_PAYLOAD')];
    }
    if (!state.players.some(p => p.id === action.playerId)) {
      return [rejected(action, 'PLAYER_NOT_FOUND')];
    }
    const ask = getReactionAsk(state);
    if (!ask) return [rejected(action, 'NO_PENDING_REACTION')];
    if (ask.nodeKey !== payload.nodeKey) return [rejected(action, 'REACTION_NODE_MISMATCH')];
    if (ask.playerId !== action.playerId) return [rejected(action, 'NOT_REACTION_PLAYER')];

    return [{ type: 'REACTION_ANSWERED', data: reactionAnsweredOf(ask, null) }];
  }
}

function rejected(action: GameAction, reason: string): GameEvent {
  return { type: 'ACTION_REJECTED', data: { action, reason } };
}
