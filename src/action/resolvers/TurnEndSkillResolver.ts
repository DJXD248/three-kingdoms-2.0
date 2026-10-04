import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent, ReactionAnsweredData } from '../../core/Event';
import { SkillTriggerBridge } from '../../skills/SkillTriggerBridge';
import { evaluateSkillConditions } from '../../skills/skillConditions';
import {
  limitedActivationEvent,
  limitedQuotaAvailable,
  skillActivatedEvent,
} from '../../skills/skillQuota';
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
 * 两条路的记账（v2.8.32 限定技额度刀更正）：过去这里写着"响应那次只记
 * `REACTION_ANSWERED`、与自动路逐字同一套账"，本刀起**带「一局一次」额度的定义三条
 * 路都记同一笔 `SKILL_ACTIVATED`**——额度要跨回合、跨发动路查，账不落就管不住。
 * 不带额度的定义一字未变（两条路仍只记各自那一句），所以既有对局的事件流逐字节不动。
 * `stableId` 的形状也统一由 `skills/skillQuota.ts` 单点生产；回合结束那一路的每回合
 * 一次门查的仍是同一个键。
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
    // v2.8.32 限定技额度：同一句判据，第四条消费路（解析器复核）。放在"本回合已经
    // 用过"之后＝既有拒绝理由逐字不变，只有跨回合再用同一枚限定技才新报这一条。
    if (!limitedQuotaAvailable(state, definition)) {
      return [rejected(action, 'SKILL_LIMIT_EXHAUSTED')];
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

    // 载荷形状的唯一生产点（v2.8.32）：键序与 v2.8.31 逐字一致，不带额度的定义
    // 连键都不多——三条路因此记的是同一份账。
    const activationEvent = skillActivatedEvent(definition, { playerId: action.playerId, generalId, turn });
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
  // v2.8.32：候选过滤器已经扣过额度，这一句是解析器侧的独立复核（与上面回合结束
  // 那条同一口径：合法性从 EngineState 重推，绝不信载荷或窗口的陈旧快照）。
  if (!limitedQuotaAvailable(state, option.definition)) {
    return [rejected(action, 'SKILL_LIMIT_EXHAUSTED')];
  }

  const answeredData: ReactionAnsweredData = reactionAnsweredOf(ask, option);
  const answeredEvent: GameEvent = { type: 'REACTION_ANSWERED', data: answeredData };
  const effectEvents = reactionEffectEvents(ask, state, option);
  // 与回合结束那条同一诚实口径：选择组逐项门槛全不过＝宁可不发，绝不空耗。
  if (option.definition.choiceMode && effectEvents.length === 0) {
    return [rejected(action, 'SKILL_CONDITION_UNMET')];
  }
  // v2.8.32 限定技额度刀：问答路的这一次点头**也是一次发动**，所以带额度的定义
  // 在这里落同一笔账（形状仍走唯一生产点）。不带额度的定义一字未变——只多出来的
  // 那一笔才是本刀的账，其余定义的事件流逐字节不动。
  const activation = limitedActivationEvent(option.definition, {
    playerId: action.playerId,
    generalId: ask.generalId,
    turn: state.turn ?? 0,
  }, effectEvents.length);
  return [...(activation ? [activation] : []), answeredEvent, ...effectEvents];
}
