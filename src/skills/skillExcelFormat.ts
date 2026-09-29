/**
 * skillExcelFormat — pure helpers for the SkillEditor Excel format.
 *
 * Responsibilities (all side-effect free, unit-testable):
 *   - trigger config <-> readable string ("部署时→上阵", round-trip safe);
 *   - structured runtime effect fields (类型/数值/目标) <-> strings;
 *   - effect column-group serialization & parsing for ALL widths:
 *       v1 (legacy, 3 cols): 标注 | 触发 | 描述
 *       v2 (6 cols): 标注 | 触发 | 效果类型 | 数值 | 目标 | 描述
 *       v3 (current, 7 cols): v2 + 门槛
 *     Width is detected from the header row, so old exported files still import.
 *   - 门槛（发动条件）cell <-> structured conditions, via skillGateText.ts.
 *
 * These helpers only translate between spreadsheet cells and the data model in
 * data/generals.ts. Whether an effect actually executes in-game is decided
 * solely by skillCompiler.ts (which requires a structured runtime payload).
 */

import type {
  SkillTriggerConfig,
  SkillTriggerType,
  SkillEffect,
  SkillRuntimeEffect,
  SkillCondition,
  DeploySubType,
  TurnSubType,
  DamageSubType,
  KillSubType,
  CardSubType,
  ExpireCondition,
} from '../data/generals';
import {
  allTriggerTypes,
  triggerTypeLabels,
  getTriggerSubOptions,
  deploySubLabels,
  turnSubLabels,
  damageSubLabels,
  killSubLabels,
  cardSubLabels,
  expireLabels,
} from '../data/generals';
import { parseGateText, gateConditionsToText } from './skillGateText';

const EMPTY = '无';

/** Trim a raw cell and normalize the "无"/"none" placeholder to empty. */
export function cleanCell(s: unknown): string {
  const v = String(s ?? '').trim();
  return v === EMPTY ? '' : v;
}

// ── Trigger <-> string ──────────────────────────────────────────────

/** Format a trigger config as a readable string; undefined -> "无". */
export function triggerToStr(t?: SkillTriggerConfig): string {
  if (!t || !t.type) return EMPTY;
  let s = triggerTypeLabels[t.type] || t.type;
  const sub = getTriggerSubOptions(t.type);
  if (sub === 'deploy' && t.deploySubType) s += '→' + deploySubLabels[t.deploySubType];
  if (sub === 'turn' && t.turnSubType) s += '→' + turnSubLabels[t.turnSubType];
  if (sub === 'damage' && t.damageSubType) s += '→' + damageSubLabels[t.damageSubType];
  if (sub === 'kill' && t.killSubType) s += '→' + killSubLabels[t.killSubType];
  if (sub === 'card' && t.cardSubType) s += '→' + cardSubLabels[t.cardSubType];
  if (sub === 'expire' && t.expireCondition) s += '→' + expireLabels[t.expireCondition];
  return s;
}

/** All selectable trigger strings for Excel dropdowns (first entry "无"). */
export function buildTriggerOptionStrings(): string[] {
  const opts = [EMPTY];
  for (const type of allTriggerTypes) {
    const main = triggerTypeLabels[type];
    const subKind = getTriggerSubOptions(type);
    if (!subKind) { opts.push(main); continue; }
    let labels: readonly string[];
    if (subKind === 'deploy') labels = Object.values(deploySubLabels);
    else if (subKind === 'turn') labels = Object.values(turnSubLabels);
    else if (subKind === 'damage') labels = Object.values(damageSubLabels);
    else if (subKind === 'kill') labels = Object.values(killSubLabels);
    else if (subKind === 'card') labels = Object.values(cardSubLabels);
    else labels = Object.values(expireLabels);
    for (const label of labels) opts.push(`${main}→${label}`);
  }
  return opts;
}

/** Parse a trigger string back to config; "无"/unknown -> undefined. */
export function strToTrigger(s: string): SkillTriggerConfig | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  if (!trimmed || trimmed === EMPTY) return undefined;
  const parts = trimmed.split('→');
  const mainLabel = parts[0].trim();
  const subLabel = parts[1]?.trim();
  const type = (Object.entries(triggerTypeLabels) as [SkillTriggerType, string][])
    .find(([, v]) => v === mainLabel)?.[0];
  if (!type) return undefined;
  const cfg: SkillTriggerConfig = { type };
  if (subLabel) {
    const subKind = getTriggerSubOptions(type);
    if (subKind === 'deploy') cfg.deploySubType = (Object.entries(deploySubLabels) as [DeploySubType, string][]).find(([, v]) => v === subLabel)?.[0];
    if (subKind === 'turn') cfg.turnSubType = (Object.entries(turnSubLabels) as [TurnSubType, string][]).find(([, v]) => v === subLabel)?.[0];
    if (subKind === 'damage') cfg.damageSubType = (Object.entries(damageSubLabels) as [DamageSubType, string][]).find(([, v]) => v === subLabel)?.[0];
    if (subKind === 'kill') cfg.killSubType = (Object.entries(killSubLabels) as [KillSubType, string][]).find(([, v]) => v === subLabel)?.[0];
    if (subKind === 'card') cfg.cardSubType = (Object.entries(cardSubLabels) as [CardSubType, string][]).find(([, v]) => v === subLabel)?.[0];
    if (subKind === 'expire') cfg.expireCondition = (Object.entries(expireLabels) as [ExpireCondition, string][]).find(([, v]) => v === subLabel)?.[0];
  }
  return cfg;
}

/**
 * 严格版触发读法（录入面唯一入口）。宽松 `strToTrigger` 会把「受到伤害后→攻击」
 * 这类半截写法读成"没有细分＝所有伤害"——**把用户的限制放宽**比不填更危险，
 * 所以对外只认"反写回来与原文逐字相同"的写法，其余一律交回未看懂。
 */
export function readTriggerCell(s: unknown): { trigger?: SkillTriggerConfig; unreadable?: string } {
  const trimmed = String(s ?? '').trim();
  if (!trimmed || trimmed === EMPTY) return {};
  const parsed = strToTrigger(trimmed);
  if (parsed && triggerToStr(parsed) === trimmed) return { trigger: parsed };
  return { unreadable: trimmed };
}

// ── Runtime effect fields ───────────────────────────────────────────

export const runtimeEffectTypeLabels: Record<SkillRuntimeEffect['type'], string> = {
  DRAW_CARD: '摸牌',
  DAMAGE: '伤害',
  HEAL: '回复体力',
  GAIN_ARMOR: '获得护甲',
  DISCARD: '弃牌',
  GIVE: '发放',
  EQUIP_STRIP: '拆掉装备',
  REVEAL: '看牌堆顶',
  DECK_PLACE: '放回牌堆',
};

/**
 * 旧行话（v2.8.3 及更早版本导出、以及用户手写在这些词上的文件）。
 * **只接受、绝不写出**——写出的永远用上面那套大白话，否则用户手上的旧 .xlsx 一改词就导入即失效。
 */
const LEGACY_TYPE_LABELS: Record<string, SkillRuntimeEffect['type']> = {
  剥离装备: 'EQUIP_STRIP',
  观顶: 'REVEAL',
  置牌入堆: 'DECK_PLACE',
};
const LEGACY_TARGET_LABELS: Record<string, NonNullable<SkillRuntimeEffect['target']>> = {
  被作用者: 'TARGET',
};

/** Types the compiler can settle today (see skillCompiler SUPPORTED_EFFECT_TYPES). */
export const SETTLEABLE_RUNTIME_TYPES: readonly SkillRuntimeEffect['type'][] = ['DRAW_CARD', 'DAMAGE', 'HEAL', 'GAIN_ARMOR', 'DISCARD', 'GIVE', 'EQUIP_STRIP', 'REVEAL', 'DECK_PLACE'];

export const runtimeTargetLabels: Record<NonNullable<SkillRuntimeEffect['target']>, string> = {
  SELF: '自身',
  ATTACKER: '伤害来源',
  TARGET: '目标',
};

export const RUNTIME_TYPE_LIST = Object.values(runtimeEffectTypeLabels).join(',');
export const SETTLEABLE_RUNTIME_TYPE_LIST = SETTLEABLE_RUNTIME_TYPES.map(t => runtimeEffectTypeLabels[t]).join(',');
export const RUNTIME_TARGET_LIST = Object.values(runtimeTargetLabels).join(',');

/** Parse "摸牌"/"DRAW_CARD" -> runtime type; anything else -> undefined. */
export function parseRuntimeType(s: string): SkillRuntimeEffect['type'] | undefined {
  const v = cleanCell(s);
  if (!v) return undefined;
  const upper = v.toUpperCase();
  const byEnum = (Object.keys(runtimeEffectTypeLabels) as SkillRuntimeEffect['type'][])
    .find(t => t === upper);
  if (byEnum) return byEnum;
  const byLabel = (Object.entries(runtimeEffectTypeLabels) as [SkillRuntimeEffect['type'], string][])
    .find(([, label]) => label === v)?.[0];
  return byLabel ?? LEGACY_TYPE_LABELS[v];
}

/** Parse "自身"/"SELF" -> target; anything else -> undefined. */
export function parseRuntimeTarget(s: string): SkillRuntimeEffect['target'] | undefined {
  const v = cleanCell(s);
  if (!v) return undefined;
  const upper = v.toUpperCase();
  const byEnum = (Object.keys(runtimeTargetLabels) as SkillRuntimeEffect['target'][])
    .find(t => t === upper);
  if (byEnum) return byEnum;
  const byLabel = (Object.entries(runtimeTargetLabels) as [NonNullable<SkillRuntimeEffect['target']>, string][])
    .find(([, label]) => label === v)?.[0];
  return byLabel ?? LEGACY_TARGET_LABELS[v];
}

/** Parse a positive integer value; invalid/missing -> undefined. */
export function parseRuntimeValue(s: unknown): number | undefined {
  const v = cleanCell(s);
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

// ── Effect column groups (Excel) ────────────────────────────────────

export type EffectGroupWidth = 3 | 6 | 7;

export const EFFECT_GROUP_COLS_V1 = ['标注', '触发', '描述'] as const;
export const EFFECT_GROUP_COLS_V2 = ['标注', '触发', '效果类型', '数值', '目标', '描述'] as const;
/** v2.8.3（刀 B）：第 7 列「门槛」——大白话文本，多条件用顿号/逗号/换行分隔。 */
export const EFFECT_GROUP_COLS_V3 = [...EFFECT_GROUP_COLS_V2, '门槛'] as const;

/** Header cells for effect group n (1-based), current (7-col) format. */
export function effectGroupHeaders(n: number): string[] {
  return EFFECT_GROUP_COLS_V3.map(c => `效果${n}${c}`);
}

/** Detect the effect-group width of a sheet from its header row. */
export function detectEffectGroupWidth(header: unknown[]): EffectGroupWidth {
  const cells = header.map(h => String(h ?? '').trim());
  if (cells.some(h => /^效果\d+门槛/.test(h))) return 7;
  return cells.some(h => /^效果\d+效果类型$/.test(h)) ? 6 : 3;
}

/**
 * v2.8.11 刀2：固定列「技能门槛」＝**整组门槛**（技能级，先判；不过则这一刻
 * 整条技能不响）。效果组第 7 列「效果N门槛」是**逐项门槛**（后判）。
 */
export const SKILL_GATE_HEADER = '技能门槛';

/**
 * 效果组起始列（0-based），从表头认而不是写死：v2.8.10 及更早的导出里固定列
 * 是 11 列（组从 11 开始），v2.8.11 起插入「技能门槛」⇒ 组从 12 开始。
 * 认不出「效果1标注」时回退 11（=旧版逐字行为）。
 */
export function detectEffectGroupStart(header: unknown[]): number {
  const idx = header.findIndex(h => /^效果1标注$/.test(String(h ?? '').trim()));
  return idx >= 0 ? idx : 11;
}

/** Export cell for the 整组门槛 column. */
export function serializeSkillGate(conditions?: SkillCondition[]): string {
  return gateConditionsToText(conditions);
}

/** Import cell for the 整组门槛 column（读不懂的碎片由调用方回显，绝不静默丢）。 */
export function parseSkillGate(text: string): { conditions?: SkillCondition[]; unknown: string[] } {
  const gate = parseGateText(text);
  return {
    conditions: gate.conditions.length > 0 ? gate.conditions : undefined,
    unknown: gate.unknown,
  };
}

/** Fields parsed out of one effect column group (id assigned by caller). */
export type ParsedEffectFields = Omit<SkillEffect, 'id'>;

/** One effect group's parse result: the editable fields + 门槛栏里读不懂的碎片。 */
export interface ParsedEffectGroup {
  fields: ParsedEffectFields;
  /** 门槛单元格中无法翻译成条件的原文片段（逐条回显给导入报告，绝不静默丢弃）。 */
  gateUnknown: string[];
  /** 整组只写了门槛、没写"这是哪个效果"（无标注/触发/类型/描述）。门槛必须挂在
   *  某个具体效果上，此处**不凭空造一个效果**，把原文交回导入面报告。 */
  orphanGate?: string;
  /** 「触发」栏没看懂的原文（含只写了一半的细分写法）：不填、不猜，交回导入面。 */
  triggerUnreadable?: string;
}

/**
 * Parse one effect group starting at `col` (0-based) with the given width.
 * Returns null when the whole group is blank.
 */
export function parseEffectGroup(
  row: (string | number | undefined)[],
  col: number,
  width: EffectGroupWidth,
): ParsedEffectGroup | null {
  const get = (k: number) => cleanCell(row[col + k]);
  const label = get(0);
  const triggerStr = get(1);
  let runtimeStr = { type: '', value: '', target: '' };
  let desc: string;
  let gateStr = '';
  if (width === 3) {
    desc = get(2);
  } else {
    runtimeStr = { type: get(2), value: get(3), target: get(4) };
    desc = get(5);
    if (width === 7) gateStr = get(6);
  }
  const hasEffectBody = !!(label || desc || runtimeStr.type);
  const triggerRead = readTriggerCell(triggerStr);
  const canFormEffect = hasEffectBody || !!triggerRead.trigger;
  if (!canFormEffect && !gateStr && !triggerRead.unreadable) return null;
  if (!canFormEffect) {
    // 这一组里没有一个"站得住的效果"（只写了门槛，或触发写法没看懂）：
    // 不凭空造一个空效果占位（那会挤占效果编号并显示成"纯描述"），
    // 把原文交回导入面如实报告。
    return { fields: {}, gateUnknown: [], orphanGate: gateStr, triggerUnreadable: triggerRead.unreadable };
  }

  const type = parseRuntimeType(runtimeStr.type);
  const target = parseRuntimeTarget(runtimeStr.target);
  const value = parseRuntimeValue(runtimeStr.value);

  const fields: ParsedEffectFields = {};
  if (label) fields.label = label;
  if (triggerRead.trigger) fields.trigger = triggerRead.trigger;
  if (desc) fields.description = desc;
  if (type) {
    fields.runtime = { type };
    if (value != null) fields.runtime.value = value;
    if (target) fields.runtime.target = target;
  }
  const gate = parseGateText(gateStr);
  if (gate.conditions.length > 0) fields.conditions = gate.conditions;
  return { fields, gateUnknown: gate.unknown, triggerUnreadable: triggerRead.unreadable };
}

/** Serialize one effect into cells for the given width (export path). */
export function serializeEffectGroup(
  eff: SkillEffect | undefined,
  width: EffectGroupWidth,
): (string | number)[] {
  if (!eff) {
    if (width === 7) return [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
    return width === 6
      ? [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]
      : [EMPTY, EMPTY, EMPTY];
  }
  const label = eff.label || EMPTY;
  const trigger = triggerToStr(eff.trigger);
  if (width === 3) {
    return [label, trigger, eff.description || EMPTY];
  }
  const rt = eff.runtime;
  const cells: (string | number)[] = [
    label,
    trigger,
    rt ? runtimeEffectTypeLabels[rt.type] : EMPTY,
    rt && rt.value != null ? rt.value : EMPTY,
    rt && rt.target ? runtimeTargetLabels[rt.target] : EMPTY,
    eff.description || EMPTY,
  ];
  if (width === 7) cells.push(gateConditionsToText(eff.conditions));
  return cells;
}
