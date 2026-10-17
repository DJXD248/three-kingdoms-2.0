/**
 * skillSentence — 「积木 → 一句卡面话」的唯一词源（#49 拼积木编辑器，v2.9.8）。
 *
 * 用户要的顺序是：先挑积木（触发时机／门槛／结构化效果），话由系统替他说出来，
 * 说错了他自己改。这里只负责"说出来"那一步，外加一条接线规则：
 *   描述文字为空、或与上一次由积木生成的那句逐字相同 ⇒ 这句还跟着积木走；
 *   只要手打过一次（与生成串不同）⇒ 积木再变也不碰它，界面上给一个「用积木重写这句」。
 *
 * 没有新增任何存储字段，也**没有**"把文字反解回积木"的解析器：引擎从不读描述文字
 * （读的是 trigger / conditions / runtime），所以文字与积木不一致不会让对局变一个字。
 */

import {
  SkillCondition, SkillEffect, SkillRuntimeEffect, SkillTriggerConfig,
  triggerTypeLabels, listenerScopeLabels, supportsListenerScope, getTriggerSubOptions,
  statModifierKeyLabels, deploySubLabels, turnSubLabels, damageSubLabels, targetSubLabels,
  killSubLabels, cardSubLabels, expireLabels,
} from '../data/generals';
import { runtimeTargetLabels } from './skillExcelFormat';
import { gateConditionsToText } from './skillGateText';

/** 一块积木（结构化效果）说出来的那句话——运行时预览与生成文字共用这一份。 */
export const runtimeEffectPhrases: Record<SkillRuntimeEffect['type'], (v: number, rt?: SkillRuntimeEffect) => string> = {
  DRAW_CARD: v => (v === 0 ? '摸全部手牌' : `摸 ${v} 张牌`),
  DAMAGE: v => `造成 ${v} 点技能伤害`,
  HEAL: v => `回复 ${v} 点体力`,
  GAIN_ARMOR: v => `获得 ${v} 点护甲`,
  DISCARD: v => (v === 0 ? '弃全部手牌' : `弃 ${v} 张手牌`),
  GIVE: v => (v === 0 ? '发放全部手牌' : `发放 ${v} 张手牌`),
  EQUIP_STRIP: v => `拆掉 ${v} 张军备卡`,
  REVEAL: v => `观看牌堆顶 ${v} 张`,
  DECK_PLACE: v => (v === 0 ? '把全部手牌放回牌堆' : `把 ${v} 张手牌放回牌堆`),
  DUEL: (_v, rt) => `与${duelFoe(rt)}将领决斗（双方各三轮，最多六次）`,
  MODIFY_STAT: (v, rt) => {
    const key = statKeyLabel(rt?.stat);
    const once = rt?.duration === 'thisDamage' ? '下一次' : '';
    if (rt?.modifyMode === 'set') return `${once}把${key}摁成 ${v}（覆盖卡面上的数）`;
    return v < 0 ? `${once}让${key}减少 ${-v}` : `${once}让${key}增加 ${v}`;
  },
  GAIN_SKILL: (_v, rt) => {
    const name = String(rt?.skillName ?? '').trim();
    return name ? `获得技能「${name}」` : '获得技能：还没写要拿哪一枚';
  },
};

function statKeyLabel(stat?: string): string {
  const key = (stat ?? 'MELEE_ATK') as keyof typeof statModifierKeyLabels;
  return statModifierKeyLabels[key] ?? String(stat ?? '');
}

/** 触发时机那一格说出来的话（含细分与「我听谁」）。没选时机＝空串，不硬造半句。 */
export function triggerPhrase(trigger?: SkillTriggerConfig): string {
  if (!trigger?.type) return '';
  let text = triggerTypeLabels[trigger.type];
  const sub = getTriggerSubOptions(trigger.type);
  if (sub === 'deploy' && trigger.deploySubType) text += `（${deploySubLabels[trigger.deploySubType]}）`;
  if (sub === 'turn' && trigger.turnSubType) text += `（${turnSubLabels[trigger.turnSubType]}）`;
  if (sub === 'damage' && trigger.damageSubType) text += `（${damageSubLabels[trigger.damageSubType]}）`;
  // 「成为目标」的默认档就是不选＝只算攻击，生成句把它写全，免得读的人以为是所有来源。
  if (sub === 'target') text += `（${targetSubLabels[trigger.targetSubType ?? 'attackTarget']}）`;
  if (sub === 'kill' && trigger.killSubType) text += `（${killSubLabels[trigger.killSubType]}）`;
  if (sub === 'card' && trigger.cardSubType) text += `（${cardSubLabels[trigger.cardSubType]}）`;
  if (sub === 'expire' && trigger.expireCondition) text += `（${expireLabels[trigger.expireCondition]}）`;
  if (trigger.listenerScope && supportsListenerScope(trigger.type)) {
    text += `（${listenerScopeLabels[trigger.listenerScope]}）`;
  }
  return text;
}

/** 门槛那一格说出来的话；没有门槛＝空串（不写「无门槛」这种废话）。 */
export function gatePhrase(conditions?: SkillCondition[]): string {
  if (!conditions || conditions.length === 0) return '';
  return `要满足${gateConditionsToText(conditions)}`;
}

/**
 * 这块积木到底读不读「对象」那一格——按**引擎事实**列，不按界面上有没有那个下拉列：
 *   读（`SkillTriggerBridge` 用 resolveEffectTarget 解出的 targetId）：伤害／回复／护甲／弃牌／拆解军备，
 *   读、但只当"收到东西的人"（GIVE 的发方恒为发动者那一席），读、且写在句子自己里（DUEL 点名两位），
 *   **不读**（`playerId: Number(sourceId)` 那条路，或压根没有目标轴）：摸牌（桥接注释原话
 *   "Card draw is always granted to the skill owner's hand"）、看牌堆顶、放回牌堆、修改数值、获得技能。
 * 给不读对象的那几档标上"对谁"＝界面替引擎说了一句它不做的动作（§12-112 那一族）。
 */
const TARGET_MARK: Partial<Record<SkillRuntimeEffect['type'], '对' | '给'>> = {
  DAMAGE: '对', HEAL: '对', GAIN_ARMOR: '对', DISCARD: '对', EQUIP_STRIP: '对', GIVE: '给',
};

/** 决斗那句话点名的是哪一位（引擎按这块积木的目标档取名，默认＝目标）。 */
function duelFoe(rt?: SkillRuntimeEffect): string {
  return runtimeTargetLabels[rt?.target ?? 'TARGET'];
}

/**
 * 一条积木拼成的一句：`时机，对谁，要满足…，做什么。`
 * 没填结构化效果＝这块积木说不出"做什么"，返回空串（宁可不生成，也不生成半句）。
 */
export function effectSentence(effect?: Pick<SkillEffect, 'trigger' | 'conditions' | 'runtime'>): string {
  if (!effect?.runtime) return '';
  const rt = effect.runtime;
  const mark = TARGET_MARK[rt.type];
  const who = mark && rt.target && rt.target !== 'TARGET'
    ? `${mark}${runtimeTargetLabels[rt.target]}`
    : '';
  const gate = gatePhrase(effect.conditions);
  const what = runtimeEffectPhrases[rt.type](rt.value ?? (rt.type === 'MODIFY_STAT' ? 0 : 1), rt);
  const parts = [triggerPhrase(effect.trigger), who, gate, what].filter(Boolean);
  return `${parts.join('，')}。`;
}

/** 一条技能里能被拼成句的那几格积木。 */
export interface SkillBlocks {
  effects?: SkillEffect[];
  conditions?: SkillCondition[];
  effectMode?: string;
}

/** 一整条技能（多效果模式）拼出来的总述；没有一块能说话的积木＝空串。 */
export function skillSentence(skill: SkillBlocks): string {
  const rows = (skill.effects ?? []).map(effectSentence).filter(Boolean);
  if (rows.length === 0) return '';
  const groupGate = gatePhrase(skill.conditions);
  const head = skill.effectMode === 'choice' && rows.length > 1 ? '以下择一' : '';
  const body = rows.map(r => r.replace(/。$/, '')).join('；');
  return [head, groupGate, body].filter(Boolean).join('，') + '。';
}

/** 这块积木被改动时，那句由它生成的文字要不要跟着重写。 */
function shouldFollow(current: string | undefined, generatedFromOld: string): boolean {
  const text = current ?? '';
  return text === '' || text === generatedFromOld;
}

/** 改一条效果的积木（时机／门槛／效果）：手改过的那句原样留着。 */
export function patchEffect(effect: SkillEffect, patch: Partial<SkillEffect>): SkillEffect {
  if ('description' in patch) return { ...effect, ...patch };
  const next: SkillEffect = { ...effect, ...patch };
  if (!shouldFollow(effect.description, effectSentence(effect))) return next;
  const generated = effectSentence(next);
  return generated ? { ...next, description: generated } : next;
}

/** 改一条技能的积木（整组门槛／子效果）：总述同理，手改过的原样留着。 */
export function patchSkill<T extends SkillBlocks>(skill: T, patch: Partial<T>): T {
  if ('description' in patch) return { ...skill, ...patch };
  const next: T = { ...skill, ...patch };
  if (!shouldFollow((skill as { description?: string }).description, skillSentence(skill))) return next;
  const generated = skillSentence(next);
  return generated ? { ...next, description: generated } : next;
}

/** 这句现在是不是手改的（用来决定界面要不要给「用积木重写这句」那颗按钮）。 */
export function isHandWritten(current: string | undefined, blocks: { trigger?: SkillTriggerConfig; conditions?: SkillCondition[]; runtime?: SkillRuntimeEffect }): boolean {
  const text = (current ?? '').trim();
  if (!text) return false;
  return text !== effectSentence(blocks).trim();
}

export function isSkillHandWritten(current: string | undefined, skill: SkillBlocks): boolean {
  const text = (current ?? '').trim();
  if (!text) return false;
  return text !== skillSentence(skill).trim();
}
