/**
 * skillExcelFormat — pure helpers for the SkillEditor Excel format.
 *
 * Responsibilities (all side-effect free, unit-testable):
 *   - trigger config <-> readable string ("部署时→上阵", round-trip safe);
 *   - structured runtime effect fields (类型/数值/目标) <-> strings;
 *   - effect column-group serialization & parsing for BOTH widths:
 *       v1 (legacy, 3 cols): 标注 | 触发 | 描述
 *       v2 (current, 6 cols): 标注 | 触发 | 效果类型 | 数值 | 目标 | 描述
 *     Width is detected from the header row, so old exported files still import.
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
  DeploySubType,
  TurnSubType,
  DamageSubType,
  KillSubType,
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
  expireLabels,
} from '../data/generals';

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
    if (subKind === 'expire') cfg.expireCondition = (Object.entries(expireLabels) as [ExpireCondition, string][]).find(([, v]) => v === subLabel)?.[0];
  }
  return cfg;
}

// ── Runtime effect fields ───────────────────────────────────────────

export const runtimeEffectTypeLabels: Record<SkillRuntimeEffect['type'], string> = {
  DRAW_CARD: '摸牌',
  DAMAGE: '伤害',
  HEAL: '回复体力',
  GAIN_ARMOR: '获得护甲',
  DISCARD: '弃牌',
};

/** Types the compiler can settle today (see skillCompiler SUPPORTED_EFFECT_TYPES). */
export const SETTLEABLE_RUNTIME_TYPES: readonly SkillRuntimeEffect['type'][] = ['DRAW_CARD', 'DAMAGE', 'HEAL', 'GAIN_ARMOR', 'DISCARD'];

export const runtimeTargetLabels: Record<NonNullable<SkillRuntimeEffect['target']>, string> = {
  SELF: '自身',
  ATTACKER: '伤害来源',
  TARGET: '被作用者',
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
  return (Object.entries(runtimeEffectTypeLabels) as [SkillRuntimeEffect['type'], string][])
    .find(([, label]) => label === v)?.[0];
}

/** Parse "自身"/"SELF" -> target; anything else -> undefined. */
export function parseRuntimeTarget(s: string): SkillRuntimeEffect['target'] | undefined {
  const v = cleanCell(s);
  if (!v) return undefined;
  const upper = v.toUpperCase();
  const byEnum = (Object.keys(runtimeTargetLabels) as SkillRuntimeEffect['target'][])
    .find(t => t === upper);
  if (byEnum) return byEnum;
  return (Object.entries(runtimeTargetLabels) as [NonNullable<SkillRuntimeEffect['target']>, string][])
    .find(([, label]) => label === v)?.[0];
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

export type EffectGroupWidth = 3 | 6;

export const EFFECT_GROUP_COLS_V1 = ['标注', '触发', '描述'] as const;
export const EFFECT_GROUP_COLS_V2 = ['标注', '触发', '效果类型', '数值', '目标', '描述'] as const;

/** Header cells for effect group n (1-based), v2 format. */
export function effectGroupHeaders(n: number): string[] {
  return EFFECT_GROUP_COLS_V2.map(c => `效果${n}${c}`);
}

/** Detect the effect-group width of a sheet from its header row. */
export function detectEffectGroupWidth(header: unknown[]): EffectGroupWidth {
  return header.some(h => /^效果\d+效果类型$/.test(String(h ?? '').trim())) ? 6 : 3;
}

/** Fields parsed out of one effect column group (id assigned by caller). */
export type ParsedEffectFields = Omit<SkillEffect, 'id'>;

/**
 * Parse one effect group starting at `col` (0-based) with the given width.
 * Returns null when the whole group is blank.
 */
export function parseEffectGroup(
  row: (string | number | undefined)[],
  col: number,
  width: EffectGroupWidth,
): ParsedEffectFields | null {
  const get = (k: number) => cleanCell(row[col + k]);
  const label = get(0);
  const triggerStr = get(1);
  let runtimeStr = { type: '', value: '', target: '' };
  let desc: string;
  if (width === 6) {
    runtimeStr = { type: get(2), value: get(3), target: get(4) };
    desc = get(5);
  } else {
    desc = get(2);
  }
  if (!label && !triggerStr && !desc && !runtimeStr.type) return null;

  const type = parseRuntimeType(runtimeStr.type);
  const target = parseRuntimeTarget(runtimeStr.target);
  const value = parseRuntimeValue(runtimeStr.value);

  const fields: ParsedEffectFields = {};
  if (label) fields.label = label;
  const trigger = strToTrigger(triggerStr);
  if (trigger) fields.trigger = trigger;
  if (desc) fields.description = desc;
  if (type) {
    fields.runtime = { type };
    if (value != null) fields.runtime.value = value;
    if (target) fields.runtime.target = target;
  }
  return fields;
}

/** Serialize one effect into cells for the given width (export path). */
export function serializeEffectGroup(
  eff: SkillEffect | undefined,
  width: EffectGroupWidth,
): (string | number)[] {
  if (!eff) {
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
  return [
    label,
    trigger,
    rt ? runtimeEffectTypeLabels[rt.type] : EMPTY,
    rt && rt.value != null ? rt.value : EMPTY,
    rt && rt.target ? runtimeTargetLabels[rt.target] : EMPTY,
    eff.description || EMPTY,
  ];
}
