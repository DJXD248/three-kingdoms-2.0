
import type { DataSkillDefinition, DataSkillTrigger, SkillEffectData } from './dataTypes';
import type { EngineState, PendingChoiceOption } from '../core/GameState';
import type { GameEvent, GameEventType } from '../core/Event';
import type { TriggerEngine } from '../triggers/TriggerEngine';
import type { TriggerContext } from '../triggers/types';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { evaluateSkillConditions } from './skillConditions';
import { gateConditionsToText } from './skillGateText';
import {
  enumerateHandCardCandidates,
  enumerateTargetCandidates,
  type ChoiceCandidate,
} from './choiceCandidates';

const TRIGGER_EVENT_MAP: Partial<Record<DataSkillTrigger, GameEventType>> = {
  onDeploy: 'GENERAL_DEPLOYED',
  onTurnStart: 'TURN_START',
  onDamageTaken: 'DAMAGE',
  onDamageDealt: 'AFTER_DAMAGE',
  onKill: 'DEATH',
  onDeath: 'DEATH',
  // 2.3.0: BEFORE_DAMAGE is a pure notification (no EventProcessor case, no
  // state change) emitted by AttackResolver right before damage settlement.
  // Derived effects queue at the trigger-chain tail, so a counter hit from
  // this trigger settles AFTER the source DAMAGE within one dispatch —
  // frozen semantics, see PROJECT_ARCH_MAP "Trigger 契约表".
  onBecomingTarget: 'BEFORE_DAMAGE',
  // 2.5.3: card-loss/gain triggers listen to the pure notification events
  // derived by the GIVE settlement (chainedConsequences). CARD_* carries no
  // EventProcessor case and changes no state by itself — same "pure
  // notification in the map" shape as BEFORE_DAMAGE (2.3.0).
  onCardLost: 'CARD_LOST',
  onCardGained: 'CARD_GAINED'
  // onTurnEnd is DELIBERATELY absent (2.3.1, single-activation-path /
  // double-fire ban): TURN_END must never auto-fire the skill. Its only
  // activation path is the canonical ACTIVATE_SKILL action → the resolver,
  // which reuses the static createSkillEvents below — the same
  // effect-translation code, never a second one.
};

const PRIORITY: Partial<Record<DataSkillTrigger, number>> = {
  onDeploy: 100,
  onTurnStart: 50,
  onDamageTaken: 50,
  onDamageDealt: 50,
  onKill: 60,
  onDeath: 100,
  onBecomingTarget: 50,
  onCardLost: 50,
  onCardGained: 50
};

export interface SkillOwnerBinding {
  ownerId: number | string;
  skill: DataSkillDefinition;
  enabled?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function idEq(ownerId: number | string, candidate: unknown): boolean {
  return candidate !== undefined && candidate !== null && String(candidate) === String(ownerId);
}

/**
 * Condition per trigger so a skill only reacts to events involving its owner
 * (and, when known, its owning general instance). Without this, every DAMAGE
 * event on the table would fire every registered skill.
 */
function buildCondition(
  trigger: DataSkillTrigger,
  binding: SkillOwnerBinding
): (context: TriggerContext) => boolean {
  const { ownerId, skill } = binding;
  const generalId = skill.sourceGeneralId;
  const damageFilter = skill.damageTypeFilter;
  // v2.8.21 监听扩面刀：两维的缺省值都必须等于扩面前的逐字行为——
  // 不听别人的事（self）、只听攻击引起的目标（attack）。
  const scope = skill.listenerScope ?? 'self';
  const targetSource = skill.targetSource ?? 'attack';

  /** 「我听谁」的玩家那一层。`field` 档不比玩家键，但**事件必须带着这个键**：
   *  缺键＝这件事根本没落到某一位玩家身上（本营被攻击的 BEFORE_DAMAGE 就是这种），
   *  那是"没有受击者"，不是"受击者不是我"⇒ 三档都不响。这条保住了扩面前
   *  "打本营不会触发将领的受击类技能"那一既有事实。 */
  const playerMatches = (playerKey: unknown): boolean =>
    scope === 'field'
      ? playerKey !== undefined && playerKey !== null
      : idEq(ownerId, playerKey);

  /** 「我听谁」的将领那一层：只有 `self` 档认这一层（扩面门的严格写法——
   *  知道将Id 时键必须对得上，缺键＝对不上＝不响）。手牌／回合开始这类事件的键
   *  本来就只有玩家一维（将领不持牌），那里 `self` 与 `allySeat` 是同一件事。 */
  const generalMatches = (generalKey: unknown): boolean =>
    scope !== 'self' || !generalId || idEq(generalId, generalKey);

  /** 「这事是谁引起的」（v2.8.21 第二维）：读通知事件**已经记下**的那个字段，
   *  不在这里重新推断伤害数学。缺 `damageType`＝攻击结算那一条路（今日
   *  `BEFORE_DAMAGE` 的唯一生产者=`AttackResolver`，它不带这个字段）⇒ 记为攻击
   *  引起。技能指定目标的那一档由 #70/#71 的发射器显式带 `damageType:'skill'`。 */
  const sourceMatches = (data: Record<string, unknown>): boolean => {
    if (targetSource === 'any') return true;
    const kind = data.damageType === 'skill' ? 'skill' : 'attack';
    return kind === targetSource;
  };

  const identityCheck = (context: TriggerContext): boolean => {
    const data = asRecord(context.event.data);
    switch (trigger) {
      case 'onTurnStart':
        return playerMatches(data.playerId);
      case 'onDeploy': {
        if (!playerMatches(data.playerId)) return false;
        if (generalId && scope === 'self') {
          const deployedId = data.general && typeof data.general === 'object'
            ? getRuntimeCardId(data.general as never)
            : data.general === undefined ? '' : String(data.general);
          if (deployedId && deployedId !== String(generalId)) return false;
        }
        return true;
      }
      case 'onDamageTaken': {
        if (!playerMatches(data.targetPlayerId)) return false;
        if (!generalMatches(data.targetId ?? data.target)) return false;
        if (damageFilter && data.damageType !== damageFilter) return false;
        return true;
      }
      case 'onDamageDealt': {
        const action = asRecord(data.action);
        if (!playerMatches(action.playerId)) return false;
        if (generalId) {
          const payload = asRecord(action.payload);
          if (!generalMatches(payload.attackerId ?? action.attackerId)) return false;
        }
        // AFTER_DAMAGE is currently emitted only by attack resolution, so a
        // skill-damage filter can never match here (documented engine fact).
        if (damageFilter === 'skill') return false;
        if (damageFilter === 'attack' && data.damageType !== undefined && data.damageType !== 'attack') return false;
        return true;
      }
      case 'onKill': {
        if (!playerMatches(data.attackerPlayerId)) return false;
        if (!generalMatches(data.attackerId)) return false;
        return true;
      }
      case 'onDeath': {
        if (!playerMatches(data.targetPlayerId)) return false;
        if (!generalMatches(data.targetId)) return false;
        return true;
      }
      case 'onBecomingTarget': {
        // BEFORE_DAMAGE for a base attack carries no targetPlayerId, so the
        // owner check below legitimately never matches — being attacked as a
        // base is not "a general becoming a target"（`field` 档同样不响：那里
        // 缺的是"受击者"这个人，不是"受击者不是我"）。
        if (!playerMatches(data.targetPlayerId)) return false;
        if (!generalMatches(data.targetId ?? data.target)) return false;
        return sourceMatches(data);
      }
      case 'onCardLost':
      case 'onCardGained': {
        // Hands live on players, not general instances (same keying lesson
        // as DISCARD, 2.5.0): CARD_* keys the losing/gaining PLAYER only.
        // sourceGeneralId never narrows these triggers.
        if (!playerMatches(data.playerId)) return false;
        if (trigger === 'onCardLost' && skill.cardFilter && skill.cardFilter !== 'any') {
          // v2.6.2 emission-source predicates. The via/remainingHand facts
          // are recorded by the derivation itself (chainedConsequences), so
          // the condition reads settled truth rather than re-deriving it.
          const via = typeof data.via === 'string' ? data.via : '';
          if (skill.cardFilter === 'equipment') return via === 'EQUIP';
          if (!via || via === 'EQUIP') return false;
          if (skill.cardFilter === 'lastHand') {
            return typeof data.remainingHand === 'number' && data.remainingHand === 0;
          }
        }
        return true;
      }
      default:
        return false;
    }
  };

  // v2.7.3 gate conditions ride AFTER identity (先身份、再门槛). Pure predicate
  // over already-recorded facts, fail-closed, emits nothing by itself.
  return (context) => identityCheck(context) && evaluateSkillConditions(skill.conditions, {
    state: context.state,
    ownerId,
    sourceGeneralId: generalId,
    event: context.event,
  });
}

/**
 * Adapts data-driven skills into the Phase 5.24 TriggerEngine.
 * This is intentionally a bridge: imported skill data remains data,
 * while runtime ownership and trigger registration live in the engine.
 *
 * Effects are translated into canonical engine events:
 *   DRAW_CARD   → DRAW         { playerId, count }        (deck selection in EventProcessor)
 *   DAMAGE      → DAMAGE       { damageType: 'skill' }    (armor settlement in EventProcessor)
 *   HEAL        → HEAL         { targetPlayerId, targetId, value } (hp capped at maxHp)
 *   GAIN_ARMOR  → GAIN_ARMOR   { targetPlayerId, targetId, value } (armor points, no cards)
 *   DISCARD     → DISCARD      { playerId, count }        (2.5.0, hand move in EventProcessor;
 *                               count 0 = whole-hand sentinel; since 2.6.2 its settlement
 *                               derives CARD_LOST via='DISCARD' with remainingHand)
 *   GIVE        → GIVE         { fromPlayerId, toPlayerId, count } (2.5.3, hand-to-hand
 *                               transfer in EventProcessor; settlement derives the
 *                               CARD_LOST/CARD_GAINED notifications)
 *   EQUIP_STRIP → EQUIP_STRIP  { targetPlayerId, targetId, count } (2.6.0, general-keyed
 *                               armor-card strip in EventProcessor; since 2.6.2 its
 *                               settlement derives CARD_LOST via='EQUIP')
 *   REVEAL      → REVEAL       { viewerPlayerId, count } (2.6.1, pure observation —
 *                               settlement returns state unchanged, zero rngState)
 *   DECK_PLACE  → DECK_PLACE   { playerId, dest, count } (2.6.1, hand→deck mirror of GIVE;
 *                               dest defaults to BOTTOM, head-of-hand deterministic slice)
 */
export class SkillTriggerBridge {
  private registrations = new Map<string, string[]>();

  constructor(private readonly triggerEngine: TriggerEngine) {}

  registerSkill(binding: SkillOwnerBinding) {
    const eventType = TRIGGER_EVENT_MAP[binding.skill.trigger];
    if (!eventType) return [];

    const triggerId = `skill:${binding.ownerId}:${binding.skill.id}`;
    const unregister = this.triggerEngine.register({
      id: triggerId,
      eventType,
      priority: PRIORITY[binding.skill.trigger] ?? 0,
      enabled: binding.enabled !== false,
      ownerId: binding.ownerId,
      skillId: binding.skill.id,
      condition: buildCondition(binding.skill.trigger, binding),
      createEvents: (context) =>
        SkillTriggerBridge.createSkillEvents(binding, context.state, context.event)
    });

    const ownerKey = String(binding.ownerId);
    const ids = this.registrations.get(ownerKey) ?? [];
    ids.push(triggerId);
    this.registrations.set(ownerKey, ids);

    return [unregister];
  }

  registerSkills(ownerId: number | string, skills: DataSkillDefinition[]) {
    const unregisters: Array<() => void> = [];
    for (const skill of skills) {
      unregisters.push(...this.registerSkill({ ownerId, skill }));
    }
    return unregisters;
  }

  unregisterOwner(ownerId: number | string) {
    this.triggerEngine.unregisterByOwner(ownerId);
    this.registrations.delete(String(ownerId));
  }

  setSkillEnabled(ownerId: number | string, skillId: string, enabled: boolean) {
    return this.triggerEngine.setEnabled(
      `skill:${ownerId}:${skillId}`,
      enabled
    );
  }

  /** Effect translation — instance-free on purpose (2.3.1): the trigger path
   * and the explicit ACTIVATE_SKILL path must share ONE code, so this is a
   * static and TurnEndSkillResolver calls it directly rather than keeping a
   * second copy of the DRAW/DAMAGE/HEAL/GAIN_ARMOR translation.
   *
   * choiceMode (2.6.3): instead of one event per effect, a single
   * CHOICE_REQUIRED offer is emitted whose options are the SAME translated
   * events, one branch each — the player picks with CHOOSE_OPTION and the
   * chosen branch settles then ("延后结算时点=决策时点"). Deterministic by
   * construction: label + branch events are derived from state at trigger
   * time, zero RNG, and the choiceKey is composed like the rw: ids. */
  static createSkillEvents(
    binding: SkillOwnerBinding,
    state: EngineState,
    event: GameEvent
  ): GameEvent[] {
    const sourceId = String(binding.ownerId);

    const translateEffect = (
      effect: SkillEffectData,
      candidate?: ChoiceCandidate,
    ): GameEvent => {
      const targetId = candidate?.targetId
        ?? SkillTriggerBridge.resolveEffectTarget(effect, binding, event);
      const data = {
        sourceId,
        targetId,
        value: effect.value ?? 0,
        skillId: binding.skill.id,
        skillName: binding.skill.name,
        effectType: effect.type,
        triggerEventId: event.id
      };
      // A choice producer candidate names the exact hand cards to settle
      // (v2.7.2); every payload minted before this carries no cardKeys and
      // keeps the canonical head-of-hand slice.
      const handSelection = candidate?.cardKeys ? { cardKeys: candidate.cardKeys } : {};

      if (effect.type === 'DRAW_CARD') {
        // Card draw is always granted to the skill owner's hand.
        return {
          type: 'DRAW',
          data: {
            ...data,
            playerId: Number(sourceId),
            count: Math.max(1, Number(effect.value ?? 1))
          }
        };
      }

      if (effect.type === 'DAMAGE') {
        const targetRef = SkillTriggerBridge.findGeneralRef(state, targetId);
        return {
          type: 'DAMAGE',
          data: {
            ...data,
            sourcePlayerId: Number(sourceId),
            sourceGeneralId: binding.skill.sourceGeneralId,
            targetPlayerId: targetRef
              ? targetRef.player.id
              : SkillTriggerBridge.playerIdFromBase(targetId),
            targetId: targetId ?? data.targetId,
            damageType: 'skill',
            value: Math.max(1, Number(effect.value ?? 1))
          }
        };
      }

      if (effect.type === 'HEAL' || effect.type === 'GAIN_ARMOR') {
        const targetRef = SkillTriggerBridge.findGeneralRef(state, targetId);
        return {
          type: effect.type,
          data: {
            ...data,
            targetPlayerId: targetRef
              ? targetRef.player.id
              : SkillTriggerBridge.playerIdFromBase(targetId),
            targetId: targetId ?? data.targetId,
            value: Math.max(1, Number(effect.value ?? 1))
          }
        };
      }

      if (effect.type === 'DISCARD') {
        // Discards are keyed to a PLAYER (hands live on players), not to a
        // general instance — an attacker whose general already left the field
        // still owes the cards (断肠 settlement after a lethal hit).
        const eventData = asRecord(event.data);
        const role = effect.target ?? 'TARGET';
        const discardPlayerId = role === 'SELF'
          ? Number(sourceId)
          : role === 'ATTACKER'
            ? Number(eventData.sourcePlayerId ?? eventData.attackerPlayerId)
            : Number(eventData.targetPlayerId);
        return {
          type: 'DISCARD',
          data: {
            ...data,
            ...handSelection,
            playerId: Number.isFinite(discardPlayerId) ? discardPlayerId : undefined,
            count: Math.max(0, Math.floor(Number(effect.value ?? 1)))
          }
        };
      }

      if (effect.type === 'GIVE') {
        // Mirror of DISCARD (2.5.3): the giver is always the skill owner's
        // PLAYER (hands live on players); the receiver is resolved from the
        // effect's target role against the triggering event, same role table
        // as above. Same-player / dead-receiver / empty-hand cases settle as
        // honest no-ops inside applyGiveEvent — the GIVE event still records
        // that the trigger fired.
        const eventData = asRecord(event.data);
        const role = effect.target ?? 'TARGET';
        const toPlayerId = role === 'SELF'
          ? Number(sourceId)
          : role === 'ATTACKER'
            ? Number(eventData.sourcePlayerId ?? eventData.attackerPlayerId)
            : Number(eventData.targetPlayerId);
        return {
          type: 'GIVE',
          data: {
            ...data,
            ...handSelection,
            fromPlayerId: Number(sourceId),
            toPlayerId: Number.isFinite(toPlayerId) ? toPlayerId : undefined,
            count: Math.max(0, Math.floor(Number(effect.value ?? 1)))
          }
        };
      }

      if (effect.type === 'EQUIP_STRIP') {
        // EQUIP_STRIP (2.6.0) is keyed to a GENERAL, not a player: equipment
        // lives on the field general as armorCards. The victim's player is
        // recovered from the resolved general id via findGeneralRef (the
        // AFTER_DAMAGE payload carries no targetPlayerId — same lesson that
        // makes GIVE TARGET spin there). A general already off-field (killed
        // by the source hit) settles as an honest no-op downstream.
        const targetRef = SkillTriggerBridge.findGeneralRef(state, targetId);
        return {
          type: 'EQUIP_STRIP',
          data: {
            ...data,
            targetPlayerId: targetRef?.player.id,
            targetId: targetId ?? data.targetId,
            count: Math.max(1, Math.floor(Number(effect.value ?? 1))),
          },
        };
      }

      if (effect.type === 'REVEAL') {
        // REVEAL (2.6.1, deck-top capability layer): pure observation keyed to
        // the skill OWNER's player (who looks). It never mutates state and
        // consumes no rngState — settlement returns state unchanged; the event
        // is recorded so the log/HUD shows the look happened.
        return {
          type: 'REVEAL',
          data: {
            ...data,
            viewerPlayerId: Number(sourceId),
            count: Math.max(0, Math.floor(Number(effect.value ?? 1)))
          }
        };
      }

      if (effect.type === 'DECK_PLACE') {
        // DECK_PLACE (2.6.1, deck-top capability layer): hand→deck mirror of
        // GIVE, keyed to the skill OWNER's player (whose hand is detached and
        // re-attached onto the deck). dest defaults to BOTTOM (the dominant
        // "place under the deck" semantic); TOP is carried when the runtime
        // payload sets it. Empty-hand settles as an honest no-op downstream.
        return {
          type: 'DECK_PLACE',
          data: {
            ...data,
            ...handSelection,
            playerId: Number(sourceId),
            dest: effect.dest === 'TOP' ? 'TOP' : 'BOTTOM',
            count: Math.max(0, Math.floor(Number(effect.value ?? 1)))
          }
        };
      }

      if (effect.type === 'DUEL') {
        // DUEL (2.8 刀9, §H5-6＋§H9): the bridge only NAMES the two
        // participants — it emits no DAMAGE here, because the round plan has
        // to read post-settlement state and must run to completion without
        // anything cutting in. A-side (first strike) is always the owner's
        // general; B-side uses the usual target-role table, so a skill can
        // duel the general it acts on (and SELF resolves to the owner's own
        // general = "自己不能和自己决斗" → honest no-op downstream).
        const targetRef = SkillTriggerBridge.findGeneralRef(state, targetId);
        return {
          type: 'DUEL',
          data: {
            ...data,
            sourcePlayerId: Number(sourceId),
            sourceGeneralId: binding.skill.sourceGeneralId,
            targetPlayerId: targetRef?.player.id,
            targetId: targetId ?? data.targetId,
          },
        };
      }

      return {
        type: 'CUSTOM',
        data: { ...data, kind: effect.type }
      };
    };

    if (binding.skill.choiceMode) {
      const options = SkillTriggerBridge.buildChoiceOptions(
        binding, state, sourceId, event, translateEffect);
      // An empty candidate set never opens an offer: the frozen-world gate
      // would lock the table with nothing legal to pick, so "the trigger
      // happened but there was nothing to choose" stays event-free by design.
      // 刀2 (v2.8.11) 同一契约的另一半：所有分支都不过逐项门槛⇒同样不开窗
      // （没有一项可选的开窗就是死桌）。[完整]提示模式要在这种时点也停下来
      // 问一次，那是 #42 的口径，需要显式的「都不发动」出口。
      if (options.length === 0) return [];
      const choiceData = {
        choiceKey: `ch:${state.turn ?? 0}:${state.round ?? 0}:${binding.skill.id}`,
        chooserPlayerId: Number(sourceId),
        options,
        skillId: binding.skill.id,
        skillName: binding.skill.name,
      };
      return [{ type: 'CHOICE_REQUIRED', data: choiceData }];
    }

    return binding.skill.effects.map(effect => translateEffect(effect));
  }

  /**
   * choice 生产者面 (v2.7.2, GPT 三检 Q5 minimal verification cut): where the
   * candidate table comes from.
   *
   *  - `choiceSource` unset (every definition the compiler can produce today):
   *    v2.6.3 verbatim — one option per pre-translated effect branch.
   *  - 'TARGET' / 'HAND_CARD': one option per candidate enumerated from
   *    EngineState, each carrying the definition's SINGLE template effect with
   *    that candidate filled in (targetId / cardKeys). A producer definition
   *    with anything other than exactly one effect falls back to the
   *    effect-branch behavior — dropping effects silently would be worse than
   *    not offering a pick.
   *
   * Translation stays in one place: both shapes call the same translateEffect
   * closure handed in by createSkillEvents (no second translation path).
   *
   * v2.8.11 刀2 逐项门槛（用户口径①③）：**整组门槛已经在外面判过**
   * （`buildCondition` ⇒ 定义级 conditions，不过则根本不造事件），这里只判
   * 挂在每条效果/模板上的那一级。求值用同一个纯函数 skillConditions，
   * 求不出⇒不响（失败即闭）。不过门槛的分支**不删**，而是留下并标
   * `enabled:false` + `gateText`（置灰可见、写明原因）；全都不过⇒不开窗
   * （可选项为零的冻结世界=死桌，与空候选集同一契约）。
   */
  private static buildChoiceOptions(
    binding: SkillOwnerBinding,
    state: EngineState,
    sourceId: string,
    event: GameEvent,
    translate: (effect: SkillEffectData, candidate?: ChoiceCandidate) => GameEvent,
  ): PendingChoiceOption[] {
    const { effects, choiceSource } = binding.skill;
    const template = choiceSource && effects.length === 1 ? effects[0] : undefined;
    const options = !template
      ? effects.map(effect => ({
        label: effect.description ?? binding.skill.description ?? binding.skill.name,
        events: [translate(effect)],
        gate: effect.conditions,
      }))
      : (choiceSource === 'TARGET'
        ? enumerateTargetCandidates(state, Number(sourceId), binding.skill.choiceTargetScope)
        : enumerateHandCardCandidates(state, Number(sourceId))
      ).map(candidate => ({
        label: candidate.label,
        events: [translate(template, candidate)],
        gate: template.conditions,
      }));

    const marked = options.map(option => {
      if (!option.gate || option.gate.length === 0) return { label: option.label, events: option.events };
      if (evaluateSkillConditions(option.gate, {
        state,
        ownerId: Number(sourceId),
        sourceGeneralId: binding.skill.sourceGeneralId,
        event,
      })) {
        return { label: option.label, events: option.events };
      }
      return {
        label: option.label,
        events: option.events,
        enabled: false as const,
        gateText: gateConditionsToText(option.gate),
      };
    });
    return marked.some(option => option.enabled !== false) ? marked : [];
  }

  /**
   * Resolves which entity an effect applies to, based on the effect's declared
   * target role relative to the triggering event:
   *   SELF     → the owning general (falls back to the owner player id)
   *   ATTACKER → the attacker general of the source event
   *   TARGET   → the victim/general referenced by the source event
   */
  private static resolveEffectTarget(
    effect: SkillEffectData,
    binding: SkillOwnerBinding,
    event: GameEvent
  ): string | undefined {
    const data = asRecord(event.data);
    const role = effect.target ?? 'TARGET';

    if (role === 'SELF') {
      return binding.skill.sourceGeneralId ?? String(binding.ownerId);
    }
    if (role === 'ATTACKER') {
      const action = asRecord(data.action);
      const payload = asRecord(action.payload);
      const attacker = data.sourceGeneralId ?? data.attackerId ?? payload.attackerId ?? action.attackerId;
      return attacker === undefined ? undefined : String(attacker);
    }

    const value = data.targetId ?? data.target ?? data.victimId;
    return value === undefined ? undefined : String(value);
  }

  private static findGeneralRef(state: EngineState, generalId?: string) {
    if (!generalId) return null;
    for (const player of state.players) {
      const fieldGenerals = Array.isArray(player.fieldGenerals)
        ? player.fieldGenerals as Array<Record<string, unknown>>
        : [];
      const found = fieldGenerals.find(fg =>
        getRuntimeCardId(fg?.general as never) === String(generalId));
      if (found) return { player, general: found };
    }
    return null;
  }

  private static playerIdFromBase(targetId?: string): number | undefined {
    if (!targetId || !targetId.startsWith('base_')) return undefined;
    const parsed = Number(targetId.slice('base_'.length));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
