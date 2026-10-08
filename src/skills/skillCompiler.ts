/**
 * Skill compiler — the single gateway from game data (data/generals.ts Skill
 * configurations, including DIY-edited skills) into the canonical runtime
 * model consumed by SkillTriggerBridge/TriggerEngine inside GameEngine.
 *
 * Convergence rules (Phase 5 skill uniqueness):
 *   - Only skills with a structured runtime effect payload are compiled.
 *     Built-in generals keep descriptive text only, so nothing fires until a
 *     designer attaches real numbers — the compiler never invents gameplay.
 *   - Only the event-backed triggers are supported; the remaining
 *     trigger kinds (modify*, onBase*, active*, untilExpire, …) are
 *     skipped with an explicit reason. onTurnEnd (2.3.1) is the exception
 *     that proves the rule: it compiles, but NEVER auto-fires — TURN_END is
 *     deliberately absent from TRIGGER_EVENTS, and its sole activation
 *     path is the canonical ACTIVATE_SKILL action (ask-window driven).
 *     `passive` (v2.8 刀4 #25) is the second exception: it compiles into a
 *     `passive:true` definition that is deliberately NOT in the event-hearing
 *     map (matchesSkillEvent default=false ⇒ structurally cannot "fire"), and
 *     its sole consumer is skills/passiveModifiers.ts.
 *   - HEAL / GAIN_ARMOR settle in EventProcessor as hp restore (capped at
 *     maxHp) and armor points; DISCARD (2.5.0) settles as a hand-card move
 *     (resources to the discard pile, general cards back to the owner's
 *     pool); GIVE (2.5.3) settles as a deterministic hand-to-hand transfer and
 *     derives the CARD_LOST/CARD_GAINED notification events its new triggers
 *     listen to; EQUIP_STRIP (2.6.0) settles as a deterministic detach from a
 *     field general's armorCards (the project's only equipment surface) with
 *     one armor point deducted per detached card; MODIFY_STAT (v2.8 刀4 #25)
 *     settles as a write into the canonical stat ledger
 *     (core/statModifiers.ts) — it moves no card and deals no damage, and the
 *     three keys wired today (近战攻击/远程攻击/体力上限) resolve on SELF only.
 *     effect types beyond the eight supported ones are still skipped rather
 *     than emitting no-op
 *     events.
 *   - effectMode 'choice' (2.6.3): effects sharing one trigger signature
 *     compile into a SINGLE choiceMode definition — the bridge translates it
 *     into CHOICE_REQUIRED with one option per effect and the player picks
 *     through the canonical CHOOSE_OPTION action. A choice skill whose
 *     runtime effects sit on different triggers degenerates honestly into
 *     independent definitions (nothing to choose between at one moment).
 *   - 门槛 (2.8.3, 刀 B; 2.8.11, 刀 2): per-effect `conditions` are passed
 *     straight through onto the compiled definition — the evaluator
 *     (skills/skillConditions.ts) and both consumers (SkillTriggerBridge /
 *     turnEndSkills) already existed since 2.7.3, so that cut added input
 *     surface, not gameplay. 刀 2 gives a choice group its two levels: the
 *     skill-level 整组门槛 lands on the definition's single conditions slot
 *     (evaluated before any option is built), and each effect carries its own
 *     逐项门槛 so the offer can grey out — with the reason visible — the
 *     branches that do not meet their gate (用户 2026-09-29 口径①/③).
 */

import type { General, Skill, SkillCondition, SkillEffect, SkillTriggerType } from '../data/generals';
import { supportsListenerScope } from '../data/generals';
import { tagsOf } from '../domain/skillTags';
import type {
  DataSkillDefinition,
  DataSkillEffectType,
  DataSkillTrigger,
  SkillEffectData,
} from './dataTypes';
import type { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { lookupSkillByName } from './skillNameIndex';

/** Skill triggers that map 1:1 onto real engine events.
 * onBecomingTarget maps to BEFORE_DAMAGE: a pure notification — no new event
 * type, no state change. Since v2.8.31 (§12-102) it is emitted by the attack's
 * FIRST beat (`core/attackBlow.ts`, reached through AttackResolver) and the
 * damage itself is computed only after that layer resolved, so this trigger
 * genuinely means "成为目标时". Base-targeted BEFORE_DAMAGE carries no
 * targetPlayerId, so a general skill legitimately never fires on base attacks. */
const SUPPORTED_TRIGGER_MAP: Partial<Record<SkillTriggerType, DataSkillTrigger>> = {
  onDeploy: 'onDeploy',
  onTurnStart: 'onTurnStart',
  onDamageTaken: 'onDamageTaken',
  onDamageDealt: 'onDamageDealt',
  onKill: 'onKill',
  onDeath: 'onDeath',
  onBecomingTarget: 'onBecomingTarget',
  // 2.5.3: card-loss/gain triggers ride on the CARD_LOST/CARD_GAINED
  // notification events derived by the GIVE settlement (first batch of
  // emission sources — see PROJECT_ARCH_MAP §F twelve-cell tables).
  onCardLost: 'onCardLost',
  onCardGained: 'onCardGained',
  // 2.3.1: compiles for the ACTIVATE_SKILL path only — deliberately NOT in
  // TRIGGER_EVENTS, so TURN_END never auto-fires it (single activation
  // path, double-fire ban).
  onTurnEnd: 'onTurnEnd',
  // v2.8 刀4（#25）在场即生效：**能编译、但不在事件面上**。它编译成一条
  // `passive:true` 的定义，唯一的消费方是 skills/passiveModifiers.ts（登场落笔、
  // 离场销笔），触发链那一侧 `matchesSkillEvent` 对它 default=false ⇒ 结构上
  // 不可能"响一次"，也就永远不会被误当成一次发动。
  passive: 'passive',
};

/** Effect types EventProcessor can actually settle today. */
const SUPPORTED_EFFECT_TYPES = new Set<DataSkillEffectType>([
  'DRAW_CARD',
  'DAMAGE',
  'HEAL',
  'GAIN_ARMOR',
  'DISCARD',
  'GIVE',
  'EQUIP_STRIP',
  'REVEAL',
  'DECK_PLACE',
  'DUEL',
  'MODIFY_STAT',
  'GAIN_SKILL',
]);

export interface SkillSkip {
  skillName: string;
  effectId?: string;
  reason:
    | 'NO_TRIGGER'
    | 'TRIGGER_UNSUPPORTED'
    | 'TRIGGER_SUBTYPE_UNSUPPORTED'
    | 'NO_RUNTIME_PAYLOAD'
    | 'EFFECT_TYPE_UNSUPPORTED'
    /** MODIFY_STAT 少了三样里任何一样（改哪个数／哪种形态／数值）——点名，不猜。 */
    | 'MODIFY_STAT_INCOMPLETE'
    /** MODIFY_STAT 把「一次性（用掉就销）」挂到了没有"用掉"那一刻的钥匙上
     *  （2.8 刀5：只有「受到的伤害」会被读一次销一次）。收下＝记录而未消费。 */
    | 'MODIFY_STAT_ONESHOT_KEY_UNSUPPORTED'
    /** 「在场即生效」与「选择其一」在结构上互斥：passive 按定义不进问窗，
     *  那就没人能替它择一。整组点名跳过，绝不让它悄悄变成"全都要"。 */
    | 'PASSIVE_CHOICE_UNSUPPORTED'
    /** 「在场即生效」与链式若-则在结构上互斥：passive 持续生效没有"发动一次"的时刻，
     *  链式的成败判定需要"这一声响完才知道下一声要不要响"的发射器，今天不存在。 */
    | 'PASSIVE_CHAIN_UNSUPPORTED'
    /** passive 的账只随"人在不在场"变化；门槛（体力/手牌一变就该改口）今天
     *  没有任何重算路径，悄悄收下＝"记录而未消费"。 */
    | 'PASSIVE_CONDITION_UNSUPPORTED'
    /** passive 又填了周期＝两条规则说相反的话（周期是"发动笔"那一档的东西）。 */
    | 'PASSIVE_DURATION_CONFLICT'
    /** 「觉醒技」与「在场即生效」在结构上互斥（2.9.3 刀B）：觉醒按徽章定义要"停下来
     *  问一次"，而 passive 压根不进事件面⇒问窗永远开不到它，悄悄收下就是默认全时生效。 */
    | 'AWAKENING_PASSIVE_CONFLICT'
    /** 「觉醒技」与「选择其一」也互斥（2.9.3 刀B）：择一走的是「要哪一枚」那扇窗，
     *  窗里没有"不觉醒"这个出口，也就没有"摇头不扣额度"那一条。 */
    | 'AWAKENING_CHOICE_UNSUPPORTED'
    /** 「获得技能」少了名字（或把目标填成了别人——技能只能落在发动它的那一员将身上，
     *  给别人加技能是 #28 那条目标选择器的口径，今天没有）。点名，不猜。 */
    | 'GAIN_SKILL_INCOMPLETE'
    /** 这个名字不在技能名册上（拼错了，或那枚技能还没进池）。解析点唯一＝
     *  `skills/skillNameIndex.ts`；猜一个"最像的"＝把玩法交给字符串相似度。 */
    | 'GAIN_SKILL_UNKNOWN_NAME'
    /** 名册里同名却有**两份不同内容**：谁也不知道要哪一枚。用户 2026-10-08 裁过
     *  「官方目前不存在不同效果但重名的技能」，所以真撞上就是一条要人裁决的数据缺陷。 */
    | 'GAIN_SKILL_AMBIGUOUS_NAME';
}

export interface CompileResult {
  definitions: DataSkillDefinition[];
  skipped: SkillSkip[];
}

/** Structured payload attached to a data-model effect by designers/DIY. */
export interface RuntimeEffectPayload {
  type: DataSkillEffectType;
  value?: number;
  target?: 'SELF' | 'ATTACKER' | 'TARGET';
  dest?: 'TOP' | 'BOTTOM';
}

function toEffectData(effect: SkillEffect): SkillEffectData | SkillSkip | null {
  const runtime = effect.runtime;
  if (!runtime) return null;
  if (!SUPPORTED_EFFECT_TYPES.has(runtime.type)) {
    return {
      skillName: effect.id,
      effectId: effect.id,
      reason: 'EFFECT_TYPE_UNSUPPORTED',
    };
  }
  // MODIFY_STAT 的三样缺一即点名跳过：编译器绝不把"改数"猜成某个具体数字，
  // 也不允许一条没填钥匙的账悄悄落进账本（§H5-2 第 4 条双形态＋注册表纪律）。
  // 目标只能是本人：跨将目标（"让别人的攻击+1"）是 #28 刀7 的那一格，今天没有
  // 目标选择器，选了就是"看起来能响其实不响"——宁可点名跳过。
  if (runtime.type === 'MODIFY_STAT') {
    if (!runtime.stat || !runtime.modifyMode || typeof runtime.value !== 'number'
      || (runtime.target !== undefined && runtime.target !== 'SELF')) {
      return { skillName: effect.id, effectId: effect.id, reason: 'MODIFY_STAT_INCOMPLETE' };
    }
    // 一次性那档只有「受到的伤害」这把钥匙存在"用掉的那一刻"（刀5 的唯一读档点）。
    // 挂到攻距/体力上限上＝一笔永远没人去销的账，那是另一种语义，点名跳过。
    if (runtime.duration === 'thisDamage' && runtime.stat !== 'DAMAGE_TAKEN') {
      return { skillName: effect.id, effectId: effect.id, reason: 'MODIFY_STAT_ONESHOT_KEY_UNSUPPORTED' };
    }
  }
  // GAIN_SKILL（2.9.3 刀A）：名字是唯一入口，解析点在**这里**（全库唯一一次）。
  // 解析成功⇒那枚技能原样嵌进编译好的定义，桥接层与结算侧读的都是这一份；解析失败⇒
  // 一条点名的 skipped，绝不让"发动了但没拿到东西"这种半成功进事件流。
  let gainedSkill: Skill | undefined;
  if (runtime.type === 'GAIN_SKILL') {
    const wanted = String(runtime.skillName ?? '').trim();
    if (!wanted || (runtime.target !== undefined && runtime.target !== 'SELF')) {
      return { skillName: effect.id, effectId: effect.id, reason: 'GAIN_SKILL_INCOMPLETE' };
    }
    const found = lookupSkillByName(wanted);
    if (found.status === 'unknown') {
      return { skillName: effect.id, effectId: effect.id, reason: 'GAIN_SKILL_UNKNOWN_NAME' };
    }
    if (found.status === 'ambiguous') {
      return { skillName: effect.id, effectId: effect.id, reason: 'GAIN_SKILL_AMBIGUOUS_NAME' };
    }
    gainedSkill = found.skill;
  }
  return {
    type: runtime.type,
    value: runtime.value,
    target: runtime.target ?? (runtime.type === 'MODIFY_STAT' || runtime.type === 'GAIN_SKILL' ? 'SELF' : 'TARGET'),
    dest: runtime.dest,
    // choice option label source (2.6.3) — display-only, never matched on.
    description: effect.description,
    // v2.8 刀4（#25）：改数三格透传（缺省＝非 MODIFY_STAT，键不出现）。
    ...(runtime.type === 'MODIFY_STAT'
      ? { stat: runtime.stat, modifyMode: runtime.modifyMode, duration: runtime.duration }
      : {}),
    // 2.9.3 刀A：名字（录入原样）＋解析出来的那一枚，两个键都只在 GAIN_SKILL 时出现。
    ...(runtime.type === 'GAIN_SKILL'
      ? { skillName: String(runtime.skillName ?? '').trim(), gainedSkill }
      : {}),
  };
}

/** v2.8.11 刀2：两级门槛并成一槽。求值本来就是 AND（全部成立才响），整组
 *  门槛排前面只影响可读顺序，不改变语义。两侧都空⇒undefined。 */
function mergeGates(
  groupGate: SkillCondition[] | undefined,
  effectGate: SkillCondition[] | undefined,
): SkillCondition[] | undefined {
  const out = [...(groupGate ?? []), ...(effectGate ?? [])];
  return out.length > 0 ? out : undefined;
}

/** One runtime effect that survived every gate, pre-grouping. */
interface CompiledEffect {
  effect: SkillEffect;
  data: SkillEffectData;
  mapped: DataSkillTrigger;
  damageTypeFilter?: DataSkillDefinition['damageTypeFilter'];
  cardFilter?: DataSkillDefinition['cardFilter'];
  turnSubType?: DataSkillDefinition['turnSubType'];
  targetSource?: DataSkillDefinition['targetSource'];
  listenerScope?: DataSkillDefinition['listenerScope'];
  /** v2.8.3 门槛：录在**这条效果**上，编译后成为该定义的 conditions。 */
  conditions?: SkillCondition[];
  /** Trigger identity used by the choice grouping (2.6.3): effects compiled
   * under one signature fire together, so they are choosable together. */
  signature: string;
}

/**
 * Compile one skill of one general instance into zero or more canonical
 * DataSkillDefinitions (one per independently-triggered runtime effect;
 * effectMode 'choice' groups same-trigger effects into one choiceMode
 * definition — 2.6.3).
 */
export function compileSkill(
  general: Pick<General, 'id' | 'name'>,
  skill: Skill,
  runtimeGeneralId?: string,
): CompileResult {
  const definitions: DataSkillDefinition[] = [];
  const skipped: SkillSkip[] = [];
  const ownerKey = runtimeGeneralId ?? general.id;
  // v2.8 刀4（#25）：锁定技徽章＝账本上那一笔"移不走"。技能级属性，choice 组同样继承。
  const lockedTag = tagsOf(skill).includes('锁定技');
  // v2.8.32 限定技额度刀：限定技徽章＝这枚技能有一局一次的额度。**按技能给键**
  // （`<将领实例>:<技能名>`），因为裁决说的是"每枚技能各一局一次"，而一枚技能可能
  // 编出多个定义（多效果／不同时机）——键按定义走会让第二次发动合法。
  const limitedTag = tagsOf(skill).includes('限定技');
  // 2.9.3 刀B·觉醒技徽章。用户 2026-10-08 裁「觉醒技和限定技同理，在同一局中发动过
  // 一次就不能再发动」⇒ 两枚徽章共用同一本额度账（同一个 `limitKey` 形状），而"觉醒"
  // 这一位另外把它听的那一声从自动路搬到问答路（消费点见 dataTypes 的 awakening 注释）。
  const awakeningTag = tagsOf(skill).includes('觉醒技');
  const quotaTag = limitedTag || awakeningTag;
  const limitKey = `${ownerKey}:${skill.name}`;

  const consider = (effect: SkillEffect | undefined, fallbackTrigger: Skill['trigger']): CompiledEffect | null => {
    // A skill without effect entries can never carry structured payloads.
    if (!effect) {
      skipped.push({ skillName: skill.name, reason: 'NO_RUNTIME_PAYLOAD' });
      return null;
    }

    const triggerConfig = effect?.trigger ?? fallbackTrigger ?? skill.trigger;
    if (!triggerConfig?.type) {
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'NO_TRIGGER' });
      return null;
    }

    const mapped = SUPPORTED_TRIGGER_MAP[triggerConfig.type];
    if (!mapped) {
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_UNSUPPORTED' });
      return null;
    }

    if (mapped === 'passive') {
      // 「在场即生效」这笔账的**唯一**变化条件是人在不在场。门槛（体力/手牌数一变
      // 就该改口）与周期（在场期间又到期）都要有"中途重算/再落笔"的发射器才谈得上，
      // 今天两者都不存在（调离区＝另立的一刀）⇒ 悄悄收下就是 §12-55 那种"记录而未
      // 消费"，所以宁可点名跳过。
      if (skill.conditions?.length || effect?.conditions?.length) {
        skipped.push({
          skillName: skill.name,
          effectId: effect?.id,
          reason: 'PASSIVE_CONDITION_UNSUPPORTED',
        });
        return null;
      }
      if (effect?.runtime?.duration) {
        skipped.push({
          skillName: skill.name,
          effectId: effect.id,
          reason: 'PASSIVE_DURATION_CONFLICT',
        });
        return null;
      }
      // 2.9.3 刀B：觉醒技说"到点问您点不点头"，在场即生效说"没有发动这一刻"——两句
      // 互斥，而问答路压根扫不到它（`eventsHeardBy('passive')` 是空）。悄悄收下＝把
      // 一条写着"由您自选"的技能默认成全时生效，那是另一种玩法。
      if (awakeningTag) {
        skipped.push({
          skillName: skill.name,
          effectId: effect?.id,
          reason: 'AWAKENING_PASSIVE_CONFLICT',
        });
        return null;
      }
    }

    let damageTypeFilter: DataSkillDefinition['damageTypeFilter'];
    if ((mapped === 'onTurnStart' || mapped === 'onTurnEnd') && triggerConfig.turnSubType === 'otherTurn') {
      // The ask window only ever belongs to the current turn's owner, so an
      // otherTurn onTurnEnd has no honest activation path (2.3.1, same
      // discipline as the pre-existing onTurnStart guard).
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
      return null;
    }
    if (mapped === 'onKill' && triggerConfig.killSubType === 'killAlly') {
      // The engine only emits DEATH for enemy kills — never fires; skip honestly.
      skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
      return null;
    }
    if ((mapped === 'onDamageTaken' || mapped === 'onDamageDealt') && triggerConfig.damageSubType) {
      if (triggerConfig.damageSubType === 'attackDamage') damageTypeFilter = 'attack';
      else if (triggerConfig.damageSubType === 'skillDamage') damageTypeFilter = 'skill';
    }
    // v2.8.21 监听扩面刀·来源档：只有「成为目标时」这一型有这一维。**缺省不写＝
    // 'attack'**（扩面前 label 写死的就是"成为攻击目标时"，官方四条与 DIY 夹具
    // 那条的描述也都这么写）⇒ 这一维今日不扩响、不动两个锚池。
    let targetSource: DataSkillDefinition['targetSource'];
    if (mapped === 'onBecomingTarget') {
      const sub = triggerConfig.targetSubType;
      targetSource = sub === 'skillTarget' ? 'skill' : sub === 'anyTarget' ? 'any' : 'attack';
    }
    // v2.8.21 监听扩面刀·「我听谁」：缺省不写＝'self'＝扩面前逐字行为。
    // 只在触发型自认支持这一维时才带上（录入面认不出的组合由 Excel 侧点名，
    // 编译器这一侧绝不把"听场上"悄悄塞进一个听不懂的时机）。
    let listenerScope: DataSkillDefinition['listenerScope'];
    if (triggerConfig.listenerScope && supportsListenerScope(triggerConfig.type)) {
      listenerScope = triggerConfig.listenerScope;
    }
    // v2.6.2 card-trigger predicates (连营/枭姬 keys): 'anyLost' and an
    // absent sub-type stay the pre-expansion any-source behavior (undefined
    // filter). A sub-type that contradicts its trigger direction, or a
    // gained-side predicate with no emission source yet (only GIVE derives
    // CARD_GAINED), skips honestly rather than silently never-firing.
    let cardFilter: DataSkillDefinition['cardFilter'];
    if (mapped === 'onCardLost' || mapped === 'onCardGained') {
      const cardSub = triggerConfig.cardSubType;
      const lostOnly = cardSub === 'equipmentLost' || cardSub === 'lastHandLost' || cardSub === 'handLost';
      if (cardSub === 'anyGained' && mapped === 'onCardLost') {
        skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
        return null;
      }
      if (lostOnly && mapped === 'onCardGained') {
        skipped.push({ skillName: skill.name, effectId: effect?.id, reason: 'TRIGGER_SUBTYPE_UNSUPPORTED' });
        return null;
      }
      if (mapped === 'onCardLost') {
        if (cardSub === 'equipmentLost') cardFilter = 'equipment';
        else if (cardSub === 'lastHandLost') cardFilter = 'lastHand';
        else if (cardSub === 'handLost') cardFilter = 'hand';
      }
    }

    const converted = toEffectData(effect);
    if (!converted) {
      skipped.push({ skillName: skill.name, effectId: effect.id, reason: 'NO_RUNTIME_PAYLOAD' });
      return null;
    }
    if ('reason' in converted) {
      converted.skillName = skill.name;
      skipped.push(converted);
      return null;
    }

    const turnSubType = (mapped === 'onTurnStart' || mapped === 'onTurnEnd')
      ? triggerConfig.turnSubType
      : undefined;
    return {
      effect,
      data: converted,
      mapped,
      damageTypeFilter,
      cardFilter,
      turnSubType,
      targetSource,
      listenerScope,
      conditions: effect.conditions && effect.conditions.length > 0 ? effect.conditions : undefined,
      signature: `${mapped}|${damageTypeFilter ?? ''}|${cardFilter ?? ''}|${turnSubType ?? ''}|${targetSource ?? ''}|${listenerScope ?? ''}`,
    };
  };

  const singleDefinition = (c: CompiledEffect): DataSkillDefinition => ({
    id: `${ownerKey}:${skill.name}:${c.effect.id}`,
    name: skill.name,
    trigger: c.mapped,
    description: c.effect.description ?? skill.description ?? '',
    effects: [c.data],
    sourceGeneralId: runtimeGeneralId,
    damageTypeFilter: c.damageTypeFilter,
    cardFilter: c.cardFilter,
    targetSource: c.targetSource,
    listenerScope: c.listenerScope,
    // ACTIVATE_SKILL addressing (2.3.1): id doubles as `<general>:<skill>:<effect>`,
    // these two fields let resolvers/UI read the parts without parsing.
    effectId: c.effect.id,
    turnSubType: c.turnSubType,
    // v2.8.11 刀2：单效果定义把两级门槛并成一槽（AND 语义，整组在前）。
    // 两侧都空⇒undefined，v2.8.10 之前的输出逐字不变。
    conditions: mergeGates(skill.conditions, c.conditions),
    // v2.8.22 响应链执法刀：录入面的「强制发动」透传到编译模型。
    // 只在真为 true 时落键——缺省定义的键集合与 v2.8.21 逐字一致。
    ...(skill.forced === true ? { forced: true } : {}),
    // v2.8 刀4（#25）在场即生效：passive 型编译成一条**不落事件面**的定义，
    // 由 skills/passiveModifiers.ts 单独消费。同样"只在真为 true 时落键"。
    ...(c.mapped === 'passive' ? { passive: true } : {}),
    ...(lockedTag && c.data.type === 'MODIFY_STAT' ? { locked: true } : {}),
    // 「一局一次」额度按技能给键；passive 型不落键——持续生效没有"发动一次"的时刻，
    // 落键只会假装管住了它（如实账见 dataTypes 的 limitKey 注释）。
    // 2.9.3 刀B：限定技与觉醒技共用同一本账（quotaTag）；觉醒位只在编出定义时落，
    // passive 那一支在上面已经点名跳过，所以这一句永远走不到"落键却不问"的死角。
    ...(quotaTag && c.mapped !== 'passive' ? { limitKey } : {}),
    ...(awakeningTag && c.mapped !== 'passive' ? { awakening: true } : {}),
  });

  const candidates: CompiledEffect[] = [];
  if (skill.effects && skill.effects.length > 0) {
    for (const effect of skill.effects) {
      const compiled = consider(effect, skill.trigger);
      if (compiled) candidates.push(compiled);
    }
  } else {
    consider(undefined, skill.trigger);
  }

  if (skill.effectMode === 'choice' && candidates.length >= 2) {
    // Group by trigger signature: effects that fire at the SAME moment are
    // one choice ("select one"); an isolated effect has nothing to choose
    // against and compiles exactly as before (id shape included).
    const groups = new Map<string, CompiledEffect[]>();
    for (const c of candidates) {
      const group = groups.get(c.signature);
      if (group) group.push(c);
      else groups.set(c.signature, [c]);
    }
    for (const group of groups.values()) {
      if (group.length === 1) {
        definitions.push(singleDefinition(group[0]));
        continue;
      }
      if (group[0].mapped === 'passive') {
        // 「在场即生效」按定义不进问窗 ⇒ 没有任何路径能替这组择一。整组点名
        // 跳过，绝不悄悄把它读成"全部生效"（那是另一种玩法）。
        for (const c of group) {
          skipped.push({
            skillName: skill.name,
            effectId: c.effect.id,
            reason: 'PASSIVE_CHOICE_UNSUPPORTED',
          });
        }
        continue;
      }
      if (awakeningTag) {
        // 2.9.3 刀B：择一组走的是 `CHOICE_REQUIRED` 那条窗（分流开关第一句就把
        // choiceMode 留在自动路），它问的是"要哪一枚"，压根没有"觉不觉醒"这一问，
        // 也就没有"摇头不扣额度"那个出口。点名跳过，等择一窗挂得上"不发动"再说。
        for (const c of group) {
          skipped.push({
            skillName: skill.name,
            effectId: c.effect.id,
            reason: 'AWAKENING_CHOICE_UNSUPPORTED',
          });
        }
        continue;
      }
      definitions.push({
        id: `${ownerKey}:${skill.name}:choice`,
        name: skill.name,
        trigger: group[0].mapped,
        description: skill.description ?? '',
        // v2.8.11 刀2：逐项门槛随各自的效果数据走（抉择窗逐选项求值），
        // 整组门槛走定义级 conditions 槽（桥接层身份判定之后、造事件之前）。
        // 无门槛的选择组一字未变：conditions 两侧都是 undefined。
        effects: group.map(c => (c.conditions ? { ...c.data, conditions: c.conditions } : c.data)),
        sourceGeneralId: runtimeGeneralId,
        damageTypeFilter: group[0].damageTypeFilter,
        cardFilter: group[0].cardFilter,
        targetSource: group[0].targetSource,
        listenerScope: group[0].listenerScope,
        turnSubType: group[0].turnSubType,
        choiceMode: true,
        conditions: skill.conditions?.length ? skill.conditions : undefined,
        // 「强制发动」是技能级录入，choice 组同样继承（整组自动发动，组内择一
        // 仍由既有的抉择窗负责——那是 CHOICE_REQUIRED 的路，不另开一条）。
        ...(skill.forced === true ? { forced: true } : {}),
        // 锁定技同理继承，但只在组里**真有**写账本的效果时落键（择一之后落的那
        // 一笔才需要"移不走"位）。
        ...(lockedTag && group.some(c => c.data.type === 'MODIFY_STAT') ? { locked: true } : {}),
        // 限定技同理继承：整组择一＝一次发动＝一次额度（键与单效果定义同形）。
        // （觉醒技＋择一那一组在上面已点名跳过，所以这一支只可能是限定技在落键。）
        ...(quotaTag ? { limitKey } : {}),
      });
    }
    // v2.8.x 链式若-则刀：effectMode==='chain' 时，同一触发签名的多个效果编入一条
    // 定义、挂 effectChain=true ⇒ SkillTriggerBridge 顺序翻译、前败后弃。
    // 跨签名（不同 trigger / damageTypeFilter）仍拆成独立定义——链只在"同时响"的
    // 效果之间生效。passive 按定义没有"发动一次"的时刻，链式成败判定找不到发射器⇒点名跳过。
  } else if (skill.effectMode === 'chain') {
    const groups = new Map<string, CompiledEffect[]>();
    for (const c of candidates) {
      const group = groups.get(c.signature);
      if (group) group.push(c);
      else groups.set(c.signature, [c]);
    }
    for (const group of groups.values()) {
      if (group.length === 1) {
        definitions.push(singleDefinition(group[0]));
        continue;
      }
      if (group[0].mapped === 'passive') {
        for (const c of group) {
          skipped.push({
            skillName: skill.name,
            effectId: c.effect.id,
            reason: 'PASSIVE_CHAIN_UNSUPPORTED',
          });
        }
        continue;
      }
      definitions.push({
        id: `${ownerKey}:${skill.name}:chain`,
        name: skill.name,
        trigger: group[0].mapped,
        description: skill.description ?? '',
        // 2.9.3 刀C：链式一组**同样继承整组门槛**（与上面 choice 那一支同一格位子）。
        // 这一槽是"这一刻到底该不该响/该不该问"的唯一判据（`SkillTriggerBridge.buildCondition`
        // 与 `skills/reactionChain.ts` 候选枚举都读它）；链上不带＝写着门槛却没人读，
        // 正是 §12-55 明令禁止的"记录而未消费"。魏关羽「单骑」那三格门槛就落在这里。
        // 如实账：挂在**单条效果**上的逐项门槛今天只在择一窗被消费（`buildChoiceOptions`），
        // 链式没有"跳过中间一环"的形状，所以这一支仍只并把它们留在效果数据里、不进定义级
        // 判据——那是另立的一刀，本刀不假装已经管住它。
        conditions: skill.conditions?.length ? skill.conditions : undefined,
        effects: group.map(c => (c.conditions ? { ...c.data, conditions: c.conditions } : c.data)),
        sourceGeneralId: runtimeGeneralId,
        damageTypeFilter: group[0].damageTypeFilter,
        cardFilter: group[0].cardFilter,
        targetSource: group[0].targetSource,
        listenerScope: group[0].listenerScope,
        turnSubType: group[0].turnSubType,
        effectChain: true,
        ...(skill.forced === true ? { forced: true } : {}),
        ...(lockedTag && group.some(c => c.data.type === 'MODIFY_STAT') ? { locked: true } : {}),
        // 链式一组＝一次发动：额度与觉醒位照常继承（魏关羽「单骑」"失去1点体力上限
        // **并**获得技能「怒斩」"就是这一支——一次觉醒、一笔账、两下连着落）。
        ...(quotaTag ? { limitKey } : {}),
        ...(awakeningTag ? { awakening: true } : {}),
      });
    }
  } else {
    for (const c of candidates) definitions.push(singleDefinition(c));
  }

  return { definitions, skipped };
}

/** Compile every runtime-executable skill of a general instance. */
export function compileGeneralSkills(
  general: General,
  runtimeGeneralId?: string,
): CompileResult {
  const definitions: DataSkillDefinition[] = [];
  const skipped: SkillSkip[] = [];
  for (const skill of general.skills ?? []) {
    const result = compileSkill(general, skill, runtimeGeneralId);
    definitions.push(...result.definitions);
    skipped.push(...result.skipped);
  }
  return { definitions, skipped };
}

/**
 * Register the skills of all field generals of every player into the engine.
 *
 * Registration is always re-derived from EngineState (never cached gameplay
 * state): the resident store container unregisters its previous owners and
 * calls this before every dispatch, which reproduces the fresh-engine
 * semantics of the rebuild path — a general that left the field cannot keep
 * triggering. Compiled, data-driven registration only — no gameplay rules
 * live here.
 *
 * Compile honesty (2.3.0, D-9 class C): skipped skill entries used to vanish
 * silently here (the 演練・回刺 onBecomingTarget case). They now land in an
 * out-of-band diagnostics channel — never the event stream, never state —
 * and each DISTINCT skipped entry earns exactly one aggregated console.warn
 * on first appearance. Dedup is per entry, not per engine and not per
 * skip-set: the battleRunner/reconcile paths mint a fresh engine per step and
 * the resident path resyncs per dispatch, so either coarser key would turn
 * field churn into log spam.
 */
export function syncPlayerSkills(engine: GameEngine, state: EngineState): number {
  let registered = 0;
  const skips: SkillSkip[] = [];
  for (const player of state.players) {
    const fieldGenerals = Array.isArray(player.fieldGenerals)
      ? (player.fieldGenerals as Array<Record<string, unknown>>)
      : [];
    for (const fg of fieldGenerals) {
      const general = fg?.general as General | undefined;
      if (!general || !Array.isArray(general.skills) || general.skills.length === 0) continue;
      const runtimeId = getRuntimeCardId(general as never) || general.id;
      const { definitions, skipped } = compileGeneralSkills(general, runtimeId);
      skips.push(...skipped);
      if (definitions.length === 0) continue;
      engine.registerPlayerSkills(player.id, definitions);
      registered += definitions.length;
    }
  }
  recordCompileSkips(engine, skips);
  return registered;
}

/**
 * Out-of-band view of the compile skips seen for an engine's latest skill
 * sync. Observation only (mirrors GameEngine.lastOverrideFailures, 2.2.23):
 * the editor/Excel input layer and tests consume this; the event stream
 * never carries it.
 */
export interface SkillCompileDiagnostics {
  skips: SkillSkip[];
  /** Aggregated distinct entries: `${skillName}|${effectId}|${reason}`. */
  signature: string;
}

const diagnosticsByEngine = new WeakMap<GameEngine, SkillCompileDiagnostics>();
const warnedEntries = new Set<string>();

function recordCompileSkips(engine: GameEngine, skips: SkillSkip[]): void {
  if (skips.length === 0) return;
  const distinct = [...new Set(
    skips.map(skip => `${skip.skillName}|${skip.effectId ?? ''}|${skip.reason}`),
  )].sort();
  diagnosticsByEngine.set(engine, { skips, signature: distinct.join(';') });
  const fresh = distinct.filter(entry => !warnedEntries.has(entry));
  if (fresh.length === 0) return;
  fresh.forEach(entry => warnedEntries.add(entry));
  console.warn(
    `[skillCompiler] ${fresh.length} skill effect(s) skipped at compile time — ` +
    fresh.map(entry => {
      const [skillName, effectId, reason] = entry.split('|');
      return `${skillName}${effectId ? `#${effectId}` : ''}: ${reason}`;
    }).join(', ') +
    '. Skipped skills never fire until the engine gains support for them.',
  );
}

export function getCompileDiagnostics(engine: GameEngine): SkillCompileDiagnostics | null {
  return diagnosticsByEngine.get(engine) ?? null;
}

/** Test seam: forget warned entries so dedup can be re-observed. */
export function __resetCompileWarnDedup(): void {
  warnedEntries.clear();
}
