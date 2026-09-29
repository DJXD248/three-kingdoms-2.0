// 导入总结（v2.8.13，用户 2026-09-29 需求）：一次导入到底新增/改动了哪些将领。
// 全部为无状态纯函数：只吃"写入前后的当前生效视图"，不认识 store 也不认识组件。
import { General } from '../../data/generals';

/** 总结要读的字段——一律从生效视图取，绝不从仓库原始卡取（#47 裁决同一口径）。 */
export interface SummarySnapshot {
  name: string;
  faction: string;
  hp: number;
  meleeAtk: number;
  rangedAtk: number;
  skills: { name: string; description: string; tag: string }[];
}

export type ImportSummaryEntry =
  | { kind: 'created'; name: string; skills: string[] }
  | { kind: 'modified'; name: string; items: string[] };

/** describeChanges 只会产出"修改"这一类，返回类型就照实收窄，别让调用方替它猜。 */
export type ModifiedSummaryEntry = Extract<ImportSummaryEntry, { kind: 'modified' }>;

export function snapshotForSummary(g: General): SummarySnapshot {
  return {
    name: g.name,
    faction: g.faction,
    hp: g.hp,
    meleeAtk: g.meleeAtk,
    rangedAtk: g.rangedAtk,
    skills: g.skills.map(s => ({
      name: s.name, description: s.description ?? '', tag: s.tag ?? '',
    })),
  };
}

const repeat = (n: number, make: () => string) => Array.from({ length: n }, make);

/** 只点名：新增/移除/改动了哪些技能；集合没变但顺序变了也如实说一句。 */
function describeSkillChanges(
  before: SummarySnapshot['skills'],
  after: SummarySnapshot['skills'],
): string[] {
  const items: string[] = [];
  const names = (list: SummarySnapshot['skills']) => list.map(s => s.name);
  const beforeNames = names(before);
  const afterNames = names(after);
  const countIn = (list: string[], name: string) => list.filter(n => n === name).length;
  // 按**名字**逐个报，同名多张只在张数真的变了时报相应张数；
  // 逐条遍历会把"新增 1 张"跟着第二个同名技能再报一遍（界面出现两行同样的话）。
  for (const name of new Set(afterNames)) {
    items.push(...repeat(Math.max(0, countIn(afterNames, name) - countIn(beforeNames, name)),
      () => `新增技能「${name}」`));
  }
  for (const name of new Set(beforeNames)) {
    items.push(...repeat(Math.max(0, countIn(beforeNames, name) - countIn(afterNames, name)),
      () => `移除技能「${name}」`));
  }
  const pairCount = Math.min(before.length, after.length);
  for (let i = 0; i < pairCount; i++) {
    const b = before[i], a = after[i];
    if (b.name !== a.name) continue;
    const sameCount = beforeNames.filter(n => n === b.name).length === afterNames.filter(n => n === b.name).length;
    const changed = b.description !== a.description || b.tag !== a.tag;
    const label = `技能「${b.name}」改动`;
    if (sameCount && changed && !items.includes(label)) items.push(label);
  }
  const sameSet = [...beforeNames].sort().join('\u0000') === [...afterNames].sort().join('\u0000');
  const sameOrder = before.length === after.length && before.every((s, i) => s.name === after[i].name);
  if (sameSet && !sameOrder) items.push('技能顺序调整');
  return items;
}

/** 前后两个生效视图 ⇒ 这个将领本次被改了什么；什么都没改返回 null（绝不列空条目）。 */
export function describeChanges(
  before: SummarySnapshot,
  after: SummarySnapshot,
): ModifiedSummaryEntry | null {
  const items: string[] = [];
  if (before.faction !== after.faction) items.push(`势力 ${before.faction}→${after.faction}`);
  if (before.hp !== after.hp) items.push(`体力 ${before.hp}→${after.hp}`);
  if (before.meleeAtk !== after.meleeAtk) items.push(`近战 ${before.meleeAtk}→${after.meleeAtk}`);
  if (before.rangedAtk !== after.rangedAtk) items.push(`远程 ${before.rangedAtk}→${after.rangedAtk}`);
  items.push(...describeSkillChanges(before.skills, after.skills));
  return items.length > 0 ? { kind: 'modified', name: after.name, items } : null;
}

export function createdEntry(name: string, skillNames: string[]): ImportSummaryEntry {
  return { kind: 'created', name, skills: skillNames };
}

/** 同一名将领在一次导入里被写两次 ⇒ 合成一条（总结回答的是"本次导入后怎么样了"）。 */
export function mergeSummaryEntry(
  prev: ImportSummaryEntry[],
  next: ImportSummaryEntry,
): ImportSummaryEntry[] {
  const i = prev.findIndex(e => e.kind === next.kind && e.name === next.name);
  if (i === -1) return [...prev, next];
  const existing = prev[i];
  if (existing.kind === 'created' && next.kind === 'created') {
    const skills = Array.from(new Set([...existing.skills, ...next.skills]));
    return [...prev.slice(0, i), { ...existing, skills }, ...prev.slice(i + 1)];
  }
  if (existing.kind === 'modified' && next.kind === 'modified') {
    const items = Array.from(new Set([...existing.items, ...next.items]));
    return [...prev.slice(0, i), { ...existing, items }, ...prev.slice(i + 1)];
  }
  return [...prev, next];
}

export function renderSummaryText(entries: ImportSummaryEntry[]): string {
  const created = entries.filter(e => e.kind === 'created');
  const modified = entries.filter(e => e.kind === 'modified');
  const lines: string[] = [];
  if (created.length > 0) {
    lines.push(`新增 ${created.length} 名`);
    for (const e of created) lines.push(`· ${e.name}：${e.skills.join('、') || '（无技能）'}`);
  }
  if (modified.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`修改 ${modified.length} 名`);
    for (const e of modified) lines.push(`· ${e.name}：${e.items.join('；')}`);
  }
  return lines.join('\n');
}
