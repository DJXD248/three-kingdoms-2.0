/**
 * skillExcelFormat — pure helpers for the SkillEditor Excel format.
 *
 * Responsibilities (all side-effect free, unit-testable):
 *   - trigger config <-> readable string ("部署时→上阵", round-trip safe);
 *   - structured runtime effect fields (类型/数值/目标) <-> strings;
 *   - effect column-group serialization & parsing for ALL widths:
 *       v1 (legacy, 3 cols): 标注 | 触发 | 描述
 *       v2 (6 cols): 标注 | 触发 | 效果类型 | 数值 | 目标 | 描述
 *       v3 (7 cols): v2 + 门槛
 *       v4 (current, 8 cols): v3 + 我听谁（v2.8.21 监听扩面刀）
 *     Width is detected from the header row, so old exported files still import.
 *   - 门槛（发动条件）cell <-> structured conditions, via skillGateText.ts.
 *   - 「我听谁」cell <-> ListenerScope：它是**独立一列**，不挤进触发那句话里，
 *     因为它与「伤害类型」那类细分是并存的第二轴（同一刻既要挑"哪种伤害"
 *     也要挑"听谁的事"，一句话装不下两个正交的选择）。
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
  TargetSubType,
  ListenerScope,
  ExpireCondition,
} from '../data/generals';
import {
  allTriggerTypes,
  triggerTypeLabels,
  getTriggerSubOptions,
  supportsListenerScope,
  deploySubLabels,
  turnSubLabels,
  damageSubLabels,
  killSubLabels,
  cardSubLabels,
  targetSubLabels,
  listenerScopeLabels,
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

/** Format a trigger config as a readable string; undefined -> "无".
 *  「我听谁」不写进这句话——它住在自己的列里（`LISTENER_SCOPE_HEADER`）。 */
export function triggerToStr(t?: SkillTriggerConfig): string {
  if (!t || !t.type) return EMPTY;
  let s = triggerTypeLabels[t.type] || t.type;
  const sub = getTriggerSubOptions(t.type);
  if (sub === 'deploy' && t.deploySubType) s += '→' + deploySubLabels[t.deploySubType];
  if (sub === 'turn' && t.turnSubType) s += '→' + turnSubLabels[t.turnSubType];
  if (sub === 'damage' && t.damageSubType) s += '→' + damageSubLabels[t.damageSubType];
  if (sub === 'target' && t.targetSubType) s += '→' + targetSubLabels[t.targetSubType];
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
    else if (subKind === 'target') labels = Object.values(targetSubLabels);
    else if (subKind === 'kill') labels = Object.values(killSubLabels);
    else if (subKind === 'card') labels = Object.values(cardSubLabels);
    else labels = Object.values(expireLabels);
    for (const label of labels) opts.push(`${main}→${label}`);
  }
  return opts;
}

/**
 * v2.8.18 词汇收口（用户裁决第 4 句原文：「"装备"这个词：把技能描述改成"军备"」）留下的旧词。
 * **只在读入侧认，绝不写出**（与下面的 `LEGACY_TYPE_LABELS` 同一族规矩）。
 * 不认这一枚别名会静默放宽语义：`strToTrigger` 找不到 `cardSubType` 时返回的是
 * 不带细分的 `{ type: 'onCardLost' }`，编译器把它读成"失去任意牌"——枭姬从
 * "失去军备牌才摸两张"变成"丢任何牌都摸两张"。
 */
const LEGACY_CARD_SUB_LABELS: Record<string, CardSubType> = { 失去装备牌: 'equipmentLost' };

/**
 * v2.8.21 整格别名（同一个单向门，只是这次换的是**主名**）：`onBecomingTarget`
 * 原来只有一个写死的名字「成为攻击目标时」，来源扩成三档后主名改成了泛指的
 * 「成为目标时」。旧文件里那一格整句就是旧主名，所以别名挂在**整格**上、
 * 归一成正现行的「成为目标时→成为攻击目标」再走严格读法；**写出侧只出现行写法**。
 * 不认这一枚别名的后果与上面那族一样：老 `.xlsx` 里的受击类技能会读成"没看懂"，
 * 技能照进、照显示、只是不再响。
 */
const LEGACY_TRIGGER_CELL_ALIASES: Record<string, string> = {
  成为攻击目标时: `${triggerTypeLabels.onBecomingTarget}→${targetSubLabels.attackTarget}`,
};

/** 把 cell 里的旧细分词换成现行写法；不认识的一律原样交回。 */
function normaliseLegacySubLabel(s: string): string {
  const whole = LEGACY_TRIGGER_CELL_ALIASES[s];
  if (whole) return whole;
  const i = s.indexOf('→');
  if (i < 0) return s;
  const sub = s.slice(i + 1).trim();
  const mapped = LEGACY_CARD_SUB_LABELS[sub];
  return mapped ? `${s.slice(0, i)}→${cardSubLabels[mapped]}` : s;
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
    if (subKind === 'target') cfg.targetSubType = (Object.entries(targetSubLabels) as [TargetSubType, string][]).find(([, v]) => v === subLabel)?.[0];
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
  const canonical = normaliseLegacySubLabel(trimmed);
  const parsed = strToTrigger(canonical);
  if (parsed && triggerToStr(parsed) === canonical) return { trigger: parsed };
  return { unreadable: trimmed };
}

// ── 「我听谁」（v2.8.21 监听扩面刀：独立一列，技能级与逐效果级各一列） ────

/** 固定列名＝技能级那一栏；效果组第 8 列名是 `效果N我听谁`。 */
export const LISTENER_SCOPE_HEADER = '我听谁';

/** 写出侧：三档都写现行标签，没填＝「无」（＝只听自己＝扩面前的逐字行为）。 */
export function listenerScopeToStr(scope?: ListenerScope): string {
  return scope ? listenerScopeLabels[scope] : EMPTY;
}

export interface ListenerScopeRead {
  scope?: ListenerScope;
  /** 这一格写了字但词表认不出来：原文交回导入面逐条点名，绝不静默丢。 */
  unknown?: string;
}

/** 只翻译词表，**不判断这一格挂的时机认不认这一栏**——那句人话由调用方写
 *  （只有录入侧知道"这是谁的哪个效果"，报得出名字；同 v2.8.3 门槛的分工）。
 *  时机认不认这一栏由 `data/generals.ts` 的 `supportsListenerScope` 单点判定
 *  （编译器与录入面共用同一个根，不许两处各写一份）。 */
export function readListenerScopeCell(raw: unknown): ListenerScopeRead {
  const cell = cleanCell(raw);
  if (!cell) return {};
  const scope = (Object.entries(listenerScopeLabels) as [ListenerScope, string][])
    .find(([, label]) => label === cell)?.[0];
  return scope ? { scope } : { unknown: cell };
}

/** 三档的 Excel 下拉内容（「无」＝不填＝只听自己）。 */
export const LISTENER_SCOPE_LIST = [EMPTY, ...Object.values(listenerScopeLabels)].join(',');

/** 贴在这两列（技能级「我听谁」＋「效果N我听谁」）表头批注上的一句话。 */
export const LISTENER_SCOPE_HINT =
  '「我听谁」＝这一声响的时候，技能听多宽：只听自己／听己方（同一席位）／听场上（所有玩家）。'
  + '留空＝只听自己（与今天对局一致）。'
  + '只有部署、回合开始、成为目标、受到伤害、造成伤害、击杀、阵亡、失去牌、获得牌这些时机认这一栏；'
  + '别的时机填了会按没填处理，并在导入报告里点名（不会静默收下）。';

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
  DUEL: '决斗',
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
export const SETTLEABLE_RUNTIME_TYPES: readonly SkillRuntimeEffect['type'][] = ['DRAW_CARD', 'DAMAGE', 'HEAL', 'GAIN_ARMOR', 'DISCARD', 'GIVE', 'EQUIP_STRIP', 'REVEAL', 'DECK_PLACE', 'DUEL'];

/**
 * 2.8 刀9：**根本不读「数值」格的类型**。决斗的轮数是规则常量（双方各三轮＝
 * 最多六次，§H9 第六轮①），把它做成可填数字＝"界面写 1、生效是 6"的分叉
 * （§12-55／v2.8.13 同族），所以录入面不给它数字框、Excel 侧填了也点名退回。
 */
export const VALUELESS_RUNTIME_TYPES: readonly SkillRuntimeEffect['type'][] = ['DUEL'];

/**
 * 数值 `0` 在这几个类型里**有真含义**＝「整只手（全部）」：它们都经
 * `core/eventProcessors/handSelection.ts:42` 读欠账者的手牌，那里写着
 * `count === 0 ? 整只手`（官方卡蔡文姬·断肠就是这么写的）。
 * 其余类型**不许**填 0：摸牌 0＝摸不到牌、看牌堆顶根本不读这个数、
 * 伤害/回复/护甲/拆装备会被引擎自己夹回 1 ⇒ 全局放开数字框只会造出
 * 新一轮"看起来像没填、实际换成另一个数"的静默失真（§12-67）。
 */
export const WHOLE_HAND_RUNTIME_TYPES: readonly SkillRuntimeEffect['type'][] = ['DISCARD', 'GIVE', 'DECK_PLACE'];

/** 「0」在录入面上的唯一大白话说法（Excel 侧仍认数字 0，GUI 侧只认这句话）。 */
export const WHOLE_HAND_LABEL = '整只手（全部）';

/** 那三类效果在表格里的名字，用来把提醒写成一句能看懂的话。 */
const WHOLE_HAND_TYPE_NAMES = WHOLE_HAND_RUNTIME_TYPES.map(t => runtimeEffectTypeLabels[t]).join('、');

/**
 * 「数值」格里指代「整只手」的两种写法：用户自己的话（刀#49 方案2，用户
 * 2026-09-29 拍板：表格认这个词）与 GUI 复选框那句文案（照着界面抄也得能用）。
 * **只进不出**：导出侧永远写数字 0，别让表格长出第二种「全部」形态。
 */
const WHOLE_HAND_VALUE_ALIASES: readonly string[] = ['全部', WHOLE_HAND_LABEL];

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

/**
 * Parse the 数值 cell. 负数/小数/文字＝没有这个数（照旧 undefined）。
 * **0 必须认**：它是引擎的「全部」哨兵（`handSelection.ts` 里 `count === 0 ⇒ 整只手`），
 * 官方卡就这么写（断肠＝击杀者弃置全部手牌）。导出侧原样写出 0，导入侧若不认，
 * 用户把自己导出的 Excel 再导回去，就会把「弃置全部」悄悄改成「弃置 1 张」。
 */
export function parseRuntimeValue(s: unknown): number | undefined {
  const v = cleanCell(s);
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** 「数值」格按类型读的结果：`value`＝落进模型的数（undefined＝按没填），`note`＝要点名的原话。 */
export interface ValueCellRead {
  value?: number;
  note?: string;
}

/**
 * v2.8.13（#49 方案 B＋2，用户 2026-09-29 拍板）：「数值」格按**类型**收口。
 * 解析器不许再对 0 一视同仁——0 只在读手牌的那三类里等于「全部」，
 * 别的类型写下 0 会被引擎换成另一个数（摸牌/伤害/回复/护甲/拆装备夹成 1，
 * 看牌堆顶更狠：它的 0 不夹，就真的看 0 张）。那种"看着像填了、实际是另一个数"
 * 正是 §12-67 的静默失真，所以按没填处理**并点名**。
 */
export function readValueCell(raw: unknown, type?: SkillRuntimeEffect['type']): ValueCellRead {
  const cell = cleanCell(raw);
  if (!cell) return {};

  // 决斗这类根本不读数的类型：填了数字或「全部」才点名退回；
  // 「无」/看不懂的话沿用别的类型的习惯＝按没填，不作声。
  if (type && VALUELESS_RUNTIME_TYPES.includes(type)) {
    if (!WHOLE_HAND_VALUE_ALIASES.includes(cell) && parseRuntimeValue(cell) == null) return {};
    return {
      note: `「${runtimeEffectTypeLabels[type]}」没有数量可填（决斗的轮数由规则定死：双方各三轮、最多六次），`
        + `这一格按没填处理`,
    };
  }

  if (WHOLE_HAND_VALUE_ALIASES.includes(cell)) {
    if (type && WHOLE_HAND_RUNTIME_TYPES.includes(type)) return { value: 0 };
    if (type) {
      return {
        note: `「${cell}」＝整只手，只有 ${WHOLE_HAND_TYPE_NAMES} 认这个词；`
          + `「${runtimeEffectTypeLabels[type]}」的数值不认它，这一格按没填处理`,
      };
    }
    return {};
  }

  const n = parseRuntimeValue(cell);
  if (n == null || n > 0) return { value: n };
  if (type && WHOLE_HAND_RUNTIME_TYPES.includes(type)) return { value: 0 };
  if (!type) return {};

  const engineWouldDo = type === 'REVEAL'
    ? '而且引擎对它的 0 不会夹成 1——会真的「看 0 张」，一张也不看'
    : '引擎会把它当成 1';
  return {
    note: `数值填的是 0：只有 ${WHOLE_HAND_TYPE_NAMES} 认 0（＝整只手），`
      + `「${runtimeEffectTypeLabels[type]}」这一格按没填处理（${engineWouldDo}）`,
  };
}

// ── Effect column groups (Excel) ────────────────────────────────────

export type EffectGroupWidth = 3 | 6 | 7 | 8;

export const EFFECT_GROUP_COLS_V1 = ['标注', '触发', '描述'] as const;
export const EFFECT_GROUP_COLS_V2 = ['标注', '触发', '效果类型', '数值', '目标', '描述'] as const;
/** v2.8.3（刀 B）：第 7 列「门槛」——大白话文本，多条件用顿号/逗号/换行分隔。 */
export const EFFECT_GROUP_COLS_V3 = [...EFFECT_GROUP_COLS_V2, '门槛'] as const;
/** v2.8.21（监听扩面刀）：第 8 列「我听谁」——三档词表见 listenerScopeLabels。 */
export const EFFECT_GROUP_COLS_V4 = [...EFFECT_GROUP_COLS_V3, LISTENER_SCOPE_HEADER] as const;

/** Header cells for effect group n (1-based), current (8-col) format. */
export function effectGroupHeaders(n: number): string[] {
  return EFFECT_GROUP_COLS_V4.map(c => `效果${n}${c}`);
}

/** Detect the effect-group width of a sheet from its header row. */
export function detectEffectGroupWidth(header: unknown[]): EffectGroupWidth {
  const cells = header.map(h => String(h ?? '').trim());
  if (cells.some(h => /^效果\d+我听谁$/.test(h))) return 8;
  if (cells.some(h => /^效果\d+门槛$/.test(h))) return 7;
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
  /** 「数值」格这一格按没填处理时的大白话理由（#49 方案 B）：导入面必须点名，绝不静默换数。 */
  valueNote?: string;
  /** 「我听谁」格写了但词表认不出来（v2.8.21）：交回导入面点名。 */
  scopeUnknown?: string;
  /** 「我听谁」格认出来了，但这一组的触发时机不认这一栏（v2.8.21）：
   *  **不静默收下**——填了却没人读，就是下一轮的"显示与生效分叉"（§12-55 同族）。 */
  scopeIgnored?: string;
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
  let scopeStr = '';
  if (width === 3) {
    desc = get(2);
  } else {
    runtimeStr = { type: get(2), value: get(3), target: get(4) };
    desc = get(5);
    if (width === 7) gateStr = get(6);
    if (width === 8) { gateStr = get(6); scopeStr = get(7); }
  }
  const hasEffectBody = !!(label || desc || runtimeStr.type);
  const triggerRead = readTriggerCell(triggerStr);
  const canFormEffect = hasEffectBody || !!triggerRead.trigger;
  if (!canFormEffect && !gateStr && !scopeStr && !triggerRead.unreadable) return null;
  if (!canFormEffect) {
    // 这一组里没有一个"站得住的效果"（只写了门槛/只听谁，或触发写法没看懂）：
    // 不凭空造一个空效果占位（那会挤占效果编号并显示成"纯描述"），
    // 把原文交回导入面如实报告。
    return {
      fields: {},
      gateUnknown: [],
      orphanGate: gateStr,
      triggerUnreadable: triggerRead.unreadable,
      ...(scopeStr ? { scopeIgnored: scopeStr } : {}),
    };
  }

  const type = parseRuntimeType(runtimeStr.type);
  const target = parseRuntimeTarget(runtimeStr.target);
  const valueRead = readValueCell(runtimeStr.value, type);

  const fields: ParsedEffectFields = {};
  if (label) fields.label = label;
  if (triggerRead.trigger) fields.trigger = triggerRead.trigger;
  if (desc) fields.description = desc;
  if (type) {
    fields.runtime = { type };
    if (valueRead.value != null) fields.runtime.value = valueRead.value;
    if (target) fields.runtime.target = target;
  }
  const gate = parseGateText(gateStr);
  if (gate.conditions.length > 0) fields.conditions = gate.conditions;

  // 「我听谁」挂在**这一组的触发**上（与技能级那一栏是两回事，同门槛的两级分工）。
  const scopeRead = readListenerScopeCell(scopeStr);
  let scopeUnknown: string | undefined;
  let scopeIgnored: string | undefined;
  if (scopeRead.scope) {
    const fittedType = fields.trigger?.type;
    if (fittedType && supportsListenerScope(fittedType)) {
      fields.trigger = { ...(fields.trigger as SkillTriggerConfig), listenerScope: scopeRead.scope };
    } else {
      scopeIgnored = scopeStr;
    }
  } else if (scopeRead.unknown) {
    scopeUnknown = scopeRead.unknown;
  }

  return {
    fields,
    gateUnknown: gate.unknown,
    triggerUnreadable: triggerRead.unreadable,
    valueNote: valueRead.note,
    scopeUnknown,
    scopeIgnored,
  };
}

/** Serialize one effect into cells for the given width (export path). */
export function serializeEffectGroup(
  eff: SkillEffect | undefined,
  width: EffectGroupWidth,
): (string | number)[] {
  if (!eff) {
    if (width === 8) return [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
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
  if (width >= 7) cells.push(gateConditionsToText(eff.conditions));
  if (width === 8) cells.push(listenerScopeToStr(eff.trigger?.listenerScope));
  return cells;
}
