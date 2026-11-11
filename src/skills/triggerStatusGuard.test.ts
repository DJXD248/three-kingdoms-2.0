/**
 * 触发时机状态表守卫（用户 2026-11-11「先做守卫刀」；契约＝PROJECT_HANDOFF.md §16
 * ＋§12-175⑤⑥＋§12-174⑤）。
 *
 * 三权分立＝**人定义**（表里那一栏由用户裁）／**机核验**（本文件）／**CI 阻断**（跑在册
 * `npm run test:coverage`，不新增 job、不动 ci.yml）。硬约束＝**本文件只读不写**：
 * 检查通过绝不把"挂起／未接线"翻成"已接线"，"绿"不是定义权。
 *
 * 两条防自欺判据（§12-155③「弱断言不配当证人」＋§12-166「抽取失败必须非零退出」）：
 * ① 抽取不到表就**抛**，绝不返回空表让后面"空集比空集"蒙绿；
 * ② 每条反查都配一枚**合成坏形状**的用例，证明"真改了会红"，不是只写一句 toEqual([])。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { triggerTypeLabels } from '../data/generals';
import { SUPPORTED_TRIGGER_MAP } from './skillCompiler';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const handoffPath = path.join(repoRoot, 'PROJECT_HANDOFF.md');

const BEGIN = '<!-- TRIGGER-STATUS:BEGIN v1 -->';
const END = '<!-- TRIGGER-STATUS:END -->';
const STATUSES = ['已接线', '未接线', '挂起'] as const;
type Status = (typeof STATUSES)[number];

interface Row {
  key: string;
  status: Status;
  pointer: string;
}

function markerLines(lines: string[], marker: string): number[] {
  const found: number[] = [];
  lines.forEach((line, i) => {
    if (line.trim() === marker) found.push(i);
  });
  return found;
}

/** 只取那对标记之间的表格行；任何形状不对一律抛（⇒ 这一趟非零退出）。 */
function extractTable(doc: string): Row[] {
  // 换行符先归一：windows runner 检出会把 LF 换成 CRLF，判据不许认死某一种（§12-176 那族）。
  const lines = doc.replace(/\r\n/g, '\n').split('\n');
  const begins = markerLines(lines, BEGIN);
  const ends = markerLines(lines, END);
  if (begins.length !== 1) throw new Error(`BEGIN 标记应恰好 1 枚，实为 ${begins.length}`);
  if (ends.length !== 1) throw new Error(`END 标记应恰好 1 枚，实为 ${ends.length}`);
  if (ends[0] <= begins[0]) throw new Error('END 标记不在 BEGIN 之后');

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const raw of lines.slice(begins[0] + 1, ends[0])) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('|') || !line.endsWith('|')) {
      throw new Error(`表区里出现非表格行：${line}`);
    }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length !== 3) throw new Error(`表行应恰好 3 格，实为 ${cells.length}：${line}`);
    if (cells[0] === '键名') continue;
    if (/^-+$/.test(cells[0])) continue;
    const [key, status, pointer] = cells;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error(`键名形状不认识：${key}`);
    if (!(STATUSES as readonly string[]).includes(status)) {
      throw new Error(`状态只许三档（${STATUSES.join('／')}），实为「${status}」（键 ${key}）`);
    }
    if (pointer === '') throw new Error(`键 ${key} 没有凭据指针`);
    if (seen.has(key)) throw new Error(`键 ${key} 在表里出现两次`);
    seen.add(key);
    rows.push({ key, status: status as Status, pointer });
  }
  if (rows.length === 0) throw new Error('表区里一行数据都没有（不许空跑蒙绿）');
  return rows;
}

/**
 * 双向反查：表是定义、`SUPPORTED_TRIGGER_MAP` 是实现，两边谁漂谁红。
 * 返回人话清单（空＝对得上），合成坏形状的用例直接喂它，证明它真咬。
 */
function crossCheck(rows: readonly Row[], wired: readonly string[]): string[] {
  const problems: string[] = [];
  const byKey = new Map(rows.map(r => [r.key, r]));
  for (const row of rows) {
    const inMap = wired.includes(row.key);
    if (row.status === '已接线' && !inMap) {
      problems.push(`表说「${row.key}」已接线，SUPPORTED_TRIGGER_MAP 里却没有`);
    }
    if (row.status !== '已接线' && inMap) {
      problems.push(`表说「${row.key}」${row.status}，SUPPORTED_TRIGGER_MAP 里却已经认它`);
    }
  }
  for (const key of wired) {
    const row = byKey.get(key);
    if (!row) problems.push(`SUPPORTED_TRIGGER_MAP 认「${key}」，表里却没有这一行`);
    else if (row.status !== '已接线') {
      problems.push(`SUPPORTED_TRIGGER_MAP 认「${key}」，表里却写「${row.status}」`);
    }
  }
  return problems;
}

/** 表 ↔ 词表完整性：一枚不漏、一枚不多（新加一种说法却忘了登记 ⇒ 红）。 */
function coverageProblems(rows: readonly Row[], labels: readonly string[]): string[] {
  const problems: string[] = [];
  const rowKeys = rows.map(r => r.key);
  for (const key of labels) {
    if (!rowKeys.includes(key)) problems.push(`词表里有「${key}」，表里却没有这一行`);
  }
  for (const key of rowKeys) {
    if (!labels.includes(key)) problems.push(`表里有「${key}」，词表里却没有这一枚`);
  }
  return problems;
}

/**
 * 凭据指针只验"真能 grep 到"：文件在、`#12-NNN` 那条判据在、写了行号的那一行在。
 * **不核指针那一行的语义**——行号会随上方编辑漂移，认死它＝天天红（§16 代裁第⑥条）。
 */
function pointerProblems(rows: readonly Row[]): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    for (const token of row.pointer.split('＋')) {
      const spec = token.trim();
      if (spec === '') {
        problems.push(`键 ${row.key} 的指针里有一格空的`);
        continue;
      }
      const hashAt = spec.indexOf('#');
      const filePart = hashAt >= 0 ? spec.slice(0, hashAt) : spec;
      const anchor = hashAt >= 0 ? spec.slice(hashAt + 1) : '';
      const lineMatch = /:(\d+)$/.exec(filePart);
      const relFile = lineMatch ? filePart.slice(0, filePart.length - lineMatch[0].length) : filePart;
      const lineNo = lineMatch ? Number(lineMatch[1]) : null;
      const full = path.join(repoRoot, relFile);
      let text: string;
      try {
        if (!statSync(full).isFile()) throw new Error('not a file');
        text = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
      } catch {
        problems.push(`键 ${row.key} 的指针「${spec}」指到的文件不存在`);
        continue;
      }
      if (anchor !== '') {
        const sec = /^12-(\d+)/.exec(anchor);
        if (!sec) problems.push(`键 ${row.key} 的销案编号「${anchor}」形状不认识`);
        else if (!new RegExp(`^${sec[1]}\\. `, 'm').test(text)) {
          problems.push(`键 ${row.key} 的指针「${spec}」那条判据在 ${relFile} 里找不到`);
        }
      }
      if (lineNo !== null) {
        const total = text.split('\n').length;
        if (lineNo < 1 || lineNo > total) {
          problems.push(`键 ${row.key} 的指针「${spec}」行号越界（那份文件只有 ${total} 行）`);
        }
      }
    }
  }
  return problems;
}

const doc = readFileSync(handoffPath, 'utf8');
const rows = extractTable(doc);
const wired = Object.keys(SUPPORTED_TRIGGER_MAP);
const labelKeys = Object.keys(triggerTypeLabels);

describe('状态表读得出来（抽取失败必须红，不许静默空跑）', () => {
  it('那对标记各恰好一枚、BEGIN 在前，表里行数与词表枚数相等', () => {
    expect(markerLines(doc.split('\n'), BEGIN)).toHaveLength(1);
    expect(markerLines(doc.split('\n'), END)).toHaveLength(1);
    expect(rows.length).toBe(labelKeys.length);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('每行三格齐全：键名是标识符、状态只许三档、指针非空、键不重复', () => {
    for (const row of rows) {
      expect(row.key).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(STATUSES).toContain(row.status);
      expect(row.pointer.length).toBeGreaterThan(0);
    }
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
  });

  it('CRLF 与 LF 两种换行读出来逐行同一（windows runner 检出会换行尾）', () => {
    expect(extractTable(doc.replace(/\n/g, '\r\n'))).toEqual(rows);
  });

  it('标记之外的行文一律不读：在文档末尾追加一行假表也不影响读数', () => {
    const polluted = `${doc}\n| onNoSuchTiming | 已接线 | src/skills/skillCompiler.ts |\n`;
    expect(extractTable(polluted)).toEqual(rows);
  });

  it('缺 END 标记⇒抛（不是返回空表）', () => {
    expect(() => extractTable(doc.replace(END, ''))).toThrow(/END 标记应恰好 1 枚/);
  });

  it('BEGIN 标记出现两次⇒抛', () => {
    expect(() => extractTable(`${doc}\n${BEGIN}\n`)).toThrow(/BEGIN 标记应恰好 1 枚/);
  });

  it('表区只剩表头⇒抛（空集比空集会蒙绿）', () => {
    const gutted = doc.replace(
      /\| onDeploy \| 已接线[\s\S]*?\| untilExpire \| 未接线 \| PROJECT_HANDOFF\.md#12-175③ \|/,
      '',
    );
    expect(gutted).not.toBe(doc);
    expect(() => extractTable(gutted)).toThrow(/一行数据都没有/);
  });

  it('状态写成第四档⇒抛（"已完成"这种自造词不许混进来）', () => {
    const bad = doc.replace('| onDeploy | 已接线 |', '| onDeploy | 已完成 |');
    expect(bad).not.toBe(doc);
    expect(() => extractTable(bad)).toThrow(/状态只许三档/);
  });

  it('同一枚键写两行⇒抛', () => {
    const bad = doc.replace(END, `| onDeploy | 已接线 | src/skills/skillCompiler.ts |\n${END}`);
    expect(() => extractTable(bad)).toThrow(/出现两次/);
  });
});

describe('双向反查：表 ↔ SUPPORTED_TRIGGER_MAP（判据单点，不另抄名单）', () => {
  it('现树对得上：不一致清单为空', () => {
    expect(crossCheck(rows, wired)).toEqual([]);
  });

  it('表里"已接线"那一档与编译器认的那一批逐枚相等（排序后比）', () => {
    const declared = rows.filter(r => r.status === '已接线').map(r => r.key).sort();
    expect(declared).toEqual([...wired].sort());
    expect(declared.length).toBeGreaterThan(0);
  });

  it('把已接线的一枚改成"未接线"⇒红，且两个方向各点它一次', () => {
    const bad = rows.map(r => (r.key === 'onTargetConfirmed' ? { ...r, status: '未接线' as Status } : r));
    const problems = crossCheck(bad, wired);
    expect(problems).toContain('表说「onTargetConfirmed」未接线，SUPPORTED_TRIGGER_MAP 里却已经认它');
    expect(problems).toContain('SUPPORTED_TRIGGER_MAP 认「onTargetConfirmed」，表里却写「未接线」');
  });

  it('把"挂起"那一枚翻成"已接线"⇒红（PENDING 不许自动翻的定义权护栏）', () => {
    const bad = rows.map(r => (r.key === 'onOtherDeploy' ? { ...r, status: '已接线' as Status } : r));
    expect(crossCheck(bad, wired)).toContain('表说「onOtherDeploy」已接线，SUPPORTED_TRIGGER_MAP 里却没有');
  });

  it('代码新接了一枚、表里忘了登记⇒红', () => {
    const problems = crossCheck(rows, [...wired, 'untilExpire']);
    expect(problems).toContain('SUPPORTED_TRIGGER_MAP 认「untilExpire」，表里却写「未接线」');
    expect(crossCheck(rows.filter(r => r.key !== 'passive'), wired))
      .toContain('SUPPORTED_TRIGGER_MAP 认「passive」，表里却没有这一行');
  });

  it('表里删掉一行已接线的⇒红（不是"少一行也算对"）', () => {
    const problems = crossCheck(rows.filter(r => r.key !== 'onTurnEnd'), wired);
    expect(problems).toContain('SUPPORTED_TRIGGER_MAP 认「onTurnEnd」，表里却没有这一行');
  });
});

describe('完整性：表 ↔ 词表 22 枚一枚不漏、一枚不多', () => {
  it('现树对得上', () => {
    expect(coverageProblems(rows, labelKeys)).toEqual([]);
  });

  it('词表新加一枚、表里没行⇒红', () => {
    expect(coverageProblems(rows, [...labelKeys, 'onBrandNew']))
      .toContain('词表里有「onBrandNew」，表里却没有这一行');
  });

  it('表里多出一枚词表没有的键⇒红', () => {
    const bad = [...rows, { key: 'onBrandNew', status: '未接线' as Status, pointer: 'PROJECT_HANDOFF.md#12-175③' }];
    expect(coverageProblems(bad, labelKeys)).toContain('表里有「onBrandNew」，词表里却没有这一枚');
  });
});

describe('凭据指针真能 grep 到（只验存在，不核语义）', () => {
  it('现树每一枚指针都指得到', () => {
    expect(pointerProblems(rows)).toEqual([]);
  });

  it('指针指到不存在的文件⇒红', () => {
    const bad = rows.map(r => (r.key === 'onDeploy' ? { ...r, pointer: 'src/skills/noSuchFile.ts' } : r));
    expect(pointerProblems(bad)).toContain('键 onDeploy 的指针「src/skills/noSuchFile.ts」指到的文件不存在');
  });

  it('销案编号那条判据不在文档里⇒红', () => {
    const bad = rows.map(r => (r.key === 'untilExpire' ? { ...r, pointer: 'PROJECT_HANDOFF.md#12-99999' } : r));
    expect(pointerProblems(bad)[0]).toMatch(/那条判据在 PROJECT_HANDOFF\.md 里找不到/);
  });

  it('行号越界⇒红', () => {
    const bad = rows.map(r => (r.key === 'onOtherDeploy'
      ? { ...r, pointer: 'src/data/listenerScopeSingleSource.test.ts:999999' }
      : r));
    expect(pointerProblems(bad)[0]).toMatch(/行号越界/);
  });

  it('挂起那一枚的指针真指到钉它缺席的那一行', () => {
    const suspended = rows.filter(r => r.status === '挂起');
    expect(suspended.length).toBeGreaterThan(0);
    const target = path.join(repoRoot, 'src', 'data', 'listenerScopeSingleSource.test.ts');
    const line = readFileSync(target, 'utf8').replace(/\r\n/g, '\n').split('\n')[81];
    expect(line).toContain("not.toContain('onOtherDeploy')");
  });
});

describe('守卫只读不写：绿了也不许改表（人定义权那一栏）', () => {
  it('跑完整套核验之后，那份文档的字节与修改时刻逐字未动', () => {
    const before = statSync(handoffPath);
    const textBefore = readFileSync(handoffPath, 'utf8');
    crossCheck(rows, wired);
    coverageProblems(rows, labelKeys);
    pointerProblems(rows);
    extractTable(readFileSync(handoffPath, 'utf8'));
    const after = statSync(handoffPath);
    expect(readFileSync(handoffPath, 'utf8')).toBe(textBefore);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('状态取自文档、不取自代码：同一份表喂不同的实现集，读数跟着变', () => {
    expect(crossCheck(rows, wired)).toEqual([]);
    expect(crossCheck(rows, []).length).toBe(wired.length);
    expect(crossCheck([], wired).length).toBe(wired.length);
  });
});