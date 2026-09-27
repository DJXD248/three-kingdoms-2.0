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

export const resolveGeneralByNameFaction = (name: string, factionText?: string): General | undefined => {
  const n = name.trim();
  const f = (factionText || '').trim();
  if (!n) return undefined;
  if (f) {
    const exact = allGenerals.find(g => g.name === n && g.faction === f);
    if (exact) return exact;
  }
  const sameName = allGenerals.filter(g => g.name === n);
  if (sameName.length === 1) return sameName[0];
  return sameName[0];
};

// ── Parse new row-per-skill format for an entire sheet ──
// parseWarnings: 录入面读不懂的原文（门槛栏、触发栏各自逐条列出）。
// 导入报告必须如实显示，绝不能假装成功——"没看懂"和"没有"是两件事。
export const parseRowPerSkillSheet = (rows: (string|number|undefined)[][]): {
  entries: { general: General; gEdit: Record<string,unknown>; skills: SkillEditEntry[] }[];
  parseWarnings: string[];
} => {
  const header = rows[0] || [];
  const noteColIndex = header.findIndex(h => String(h || '').trim() === '设定备注');
  const effectEndExclusive = noteColIndex === -1 ? header.length : noteColIndex; // don't parse 备注列
  const groupWidth = detectEffectGroupWidth(header); // 3 (legacy) | 6 (runtime) | 7 (runtime + 门槛)
  const dataRows = rows.slice(1); // skip header
  const entries: { general: General; gEdit: Record<string,unknown>; skills: SkillEditEntry[] }[] = [];
  const parseWarnings: string[] = [];
  const facList = ['魏','蜀','吴','群','晋'] as Faction[];

  let currentGeneral: General | undefined;
  let currentGEdit: Record<string,unknown> = {};
  let currentSkills: SkillEditEntry[] = [];

  const flushCurrent = () => {
    if (currentGeneral && currentSkills.length > 0) {
      entries.push({ general: currentGeneral, gEdit: { ...currentGEdit }, skills: [...currentSkills] });
    }
  };

  for (const row of dataRows) {
    if (!row || row.length < 6) continue;
    const nameCell = String(row[0] || '').trim();

    // If column A has a general name, start a new general block
    if (nameCell) {
      flushCurrent();
      const rawFac = clean(String(row[1] || ''));
      currentGeneral = resolveGeneralByNameFaction(nameCell, rawFac);
      if (!currentGeneral) { currentSkills = []; continue; }
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
    }

    if (!currentGeneral) continue;

    // Parse skill from cols 5-10
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
      parseWarnings.push(`${currentGeneral.name}·${sName} 技能触发：这句没看懂 → ${skillTriggerRead.unreadable}`);
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
          parseWarnings.push(`${currentGeneral.name}·${sName} ${seq}：只写了门槛「${parsed.orphanGate}」，没写这是哪个效果，这条没被记下`);
        }
        if (parsed.triggerUnreadable) {
          parseWarnings.push(`${currentGeneral.name}·${sName} ${seq} 触发：这句没看懂 → ${parsed.triggerUnreadable}`);
        }
        if (Object.keys(parsed.fields).length > 0) {
          effects.push({ id: `e${Date.now()}_${effects.length}`, ...parsed.fields });
          for (const u of parsed.gateUnknown) {
            parseWarnings.push(`${currentGeneral.name}·${sName} 效果${effects.length}：门槛里这句没看懂 → ${u}`);
          }
        }
      }
      col += groupWidth;
    }

    currentSkills.push({
      name: sName, tag, forced, trigger,
      effectMode: effects.length > 0 ? (effectMode || 'all') : effectMode,
      effects: effects.length > 0 ? effects : undefined,
      description: sDesc || undefined,
    });
  }
  flushCurrent();
  return { entries, parseWarnings };
};

// ── Legacy flat format parser (5 cols per skill) ──
export const parseLegacyDetailedRow = (row: (string|number|undefined)[]): {
  general: General | undefined;
  gEdit: Record<string,unknown>;
  skills: SkillEditEntry[];
} | null => {
  const name = String(row[0] || '').trim();
  if (!name) return null;
  const facList = ['魏','蜀','吴','群','晋'] as Faction[];
  const rawFac = clean(String(row[1] || ''));
  const general = resolveGeneralByNameFaction(name, rawFac);
  if (!general) return null;
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
