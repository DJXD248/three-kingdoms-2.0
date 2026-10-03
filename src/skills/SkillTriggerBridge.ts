
import type { DataSkillDefinition, DataSkillTrigger, SkillEffectData } from './dataTypes';
import type { EngineState, PendingChoiceOption } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type { TriggerEngine } from '../triggers/TriggerEngine';
import type { TriggerContext } from '../triggers/types';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { capDamageToBase } from '../core/baseDamage';
import { evaluateSkillConditions } from './skillConditions';
import { gateConditionsToText } from './skillGateText';
import { matchesSkillEvent } from './skillEventMatch';
import { eventsHeardBy, isReactionTrigger } from './reactionTriggers';
import {
  enumerateHandCardCandidates,
  enumerateTargetCandidates,
  type ChoiceCandidate,
} from './choiceCandidates';

/**
 * 「这一型听哪几一声」不在这里写第二份——唯一一份表在
 * `skills/reactionTriggers.ts` 的 `TRIGGER_EVENTS`，问答路与自动路同读它
 * （v2.8.25 强制发动执法刀：两处各写一份时，打了「强制发动」的受伤技听不到
 * 决斗收官那一声，而不强制的照常被问到）。
 */

/** 档位表（只给档，同档内先后由 `triggers/reactionOrder.ts` 决定）。导出是给
 * 响应链候选枚举用同一份档——两处各写一份迟早分叉。 */
export const PRIORITY: Partial<Record<DataSkillTrigger, number>> = {
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

/**
 * 注册面的**分流开关**（§H9 第九轮 a/c 三类分流，v2.8.22 响应链执法刀）。
 * true＝这枚定义**不进触发链**：它听的那一声（受击／受伤）改成走响应链问答
 * 队列——候选由 `skills/reactionChain.ts` 从 EngineState 枚举，发动经 canonical
 * `ACTIVATE_SKILL`、不发动经 canonical `SKIP_REACTION`。形态与 `onTurnEnd`
 * 故意缺席 `TRIGGER_EVENTS` 一模一样（**同一枚技能绝不允许既自动响又问**）。
 *
 * `forced`（强制发动）＝"满足触发条件与代价后直接响、不用玩家点头"（§H9 用户
 * 更正 c 条），所以它留在自动路上；该字段此前只活在录入面、结算侧零消费
 * （§12-55），本刀起它是唯一的自动发动开关。其余触发型一字未动。
 */
export function defersToReactionQueue(skill: DataSkillDefinition): boolean {
  // choiceMode 技能不进反应队列，直接开选择账
  if ((skill as unknown as Record<string, unknown>).choiceMode === true) return false;
  return isReactionTrigger(skill.trigger) && skill.forced !== true;
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
  // v2.8.22：身份那一层搬进 `skillEventMatch.ts`——触发链与响应链候选必须逐字
  // 同意"这事是不是发生在我身上"，两处各写一份迟早分叉（一响一不响最难查）。
  // v2.7.3 gate conditions ride AFTER identity (先身份、再门槛). Pure predicate
  // over already-recorded facts, fail-closed, emits nothing by itself.
  return (context) => matchesSkillEvent(trigger, binding, context.event) && evaluateSkillConditions(skill.conditions, {
    state: context.state,
    ownerId,
    sourceGeneralId: skill.sourceGeneralId,
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
 *   MODIFY_STAT → STAT_MODIFY  { op:'ADD', modifier } (v2.8 刀4 #25, writes the stat
 *                               ledger — no card moves, no hp moves; the entry's own
 *                               id/seq are minted by the processor from the ledger)
 * `passive`-triggered definitions never come through this class at all: they are not
 * in TRIGGER_EVENTS, and skills/passiveModifiers.ts is their only writer.
 */
export class SkillTriggerBridge {
  private registrations = new Map<string, string[]>();

  constructor(private readonly triggerEngine: TriggerEngine) {}

  registerSkill(binding: SkillOwnerBinding) {
    // v2.8.22 响应链执法刀：受击／受伤两型的非 forced 定义**根本不注册**到触发
    // 链上——它们改走响应链问答（`skills/reactionChain.ts`），发动经 canonical
    // `ACTIVATE_SKILL`。不注册的形态与 `onTurnEnd` 故意缺席 `TRIGGER_EVENTS`
    // 同一条纪律：同一枚技能绝不允许既自动响又停下来问。
    if (defersToReactionQueue(binding.skill)) return [];
    // v2.8.25 强制发动执法刀：一型可以听好几声（「受到伤害后」＝普通伤害＋决斗
    // 收官那笔累计受伤），所以逐个事件各注册一次。第一枚的 id 保持原样
    // （`skill:<席>:<定义>`）⇒既有单事件技能在触发链／事件流里的读数逐字不变，
    // 只有真需要多听一声的定义才多出带事件名后缀的那一枚。
    const eventTypes = eventsHeardBy(binding.skill.trigger);
    if (eventTypes.length === 0) return [];

    const ownerKey = String(binding.ownerId);
    const unregisters: Array<() => void> = [];
    const ids = this.registrations.get(ownerKey) ?? [];

    eventTypes.forEach((eventType, index) => {
      const triggerId = index === 0
        ? `skill:${binding.ownerId}:${binding.skill.id}`
        : `skill:${binding.ownerId}:${binding.skill.id}#${eventType}`;
      const unregister = this.triggerEngine.register({
        id: triggerId,
        eventType,
        priority: PRIORITY[binding.skill.trigger] ?? 0,
        enabled: binding.enabled !== false,
        ownerId: binding.ownerId,
        skillId: binding.skill.id,
        // 顺序比较器要按"这一员"分组（同席位内挨打的那一员先表态），故把将领实例
        // id 一并带到 trigger 上；读法与 `generalMatches` 用的同一个键。
        generalId: binding.skill.sourceGeneralId,
        condition: buildCondition(binding.skill.trigger, binding),
        createEvents: (context) =>
          SkillTriggerBridge.createSkillEvents(binding, context.state, context.event)
      });
      unregisters.push(unregister);
      ids.push(triggerId);
    });

    this.registrations.set(ownerKey, ids);

    return unregisters;
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
        // 指不出将领、却能解出席位 ⇒ 这一笔打的是本营（`base_<座次>`）。
        const baseTargetPlayerId = targetRef
          ? undefined
          : SkillTriggerBridge.playerIdFromBase(targetId);
        const rawValue = Math.max(1, Number(effect.value ?? 1));
        return {
          type: 'DAMAGE',
          data: {
            ...data,
            sourcePlayerId: Number(sourceId),
            sourceGeneralId: binding.skill.sourceGeneralId,
            targetPlayerId: targetRef
              ? targetRef.player.id
              : baseTargetPlayerId,
            targetId: targetId ?? data.targetId,
            damageType: 'skill',
            // 「封」（§12-96）：技能伤害打本营同样单次最多 1 点，与普攻取的是
            // 同一个发射点常量。打将领那一支照卡面数值，不受影响。
            value: baseTargetPlayerId === undefined
              ? rawValue
              : capDamageToBase(rawValue),
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

      if (effect.type === 'MODIFY_STAT' && effect.stat && effect.modifyMode) {
        // MODIFY_STAT (v2.8 刀4 #25)：既不改卡面也不扣血，只往**修正器账本**上落一笔
        // （读数点在别处现算：近战/远程攻击力与体力上限）。编译器已经把三样
        // （改哪个数、哪种形态、数值）验齐才让走到这里，缺一样就落到下面那条
        // CUSTOM（"响过但无可结算"，与所有未支持类型同一口径）。
        // 目标角色被编译器强制为 SELF ⇒ "被改的那一位"就是技能拥有者自己这一员：
        // 账本的两个键（座次＋将领实例）一律从 binding 取，绝不从触发事件里猜
        // （跨将目标是 #28 刀7 的口径，今天没有那条路）。
        const ownerGeneralId = String(binding.skill.sourceGeneralId ?? targetId ?? sourceId);
        return {
          type: 'STAT_MODIFY',
          data: {
            ...data,
            op: 'ADD' as const,
            modifier: {
              key: effect.stat,
              mode: effect.modifyMode,
              value: Number(effect.value ?? 0),
              targetPlayerId: Number(sourceId),
              targetId: ownerGeneralId,
              ownerPlayerId: Number(sourceId),
              ownerGeneralId,
              ownerSkillId: binding.skill.id,
              ownerSkillName: binding.skill.name,
              // 锁定技徽章（编译面只在真有 MODIFY_STAT 时才落这个键）。
              locked: binding.skill.locked === true,
              // 这一路是**发动**落笔（登场/回合开始/受击……），不是在场持续：
              // 在场那半由 skills/passiveModifiers.ts 单点来写，周期＝在场本身。
              passive: false,
              expire: effect.duration,
            },
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
