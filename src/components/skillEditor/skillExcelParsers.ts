// Excel/文本技能导入解析器 —— 2.2.14 从 SkillEditor.tsx 纯移动拆出（D-6 阶段 F）。
// 全部为无状态纯函数：输入行数据，输出编辑条目；不触碰组件状态或 store。
import {
  allGenerals, General, Faction, SkillTag, allSkillTags,
  SkillTriggerConfig, SkillEffect, SkillEffectMode,
} from '../../data/generals';
import {
  readTriggerCell, detectEffectGroupWidth, parseEffectGroup,
} from '../../skills/skillExcelFormat';

/** 编辑器与导入共用的技能条目类型（原为组件内 `typeof editingSkills`，仅类型层面替换）。 */
export interface SkillEditEntry {
  name: string;
  description?: string;
  tag?: SkillTag;
  trigger?: SkillTriggerConfig;
  effects?: SkillEffect[];
  effectMode?: SkillEffectMode;
  forced?: boolean;
}

// ── Parse a single skill cell like "武圣：远程伤害+1" or "反馈<锁定技>：描述"
// Also auto-detects tags embedded in the description, e.g.:
//   "替身：限定技，当你被击杀时..." → name="替身", tag="限定技", description="当你被击杀时..."
//   "反馈<锁定技>：描述"            → name="反馈", tag="锁定技", description="描述"
export const parseSkillCell = (cell: string): { name: string; description?: string; tag?: SkillTag } | null => {
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

  // 1) Try extracting tag from skill name: "反馈<锁定技>"
  let tag: SkillTag | undefined;
  const tagMatch = skillName.match(/^(.+?)[<＜《](.+?)[>＞》]$/);
  if (tagMatch) {
    skillName = tagMatch[1].trim();
    const tagText = tagMatch[2].trim();
    if (tagList.includes(tagText)) {
      tag = tagText as SkillTag;
    }
  }

  // 2) If no tag found yet, try auto-detecting from description start
  //    e.g. "限定技，当你被击杀时..." or "锁定技。你的..." or "觉醒技 - 当..."
  if (!tag && description) {
    for (const t of tagList) {
      // Check if description starts with a tag name followed by a separator
      if (description.startsWith(t)) {
        const afterTag = description.substring(t.length);
        // Must be followed by separator: ，,。.、；;：: space - or end of string
        if (afterTag.length === 0 || /^[，,。.、；;：:\-\s]/.test(afterTag)) {
          tag = t as SkillTag;
          // Remove the tag and leading separators from description
          description = afterTag.replace(/^[，,。.、；;：:\-\s]+/, '').trim();
          break;
        }
      }
    }
  }

  if (!skillName) return null;
  return { name: skillName, description: description || undefined, tag };
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

// ── Unresolved import block (v2.8.7) ──
// 来自 Excel 行-per-skill 格式的未解析条目，用于两阶段导入：
//   - resolution: 'missing' (库里没有) 或 'ambiguous' (同名多张)
//   - candidates: 仅在 ambiguous 时有值，用于点选
//   - rowNumbers: 报行号用（1-based）
export type UnresolvedImportBlock = {
  name: string;
  factionText: string;
  hp: number | undefined;
  meleeAtk: number | undefined;
  rangedAtk: number | undefined;
  skills: SkillEditEntry[];
  resolution: 'missing' | 'ambiguous';
  candidates: General[];
  rowNumbers: string;
};

// ── Import lookup (§H8 N1 定位形态，v2.8.7) ──
// 势力是消除歧义的键，不是「回落到同名第一个」的兜底。§H8 三态：
//   唯一命中（名字+势力唯一）→ unique；多张 → ambiguous（弹候选）；没有 → missing（可新建）。
// 旧实现 `resolveGeneralByNameFaction` 的「同名取第一个 + 死分支」会让导入
// 静默改到另一势力的同名卡上（官方池 司马懿/邓艾/钟会/张春华 均跨势力），这一条已废除。
export type ImportResolution =
  | { kind: 'unique'; general: General }
  | { kind: 'ambiguous'; candidates: General[] }
  | { kind: 'missing' };

export function resolveGeneralForImport(
  name: string,
  factionText: string | undefined,
  pool: General[],
): ImportResolution {
  const n = name.trim();
  const f = (factionText || '').trim();
  if (!n) return { kind: 'missing' };
  const sameName = pool.filter(g => g.name === n);
  if (sameName.length === 0) return { kind: 'missing' };
  if (f) {
    const matched = sameName.filter(g => g.faction === f);
    if (matched.length === 1) return { kind: 'unique', general: matched[0] };
    if (matched.length > 1) return { kind: 'ambiguous', candidates: matched };
    // 势力填了但没命中：不替用户猜，把全部同名列出（可能是想选另一势力、或这才是待建）。
    return { kind: 'ambiguous', candidates: sameName };
  }
  if (sameName.length === 1) return { kind: 'unique', general: sameName[0] };
  return { kind: 'ambiguous', candidates: sameName };
}

/** @deprecated Use resolveGeneralForImport for strict three-state resolution */
export function resolveGeneralByNameFaction(name: string, factionText?: string): General | undefined {
  const res = resolveGeneralForImport(name, factionText, allGenerals);
  return res.kind === 'unique' ? res.general : undefined;
}

// ── Parse new row-per-skill format for an entire sheet ──
// parseWarnings: 录入面读不懂的原文（门槛栏、触发栏各自逐条列出）。
// 导入报告必须如实显示，绝不能假装成功——"没看懂"和"没有"是两件事。
export const parseRowPerSkillSheet = (rows: (string|number|undefined)[][], pool: General[] = allGenerals): {
  entries: { general: General; gEdit: Record<string,unknown>; skills: SkillEditEntry[] }[];
  parseWarnings: string[];
  unresolved: UnresolvedImportBlock[];
} => {
  const header = rows[0] || [];
  const noteColIndex = header.findIndex(h => String(h || '').trim() === '设定备注');
  const effectEndExclusive = noteColIndex === -1 ? header.length : noteColIndex; // don't parse 备注列
  const groupWidth = detectEffectGroupWidth(header); // 3 (legacy) | 6 (runtime) | 7 (runtime + 门槛)
  const dataRows = rows.slice(1); // skip header
  const entries: { general: General; gEdit: Record<string,unknown>; skills: SkillEditEntry[] }[] = [];
  const parseWarnings: string[] = [];
  const unresolved: UnresolvedImportBlock[] = [];
  const facList = ['魏','蜀','吴','群','晋'] as Faction[];

  let currentGeneral: General | undefined;
  let currentGEdit: Record<string,unknown> = {};
  let currentSkills: SkillEditEntry[] = [];
  let currentUnresolved: {
    name: string;
    factionText: string;
    hp?: number;
    meleeAtk?: number;
    rangedAtk?: number;
    skills: SkillEditEntry[];
    rowStart: number;
    rowEnd: number;
  } | null = null;

  const flushCurrent = () => {
    if (currentGeneral && currentSkills.length > 0) {
      entries.push({ general: currentGeneral, gEdit: { ...currentGEdit }, skills: [...currentSkills] });
    }
    if (currentUnresolved) {
      unresolved.push({
        name: currentUnresolved.name,
        factionText: currentUnresolved.factionText,
        hp: currentUnresolved.hp,
        meleeAtk: currentUnresolved.meleeAtk,
        rangedAtk: currentUnresolved.rangedAtk,
        skills: [...currentUnresolved.skills],
        resolution: 'missing',
        candidates: [],
        rowNumbers: `${currentUnresolved.rowStart}-${currentUnresolved.rowEnd}`,
      });
    }
    currentGeneral = undefined;
    currentGEdit = {};
    currentSkills = [];
    currentUnresolved = null;
  };

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = dataRows[rowIndex];
    if (!row || row.length < 6) continue;
    const nameCell = String(row[0] || '').trim();

    // If column A has a general name, start a new general block
    if (nameCell) {
      flushCurrent();
      const rawFac = clean(String(row[1] || ''));
      const resolution = resolveGeneralForImport(nameCell, rawFac, pool);

      if (resolution.kind === 'unique') {
        currentGeneral = resolution.general;
        const hp = row[2] != null && String(row[2]).trim() ? Number(row[2]) : undefined;
        const mAtk = row[3] != null && String(row[3]).trim() ? Number(row[3]) : undefined;
        const rAtk = row[4] != null && String(row[4]).trim() ? Number(row[4]) : undefined;
        currentGEdit = {
          faction: facList.includes(rawFac as Faction) && rawFac !== currentGeneral.faction ? rawFac : undefined,
          hp: hp && hp !== currentGeneral.hp ? hp : undefined,
          meleeAtk: mAtk != null && mAtk !== currentGeneral.meleeAtk ? mAtk : undefined,
          rangedAtk: rAtk != null && rAtk !== currentGeneral.rangedAtk ? rAtk : undefined,
        };
        currentSkills = [];
      } else {
        // unresolved: collect raw data for pending routing
        const hp = row[2] != null ? Number(row[2]) : undefined;
        const mAtk = row[3] != null ? Number(row[3]) : undefined;
        const rAtk = row[4] != null ? Number(row[4]) : undefined;
        currentUnresolved = {
          name: nameCell,
          factionText: rawFac,
          hp: Number.isFinite(hp) ? hp : undefined,
          meleeAtk: Number.isFinite(mAtk) ? mAtk : undefined,
          rangedAtk: Number.isFinite(rAtk) ? rAtk : undefined,
          skills: [],
          rowStart: rowIndex + 1, // 1-based
          rowEnd: rowIndex + 1,
        };
      }
      // Don't continue here — the same row may also contain the first skill (cols 5+)
    }

    // Parse skill from cols 5-10
    if (!currentGeneral && !currentUnresolved) continue;

    const sName = clean(String(row[5] || ''));
    if (!sName) continue;
    const sTag = clean(String(row[6] || ''));
    const sForced = clean(String(row[7] || ''));
    const sTrigger = clean(String(row[8] || ''));
    const sMode = clean(String(row[9] || ''));
    const sDesc = clean(String(row[10] || ''));

    const tag = (allSkillTags as readonly string[]).includes(sTag) ? sTag as SkillTag : undefined;
    const forced = sForced === '是' || undefined;
    const skillTriggerRead = readTriggerCell(sTrigger);
    if (skillTriggerRead.unreadable) {
      const name = currentGeneral?.name || currentUnresolved?.name || '未知';
      parseWarnings.push(`${name}·${sName} 技能触发：这句没看懂 → ${skillTriggerRead.unreadable}`);
    }
    const trigger = skillTriggerRead.trigger;
    const effectMode = (sMode === '选择其一' || sMode === 'choice') ? 'choice' as SkillEffectMode
      : (sMode === '全部生效' || sMode === 'all') ? 'all' as SkillEffectMode : undefined;

    // Parse sub-effects from col 11 onwards (groups of 3 for legacy files,
    // 6 — 标注/触发/效果类型/数值/目标/描述 — or 7 — v2 + 门槛 — for current exports)
    const effects: SkillEffect[] = [];
    let col = 11;
    while (col + groupWidth - 1 < effectEndExclusive) {
      const parsed = parseEffectGroup(row, col, groupWidth);
      if (parsed) {
        const seq = `效果${Math.floor((col - 11) / groupWidth) + 1}`;
        // 整组只有门槛/只有看不懂的触发：这不是一個效果，绝不凭空造一个空效果，只如实回显。
        if (parsed.orphanGate) {
          const name = currentGeneral?.name || currentUnresolved?.name || '未知';
          parseWarnings.push(`${name}·${sName} ${seq}：只写了门槛「${parsed.orphanGate}」，没写这是哪个效果，这条没被记下`);
        }
        if (parsed.triggerUnreadable) {
          const name = currentGeneral?.name || currentUnresolved?.name || '未知';
          parseWarnings.push(`${name}·${sName} ${seq} 触发：这句没看懂 → ${parsed.triggerUnreadable}`);
        }
        if (Object.keys(parsed.fields).length > 0) {
          effects.push({ id: `e${Date.now()}_${effects.length}`, ...parsed.fields });
          for (const u of parsed.gateUnknown) {
            const name = currentGeneral?.name || currentUnresolved?.name || '未知';
            parseWarnings.push(`${name}·${sName} 效果${effects.length}：门槛里这句没看懂 → ${u}`);
          }
        }
      }
      col += groupWidth;
    }

    if (currentGeneral) {
      currentSkills.push({
        name: sName, tag, forced, trigger,
        effectMode: effects.length > 0 ? (effectMode || 'all') : effectMode,
        effects: effects.length > 0 ? effects : undefined,
        description: sDesc || undefined,
      });
    } else if (currentUnresolved) {
      currentUnresolved.skills.push({
        name: sName, tag, forced, trigger,
        effectMode: effects.length > 0 ? (effectMode || 'all') : effectMode,
        effects: effects.length > 0 ? effects : undefined,
        description: sDesc || undefined,
      });
      currentUnresolved.rowEnd = rowIndex + 1; // 1-based
    }
  }
  flushCurrent();
  return { entries, parseWarnings, unresolved };
};

// ── Legacy flat format parser (5 cols per skill) ──
export const parseLegacyDetailedRow = (row: (string|number|undefined)[]): {
  general: General | undefined;
  gEdit: Record<string,unknown>;
  skills: SkillEditEntry[];
  rawName?: string;
  rawFac?: string;
  rawHp?: number;
  rawMAtk?: number;
  rawRAtk?: number;
} | null => {
  const name = String(row[0] || '').trim();
  if (!name) return null;
  const facList = ['魏','蜀','吴','群','晋'] as Faction[];
  const rawFac = clean(String(row[1] || ''));
  const resolution = resolveGeneralForImport(name, rawFac, allGenerals);
  
  if (resolution.kind !== 'unique') {
    // 未解析或歧义：返回 raw 数据但不返回 general
    const hp = row[2] != null ? Number(row[2]) : undefined;
    const mAtk = row[3] != null ? Number(row[3]) : undefined;
    const rAtk = row[4] != null ? Number(row[4]) : undefined;
    return {
      general: undefined,
      gEdit: {},
      skills: [],
      rawName: name,
      rawFac,
      rawHp: Number.isFinite(hp) ? hp : undefined,
      rawMAtk: Number.isFinite(mAtk) ? mAtk : undefined,
      rawRAtk: Number.isFinite(rAtk) ? rAtk : undefined,
    };
  }
  
  const general = resolution.general;
  const hp = row[2] != null ? Number(row[2]) : undefined;
  const mAtk = row[3] != null ? Number(row[3]) : undefined;
  const rAtk = row[4] != null ? Number(row[4]) : undefined;
  const gEdit = {
    faction: facList.includes(rawFac as Faction) && rawFac !== general.faction ? rawFac : undefined,
    hp: hp && hp !== general.hp ? hp : undefined,
    meleeAtk: mAtk != null && mAtk !== general.meleeAtk ? mAtk : undefined,
    rangedAtk: rAtk != null && rAtk !== general.rangedAtk ? rAtk : undefined,
  };
  const skills: SkillEditEntry[] = [];
  let col = 5;
  while (col < row.length) {
    const sName = clean(String(row[col] || ''));
    if (!sName) { col += 5; continue; }
    const sTag = clean(String(row[col + 1] || ''));
    const sForced = clean(String(row[col + 2] || ''));
    const sMode = clean(String(row[col + 3] || ''));
    const sDesc = clean(String(row[col + 4] || ''));
    const tag = (allSkillTags as readonly string[]).includes(sTag) ? sTag as SkillTag : undefined;
    const forced = sForced === '是' || undefined;
    const effectMode = (sMode === '选择其一' || sMode === 'choice') ? 'choice' as SkillEffectMode
      : (sMode === '全部生效' || sMode === 'all') ? 'all' as SkillEffectMode : undefined;
    skills.push({ name: sName, tag, forced, effectMode, description: sDesc || undefined });
    col += 5;
  }
  return { general, gEdit, skills };
};
