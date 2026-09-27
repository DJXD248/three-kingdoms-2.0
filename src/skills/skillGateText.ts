/**
 * skillGateText — 门槛（发动条件）的大白话文本 <-> 结构化条件互转。
 *
 * 录入面唯一语法（v2.8.3，刀 B）：一条门槛=「对象? 度量 运算符 (度量|数字)」，
 * 多条之间用顿号/逗号/分号/换行分隔，语义为「全部成立才发动」。
 *   手牌≤2，牌堆≥5 / 自身体力=1 / 被作用者手牌>自身手牌 / 无
 *
 * 只认这 6 个度量（都是对局里已经记录下来的事实，见 skillConditions.ts）：
 *   手牌 / 体力 / 护甲 / 场上将领 / 牌堆 / 本次伤害
 * 对象只有 3 个：自身（缺省）/ 被作用者 / 伤害来源。
 *
 * 失败即闭（fail-closed）：读不懂的片段一律进 unknown 交回录入面报告，
 * 绝不猜成别的条件，也绝不"当作没写"——技能宁可不发，不能乱发。
 */

import type {
  SkillCondition,
  SkillConditionMetric,
  SkillConditionOperator,
  SkillConditionSubject,
} from './dataTypes';

export const GATE_METRIC_LABELS: Record<SkillConditionMetric, string> = {
  HAND_COUNT: '手牌',
  GENERAL_HP: '体力',
  ARMOR_POINTS: '护甲',
  FIELD_GENERAL_COUNT: '场上将领',
  DECK_COUNT: '牌堆',
  EVENT_VALUE: '本次伤害',
};

export const GATE_SUBJECT_LABELS: Record<SkillConditionSubject, string> = {
  SELF: '自身',
  TARGET: '被作用者',
  ATTACKER: '伤害来源',
};

export const GATE_OPERATOR_LABELS: Record<SkillConditionOperator, string> = {
  LT: '<',
  LTE: '≤',
  EQ: '=',
  GTE: '≥',
  GT: '>',
};

/** 度量别名 -> 度量（按别名长度从长到短匹配，避免"手牌数"被"手牌"截走）。 */
const METRIC_ALIASES: [string, SkillConditionMetric][] = [
  ['场上将领数', 'FIELD_GENERAL_COUNT'], ['场上将领', 'FIELD_GENERAL_COUNT'],
  ['在场将领数', 'FIELD_GENERAL_COUNT'], ['在场将领', 'FIELD_GENERAL_COUNT'],
  ['牌堆剩余张数', 'DECK_COUNT'], ['牌堆剩余张', 'DECK_COUNT'], ['牌堆剩余', 'DECK_COUNT'],
  ['牌堆张数', 'DECK_COUNT'], ['牌堆', 'DECK_COUNT'],
  ['本次伤害值', 'EVENT_VALUE'], ['这次伤害值', 'EVENT_VALUE'],
  ['本次伤害', 'EVENT_VALUE'], ['这次伤害', 'EVENT_VALUE'], ['伤害值', 'EVENT_VALUE'],
  ['手牌数', 'HAND_COUNT'], ['手牌', 'HAND_COUNT'],
  ['体力值', 'GENERAL_HP'], ['体力', 'GENERAL_HP'],
  ['护甲数', 'ARMOR_POINTS'], ['护甲值', 'ARMOR_POINTS'], ['护甲', 'ARMOR_POINTS'],
];

const SUBJECT_ALIASES: [string, SkillConditionSubject][] = [
  ['己方玩家', 'SELF'], ['我方玩家', 'SELF'], ['自己', 'SELF'], ['自身', 'SELF'],
  ['被作用者', 'TARGET'], ['受击者', 'TARGET'], ['目标', 'TARGET'],
  ['伤害来源', 'ATTACKER'], ['攻击方', 'ATTACKER'], ['进攻角色', 'ATTACKER'], ['来源', 'ATTACKER'],
];

const OPERATOR_TOKENS: [string, SkillConditionOperator][] = [
  ['不大于', 'LTE'], ['不超过', 'LTE'], ['不少于', 'GTE'], ['不小于', 'GTE'], ['至少', 'GTE'],
  ['大于等于', 'GTE'], ['小于等于', 'LTE'], ['不低于', 'GTE'], ['不到', 'LT'], ['超过', 'GT'],
  ['等于', 'EQ'], ['小于', 'LT'], ['少于', 'LT'], ['大于', 'GT'], ['多于', 'GT'],
  ['数量为', 'EQ'], ['数目为', 'EQ'], ['为', 'EQ'], ['是', 'EQ'],
  ['<=', 'LTE'], ['>=', 'GTE'], ['≤', 'LTE'], ['≥', 'GTE'], ['＜', 'LT'], ['＞', 'GT'],
  ['=', 'EQ'], ['<', 'LT'], ['>', 'GT'],
];

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseNumber(raw: string): number | undefined {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1 && CN_DIGITS[s] !== undefined) return CN_DIGITS[s];
  if (s.startsWith('十') && s.length === 2 && CN_DIGITS[s[1]] !== undefined) return 10 + CN_DIGITS[s[1]];
  if (s.endsWith('十') && s.length === 2 && CN_DIGITS[s[0]] !== undefined) return CN_DIGITS[s[0]] * 10;
  return undefined;
}

/** 量词尾巴：「手牌数量」「牌堆数」「体力数目」与「手牌」「牌堆」「体力」同义，只在整词出现时剥。 */
const COUNT_SUFFIX = /^(数量|数目|数|量)$/;

function matchMetric(text: string): { metric: SkillConditionMetric; rest: string } | null {
  for (const [alias, metric] of METRIC_ALIASES) {
    if (!text.startsWith(alias)) continue;
    const tail = text.slice(alias.length).trim();
    return { metric, rest: COUNT_SUFFIX.test(tail) ? '' : tail };
  }
  return null;
}

function matchSubject(text: string): { subject?: SkillConditionSubject; rest: string } {
  for (const [alias, subject] of SUBJECT_ALIASES) {
    if (text.startsWith(alias)) return { subject, rest: text.slice(alias.length).replace(/^的/, '') };
  }
  return { rest: text };
}

/**
 * 在句子里找运算符：位置最靠前者优先，同一位置长词优先
 * （"数量为1" 走 数量为=EQ 而不是 为=EQ；"大于等于" 不会被 "大于" 截走）。
 */
function splitClause(clause: string): { left: string; op: SkillConditionOperator; right: string } | null {
  let best: { at: number; token: string; op: SkillConditionOperator } | undefined;
  for (const [token, op] of OPERATOR_TOKENS) {
    const at = clause.indexOf(token);
    if (at <= 0) continue;
    if (!best || at < best.at || (at === best.at && token.length > best.token.length)) {
      best = { at, token, op };
    }
  }
  if (!best) return null;
  return {
    left: clause.slice(0, best.at).trim(),
    op: best.op,
    right: clause.slice(best.at + best.token.length).trim(),
  };
}

function parseOne(clause: string): SkillCondition | null {
  const parts = splitClause(clause);
  if (!parts) return null;
  const leftHead = matchSubject(parts.left);
  const leftMetric = matchMetric(leftHead.rest.trim());
  if (!leftMetric || leftMetric.rest.trim() !== '') return null;
  const condition: SkillCondition = { metric: leftMetric.metric, op: parts.op };
  // 「自身」就是缺省对象（skillConditions 里 subject ?? 'SELF'），写出来只多一层噪音，
  // 也会让「写法→结构→写法」的往返对不上，所以统一不落这个字段。
  // 牌堆与本次伤害是全局事实、没有"属于谁"，主体同理不落（评估器本来就忽略它，
  // 留着会让回显显示一个不生效的限制，那是骗人）。
  const subjectless = leftMetric.metric === 'DECK_COUNT' || leftMetric.metric === 'EVENT_VALUE';
  if (leftHead.subject && leftHead.subject !== 'SELF' && !subjectless) condition.subject = leftHead.subject;

  // 比较词后面常跟一个「为/是」赘词（至少为2、不超过是3），数字本身不会以它们开头。
  const right = parts.right.replace(/^[为是]\s*/, '');
  const rightNumber = parseNumber(right);
  if (rightNumber !== undefined) {
    condition.value = rightNumber;
    return condition;
  }
  const rightHead = matchSubject(right);
  const rightMetric = matchMetric(rightHead.rest.trim());
  if (!rightMetric || rightMetric.rest.trim() !== '') return null;
  condition.compareTo = { metric: rightMetric.metric };
  if (rightHead.subject && rightHead.subject !== 'SELF') condition.compareTo.subject = rightHead.subject;
  return condition;
}

export interface GateParseResult {
  conditions: SkillCondition[];
  /** 读不懂的原文片段（逐条回显给录入面，绝不静默丢弃）。 */
  unknown: string[];
}

/** 解析门槛文本。空/「无」= 没有门槛；看不懂的部分进 unknown。 */
export function parseGateText(text: unknown): GateParseResult {
  const raw = String(text ?? '').trim();
  if (!raw || raw === '无') return { conditions: [], unknown: [] };
  const conditions: SkillCondition[] = [];
  const unknown: string[] = [];
  for (const clause of raw.split(/[、，,；;\n]+/)) {
    const trimmed = clause.trim();
    if (!trimmed || trimmed === '无') continue;
    const parsed = parseOne(trimmed);
    if (parsed) conditions.push(parsed);
    else unknown.push(trimmed);
  }
  return { conditions, unknown };
}

function conditionToText(c: SkillCondition): string {
  const subject = c.subject && c.subject !== 'SELF' ? GATE_SUBJECT_LABELS[c.subject] : '';
  const left = `${subject}${GATE_METRIC_LABELS[c.metric]}`;
  const right = c.compareTo
    ? `${c.compareTo.subject && c.compareTo.subject !== 'SELF' ? GATE_SUBJECT_LABELS[c.compareTo.subject] : ''}${GATE_METRIC_LABELS[c.compareTo.metric]}`
    : String(c.value ?? '');
  return `${left}${GATE_OPERATOR_LABELS[c.op]}${right}`;
}

/** 结构化条件 -> 表格里的那句大白话（导出/编辑器回显用）。 */
export function gateConditionsToText(conditions?: SkillCondition[]): string {
  if (!conditions || conditions.length === 0) return '无';
  return conditions.map(conditionToText).join('，');
}

/** 一句门槛提示语（编辑器/导入报告共用措辞）。 */
export const GATE_SYNTAX_HINT =
  '写法：手牌≤2，牌堆≥5（多条件用顿号或逗号＝都要满足）；可填的量只有 手牌/体力/护甲/场上将领/牌堆/本次伤害，对象只有 自身/被作用者/伤害来源';
