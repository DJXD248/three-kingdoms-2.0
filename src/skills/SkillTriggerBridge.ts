
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
import { activationRecordEvent, limitedQuotaAvailable } from './skillQuota';
import { eventsHeardBy } from './reactionTriggers';
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
  // v2.9.19 营地两格刀：与「成为目标时」同一档——它们是同一个"伤害还没落"的那一层，
  // 只是主语从"哪一员将"换成"哪家营地"。档位只给先后，同档内顺序仍由
  // `triggers/reactionOrder.ts` 那一份比较器决定。
  onBaseTargetedAtk: 50,
  onBaseTargetedSkill: 50,
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
 * 注册面的**分流开关**（§H9 第九轮 a/c 三类分流，v2.8.22 响应链执法刀立，
 * **v2.9.16 询问制刀反转**）。
 *
 * 判据只有一句：**凡是到点需要主人点头的发动，都停下来问；只有两型例外。**
 * 用户 2026-10-20 裁决原文＝「在场即生效和强制发动不问。勾选了强制发动的觉醒技不问」，
 * 与同日先前那句「技能触发后需不需要玩家响应发动，是由技能本身决定的，只有强制发动的
 * 技能才会自己直接发动不问玩家」是同一根轴——**问不问由技能自己说了算，不由时机说了算**。
 * 所以这一句不再认"哪一声"，只认这一枚定义自己身上的两个字段：
 *  - `forced`（强制发动）＝满足触发条件与代价后直接响、不用点头⇒不问；
 *  - `passive`（在场即生效）＝压根不是一次"发动"⇒问它没有意义（它也不在事件面上，
 *    唯一的写手是 `skills/passiveModifiers.ts`）；
 *  - `choiceMode`（择一）＝它到点开的是**自己的选择账**（玩家在那一扇窗里挑哪一支），
 *    已经是"停下来问"，只是问法不是是/否⇒本刀一字不动（§H9 择一契约）。
 * 余下全部触发型一律进问答路：**同一枚技能绝不允许既自动响又问**（不注册的形状与
 * `onTurnEnd` 故意缺席 `TRIGGER_EVENTS` 同一套纪律——回合结束那一格本来就永远问，
 * 走的是 `skills/turnEndSkills.ts` 那扇自己的窗，不进这条队列）。
 *
 * 「觉醒技」徽章从本刀起**不再单独享有"必问"特权**：它以前是第二族（v2.9.3 刀B），
 * 而反转后它的每一型非强制定义本来就要问，打了强制发动的那一枚则照用户的裁决不问。
 * 因此这里既不再读 `awakening`，也不再读时机名单。
 */
export function defersToReactionQueue(skill: DataSkillDefinition): boolean {
  // choiceMode 技能不进反应队列，直接开选择账
  if ((skill as unknown as Record<string, unknown>).choiceMode === true) return false;
  // 「强制发动」＝不用点头⇒压根不该停下来问
  if (skill.forced === true) return false;
  // 「在场即生效」＝人在就算，不是一次发动⇒没有"要不要发动"可问
  if (skill.trigger === 'passive') return false;
  // 其余一律问：这一型在事件面上有声可听⇒开格、停下、等表态
  return eventsHeardBy(skill.trigger).length > 0;
}

/**
 * 发动那一刻的**在场资格**（用户 2026-10-03 裁决：「将领不在场上不能发动技能，被砍死了
 * 不算在场上，能发动就是空发，就算是『强制发动』不能发动」）。
 *
 * 只补自动发动路这一边：问答路结构性成立（`reactionChain.collectListeners` 的候选只扫
 * 在场将，唯一的例外是「自身阵亡时」那一格——它去坟场取**这一声刚死掉的那一员**，别的
 * 时机一律不看坟场），两条路读的是同一句判据＝**发动那一刻主人还在不在场**。放在最前面
 * （先于身份与门槛）＝主人已离场时连"响了一声"那条事件都不发，账上绝不留下空发。
 *
 * 这里是**唯一的**执法点（v2.8.31 定义封口刀把 v2.8.30 那半把结算侧的闸拆了）：用户
 * 2026-10-04 把两型定义封死后，"这一刀整个算完之后再看主人在不在场"对**受击**那一型是
 * 错的——它按定义在伤害计算之前就发动完了，和这一刀打死谁无关。拆开之后判据反而更简单：
 * 每一型只在**它自己该响的那一刻**问一次"主人还在不在场"，而发射点天然就在那一刻。
 *
 * **豁免＝「自身阵亡时」那一型**（`onDeath`＝遗言／遗计，官方账里四张将在用）：它按定义就在
 * 主人离场那一刻响，掐掉它等于把一条既有裁决判成空发。
 */
export function ownerCanActivate(
  skill: DataSkillDefinition,
  state: EngineState,
  ownerId: string | number,
): boolean {
  if (skill.trigger === 'onDeath') return true;
  const generalId = skill.sourceGeneralId;
  // 数据技能一律带主人 id（`skillCompiler.compileGeneralSkills` 落笔）；不带的那是引擎内部
  // 触发，不属于本案，照旧放行。
  if (!generalId) return true;
  const owner = state.players.find(player => String(player.id) === String(ownerId));
  return (owner?.fieldGenerals ?? []).some(fg =>
    getRuntimeCardId((fg as { general?: unknown }).general as never) === String(generalId));
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
  return (context) => ownerCanActivate(skill, context.state, ownerId)
    && matchesSkillEvent(trigger, binding, context.event)
    // v2.8.32 限定技额度：额度是**账本事实**，与门槛（战场事实）分列两处判，读同一
    // 个判定函数＝三条路加界面四处同判据。fail-closed、自身不发事件。
    && limitedQuotaAvailable(context.state, skill, context.quotaSpent) && evaluateSkillConditions(skill.conditions, {
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
    // v2.8.22 立、v2.9.16 询问制刀反转：凡是**没打「强制发动」且不是「在场即生效」**
    // 的定义，一律**根本不注册**到触发链上——它们改走响应链问答（`skills/reactionChain.ts`），
    // 发动经 canonical `ACTIVATE_SKILL`。不注册的形态与 `onTurnEnd` 故意缺席
    // `TRIGGER_EVENTS` 同一条纪律：同一枚技能绝不允许既自动响又停下来问。
    if (defersToReactionQueue(binding.skill)) return [];
    // v2.8.25 强制发动执法刀：一型可以听好几声，所以逐个事件各注册一次。第一枚的 id
    // 保持原样（`skill:<席>:<定义>`）⇒既有单事件技能在触发链／事件流里的读数逐字不变，
    // 只有真需要多听一声的定义才多出带事件名后缀的那一枚。今天表里每一型各一声，
    // 这一圈因此恒只跑一次——留着是因为"哪一型听几声"由那张表说了算，这里不假设。
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
        createEvents: (context) => {
          const effectEvents = SkillTriggerBridge.createSkillEvents(binding, context.state, context.event);
          // v2.9.15 乙档刀：这一笔从本刀起**每次真发动都落**（旧名 `limitedActivationEvent`，
          // 那时只有带额度的定义出声）。带额度的照旧进台账，其余是不进台账的纯通知⇒
          // 既有那些"带额度的那一身"逐字不变。空发仍不出声＝裁决④"没发动成功不消耗"。
          // `viaActivation`＝这一声是替「其他将领技能发动时」那一声而响的⇒同一格不许再响
          // 第二层（防套娃），键只在这一句为真时出现。
          const activation = activationRecordEvent(binding.skill, {
            playerId: binding.ownerId,
            generalId: binding.skill.sourceGeneralId ?? '',
            turn: context.state.turn ?? 0,
            viaActivation: context.event.type === 'SKILL_ACTIVATED',
          }, effectEvents.length);
          if (!activation) return effectEvents;
          // 当场把额度键记进**这条链**的已用集合：整条展开读的是落账前的同一个 state，
          // 不记这一笔就有"一条链上两声命中、技能结两遍而台账只扣一次"的洞（v2.8.32）。
          if (binding.skill.limitKey) context.quotaSpent?.add(binding.skill.limitKey);
          return [activation, ...effectEvents];
        },
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
        triggerEventId: event.id,
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
        // 指不出将领、却能解出席位 ⇒ 这一笔打的是营地（`base_<座次>`）。
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
            // 「封」（§12-96）：技能伤害打营地同样单次最多 1 点，与普攻取的是
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
              // 生效场合（2.9.4）：只在真填了时才有这个键——账本笔会进 state、进录像，
              // 多一个 `occasion: undefined` 就是两锚逐字节比对的雷。
              ...(effect.occasion !== undefined ? { occasion: effect.occasion } : {}),
            },
          },
        };
      }

      if (effect.type === 'GAIN_SKILL' && effect.gainedSkill) {
        // GAIN_SKILL（2.9.3 刀A「获得技能」）：这是引擎里**唯一**会改卡面的一型——
        // 与 MODIFY_STAT 正好互补（那个只动账本、卡面一字不改）。它不动任何数字、
        // 不掉血、不搬牌，只往那一员将的技能表上追加一枚技能，于是下一次重编译
        // 就听得见它（本项目没有"技能表缓存"：每次发动前都从 EngineState 现算）。
        // 名字早在编译器就解析好了（`effect.gainedSkill`，唯一解析点
        // `skills/skillNameIndex.ts`）；解析不出来的名字走不到这一行，它是一条
        // 点名的 skipped。目标被编译器强制为 SELF ⇒ 拿到技能的永远是发动者自己这一员，
        // 两键一律从 binding 取，绝不从触发事件里猜（与 MODIFY_STAT 同一口径）。
        const ownerGeneralId = String(binding.skill.sourceGeneralId ?? targetId ?? sourceId);
        return {
          type: 'SKILL_GAINED',
          data: {
            ...data,
            // `data.skillName` 是**给技能的**那一枚（如「单骑」），不是被拿到那枚的
            // 名字——后者在 `skill.name` 里。两个键各有其主，别把它们读成同一个。
            playerId: Number(sourceId),
            generalId: ownerGeneralId,
            skill: effect.gainedSkill,
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

    // v2.8.x 链式若-则：effects 顺序翻译，前一个失败 ⇒ 后续全部丢弃。
    // "失败"定义为：该效果的 translateEffect 产出的事件引用了不存在的目标（
    // targetRef=null 且不是营地/玩家级操作）或纯只读事件（REVEAL/DECK_PLACE/GIVE 等
    // 在目标不存在时仍产出事件但下游结算为空操作）。我们用 findGeneralRef 检查通用目标——
    // 找不到 ≠ 营地/玩家操作即视为空操作候选，链在此断裂。
    if (binding.skill.effectChain) {
      const result: GameEvent[] = [];
      let chainBroken = false;
      for (let i = 0; i < binding.skill.effects.length; i++) {
        if (chainBroken) break;
        const testEvent = translateEffect(binding.skill.effects[i]);
        // REVEAL 和 DECK_PLACE 是纯观察/无状态操作——永远成功、不折断链。
        if (testEvent.type === 'REVEAL' || testEvent.type === 'DECK_PLACE') {
          result.push(testEvent);
          continue;
        }
        // GIVE / DISCARD 是玩家级操作、不需要将领参照——只要 player id 合法就成立。
        if (testEvent.type === 'GIVE' || testEvent.type === 'DISCARD') {
          result.push(testEvent);
          continue;
        }
        // 其余类型（DAMAGE / HEAL / GAIN_ARMOR / EQUIP_STRIP / DUEL / STAT_MODIFY /
        // SKILL_GAINED / CUSTOM）需要目标存在才为有效。指不出目标 ⇒ 空操作 ⇒ 链断。
        // （SKILL_GAINED 的目标被强制成 SELF＝发动者自己，在场⇒天然成立；写进这一支
        // 而不是上面那两条豁免，是因为"豁免"的含义是"根本不看向不向着某一位"。）
        const targetId = (testEvent.data as Record<string, unknown>).targetId as string | undefined;
        const targetRef = SkillTriggerBridge.findGeneralRef(state, targetId);
        const isBaseTarget = targetId?.startsWith('base_');
        if (targetRef || isBaseTarget) {
          result.push(...SkillTriggerBridge.mintBaseTargetNotices([testEvent]));
        } else {
          // 找不到目标也不是营地⇒这一效果是空操作，链断开，后续效果不翻译。
          chainBroken = true;
        }
      }
      return result;
    }

    return SkillTriggerBridge.mintBaseTargetNotices(
      binding.skill.effects.map(effect => translateEffect(effect)),
    );
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
        events: SkillTriggerBridge.mintBaseTargetNotices([translate(effect)]),
        gate: effect.conditions,
      }))
      : (choiceSource === 'TARGET'
        ? enumerateTargetCandidates(state, Number(sourceId), binding.skill.choiceTargetScope)
        : enumerateHandCardCandidates(state, Number(sourceId))
      ).map(candidate => ({
        label: candidate.label,
        events: SkillTriggerBridge.mintBaseTargetNotices([translate(template, candidate)]),
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

  /**
   * 「营地成为技能目标时」那一拍（v2.9.19 营地两格刀）：技能要打**哪家**营地，
   * 在伤害落下之前先喊一声。四句话：
   *  ‧ **形状与普攻的 declare 那一拍同一身**——`BEFORE_DAMAGE` ＋ `isBase:true` ＋
   *    `targetPlayerId` ＋ `damageType:'skill'`（攻击那一拍带的是缺省的攻击档）。
   *    两格读的键、两格分"攻击／技能"族的判据因此在 `skillEventMatch.ts` 里只有
   *    一份写法，不造第二种事件、不造第二根轴。
   *  ‧ **纯通知**：`BEFORE_DAMAGE` 在 EventProcessor 里没有分支⇒零状态位移；伤害数值
   *    照旧由紧跟其后那条 `DAMAGE` 结算，这一声只是"当刻读到的那份事实"。
   *  ‧ **只补打营地的那一笔**：打将领那一身自 2.3.0 起由攻击/决斗各自的那一声负责，
   *    本刀一字不动（动了就要重数全部事件流断言，而这一刀不需要）。
   *  ‧ **只补伤害那一格**：回复／护甲打在营地上不喊这一声——「成为技能目标」按定义
   *    是"这一下要落下来了"，与它后面那一格「营地受到伤害时」（真掉血才响）分前后两拍。
   *  问人那一侧的已知边界（本轮如实登记）：这一声不在延后结算的那套机制里（普攻的
   *  `attackKey`／决斗的 `duelKey` 各有自己的续跑环），所以**没打「强制发动」的这一格
   *  要到伤害落完才问**；打了「强制发动」的照旧在同一趟自动路里响。
   */
  private static mintBaseTargetNotices(events: GameEvent[]): GameEvent[] {
    const out: GameEvent[] = [];
    for (const event of events) {
      if (event.type === 'DAMAGE') {
        const data = asRecord(event.data);
        const baseSeat = SkillTriggerBridge.playerIdFromBase(
          typeof data.targetId === 'string' ? data.targetId : undefined);
        if (baseSeat !== undefined) {
          out.push({ type: 'BEFORE_DAMAGE', data: { ...data, targetPlayerId: baseSeat, isBase: true } });
        }
      }
      out.push(event);
    }
    return out;
  }
}
