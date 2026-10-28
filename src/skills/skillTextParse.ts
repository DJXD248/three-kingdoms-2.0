/**
 * skillTextParse — 「玩家自己写一句效果 → 反推成积木」（v2.9.9）。
 *
 * 用户 2026-10-17 的原话：「让玩家自己写技能效果，然后生成一个技能给玩家确认，
 * 玩家觉得不对还能进入拼积木修改界面，遇到不支持的技能效果则返回说明哪一段不支持。」
 *
 * 三条硬规矩（决定了这个文件的形状）：
 * ① **没有大模型、没有网络**：成品是离线单文件 HTML，所以"看懂那句话"只能是确定性词表匹配。
 *    能力上限＝词表里已有的说法；认不出来的一律**逐段点名回显**，绝不猜一个像的出来
 *    （猜错＝玩家以为自己做成了另一个东西，比拒绝更坏）。
 * ② **词表只有一个出处**：时机词由 `triggerPhrase` 现场枚举出来（不另抄一份），
 *    数词走 `parseCountNumber`，门槛走 `parseGateText`，钥匙名走 `statModifierKeyLabels`，
 *    场合／周期／牌堆顶底／目标档位全部 `import` 自生成侧那一份。再加字段时先改生成侧、再在这里接住。
 * ③ **产出的就是积木本身**（`SkillEffect` 的 `runtime` 载荷），确认之后走的是今天这条编译路，
 *    不新增第二条结算路；描述写生成串 ⇒ 采用之后那句还跟着积木走（v2.9.8 的接线规则）。
 */

import {
  SkillCondition, SkillEffect, SkillEffectMode, SkillRuntimeEffect, SkillTriggerConfig,
  ListenerScope, allTriggerTypes, getTriggerSubOptions, supportsListenerScope,
  listenerScopeLabels, deployTimingWithIntent,
  deploySubLabels, turnSubLabels, damageSubLabels, targetSubLabels,
  killSubLabels, cardSubLabels, expireLabels, statModifierKeyLabels, allSkillTags,
  isValidTurnLimit,
} from '../data/generals';
import { runtimeTargetLabels } from './skillExcelFormat';
import { parseGateText, parseCountNumber } from './skillGateText';
import { judgeSkillEffect, type SkillSkip } from './skillCompiler';
import {
  triggerPhrase, effectSentence, OCCASION_PHRASES, DURATION_PHRASES,
  STAT_DEFAULT_DURATION_PHRASE,
} from './skillSentence';

type SkillSkipReason = SkillSkip['reason'];

/** 一段读不出来的原文＋给玩家看的大白话理由。 */
export interface SkillTextIssue {
  raw: string;
  reason: string;
}

/** 一句话解析出来的技能积木（与 `SkillEditEntry` 里那几格一一对应）。 */
export interface SkillTextDraft {
  /** 全句公用的时机（玩家单写一段"什么时候"时挂这里，采用时铺到每一块积木上）。 */
  trigger?: SkillTriggerConfig;
  /** 整组门槛。 */
  conditions?: SkillCondition[];
  effectMode?: SkillEffectMode;
  /** 限次刀：技能级那一格「每回合限 N 次」（整条技能公用，不是某一块的）。
   *  只在读出一个 1 以上的整数时才挂这里；读不出的那一串进 `issues` 点名，绝不兜底成 1。 */
  turnLimit?: number;
  effects: SkillEffect[];
  /** 读不懂／形状不合法 ⇒ **这一块没有生成**，逐段点名。 */
  issues: SkillTextIssue[];
  /** 这块积木拼出来了、也采用了，但它踩在**引擎今天还没接线**的那一格上（例如只有下拉
   *  里有的时机）。不拦采用——录入面本来就允许比引擎先行（用户 2026-10-17 关于"目标"那一格
   *  的裁决就是这个口径）——但必须当场说出来，不能让玩家以为它已经会响。 */
  notices: SkillTextIssue[];
  /** 被当成连接词忽略掉的词（玩家看得见"这几句我没当意思"，不是偷偷丢）。 */
  ignored: string[];
}

// ── 切句：只在括号外面切 ────────────────────────────────────────────
// 「（决斗时，用掉就销）」「「怒斩」」里的顿号逗号属于字段内部，切开会碎掉一个词。

function splitTop(text: string, seps: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '（' || ch === '(' || ch === '「' || ch === '『') depth++;
    else if (ch === '）' || ch === ')' || ch === '」' || ch === '』') depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch)) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

/** 只当连接词、不承载任何字段的值（忽略时必须回显给玩家，见 `ignored`）。 */
const CONNECTIVES = ['你可以', '你可以选择', '可以', '请', '立即', '立刻', '然后', '接着', '并', '并且', '同时', '该技能', '此技能'];

function stripConnectives(fragment: string): { text: string; dropped: string[] } {
  let text = fragment;
  const dropped: string[] = [];
  for (const word of CONNECTIVES) {
    if (!text.includes(word)) continue;
    text = text.split(word).join('');
    dropped.push(word);
  }
  return { text: text.trim(), dropped };
}

// ── 时机：由生成侧那份词**现场枚举**，不抄第二份名单 ──────────────────

type SubAxis = 'deploy' | 'turn' | 'damage' | 'target' | 'kill' | 'card' | 'expire';
const SUB_TABLES: Record<SubAxis, { labels: Record<string, string>; key: keyof SkillTriggerConfig }> = {
  deploy: { labels: deploySubLabels, key: 'deploySubType' },
  turn: { labels: turnSubLabels, key: 'turnSubType' },
  damage: { labels: damageSubLabels, key: 'damageSubType' },
  target: { labels: targetSubLabels, key: 'targetSubType' },
  kill: { labels: killSubLabels, key: 'killSubType' },
  card: { labels: cardSubLabels, key: 'cardSubType' },
  expire: { labels: expireLabels, key: 'expireCondition' },
};

const TRIGGER_INDEX: Map<string, SkillTriggerConfig> = (() => {
  const map = new Map<string, SkillTriggerConfig>();
  for (const type of allTriggerTypes) {
    const axis = getTriggerSubOptions(type);
    // 档位名单一律从 `listenerScopeLabels` 现场取键（词表加了档而这里抄旧名单＝
    // 那一档永远反解不出来，正是"一处词两份写法迟早分叉"的那条）。
    const scopeOptions: (ListenerScope | undefined)[] =
      supportsListenerScope(type)
        ? [undefined, ...(Object.keys(listenerScopeLabels) as ListenerScope[])]
        : [undefined];
    const subKeys: (string | undefined)[] = axis ? [undefined, ...Object.keys(SUB_TABLES[axis].labels)] : [undefined];
    for (const sub of subKeys) {
      for (const listenerScope of scopeOptions) {
        const cfg: SkillTriggerConfig = { type };
        if (sub && axis) (cfg as unknown as Record<string, unknown>)[SUB_TABLES[axis].key] = sub;
        if (listenerScope) cfg.listenerScope = listenerScope;
        const text = triggerPhrase(cfg);
        if (text && !map.has(text)) map.set(text, cfg);
        // v2.9.13（甲档）：只有「登场时」这一格额外收用户自己的那种带定语的写法
        // （拼法只有一个出处＝`deployTimingWithIntent`，这里不手抄）。别的时机的定语
        // 主语不是"谁登场"，替用户造句子超出这一刀，档位仍可从「我听谁」那一格与
        // Excel 第 8 列录入。
        if (type === 'onDeploy' && listenerScope) {
          const intent = deployTimingWithIntent(listenerScope);
          if (!map.has(intent)) map.set(intent, cfg);
        }
      }
    }
  }
  return map;
})();

function matchTrigger(fragment: string): SkillTriggerConfig | undefined {
  return TRIGGER_INDEX.get(fragment);
}

// ── 读入侧写法别名（v2.9.22 刀5＝用户 2026-10-27 拍板的「633 条描述走出口①＝补词表/别名」）──
// **只进不出**：这批说法只喂 `parseSkillText` 的读入侧。生成侧那一份词源（`triggerPhrase`／
// `skillSentence`）与导出串一字不改⇒卡面话永远还是系统那一套，玩家的写法不会长进产物里
// （与 `LEGACY_TYPE_LABELS`／`LEGACY_TRIGGER_CELL_ALIASES` 同族规矩，§12-110）。
// 别名右边一律给**结构化档位**、串由 `triggerPhrase` 现场生成；钥匙名一律现场取
// `statModifierKeyLabels`——上面第 ② 条"词表只有一个出处"不因这批别名而破例。
// 命中判据＝**整片段相等**（`$` 收尾）。绝不做子串替换：切在括号外的分隔符上、整片才换，
// 这是"吃掉分隔符"与"把一句话改成另一句话"那两类事故的正面判据。
const ALIAS_HEAD = '(?:当|每当|每)?(?:你|自身|自己)?的?';
const ALIAS_TAIL = '(?:时候|候|时)?';

/** 玩家常见的时机说法 → 引擎里那一档（档位变了⇒串跟着变，不手抄 223 条里的任何一条）。 */
const TRIGGER_ALIASES: { re: RegExp; trigger: SkillTriggerConfig }[] = [
  { re: new RegExp(`^${ALIAS_HEAD}(?:死亡|阵亡|战死|被击杀|被杀|殉职)${ALIAS_TAIL}$`), trigger: { type: 'onDeath' } },
  // 「出场」两读（登场／上场进池），故意不收：替玩家决定是哪个＝猜。
  { re: new RegExp(`^${ALIAS_HEAD}(?:放置|登场|上场)${ALIAS_TAIL}$`), trigger: { type: 'onDeploy' } },
  { re: new RegExp(`^${ALIAS_HEAD}回合结束${ALIAS_TAIL}$`), trigger: { type: 'onTurnEnd' } },
  { re: new RegExp(`^${ALIAS_HEAD}(?:受到|遭受)伤害(?:时候|候|时|后)?$`), trigger: { type: 'onDamageTaken' } },
  { re: new RegExp(`^${ALIAS_HEAD}(?:被攻击|遭到攻击|受到攻击|成为攻击目标|被指定为攻击目标)${ALIAS_TAIL}$`), trigger: { type: 'onBecomingTarget' } },
  { re: new RegExp(`^${ALIAS_HEAD}(?:击杀|打死|杀死)(?:其他|敌方|一名|1名)*(?:角色|武将|将领|敌人)(?:时候|候|时|后)?$`), trigger: { type: 'onKill' } },
  // 施工图的 7~10 在这批表里零命中＝替玩家猜的写法，用户把留不留交给我判。留：这一批别名的价值
  // 本来就在玩家手写（存量表只救回 1 行）。真正的判据是「只进不出」不能只做半套——收下
  // `每回合结束时` 却拒绝 `每回合开始时`，是明知故犯地留一条自相矛盾的词表。
  { re: new RegExp(`^${ALIAS_HEAD}回合开始${ALIAS_TAIL}$`), trigger: { type: 'onTurnStart' } },
  { re: new RegExp(`^${ALIAS_HEAD}(?:造成|打出)伤害(?:时候|候|时|后)?$`), trigger: { type: 'onDamageDealt' } },
  { re: new RegExp(`^${ALIAS_HEAD}失去(?:全部|所有)(?:手牌|牌)${ALIAS_TAIL}$`), trigger: { type: 'onCardLost' } },
  { re: new RegExp(`^${ALIAS_HEAD}(?:获得|摸到)(?:全部|所有)?手牌${ALIAS_TAIL}$`), trigger: { type: 'onCardGained' } },
];

/** 动词写法：弃置／弃去／弃掉／丢弃 → 生成侧那一个「弃」。数量尾巴原样带过去（两支都要能吃）。 */
const VERB_ALIASES: { re: RegExp; to: (m: RegExpMatchArray) => string }[] = [
  // 「丢弃」首字是「丢」不是「弃」，所以四条写法得整词列，不能写成 `弃(?:置|去|掉|丢)` 那种前缀共享。
  { re: /^(?:弃置|弃去|弃掉|丢弃)\s*(.+)$/, to: m => `弃${m[1].trim()}` },
];

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 紧凑改数式 `近战攻击力+1`／`你的远程攻击力-2` → `让…增加/减少 N`。钥匙名只取那六把。 */
const STAT_ALIASES: { re: RegExp; to: (m: RegExpMatchArray) => string }[] = Object.entries(statModifierKeyLabels).map(
  ([, label]) => ({
    re: new RegExp(`^${ALIAS_HEAD}${reEscape(label)}([+-])\\s*(\\d+|[零一二两三四五六七八九十]+)$`),
    to: m => `让${label}${m[1] === '+' ? '增加' : '减少'}${m[2]}`,
  }),
);

/** 读入侧的一个片段的写法归一。读不懂的串原样返回⇒仍由原来的逐段点名说出来，不新增第二条路。 */
export function readingAlias(fragment: string): string {
  // 已经是词表认得的时机串⇒一字不动。别名的活是"把没登记的写法挪到登记那一串"，不是"把登记
  // 那一串换成缺省那一串"——「登场」那一档带定语的串（`自身`／`其他角色`… 打头）要是被归一成
  // 缺省那一档，v2.9.13 那五档的"听谁"就被读没了（证人：listenerScopeSingleSource 与 aliases 那两条）。
  if (matchTrigger(fragment)) return fragment;
  for (const a of TRIGGER_ALIASES) {
    if (!a.re.test(fragment)) continue;
    const phrase = triggerPhrase(a.trigger);
    // 词表漂移（那一档改名或删了）⇒ 不改写，让它照旧点名退回，绝不悄悄换成别的档。
    if (TRIGGER_INDEX.has(phrase)) return phrase;
    return fragment;
  }
  for (const v of VERB_ALIASES) {
    const m = v.re.exec(fragment);
    if (m) return v.to(m);
  }
  for (const s of STAT_ALIASES) {
    const m = s.re.exec(fragment);
    if (m) return s.to(m);
  }
  return fragment;
}

// ── 数量词 ────────────────────────────────────────────────────────
// 生成侧那句串在数字两边各留一个空格（`摸 2 张牌`），手打的人不会留 ⇒ 空格一律可省。

const NUM = '\\s*(\\d+|[零一二两三四五六七八九十]+)\\s*';
/** 严式全落空后的第二遍：把"数量"那格放宽成任意一串，专供回话用——
 *  「造成 abc 点伤害」该被告知是数没读出来，而不是"没认识的动作"（两种改法完全不同）。 */
const NUM_LOOSE = '\\s*(.+?)\\s*';
const ALL_WORD = '(?:全部|所有)';

// ── 目标档位（只有这三档，引擎真读的就是这三档）──────────────────────

const TARGET_BY_LABEL = new Map<string, NonNullable<SkillRuntimeEffect['target']>>(
  Object.entries(runtimeTargetLabels).map(([k, v]) => [v, k as NonNullable<SkillRuntimeEffect['target']>]),
);

/** 「对目标」「给自身」——档位名一律取生成侧那一份 `runtimeTargetLabels`。 */
function matchWho(fragment: string): NonNullable<SkillRuntimeEffect['target']> | null {
  const m = /^[对给](.+)$/.exec(fragment);
  if (!m) return null;
  return TARGET_BY_LABEL.get(m[1].trim()) ?? null;
}

// ── 动作（结构化效果）──────────────────────────────────────────────

interface ActionShape {
  /** 含「数量」一格的模式串：`num` 由外面喂严式或宽式两种写法，两侧共用同一句形状。 */
  pattern?: (num: string) => string;
  /** 不含数量的形状直接给正则。 */
  re?: RegExp;
  build: (m: RegExpMatchArray) => { runtime?: SkillRuntimeEffect; issue?: string };
}

function num(group: string | undefined, what: string): number | { issue: string } {
  const n = parseCountNumber(group ?? '');
  if (n === undefined) return { issue: `数量「${(group ?? '').trim()}」读不出：只认阿拉伯数字与「一…十」这类中文写法` };
  void what;
  return n;
}

const KEY_LABELS = Object.entries(statModifierKeyLabels)
  .sort((a, b) => b[1].length - a[1].length) as [SkillRuntimeEffect['stat'], string][];

/** 「（决斗时，用掉就销）」这一串：每一段必须是场合或周期，别的点名退回。 */
function parseSpan(raw: string | undefined): { occasion?: SkillRuntimeEffect['occasion']; duration?: SkillRuntimeEffect['duration']; issue?: string } {
  const span = (raw ?? '').trim();
  if (!span) return {};
  const out: { occasion?: SkillRuntimeEffect['occasion']; duration?: SkillRuntimeEffect['duration'] } = {};
  for (const part of splitTop(span, '，,、')) {
    const occ = (Object.entries(OCCASION_PHRASES) as [SkillRuntimeEffect['occasion'], string][])
      .find(([, label]) => label === part);
    if (occ) { out.occasion = occ[0]; continue; }
    if (part === STAT_DEFAULT_DURATION_PHRASE) continue;      // 缺省＝不填＝在场期间
    const dur = (Object.entries(DURATION_PHRASES) as [SkillRuntimeEffect['duration'], string][])
      .find(([, label]) => label === part);
    if (dur) { out.duration = dur[0]; continue; }
    return { ...out, issue: `生效范围「${part}」不认识：这一档只有 决斗时／近战砍有护甲的目标时 两种场合，与 ${Object.values(DURATION_PHRASES).join('／')} 这几种周期（「${STAT_DEFAULT_DURATION_PHRASE}」＝不写` };
  }
  return out;
}

function matchStatKey(text: string): SkillRuntimeEffect['stat'] | undefined {
  for (const [key, label] of KEY_LABELS) if (label === text) return key;
  return undefined;
}

const DEST_BY_CHAR: Record<string, NonNullable<SkillRuntimeEffect['dest']>> = { 顶: 'TOP', 底: 'BOTTOM' };

const ACTION_SHAPES: ActionShape[] = [
  {
    pattern: q => `^造成${q}点(?:技能)?伤害$`,
    build: m => {
      const v = num(m[1], '伤害'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'DAMAGE', value: v } };
    },
  },
  {
    pattern: q => `^回复${q}点(?:体力|血量)$`,
    build: m => {
      const v = num(m[1], '体力'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'HEAL', value: v } };
    },
  },
  {
    pattern: q => `^获得${q}点护甲$`,
    build: m => {
      const v = num(m[1], '护甲'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'GAIN_ARMOR', value: v } };
    },
  },
  {
    pattern: q => `^摸${q}张(?:手)?牌$`,
    build: m => {
      const v = num(m[1], '摸牌'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'DRAW_CARD', value: v } };
    },
  },
  {
    pattern: () => `^摸${ALL_WORD}手牌$`,
    build: () => ({ runtime: { type: 'DRAW_CARD', value: 0 } }),
  },
  {
    pattern: q => `^弃${q}张(?:手)?牌$`,
    build: m => {
      const v = num(m[1], '弃牌'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'DISCARD', value: v } };
    },
  },
  {
    pattern: () => `^弃${ALL_WORD}手牌$`,
    build: () => ({ runtime: { type: 'DISCARD', value: 0 } }),
  },
  {
    pattern: q => `^发放${q}张(?:手)?牌$`,
    build: m => {
      const v = num(m[1], '发放'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'GIVE', value: v } };
    },
  },
  {
    pattern: () => `^发放${ALL_WORD}手牌$`,
    build: () => ({ runtime: { type: 'GIVE', value: 0 } }),
  },
  {
    pattern: q => `^拆掉${q}张(?:军备|装备)(?:卡|牌)?$`,
    build: m => {
      const v = num(m[1], '拆军备'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'EQUIP_STRIP', value: v } };
    },
  },
  {
    pattern: q => `^(?:观看|看)牌堆顶${q}张$`,
    build: m => {
      const v = num(m[1], '看牌堆顶'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'REVEAL', value: v } };
    },
  },
  {
    pattern: q => `^观顶${q}张$`,
    build: m => {
      const v = num(m[1], '观顶'); if (typeof v !== 'number') return { issue: v.issue };
      return { runtime: { type: 'REVEAL', value: v } };
    },
  },
  {
    pattern: q => `^把${q}张(?:手)?牌放回牌堆([顶底])?$`,
    build: m => {
      const v = num(m[1], '放牌堆'); if (typeof v !== 'number') return { issue: v.issue };
      const dest = m[2] ? DEST_BY_CHAR[m[2]] : undefined;
      return { runtime: { type: 'DECK_PLACE', value: v, ...(dest ? { dest } : {}) } };
    },
  },
  {
    pattern: () => `^把${ALL_WORD}手牌放回牌堆([顶底])?$`,
    build: m => {
      const dest = m[1] ? DEST_BY_CHAR[m[1]] : undefined;
      return { runtime: { type: 'DECK_PLACE', value: 0, ...(dest ? { dest } : {}) } };
    },
  },
  {
    re: /^与?(?:(自身|伤害来源|目标))?(?:的)?将领决斗(?:（双方各三轮，最多六次）)?$/,
    build: m => {
      const label = m[1];
      const target = label ? TARGET_BY_LABEL.get(label) : undefined;
      return { runtime: { type: 'DUEL', ...(target ? { target } : {}) } };
    },
  },
  {
    re: /^获得技能「(.+)」$/,
    build: m => ({ runtime: { type: 'GAIN_SKILL', skillName: m[1].trim() } }),
  },
  {
    pattern: q => `^让(.+?)(增加|减少)${q}(?:（([^）]*)）)?$`,
    build: m => {
      const stat = matchStatKey(m[1].trim());
      if (!stat) return { issue: `要改的数字「${m[1].trim()}」不在名册里：只有 ${KEY_LABELS.map(([, l]) => l).join('／')} 这几把钥匙` };
      const v = num(m[3], '改数'); if (typeof v !== 'number') return { issue: v.issue };
      const span = parseSpan(m[4]);
      if (span.issue) return { issue: span.issue };
      return {
        runtime: {
          type: 'MODIFY_STAT', stat, modifyMode: 'delta',
          value: m[2] === '减少' ? -v : v,
          ...(span.occasion ? { occasion: span.occasion } : {}),
          ...(span.duration ? { duration: span.duration } : {}),
        },
      };
    },
  },
  {
    pattern: q => `^把(.+?)摁成${q}(?:（([^）]*)）)?$`,
    build: m => {
      const stat = matchStatKey(m[1].trim());
      if (!stat) return { issue: `要改的数字「${m[1].trim()}」不在名册里：只有 ${KEY_LABELS.map(([, l]) => l).join('／')} 这几把钥匙` };
      const v = num(m[2], '改数'); if (typeof v !== 'number') return { issue: v.issue };
      const span = parseSpan(m[3]);
      if (span.issue) return { issue: `「${(m[3] ?? '').trim()}」读不出` };
      return {
        runtime: {
          type: 'MODIFY_STAT', stat, modifyMode: 'set', value: v,
          ...(span.occasion ? { occasion: span.occasion } : {}),
          ...(span.duration ? { duration: span.duration } : {}),
        },
      };
    },
  },
];

/** 严式＝数量格只收数字；宽式＝那一格先任意收，交给 `build` 里的 `num` 回一句"数读不出"。 */
const TIGHT_SHAPES = ACTION_SHAPES.map(s => ({
  re: s.re ?? new RegExp(s.pattern!(NUM)),
  build: s.build,
}));
const LOOSE_SHAPES = ACTION_SHAPES
  .filter(s => s.pattern !== undefined && s.pattern(NUM).includes(NUM))
  .map(s => ({
    re: new RegExp(s.pattern!(NUM_LOOSE)),
    build: s.build,
  }));

function matchAction(fragment: string): { runtime?: SkillRuntimeEffect; issue?: string } | null {
  for (const shape of TIGHT_SHAPES) {
    const m = shape.re.exec(fragment);
    if (m) return shape.build(m);
  }
  for (const shape of LOOSE_SHAPES) {
    const m = shape.re.exec(fragment);
    if (m) {
      const built = shape.build(m);
      // 宽式只用来把"数写错了"这件事说清楚；万一它编得出积木也不采纳（宁缺毋滥）。
      return built.runtime && !built.issue ? null : built;
    }
  }
  return null;
}

// ── 每回合限 N 次（限次刀·技能级那一格，与生成侧 `turnLimitHead` 同一句拼法）──────
//
// 实测来的写法（`.ai-battle/probe-limit-styles.txt`，转换表 180 段／35 种写法）：
//   回合限1次(77)／回合限一次(58)／回合限2次(2)／每回合限一次(2)／每回合限1次(1)／
//   回合各限1次(1)／你的回合限1次(1)／回合限三次(1)
// 所以前缀「每／你的／自身／自己」与那一格「各」都可有可无，N 汉字与阿拉伯数字都认
// （用户 2026-10-28 裁决③逐字＝「汉字与阿拉伯数字都认；读不出数字就逐段退回问玩家」）。
// **不**收的那一支：「其他玩家回合限1次」——它混进了"谁的回合"这一根轴，而这一刀只裁了
// "自己这一格窗"，把别人的回合也算进来＝替用户编一条他没写的规则，所以整段退回问人。
const TURN_LIMIT_RE = /^(?:每|你的|自身|自己的?|自己)?回合(?:各)?限(.+?)次$/;

/** 读这一格：`null`＝这一段压根不是限次（交给别的字段）；`issue`＝形状像但数读不出，
 *  **必须点名**，绝不兜底成 1（悄悄当成"没写"＝写着限额却没人管，兜成 1＝替玩家编规则）。 */
function matchTurnLimit(fragment: string): { limit?: number; issue?: string } | null {
  const m = TURN_LIMIT_RE.exec(fragment);
  if (!m) return null;
  const n = parseCountNumber(m[1].trim());
  if (!isValidTurnLimit(n)) {
    return { issue: `限次那一句里的次数「${m[1].trim()}」不是一个 1 以上的整数：只认「一／二／三…」这类中文写法和阿拉伯数字。系统不会替您猜一个数，也不会当成"没有限次"——这一整条技能因此没有生成。` };
  }
  return { limit: n };
}

// ── 模式头（三种模式只有两句要说得出的话，与生成侧同一份）──────────────

const MODE_HEADS: [string, SkillEffectMode][] = [['以下择一', 'choice'], ['以下依次生效', 'chain']];

// ── 逐段点名：为什么这一段没吃下去 ──────────────────────────────────

const TAG_WORDS = allSkillTags as readonly string[];

/**
 * 理由必须写成玩家能照着改的一句，并**指出这一格该去哪儿填**。
 * 「让别人替你摸牌」这一类专门点名：那格"目标"下拉是留给未来内容的接口（用户 2026-10-17
 * 原话：「有让其他玩家执行这个效果的技能，只是我还没提供，所以这个不能删」），
 * 今天引擎不读它 ⇒ 句子里写"让别人"必须退回，不能悄悄做成"自己做"。
 */
/** 徽章写在效果句里：这一条效果照收，另有一句"该去哪儿填"的回话。 */
function whyBadge(tag: string): string {
  return `「${tag}」是徽章，不写在效果句里：请在技能条目的徽章那一格勾上（这句里的其余部分照常生成）。`;
}

function whyUnread(fragment: string): string {
  // v2.9.13 术语裁定（用户 2026-10-18 原话：「我的游戏里没有『角色摸牌』，只有『玩家
  // 摸牌』，摸牌摸上来的是手牌，角色是没有手牌这个概念的」）：先判**用词**，再判
  // "这一句做不做得出来"。「××角色摸 N 张牌」不是"将来能做的内容"，是一句写错了的
  // 话——把它原样登记成待办＝替用户把一个不成立的说法留成合法的样子。
  if (/摸\s*\S{0,4}\s*(手)?牌/.test(fragment) && /角色(?:摸|失去|获得|打出)/.test(fragment)) {
    return '「角色摸牌」在本作不成立：摸上来的牌进的是玩家的手牌，将领（角色）没有手牌这一格。请改写"玩家"——例如「其他玩家摸两张牌」。顺带说一句：让别的玩家摸牌这类效果今天还没接线（"目标"那一格就是留给它的），所以改完仍然只会记下、不会响。';
  }
  if (/(其他|别的|别家|任意|所有|一名|一位)(玩家|角色|人)/.test(fragment) || /其他席位/.test(fragment)) {
    return '这一句要作用在"别人"身上：现在效果只认 自身／伤害来源／目标 三档（摸牌、看牌堆顶、放回牌堆这三档更是只归卡牌的那位玩家自己）。想让别的玩家执行的那类内容还没做出来，所以这里先不收——"目标"那一格保留着，等的就是它。';
  }
  if (/^若/.test(fragment) || fragment.includes('则')) {
    return '"若…则…"这种一步一步的写法今天还不认：要"前一件成了才做下一件"，请写「以下依次生效」（积木里＝链式若-则那一档）。';
  }
  if (/阶段|时机|时候|每当/.test(fragment)) {
    return '这一段像是"什么时候触发"，但那个时机不在词表里：可写的时机就是触发那一格下拉里的全部选项（写错的会在这里逐条退回，不猜）。';
  }
  return '这一段里没有认识的动作。能生成的动作就是结构化效果那一格的十二档：摸牌／造成伤害／回复体力／获得护甲／弃牌／发放／拆军备／看牌堆顶／放回牌堆／决斗／改数值／获得技能。';
}

/** 排在动作**后面**、又读不懂的一段：前面那件事照做，这一段单独点名。 */
function whyAfterAction(fragment: string): string {
  return `${whyUnread(fragment)}（这一段排在动作后面，像是第二件事：想让它也做成，请另起一句，用；或。分开——要一件接一件就写「以下依次生效」，任选一件就写「以下择一」。）`;
}

/** 一段里出现第二个动作 ⇒ 不顶掉第一个（静默丢＝最坏的一种丢），点名让它另起一句。 */
function whySecondAction(): string {
  return '一段只认一件事：这一段里已经有动作了，这第二个没有生成。请另起一句（用；或。分开）——要一件接一件就写「以下依次生效」，任选一件就写「以下择一」。';
}

type RowJunk = { action?: unknown; junkBefore: string[]; junkAfter: { raw: string; reason?: string }[] };
function pushJunk(row: RowJunk, fragment: string): void {
  if (row.action) row.junkAfter.push({ raw: fragment });
  else row.junkBefore.push(fragment);
}

// ── 编不编得出结算：判据一律问编译器（`skillCompiler.judgeSkillEffect` 就是真编译路那支）──

/**
 * **写错了**那一类：形状不合法的积木一块都不生成，并点名到段。
 * 录入面的下拉根本产不出这些组合，出现＝玩家那句话被读歪了或硬凑出来的，改句话才对得上。
 */
const SHAPE_REFUSALS: Partial<Record<SkillSkipReason, string>> = {
  NO_RUNTIME_PAYLOAD: '这一段没有可结算的动作。',
  EFFECT_TYPE_UNSUPPORTED: '这一档动作今天还编不出结算。',
  MODIFY_STAT_INCOMPLETE: '改数那一句缺了样（要改哪个数／是加还是摁成／数值），或者把对象写成了别人——改数只能改自己这一员将。',
  MODIFY_STAT_KEY_UNWIRED: '这把钥匙今天没人读：改了的数结算不会动（能改的就那几把，见改数值那一格）。',
  MODIFY_STAT_ONESHOT_KEY_UNSUPPORTED: '「用掉就销」这一档只有伤害那两把钥匙有"用掉的那一刻"，别的钥匙挂它等于挂了一个永远不会来的期限。',
  MODIFY_STAT_OCCASION_UNSUPPORTED: '生效场合（决斗时／近战砍有护甲的目标时）只有钥匙「造成的伤害」才分，别的钥匙不分——把这一段去掉即可。',
  GAIN_SKILL_INCOMPLETE: '「获得技能」要么没写名字，要么把对象写成了别人：技能只能落在发动它的那一员将身上。',
  GAIN_SKILL_UNKNOWN_NAME: '这个名字不在技能表上：拼错了、还没做出的、或本来就没有这一枚。系统不会猜一个"最像的"给您。',
  GAIN_SKILL_AMBIGUOUS_NAME: '同名技能不止一枚：请先去掉重名的那一枚，或换个能唯一对上的写法。',
};

/**
 * **还没接线**那一类：积木照生成、照样能采用，只是今天不会响——因为录入面本来就允许比
 * 引擎先行（时机下拉里就摆着这些档）。沉默才是问题，所以说一句，但不拦。
 */
const WAITLIST_NOTICES: Partial<Record<SkillSkipReason, string>> = {
  NO_TRIGGER: '这条效果还没写"什么时候发动"：采用后进积木界面把触发那一格选上，它才会响。',
  TRIGGER_UNSUPPORTED: '这个时机今天还不会响（下拉里有它、结算还没接线）：先留着，等它接上那一天自动就有效。',
  TRIGGER_SUBTYPE_UNSUPPORTED: '这个时机的这一细分今天不会响：引擎在这一档只认清单里的那几种分法。',
  PASSIVE_CONDITION_UNSUPPORTED: '「在场即生效」今天不读门槛：人在就算，写了条件等于没写。',
  PASSIVE_DURATION_CONFLICT: '「在场即生效」与"有效周期"两句话互相矛盾：前者是人在就算到底，后者是说什么时候销掉。',
  AWAKENING_PASSIVE_CONFLICT: '「觉醒技」徽章与「在场即生效」互斥：觉醒要说"到点问您一次"，而在场即生效没有发动这一刻。',
};

// ── 主入口 ────────────────────────────────────────────────────────

/**
 * 把玩家自己写的那段话拆成积木。
 * 一切读不懂的都进 `issues`（带原文），绝不静默丢、绝不猜。
 */
export function parseSkillText(text: unknown): SkillTextDraft {
  const draft: SkillTextDraft = { effects: [], issues: [], notices: [], ignored: [] };
  const raw = String(text ?? '').trim();
  if (!raw) return draft;

  let carryTrigger: SkillTriggerConfig | undefined;
  /** 排在所有字段之前的门槛原文＝整条技能公用的门槛（积木里「整组门槛」那一格）。 */
  const groupGateRaw: string[] = [];
  const groupConditions: SkillCondition[] = [];

  /** 「每回合限 N 次」这一格读不成（数读不出／两个数对不上）。这一格是**整条技能**的，
   *  没读懂就一条效果也不生成＝不半采纳（采纳了就是"写着限额却没人管"）；点名已在原处给出。 */
  let quotaUnsettled = false;

  /** 整组门槛与单块门槛共用同一次解析；读不懂的那几串各自点名，绝不静默吞。 */
  const parseGate = (strings: string[]): SkillCondition[] => {
    if (strings.length === 0) return [];
    const parsed = parseGateText(strings.join('，'));
    for (const u of parsed.unknown) {
      draft.issues.push({ raw: u, reason: '这一段是门槛，但门槛的写法是「量 运算符 数」（例：手牌≤2、抽牌堆≥5）；能填的量与运算符在门槛那一格下面写着。' });
    }
    return parsed.conditions;
  };

  for (const segment of splitTop(raw, '。；;\n')) {
    const fragments = splitTop(segment, '，,、');
    const row: {
      trigger?: SkillTriggerConfig;
      who?: NonNullable<SkillRuntimeEffect['target']>;
      gate: string[];
      action?: { runtime?: SkillRuntimeEffect; issue?: string };
      actionRaw?: string;
      /** 排在动作**之前**的读不懂片段＝它本来是在给这个动作补"对谁／在什么前提下做"。 */
      junkBefore: string[];
      /** 排在动作**之后**的读不懂片段＝动作那句话说完了，这一段更像第二件事。 */
      junkAfter: { raw: string; reason?: string }[];
    } = { gate: [], junkBefore: [], junkAfter: [] };
    /** 这一段里是不是已经出现过"字段"（时机／对谁／门槛／动作）。
     *  生成侧的字段次序是定死的〔时机→对谁→门槛→动作〕，所以**排在一切字段之前的门槛＝整组门槛**，
     *  跟在时机后面的＝这一块积木自己的门槛。这条判据不另抄词表，只吃生成侧的形状。 */
    let sawField = false;
    const headMode = MODE_HEADS.find(([head]) => fragments[0] === head || fragments[0]?.startsWith(head));
    if (headMode) {
      draft.effectMode = headMode[1];
      fragments.shift();
    }

    for (let i = 0; i < fragments.length; i++) {
      const { text: cleaned, dropped } = stripConnectives(fragments[i]);
      if (dropped.length) for (const d of dropped) if (!draft.ignored.includes(d)) draft.ignored.push(d);
      const fragment = readingAlias(cleaned);
      if (!fragment) continue;
      // 列表编号（`1、2、`这样切出来的裸数字）＝脏片段，不是玩家想说的第二件事。
      // 走 `ignored` 那条回显路（连接词被忽略也要回显），不静默吞成"读过了"。
      if (/^\d+$/.test(fragment)) {
        if (!draft.ignored.includes(fragment)) draft.ignored.push(fragment);
        continue;
      }

      const trigger = matchTrigger(fragment);
      if (trigger) { row.trigger = trigger; sawField = true; continue; }
      const who = matchWho(fragment);
      if (who) { row.who = who; sawField = true; continue; }
      const tag = TAG_WORDS.find(t => fragment.includes(t));
      if (tag) {
        draft.issues.push({ raw: fragment, reason: whyBadge(tag) });
        continue;
      }
      // 限次那一格是**整条技能**的（与模式头同族），不是这一块积木的字段⇒不碰
      // `sawField`：生成侧把它排在整组门槛**之前**，吃了这一格就会把后面那句门槛错认成
      // 这一块积木自己的门槛（v2.9.9 那条"字段次序定死"的判据因此照样成立）。
      const quota = matchTurnLimit(fragment);
      if (quota) {
        if (quota.issue) { draft.issues.push({ raw: fragment, reason: quota.issue }); quotaUnsettled = true; }
        else if (draft.turnLimit === undefined) draft.turnLimit = quota.limit;
        else if (draft.turnLimit !== quota.limit) {
          // 同一句话里两个不同的数＝不猜哪个作数（静默顶掉＝最坏的一种丢），整条退回。
          draft.issues.push({ raw: fragment, reason: `这一句又写了一个限次（限 ${quota.limit} 次），和前面那句（限 ${draft.turnLimit} 次）对不上：一条技能只有一格「每回合限 N 次」，请去掉一句。整条技能因此没有生成——这一格是**整条技能**的，猜哪个数都是替您编规则。` });
          quotaUnsettled = true;
        }
        continue;
      }
      if (fragment.startsWith('要满足')) {
        // 门槛文本自己含顿号逗号（`gateConditionsToText` 就是这么串的），把后面到下一个字段之前的都收进来。
        const bucket: string[] = sawField ? row.gate : groupGateRaw;
        sawField = true;
        bucket.push(fragment.slice('要满足'.length));
        // 下一片是不是字段＝按**归一后的写法**问，否则「死亡时／近战攻击力+1」这类会被当门槛文字收进桶里。
        const nextField = (f: string) => matchTrigger(readingAlias(f)) || matchWho(f) || matchAction(readingAlias(f)) || matchTurnLimit(readingAlias(f)) !== null;
        while (i + 1 < fragments.length && !nextField(fragments[i + 1])) {
          bucket.push(fragments[++i]);
        }
        continue;
      }
      if (/^[对给]/.test(fragment)) { pushJunk(row, fragment); continue; }
      const action = matchAction(fragment);
      if (action) {
        // 一段只生成一件事：已经有动作了 ⇒ 第二个动作**不许把第一个顶掉**（静默丢＝最坏的一种丢）。
        if (row.action) row.junkAfter.push({ raw: fragment, reason: whySecondAction() });
        else { row.action = action; row.actionRaw = fragment; sawField = true; }
        continue;
      }
      pushJunk(row, fragment);
    }

    // 整段没有动作＝这不是"做什么"，而是给全技能公用的一句（时机／整组门槛／模式头）。
    if (!row.action) {
      if (row.trigger && !carryTrigger) carryTrigger = row.trigger;
      groupConditions.push(...parseGate(row.gate));
      for (const junk of row.junkBefore) draft.issues.push({ raw: junk, reason: whyUnread(junk) });
      continue;
    }

    // 动作前面有一句读不懂 ⇒ 整条退回：只收"动作"那半＝把玩家没写成的意思悄悄换成另一个东西。
    if (row.junkBefore.length) {
      for (const junk of row.junkBefore) draft.issues.push({ raw: junk, reason: whyUnread(junk) });
      for (const junk of row.junkAfter) draft.issues.push({ raw: junk.raw, reason: junk.reason ?? whyAfterAction(junk.raw) });
      draft.issues.push({ raw: segment, reason: '这一条效果没有生成：上面点名的那一段读不懂，而它排在动作前面，正是这条效果要作用在谁身上／在什么前提下做。只收一半＝做成另一件事，所以整段退回。' });
      continue;
    }

    // 动作后面还有读不懂的一段 ⇒ 点名，但前面那件读懂的事照做（用户那句原话就是"说明哪一段不支持"，
    // 不是"整句作废"）。合起来说的另一条判据：**没有任何一段是悄悄丢掉的**。
    for (const junk of row.junkAfter) draft.issues.push({ raw: junk.raw, reason: junk.reason ?? whyAfterAction(junk.raw) });

    if (row.action.issue) {
      draft.issues.push({ raw: row.actionRaw ?? segment, reason: row.action.issue });
      continue;
    }

    const effect: SkillEffect = {
      id: `e${draft.effects.length + 1}`,
      label: `效果${draft.effects.length + 1}`,
      trigger: row.trigger ?? carryTrigger,
      runtime: { ...(row.who ? { target: row.who } : {}), ...row.action.runtime! },
    };
    const own = parseGate(row.gate);
    if (own.length) effect.conditions = own;
    effect.description = effectSentence(effect);
    draft.effects.push(effect);
  }

  if (carryTrigger) draft.trigger = carryTrigger;
  groupConditions.push(...parseGate(groupGateRaw));
  if (groupConditions.length) draft.conditions = groupConditions;

  // 限次那一格没读成的那一趟：**一条效果也不生成**。这一格管的是整条技能，收下积木就等于
  // 替玩家把"每回合限几次"当成没写（裁决③"读不出数字就逐段退回问玩家"在技能级那一格的落点）。
  if (quotaUnsettled) draft.effects = [];

  // 最后一遍：**问编译器**这几块积木今天编不编得出。写错形状的一块不生成；
  // 只是还没接线的照样给，但要说一句"今天还不响"。判据不抄第二份，见 `judgeSkillEffect`。
  const settled: SkillEffect[] = [];
  for (const effect of draft.effects) {
    const verdict = judgeSkillEffect(effect, effect.trigger, { skillConditions: groupConditions });
    if (!verdict) { settled.push(effect); continue; }
    const line = effectSentence(effect);
    const refusal = SHAPE_REFUSALS[verdict];
    if (refusal) draft.issues.push({ raw: line, reason: refusal });
    else draft.notices.push({ raw: line, reason: WAITLIST_NOTICES[verdict] ?? `这一条今天编不出结算（${verdict}）` });
    if (!refusal) settled.push(effect);
  }
  // 有点名的那一块被拿掉了 ⇒ 剩下的重新编号，玩家看到的「效果1／效果2」始终连着。
  draft.effects = settled.map((effect, i) => ({
    ...effect, id: `e${i + 1}`, label: `效果${i + 1}`,
  }));
  return draft;
}

/** 一句话里到底采纳了几块积木（界面用它决定「采用」按钮能不能点）。 */
export function canAdopt(draft: SkillTextDraft): boolean {
  return draft.effects.length > 0;
}
