/**
 * v2.9.12 DIY 内容包 · 装包核对（纯判据：零 DOM、零存储）。
 *
 * 这一份负责契约里最难的那句：**装成功＝可用，装不上＝说清为什么，绝不半装。**
 * 所以 `planInstall` 先把整包逐条核完再返回，`install` 只有在零拒绝时才非空——
 * 调用方（store 的安装动作）要么一张也不写，要么一次写全，中间没有"装到一半"的状态。
 *
 * 三条边界（都已登记）：
 *  ① 包只能带玩家自制将领；编号不在 `D-` 名下、来源不是 `'DIY'`、或撞仓库官方名册的一律拒。
 *  ② 同编号且内容一模一样＝"你已经有这张了"，跳过不算失败；同编号内容不一样＝整包拒绝，
 *     绝不覆盖本机已有的卡（覆盖是拿别人的文件改玩家的资产，比装不上更糟）。
 *  ③ 落库前先按已知字段名筛一遍（`sanitizeRecord`），野字段不进本机存档。
 */
import type { General, Skill } from '../data/generals';
import { allSkillTags } from '../data/generals';
import { isRepositoryOfficial, idNamespace, isAcceptableAuthoredRecord } from '../domain/generalProvenance';
import { PACK_FACTIONS, type PackRead, stableText } from './contentPack';

export type InstallVerdict = 'install' | 'already' | 'refuse';

export type InstallLine = {
  index: number;
  id: string;
  name: string;
  verdict: InstallVerdict;
  why: string;
};

export type InstallPlan = {
  /** true ＝ install 非空且可以整包落库；false ＝ install 一定是空数组。 */
  ok: boolean;
  lines: InstallLine[];
  install: General[];
  /** 整包级别的一句话（文件本身读不懂、或有卡不合格时给界面当标题）。 */
  headline: string;
};

export type InstallContext = { existingAuthored: General[] };

const GENERAL_KEYS = ['id', 'name', 'faction', 'hp', 'type', 'meleeAtk', 'rangedAtk', 'armor', 'skills', 'identity', 'source'] as const;
const SKILL_KEYS = ['name', 'description', 'tags', 'tag', 'trigger', 'effects', 'effectMode', 'conditions', 'forced'] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * 逐条挑毛病；返回第一句人读的理由，没问题返回 null。
 * **导出这一侧也用它**（ContentPackPanel）——写出去的文件必须能装进别人的机器，
 * 两侧各写一份判据迟早会分叉：这边放行、那边整包拒，玩家拿到的是一个永远装不上的包。
 */
export function findRecordProblem(raw: unknown): string | null {
  const g = asRecord(raw);
  if (!g) return '这一条不是一个将领记录（文件结构不对）';
  if (!isAcceptableAuthoredRecord(g)) {
    const id = typeof g.id === 'string' ? g.id : '（没有编号）';
    if (idNamespace(id) !== 'D') return `编号「${id}」不在玩家自制的 D- 名下——包只装玩家自制的将，官方卡由程序自己的名册带，不接受外来文件冒充`;
    if (g.source !== 'DIY') return `编号「${id}」的来源写的不是「玩家自制」——同样的理由，不接受外来文件把自己说成官方`;
    return `编号「${id}」的记录缺了认账要用的字段（编号、来源或名字对不上）`;
  }
  if (isRepositoryOfficial(g)) return `编号「${g.id}」撞上了程序自带的官方卡——这张不会被写进本机自制清单`;
  if (typeof g.name !== 'string' || g.name.trim() === '') return `编号「${g.id}」没有将名`;
  if (!PACK_FACTIONS.includes(g.faction as never)) return `「${g.name}」的势力「${String(g.faction)}」不是本程序认的字（只认 ${PACK_FACTIONS.join('/')}）`;
  if (!isFiniteNumber(g.hp) || g.hp <= 0) return `「${g.name}」的体力「${String(g.hp)}」不是正数`;
  if (g.type !== '武将' && g.type !== '文将') return `「${g.name}」的类型「${String(g.type)}」不是本程序认的字`;
  for (const field of ['meleeAtk', 'rangedAtk', 'armor'] as const) {
    if (!isFiniteNumber(g[field]) || (g[field] as number) < 0) return `「${g.name}」的 ${field}「${String(g[field])}」不是 0 以上的数`;
  }
  if (!Array.isArray(g.skills)) return `「${g.name}」的技能那一段不是一个清单`;
  for (const [i, value] of (g.skills as unknown[]).entries()) {
    const s = asRecord(value);
    if (!s) return `「${g.name}」的第 ${i + 1} 枚技能不是一个技能记录`;
    if (typeof s.name !== 'string' || s.name.trim() === '') return `「${g.name}」的第 ${i + 1} 枚技能没有技能名`;
    if (s.tags !== undefined) {
      if (!Array.isArray(s.tags)) return `「${s.name}」的徽章不是一枚一枚列出来的`;
      const wild = (s.tags as unknown[]).filter(t => !allSkillTags.includes(t as never));
      if (wild.length > 0) return `「${s.name}」带了本程序没有的徽章：${wild.map(String).join('、')}（只认 ${allSkillTags.join('/')}）`;
    }
    if (s.effects !== undefined && !Array.isArray(s.effects)) return `「${s.name}」的效果那一段不是一个清单`;
    if (s.conditions !== undefined && !Array.isArray(s.conditions)) return `「${s.name}」的门槛那一段不是一个清单`;
    if (s.trigger !== undefined && asRecord(s.trigger) === null) return `「${s.name}」的触发时机不是一个记录`;
  }
  if (g.identity !== undefined && typeof g.identity !== 'string') return `「${g.name}」的身份那一格不是文字`;
  return null;
}

/** 已知字段名筛一遍再落库：外来文件不能往本机存档里塞野键。 */
function sanitizeRecord(raw: unknown): General {
  const g = asRecord(raw) as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const key of GENERAL_KEYS) if (g[key] !== undefined) clean[key] = g[key];
  clean.skills = (Array.isArray(g.skills) ? g.skills : []).map(value => {
    const s = asRecord(value) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of SKILL_KEYS) if (s[key] !== undefined) out[key] = s[key];
    return out as unknown as Skill;
  });
  return clean as unknown as General;
}

function describe(raw: unknown, index: number): { id: string; name: string } {
  const g = asRecord(raw);
  const id = g && typeof g.id === 'string' && g.id !== '' ? g.id : `（第 ${index + 1} 条没有编号）`;
  const name = g && typeof g.name === 'string' && g.name.trim() !== '' ? g.name : '（没有将名）';
  return { id, name };
}

export function planInstall(read: PackRead, ctx: InstallContext): InstallPlan {
  if (!read.ok) {
    return {
      ok: false,
      lines: [],
      install: [],
      headline: `这个包没有装上（一张也没有）：${read.problems.map(p => p.detail).join('；')}`,
    };
  }

  const existing = new Map<string, string>();
  for (const g of ctx.existingAuthored) existing.set(g.id, stableText(sanitizeRecord(g)));

  const lines: InstallLine[] = [];
  const install: General[] = [];
  const seenInPack = new Map<string, string>();
  let refused = 0;

  for (const [index, raw] of read.generals.entries()) {
    const { id, name } = describe(raw, index);
    const bad = findRecordProblem(raw);
    if (bad) {
      refused += 1;
      lines.push({ index, id, name, verdict: 'refuse', why: bad });
      continue;
    }
    const clean = sanitizeRecord(raw);
    const text = stableText(clean);
    const inPack = seenInPack.get(clean.id);
    if (inPack !== undefined) {
      lines.push({
        index,
        id,
        name,
        verdict: inPack === text ? 'already' : 'refuse',
        why: inPack === text ? '这个包里这张出现了两遍，内容一模一样，按一份算' : '这个包里同一个编号出现了两遍且内容不一样——我不能替你猜要哪一份',
      });
      if (inPack !== text) refused += 1;
      continue;
    }
    seenInPack.set(clean.id, text);
    const onMachine = existing.get(clean.id);
    if (onMachine !== undefined) {
      if (onMachine === text) {
        lines.push({ index, id, name, verdict: 'already', why: '这台机器上已经有一模一样的这张，不用重复装' });
        continue;
      }
      refused += 1;
      lines.push({ index, id, name, verdict: 'refuse', why: '这台机器上已经有一张同编号但内容不一样的自制将领——包不会覆盖你现有的卡，请先把它删掉或改编号' });
      continue;
    }
    lines.push({ index, id, name, verdict: 'install', why: '合格，装上' });
    install.push(clean);
  }

  if (refused > 0) {
    return {
      ok: false,
      lines,
      install: [],
      headline: `这个包没有装上（一张也没有）：${refused} 条不合格。逐条原因见下面，改好了再导一次——半装会让你的卡池变成没人说得清的样子。`,
    };
  }
  if (install.length === 0) {
    return { ok: false, lines, install: [], headline: '这个包里的将领，这台机器上已经有了，所以一张也不用装。' };
  }
  return {
    ok: true,
    lines,
    install,
    headline: `核对通过，装上 ${install.length} 张${lines.some(l => l.verdict === 'already') ? '（已有的照旧跳过）' : ''}。`,
  };
}
