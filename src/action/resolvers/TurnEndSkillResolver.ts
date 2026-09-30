import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent, ReactionAnsweredData, SkillActivationEventData } from '../../core/Event';
import { SkillTriggerBridge } from '../../skills/SkillTriggerBridge';
import { evaluateSkillConditions } from '../../skills/skillConditions';
import { listAllTurnEndDefinitions } from '../../skills/turnEndSkills';
import {
  getReactionAsk,
  reactionAnsweredOf,
  reactionEffectEvents,
  type ReactionAsk,
  type ReactionOption,
} from '../../skills/reactionChain';

interface ActivateSkillPayload {
  skillId?: unknown;
  generalId?: unknown;
}

/**
 * ACTIVATE_SKILL (2.3.1) — the ONE and only activation path for onTurnEnd
 * skills (TURN_END is deliberately not mapped in SkillTriggerBridge, so this
 * resolver can never double-fire with an auto trigger).
 *
 * Shape follows the canonical contract: the resolver only DESCRIBES what
 * happened — SKILL_ACTIVATED (an A-class fact: EventProcessor turns it into
 * the consumedSkills ledger entry) followed by the effect events translated
 * with the bridge's STATIC createSkillEvents (the same code the trigger path
 * uses — never a second effect mechanism) — and state settlement happens
 * exclusively in EventProcessor. Legality is re-derived from EngineState,
 * never from the trigger registry, so the isLegal probe (validate + resolve +
 * no rejection) also works on a fresh engine with no skills registered (the
 * strategy-policy probe case).
 *
 * v2.8.22 (#71)：同一条 canonical 动作还负责响应链问答的"发动"出口。分支判据不
 * 看载荷里的类型标记，只看状态里此刻有没有待答问句（`getReactionAsk`）——没有
 * 问句时本解析器的行为与 v2.8.21 逐字一致。为什么不开第二个解析器：
 * `ResolverRegistry.getResolver` 取第一个 `canResolve` 命中的，而 `canResolve`
 * 看不见状态。
 *
 * 两条路的记账**刻意不同**：回合结束那次记 `SKILL_ACTIVATED`（每回合一次的台账
 * 由它落账），响应那次只记 `REACTION_ANSWERED`。理由＝自动触发路也不记这条，
 * 把"到点自动响"换成"停下来问"绝不能顺手改台账；效果事件照样带 skillId/
 * skillName，所以日志与频次统计口径不变。
 */
export class TurnEndSkillResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'ACTIVATE_SKILL';
  }

  resolve(state: EngineState, action: GameAction): GameEvent[] {
    const payload = (action.payload ?? {}) as ActivateSkillPayload;
    const skillId = typeof payload.skillId === 'string' ? payload.skillId : '';
    const generalId = typeof payload.generalId === 'string' ? payload.generalId : '';
    if (!skillId || !generalId) {
      return [rejected(action, 'MALFORMED_PAYLOAD')];
    }
    if (!state.players.some(p => p.id === action.playerId)) {
      return [rejected(action, 'PLAYER_NOT_FOUND')];
    }

    const reaction = resolveReactionActivation(state, action, skillId, generalId);
    if (reaction) return reaction;

    const turn = state.turn ?? 0;
    // Unfiltered derivation on purpose: rejection reasons stay honest
    // ("not on field" vs "already activated this turn").
    const definition = listAllTurnEndDefinitions(state, action.playerId)
      .find(d => d.id === skillId);
    if (!definition) {
      return [rejected(action, 'TURN_END_SKILL_NOT_FOUND')];
    }
    if (definition.sourceGeneralId !== generalId || definition.turnSubType === 'otherTurn') {
      return [rejected(action, 'GENERAL_NOT_CONTROLLED')];
    }
    if ((state.consumedSkills ?? []).some(c => c.stableId === `${turn}:${skillId}`)) {
      return [rejected(action, 'SKILL_ALREADY_ACTIVATED')];
    }
    // v2.7.3 threshold gate: re-derived here independently of the candidate
    // filter, so an activation that raced a state change is honestly refused
    // instead of settling as a silent no-op skill.
    if (!evaluateSkillConditions(definition.conditions, {
      state,
      ownerId: action.playerId,
      sourceGeneralId: definition.sourceGeneralId,
    })) {
      return [rejected(action, 'SKILL_CONDITION_UNMET')];
    }

    const stableId = `${turn}:${definition.id}`;
    const activationData: SkillActivationEventData = {
      skillId: definition.id,
      skillName: definition.name,
      effectId: definition.effectId ?? definition.id,
      generalId,
      playerId: action.playerId,
      stableId,
    };
    const activationEvent: GameEvent = { type: 'SKILL_ACTIVATED', data: activationData };
    const effectEvents = SkillTriggerBridge.createSkillEvents(
      { ownerId: action.playerId, skill: definition },
      state,
      activationEvent,
    );
    // v2.8.11 刀2：选择组的**逐项**门槛全不过⇒桥接层如实不开窗。此时绝不
    // 记账这一次发动，否则玩家点一下就是"发动了却什么都没发生"的静默空转
    // （与上面定义级门槛同一诚实口径：宁可不发，绝不空耗）。
    if (definition.choiceMode && effectEvents.length === 0) {
      return [rejected(action, 'SKILL_CONDITION_UNMET')];
    }
    return [activationEvent, ...effectEvents];
  }
}

function rejected(action: GameAction, reason: string): GameEvent {
  return { type: 'ACTION_REJECTED', data: { action, reason } };
}

/**
 * 响应链问答的"发动"出口（#71）。返回 `null`＝此刻状态里没有待答问句，调用方
 * 照旧走回合结束那条路——这一条判据就是"旧行为逐字不变"的构造保证：没有问句
 * 时本函数一次副作用都不做。
 *
 * 问句由 `getReactionAsk` 现算（唯一推导点），所以"这一格该谁答、能选哪几枚"
 * 与界面/冻结世界门/合法动作枚举四处看到的是同一份事实。
 */
function resolveReactionActivation(
  state: EngineState,
  action: GameAction,
  skillId: string,
  generalId: string,
): GameEvent[] | null {
  const ask: ReactionAsk | null = getReactionAsk(state);
  if (!ask) return null;
  if (ask.playerId !== action.playerId) return [rejected(action, 'NOT_REACTION_PLAYER')];
  if (ask.generalId !== generalId) return [rejected(action, 'GENERAL_NOT_CONTROLLED')];

  const option: ReactionOption | undefined = ask.options.find(entry => entry.skillId === skillId);
  if (!option) return [rejected(action, 'REACTION_SKILL_NOT_FOUND')];

  const answeredData: ReactionAnsweredData = reactionAnsweredOf(ask, option);
  const answeredEvent: GameEvent = { type: 'REACTION_ANSWERED', data: answeredData };
  const effectEvents = reactionEffectEvents(ask, state, option);
  // 与回合结束那条同一诚实口径：选择组逐项门槛全不过＝宁可不发，绝不空耗。
  if (option.definition.choiceMode && effectEvents.length === 0) {
    return [rejected(action, 'SKILL_CONDITION_UNMET')];
  }
  return [answeredEvent, ...effectEvents];
}
