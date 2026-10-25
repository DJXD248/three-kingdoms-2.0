// Excel/文本技能导入解析器 —— 2.2.14 从 SkillEditor.tsx 纯移动拆出（D-6 阶段 F）。
// 全部为无状态纯函数：输入行数据，输出编辑条目；不触碰组件状态或 store。
import {
  allGenerals, supportsListenerScope, General, Faction, SkillTag, allSkillTags,
  SkillTriggerConfig, SkillEffect, SkillEffectMode, SkillCondition,
} from '../../data/generals';
import {
  readTriggerCell, triggerToStr, detectEffectGroupWidth, parseEffectGroup,
  SKILL_GATE_HEADER, detectEffectGroupStart, parseSkillGate,
  LISTENER_SCOPE_HEADER, readListenerScopeCell,
  readEffectModeCell,
} from '../../skills/skillExcelFormat';
import { parseSkillTagsCell, tagsOf, formatTags } from '../../domain/skillTags';

/** 编辑器与导入共用的技能条目类型（原为组件内 `typeof editingSkills`，仅类型层面替换）。 */
export interface SkillEditEntry {
  name: string;
  description?: string;
  /** v2.8.19：一枚技能可同时挂几枚徽章；读写走 domain/skillTags.ts。 */
  tags?: SkillTag[];
  /** 旧形态（单枚）：仍然读得到，写出面不再产生。 */
  tag?: SkillTag;
  trigger?: SkillTriggerConfig;
  effects?: SkillEffect[];
  effectMode?: SkillEffectMode;
  /** v2.8.11 刀2：整组门槛（Excel 固定列「技能门槛」）。逐项门槛挂在各效果上。 */
  conditions?: SkillCondition[];
  forced?: boolean;
}

// ── Parse a single skill cell like "武圣：远程伤害+1" or "反馈<锁定技>：描述"
// Also auto-detects tags embedded in the description, e.g.:
//   "替身：限定技，当你被击杀时..."  → name="替身", tags=["限定技"], description="当你被击杀时..."
//   "反馈<锁定技、遗计技>：描述"     → name="反馈", tags=["锁定技","遗计技"], description="描述"
export const parseSkillCell = (cell: string): { name: string; description?: string; tags?: SkillTag[] } | null => {
  const text = cell.trim();
  if (!text) return null;

  const tagList = allSkillTags as readonly string[];

  // Split by first Chinese or English colon
  let skillName = text;
  let description = '';

  const colonIdx = text.indexOf('：');
  const colonIdx2 = text.indexOf(':');
  const splitIdx = colonIdx !== -1 ? colonIdx : colonIdx2;

  if (splitIdx !== -1) {
    skillName = text.substring(0, splitIdx).trim();
    description = text.substring(splitIdx + 1).trim();
  }

  const tags: SkillTag[] = [];
  const addTag = (t: string) => {
    const trimmed = t.trim();
    if (tagList.includes(trimmed) && !tags.includes(trimmed as SkillTag)) tags.push(trimmed as SkillTag);
  };

  // 1) Try extracting tags from skill name: "反馈<锁定技、遗计技>"
  const tagMatch = skillName.match(/^(.+?)[<＜《](.+?)[>＞》]$/);
  if (tagMatch) {
    skillName = tagMatch[1].trim();
    // 分隔口径与「技能标签」列共用 domain/skillTags.ts，别在这里各认各的
    for (const t of parseSkillTagsCell(tagMatch[2]).tags) addTag(t);
  }

  // 2) If no tag found yet, try auto-detecting from the description start
  //    e.g. "限定技，当你被击杀时..." or "锁定技。你的..." or "觉醒技 - 当..."
  //    连续多枚也吃："锁定技、遗计技，当你…"（v2.8.19：徽章可多枚并存）
  if (tags.length === 0 && description) {
    for (;;) {
      let matched = '';
      for (const t of tagList) {
        if (!description.startsWith(t)) continue;
        const afterTag = description.substring(t.length);
        // Must be followed by separator: ，,。.、；;：: space - or end of string
        if (afterTag.length === 0 || /^[，,。.、；;：:\-\s]/.test(afterTag)) { matched = t; break; }
      }
      if (!matched) break;
      addTag(matched);
      description = description.substring(matched.length).replace(/^[，,。.、；;：:\-\s]+/, '').trim();
    }
  }

  if (!skillName) return null;
  return {
    name: skillName,
    description: description || undefined,
    tags: tags.length > 0 ? tags : undefined,
  };
};

const clean = (s: string) => { const v = s.trim(); return v === '无' ? '' : v; };

// ── Detect format: new detailed = header has "技能名称" at col 6 ──
export const isDetailedFormat = (rows: (string|number|undefined)[][]): boolean => {
  if (rows.length === 0) return false;
  const header = rows[0];
  if (!header || header.length < 6) return false;
  const h1 = String(header[1] || '').trim();
  const h5 = String(header[5] || '').trim();
  return h1 === '势力' && (h5 === '技能名称' || h5.startsWith('技能'));
};

// ── Detect if it's the new row-per-skill format (col 9 header is "触发时机") ──
export const isRowPerSkillFormat = (header: (string|number|undefined)[]): boolean => {
  return String(header[8] || '').trim() === '触发时机';
};

// ── 导入分流（2026-10-25 用户裁决，反转 §H8 早期口径）──
// 三种情况：
//   ① 同名 + 同势力   → 不写，交「待处理」让玩家选 新建 / 修改现有 / 跳过
//   ② 同名 + 势力不同 → 直接新建，不打断
//   ③ 名册里查无此人   → 直接新建，不打断
// 另外：没填势力（或填了不认识的势力）＝缺少必要数据，退回同一份待处理清单。
// 缺键时替玩家猜，猜错就是又一张被静默改写的同名卡——这一整条判断根只有这里一份。
export const IMPORT_FACTIONS: readonly Faction[] = ['魏', '蜀', '吴', '群', '晋'];

export type ImportBlockReason =
  | 'sameNameSameFaction'
  | 'missingFaction'
  | 'unknownFaction'
  | 'missingName';

export type ImportResolution =
  | { kind: 'needsDecision'; candidates: General[] }
  | { kind: 'createNew'; reason: 'notInRoster' | 'sameNameOtherFaction' }
  | { kind: 'needsData'; reason: ImportBlockReason };

export function resolveGeneralForImport(
  name: string,
  factionText: string | undefined,
  pool: General[],
): ImportResolution {
  const n = name.trim();
  if (!n) return { kind: 'needsData', reason: 'missingName' };
  const f = (factionText || '').trim();
  if (!f) return { kind: 'needsData', reason: 'missingFaction' };
  if (!IMPORT_FACTIONS.includes(f as Faction)) return { kind: 'needsData', reason: 'unknownFaction' };
  const sameNameSameFaction = pool.filter(g => g.name === n && g.faction === f);
  if (sameNameSameFaction.length > 0) return { kind: 'needsDecision', candidates: sameNameSameFaction };
  return pool.some(g => g.name === n)
    ? { kind: 'createNew', reason: 'sameNameOtherFaction' }
    : { kind: 'createNew', reason: 'notInRoster' };
}

/** 直接新建的一张卡：玩家不需要做任何决定。 */
export type NewGeneralImport = {
  name: string;
  faction: Faction;
  hp?: number;
  meleeAtk?: number;
  rangedAtk?: number;
  skills: SkillEditEntry[];
  rowNumbers: string;
  /** 名册里有同名卡、但都在别的势力（只用于报表措辞）。 */
  sameNameOtherFaction: boolean;
};

/** 退回「待处理」的一块：等玩家在 新建 / 修改现有 / 跳过 里选，或先补必要数据。 */
export type UnresolvedImportBlock = {
  name: string;
  factionText: string;
  /** 认得出来的势力；缺数据时为空，等玩家在面板里补。 */
  faction?: Faction;
  hp?: number;
  meleeAtk?: number;
  rangedAtk?: number;
  skills: SkillEditEntry[];
  reason: ImportBlockReason;
  /** sameNameSameFaction：全部同名同势力卡；缺数据：全部同名卡（供「挂到现有」）。 */
  candidates: General[];
  rowNumbers: string;
};

export interface ParsedImport {
  newGenerals: NewGeneralImport[];
  unresolved: UnresolvedImportBlock[];
  parseWarnings: string[];
}

type ImportDraft = {
  name: string;
  factionText: string;
  hp?: number;
  meleeAtk?: number;
  rangedAtk?: number;
  skills: SkillEditEntry[];
  rowStart: number;
  rowEnd: number;
};

const draftRowNumbers = (d: ImportDraft) => {
  if (d.rowStart <= 0) return '';
  return d.rowStart === d.rowEnd ? `${d.rowStart}` : `${d.rowStart}-${d.rowEnd}`;
};

/** 一份草稿 → 自动新建 / 退回待处理。三条导入格式共用这唯一的出口。 */
function classifyDraft(
  draft: ImportDraft,
  pool: General[],
): { kind: 'create'; block: NewGeneralImport } | { kind: 'pending'; block: UnresolvedImportBlock } {
  const resolution = resolveGeneralForImport(draft.name, draft.factionText, pool);
  const base = {
    name: draft.name,
    factionText: draft.factionText,
    hp: draft.hp,
    meleeAtk: draft.meleeAtk,
    rangedAtk: draft.rangedAtk,
    skills: draft.skills,
    rowNumbers: draftRowNumbers(draft),
  };
  if (resolution.kind === 'createNew') {
    return {
      kind: 'create',
      block: {
        ...base,
        faction: draft.factionText.trim() as Faction,
        sameNameOtherFaction: resolution.reason === 'sameNameOtherFaction',
      },
    };
  }
  if (resolution.kind === 'needsDecision') {
    return {
      kind: 'pending',
      block: {
        ...base,
        faction: draft.factionText.trim() as Faction,
        reason: 'sameNameSameFaction',
        candidates: resolution.candidates,
      },
    };
  }
  return {
    kind: 'pending',
    block: {
      ...base,
      reason: resolution.reason,
      candidates: pool.filter(g => g.name === draft.name),
    },
  };
}

// ── Parse new row-per-skill format for an entire sheet ──
// parseWarnings: 录入面读不懂的原文（门槛栏、触发栏各自逐条列出）。
// 导入报告必须如实显示，绝不能假装成功——"没看懂"和"没有"是两件事。
export const parseRowPerSkillSheet = (rows: (string|number|undefined)[][], pool: General[] = allGenerals): ParsedImport => {
  const header = rows[0] || [];
  const noteColIndex = header.findIndex(h => String(h || '').trim() === '设定备注');
  const effectEndExclusive = noteColIndex === -1 ? header.length : noteColIndex; // don't parse 备注列
  const groupWidth = detectEffectGroupWidth(header); // 3 (legacy) | 6 | 7 (+门槛) | 8 (+我听谁) | 11 (+改数三格) | 12 (+获得哪个技能)
  // v2.8.11 刀2：效果组起点从表头认（旧导出=11，含「技能门槛」列的新导出=12），
  // 「技能门槛」列按表头定位；旧文件没有这一列⇒整组门槛=无（逐字旧行为）。
  const groupStart = detectEffectGroupStart(header);
  const skillGateCol = header.findIndex(h => String(h || '').trim() === SKILL_GATE_HEADER);
  // v2.8.21 监听扩面刀：技能级「我听谁」同样按表头定位（旧文件没有这一列＝不填＝只听自己）。
  const skillScopeCol = header.findIndex(h => String(h || '').trim() === LISTENER_SCOPE_HEADER);
  const dataRows = rows.slice(1); // skip header
  const parseWarnings: string[] = [];
  // 同名同势力在这一份表里出现多次＝同一张卡被拆成几块，合并成一块。
  // 不合并会直接造出两张同名卡（直接新建档），或第二次覆盖第一次。
  const drafts = new Map<string, ImportDraft>();
  const order: string[] = [];
  let current: ImportDraft | null = null;

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = dataRows[rowIndex];
    if (!row || row.length < 6) continue;
    const nameCell = String(row[0] || '').trim();

    // If column A has a general name, start a new general block
    if (nameCell) {
      const rawFac = clean(String(row[1] || ''));
      const key = `${nameCell}\u0000${rawFac}`;
      const existing = drafts.get(key);
      if (existing) {
        current = existing;
      } else {
        const hp = row[2] != null && String(row[2]).trim() ? Number(row[2]) : undefined;
        const mAtk = row[3] != null && String(row[3]).trim() ? Number(row[3]) : undefined;
        const rAtk = row[4] != null && String(row[4]).trim() ? Number(row[4]) : undefined;
        current = {
          name: nameCell,
          factionText: rawFac,
          hp: Number.isFinite(hp) ? hp : undefined,
          meleeAtk: Number.isFinite(mAtk) ? mAtk : undefined,
          rangedAtk: Number.isFinite(rAtk) ? rAtk : undefined,
          skills: [],
          rowStart: rowIndex + 1, // 1-based
          rowEnd: rowIndex + 1,
        };
        drafts.set(key, current);
        order.push(key);
      }
      current.rowEnd = rowIndex + 1;
      // Don't continue here — the same row may also contain the first skill (cols 5+)
    }

    // Parse skill from cols 5-10
    if (!current) continue;

    const sName = clean(String(row[5] || ''));
    if (!sName) continue;
    const sForced = clean(String(row[7] || ''));
    const sTrigger = clean(String(row[8] || ''));
    const sMode = clean(String(row[9] || ''));
    const sDesc = clean(String(row[10] || ''));

    // 点名要用得出名字：本块的将领＋技能名。
    const rowName = current.name;

    const tagRead = parseSkillTagsCell(String(row[6] || ''));
    for (const u of tagRead.unknown) {
      parseWarnings.push(`${rowName}·${sName} 技能标签：这枚徽章我不认识，所以没记下 → ${u}`);
    }
    const tags = tagRead.tags;
    const forced = sForced === '是' || undefined;
    const skillTriggerRead = readTriggerCell(sTrigger);
    if (skillTriggerRead.unreadable) {
      parseWarnings.push(`${rowName}·${sName} 技能触发：这句没看懂 → ${skillTriggerRead.unreadable}`);
    }
    const trigger = skillTriggerRead.trigger;

    // v2.8.21 监听扩面刀：技能级「我听谁」＝这条技能整体听多宽。它挂在触发上，
    // 但**只在该触发时机认这一栏时才挂**——填了却没人读，就是"显示与生效分叉"（§12-55 同族），
    // 所以认不得的一律点名退回，绝不静默收下。
    let triggerWithScope = trigger;
    if (skillScopeCol >= 0) {
      const scopeRead = readListenerScopeCell(row[skillScopeCol]);
      if (scopeRead.unknown) {
        parseWarnings.push(`${rowName}·${sName} 我听谁：这个词我不认识，所以没记下 → ${scopeRead.unknown}`);
      } else if (scopeRead.scope) {
        const scopeLabel = String(row[skillScopeCol]).trim();
        if (trigger && supportsListenerScope(trigger.type)) {
          triggerWithScope = { ...trigger, listenerScope: scopeRead.scope };
        } else if (trigger) {
          parseWarnings.push(`${rowName}·${sName} 我听谁：触发时机「${sTrigger}」不听这一栏，「${scopeLabel}」按没填处理`);
        } else {
          parseWarnings.push(`${rowName}·${sName} 我听谁：这一行没有触发时机，「${scopeLabel}」没处可挂，按没填处理`);
        }
      }
    }
    const effectMode = readEffectModeCell(sMode);

    // v2.8.11 刀2：整组门槛（「技能门槛」列）。这一列不存在=旧文件=没有整组门槛。
    const groupGate = skillGateCol >= 0
      ? parseSkillGate(clean(String(row[skillGateCol] || '')))
      : { conditions: undefined as SkillCondition[] | undefined, unknown: [] as string[] };
    if (groupGate.unknown.length > 0) {
      for (const u of groupGate.unknown) {
        parseWarnings.push(`${rowName}·${sName} 技能门槛：这句没看懂 → ${u}`);
      }
    }

    // Parse sub-effects from the first group column onwards: 3 (legacy),
    // 6 (标注/触发/效果类型/数值/目标/描述), 7 (v2 + 门槛), 8 (v3 + 我听谁)
    // or 11 (v5 + 改哪个数/怎么改/有效周期，v2.8 刀4 #25)
    // or 12 (v6 + 获得哪个技能，2.9.3 刀A 新原语「获得技能」).
    const effects: SkillEffect[] = [];
    let col = groupStart;
    while (col + groupWidth - 1 < effectEndExclusive) {
      const parsed = parseEffectGroup(row, col, groupWidth);
      if (parsed) {
        const seq = `效果${Math.floor((col - groupStart) / groupWidth) + 1}`;
        // 整组只有门槛/只有看不懂的触发：这不是一個效果，绝不凭空造一个空效果，只如实回显。
        if (parsed.orphanGate) {
          parseWarnings.push(`${rowName}·${sName} ${seq}：只写了门槛「${parsed.orphanGate}」，没写这是哪个效果，这条没被记下`);
        }
        if (parsed.triggerUnreadable) {
          parseWarnings.push(`${rowName}·${sName} ${seq} 触发：这句没看懂 → ${parsed.triggerUnreadable}`);
        }
        if (parsed.valueNote) {
          parseWarnings.push(`${rowName}·${sName} ${seq} 数值：${parsed.valueNote}`);
        }
        // 「我听谁」这一格：词表认不出／这一组的时机不认这一栏，都必须点名（v2.8.21）。
        if (parsed.scopeUnknown) {
          parseWarnings.push(`${rowName}·${sName} ${seq} 我听谁：这个词我不认识，所以没记下 → ${parsed.scopeUnknown}`);
        }
        if (parsed.scopeIgnored) {
          const effTrigger = parsed.fields.trigger ? triggerToStr(parsed.fields.trigger) : '（这一组没有触发时机）';
          parseWarnings.push(`${rowName}·${sName} ${seq} 我听谁：触发时机「${effTrigger}」不听这一栏，「${parsed.scopeIgnored}」按没填处理`);
        }
        // 「改哪个数／怎么改／有效周期」这三格：话已经在格式层拼好，这里只负责挨条点名
        // （填了没人读＝下一轮的"显示与生效分叉"；缺格＝编译器会跳过，先在这儿说清楚）。
        for (const issue of parsed.statIssues) {
          parseWarnings.push(`${rowName}·${sName} ${seq} ${issue}`);
        }
        // 「获得哪个技能」这一格：同一纪律——词表认不出、缺格、别的类型不读它，全部点名。
        for (const issue of parsed.gainIssues) {
          parseWarnings.push(`${rowName}·${sName} ${seq} ${issue}`);
        }
        if (Object.keys(parsed.fields).length > 0) {
          effects.push({ id: `e${Date.now()}_${effects.length}`, ...parsed.fields });
          for (const u of parsed.gateUnknown) {
            parseWarnings.push(`${rowName}·${sName} 效果${effects.length}：门槛里这句没看懂 → ${u}`);
          }
        }
      }
      col += groupWidth;
    }

    current.skills.push({
      name: sName, tags, forced, trigger: triggerWithScope,
      effectMode: effects.length > 0 ? (effectMode || 'all') : effectMode,
      effects: effects.length > 0 ? effects : undefined,
      description: sDesc || undefined,
      conditions: groupGate.conditions,
    });
    current.rowEnd = rowIndex + 1; // 1-based
  }

  const newGenerals: NewGeneralImport[] = [];
  const unresolved: UnresolvedImportBlock[] = [];
  for (const key of order) {
    const classified = classifyDraft(drafts.get(key)!, pool);
    if (classified.kind === 'create') newGenerals.push(classified.block);
    else unresolved.push(classified.block);
  }
  return { newGenerals, unresolved, parseWarnings };
};

// ── Legacy flat format parser (5 cols per skill) ──
// 与逐技能行格式共用同一套分流：要么自动新建，要么退回待处理。
export interface LegacyDetailedRowImport {
  newGeneral?: NewGeneralImport;
  pending?: UnresolvedImportBlock;
  /** 认不出的徽章名：交调用方点名，绝不静默丢（§12-76①）。 */
  tagUnknown: string[];
}

export const parseLegacyDetailedRow = (
  row: (string|number|undefined)[],
  pool: General[] = allGenerals,
  rowNumber = 0,
): LegacyDetailedRowImport | null => {
  const name = String(row[0] || '').trim();
  if (!name) return null;
  const rawFac = clean(String(row[1] || ''));
  const hp = row[2] != null && String(row[2]).trim() ? Number(row[2]) : undefined;
  const mAtk = row[3] != null && String(row[3]).trim() ? Number(row[3]) : undefined;
  const rAtk = row[4] != null && String(row[4]).trim() ? Number(row[4]) : undefined;

  const skills: SkillEditEntry[] = [];
  const tagUnknown: string[] = [];
  let col = 5;
  while (col < row.length) {
    const sName = clean(String(row[col] || ''));
    if (!sName) { col += 5; continue; }
    const sForced = clean(String(row[col + 2] || ''));
    const sMode = clean(String(row[col + 3] || ''));
    const sDesc = clean(String(row[col + 4] || ''));
    const tagRead = parseSkillTagsCell(row[col + 1] == null ? '' : String(row[col + 1]));
    for (const u of tagRead.unknown) tagUnknown.push(`${sName}：${u}`);
    skills.push({
      name: sName,
      tags: tagRead.tags,
      forced: sForced === '是' || undefined,
      effectMode: readEffectModeCell(sMode),
      description: sDesc || undefined,
    });
    col += 5;
  }
  if (skills.length === 0) return { tagUnknown };

  const classified = classifyDraft({
    name,
    factionText: rawFac,
    hp: Number.isFinite(hp) ? hp : undefined,
    meleeAtk: Number.isFinite(mAtk) ? mAtk : undefined,
    rangedAtk: Number.isFinite(rAtk) ? rAtk : undefined,
    skills,
    rowStart: rowNumber,
    rowEnd: rowNumber,
  }, pool);
  return classified.kind === 'create'
    ? { newGeneral: classified.block, tagUnknown }
    : { pending: classified.block, tagUnknown };
};

// ── Simple format: 将领名称 | 技能名：描述 | 技能名：描述 | ...
// 这一格式没有势力列 ⇒ 每一行都缺必要数据，退回待处理（玩家补势力或挂到现有卡）。
// 绝不按名字直接命中现有卡：同名卡可能就在别的势力，猜错＝静默改写。
export const parseSimpleSheet = (rows: (string|number|undefined)[][], pool: General[] = allGenerals): ParsedImport => {
  const drafts = new Map<string, ImportDraft>();
  const order: string[] = [];
  rows.forEach((row, rowIndex) => {
    if (!row || row.length < 2) return;
    const name = String(row[0] || '').trim();
    if (!name) return;
    const skills: SkillEditEntry[] = [];
    for (let col = 1; col < row.length; col++) {
      const cell = String(row[col] || '').trim();
      if (!cell) continue;
      const parsed = parseSkillCell(cell);
      if (parsed) skills.push(parsed);
    }
    if (skills.length === 0) return;
    const key = `${name}\u0000`;
    const existing = drafts.get(key);
    if (existing) {
      existing.skills.push(...skills);
      existing.rowEnd = rowIndex + 1;
      return;
    }
    drafts.set(key, {
      name,
      factionText: '',
      skills,
      rowStart: rowIndex + 1,
      rowEnd: rowIndex + 1,
    });
    order.push(key);
  });

  const newGenerals: NewGeneralImport[] = [];
  const unresolved: UnresolvedImportBlock[] = [];
  for (const key of order) {
    const classified = classifyDraft(drafts.get(key)!, pool);
    if (classified.kind === 'create') newGenerals.push(classified.block);
    else unresolved.push(classified.block);
  }
  return { newGenerals, unresolved, parseWarnings: [] };
};

// ── 导入「无变化」判定（v2.8.12 真机反馈 #45）──
// 逐技能行格式（＝导出文件的格式）原先没有这一步：把自己导出的 Excel 原样
// 重导，95 行全部计成"导入"，每张官方将凭空多一条 ✏️ 覆盖记录（退出开发者
// 模式后还被算进"N 处改动已停用"）。判定对象是**写回去会不会改变当前生效
// 视图**，所以比的是 `getEditedGeneral` 的那一份，不是仓库原始卡。
// 比较前必须归一，否则永远不相等：
//   ① 效果 id 每次解析都重新生成（`e${Date.now()}_…`）⇒不参与比较；
//   ② 空串 / undefined、false / undefined 在存储侧与解析侧形态不同；
//   ③ 导出把"有效果但没写模式"写成「全部生效」⇒两侧都按 'all' 认。
const canonGate = (cs?: SkillCondition[]) =>
  (cs ?? []).map(c => [c.metric, c.subject ?? null, c.op, c.value ?? null,
    c.compareTo ? [c.compareTo.metric, c.compareTo.subject ?? null] : null]);

/**
 * v2.8.21 两个新维度必须**按默认档归一**后再比：编译器把「成为目标时」的空细分读成
 * 「成为攻击目标」、把空的「我听谁」读成「只听自己」，所以"没写"与"显式写了默认档"
 * 在结算侧是同一件事。不归一⇒把自己早先导出的 Excel 原样重导，四张官方将的
 * 「成为攻击目标时」会凭空多出 targetSubType ⇒ 造出 ✏️ 覆盖记录（#45 同族）。
 */
const canonTrigger = (t?: SkillTriggerConfig) => t
  ? [t.type, t.deploySubType ?? null, t.turnSubType ?? null, t.damageSubType ?? null,
    t.killSubType ?? null, t.cardSubType ?? null, t.expireCondition ?? null,
    t.targetSubType ?? (t.type === 'onBecomingTarget' ? 'attackTarget' : null),
    t.listenerScope ?? 'self']
  : null;

const canonRuntime = (r?: NonNullable<SkillEffect['runtime']>) => r
  ? [r.type, r.value ?? null, r.target ?? null, r.dest ?? null]
  : null;

const canonEffect = (e: SkillEffect) =>
  [e.label ?? null, e.description || null, canonTrigger(e.trigger), canonGate(e.conditions), canonRuntime(e.runtime)];

const canonSkill = (s: SkillEditEntry | General['skills'][number]) => {
  const effects = s.effects ?? [];
  return [
    s.name, s.description || null, formatTags(tagsOf(s)) || null, s.forced ? true : null,
    canonTrigger(s.trigger),
    effects.length > 0 ? (s.effectMode ?? 'all') : (s.effectMode ?? null),
    effects.map(canonEffect), canonGate(s.conditions),
  ];
};

/** 这一行写回去是否什么都不会改变（true＝该跳过，不该记成"导入"、也不留覆盖记录）。 */
export const importEntryChangesNothing = (
  edited: General,
  gEdit: Record<string, unknown>,
  skills: SkillEditEntry[],
): boolean => {
  if (gEdit.faction !== undefined && gEdit.faction !== edited.faction) return false;
  if (gEdit.hp !== undefined && gEdit.hp !== edited.hp) return false;
  if (gEdit.meleeAtk !== undefined && gEdit.meleeAtk !== edited.meleeAtk) return false;
  if (gEdit.rangedAtk !== undefined && gEdit.rangedAtk !== edited.rangedAtk) return false;
  if (skills.length === 0) return true; // 这一行不带技能⇒技能侧不会变
  const incoming = JSON.stringify(skills.map(canonSkill));
  const current = JSON.stringify(edited.skills.map(canonSkill));
  return incoming === current;
};
