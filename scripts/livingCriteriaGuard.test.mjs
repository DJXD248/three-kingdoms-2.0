// 冻结令＋投影账本的守卫（2026-11-15「接手时少读点」第一刀）。
// 契约＝PROJECT_HANDOFF.md §12 冻结令第⑤条＋§12-195④⑤⑦。
// 为什么不数编号就完事：§12-195⑤ 记的是"编号留壳、正文搬空，行首 `N. ` 断言照样绿"＝弱断言
// （§12-155③）。所以这里四条一起验，且每条正面断言配一枚"改坏必须响"的合成探针。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANDOFF = path.join(ROOT, 'PROJECT_HANDOFF.md');
const LEDGER = path.join(ROOT, 'PROJECT_LIVING_CRITERIA.md');
const GENERATOR = path.join(ROOT, 'scripts', 'make-living-criteria.mjs');

// 冻结线：§12 条目编号的**有序序列**（不是编号→条目的映射——71 有两份、还有编号 0，
// 编号不是唯一键，按 §12-195④ 只能比序列）。2026-11-15 立线时逐字取自现场。
const FROZEN = `0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,
31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,
71,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,
111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,
145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,
179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195`
  .split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

const readText = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** §12 的起止行号；找不到标题＝抽取失败，必须抛（§12-166：抽取失败不许静默空跑）。 */
function sectionRange(lines) {
  const start = lines.findIndex((l) => /^## 12\./.test(l));
  if (start < 0) throw new Error('§12 标题找不到');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \d+\./.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

function numbering(lines) {
  const { start, end } = sectionRange(lines);
  const nums = [];
  for (let i = start + 1; i < end; i++) {
    const m = /^(\d{1,3})\. /.exec(lines[i]);
    if (m) nums.push(m[1]);
  }
  if (nums.length === 0) throw new Error('§12 条目一条都没抽到＝抽取失败');
  return nums;
}

/** 编号 -> 该条正文（归一空白）。同一编号两份（71）就拼起来，命中任一份即算有原文。 */
function bodiesByNumber(lines) {
  const { start, end } = sectionRange(lines);
  const marks = [];
  for (let i = start + 1; i < end; i++) if (/^\d{1,3}\. /.test(lines[i])) marks.push(i);
  const map = new Map();
  marks.forEach((a, k) => {
    const b = k + 1 < marks.length ? marks[k + 1] : end;
    const num = /^(\d{1,3})\. /.exec(lines[a])[1];
    const body = norm(lines.slice(a, b).join('\n'));
    map.set(num, `${map.get(num) || ''} ⧉ ${body}`);
  });
  return map;
}

/**
 * 账本「账本正文」各分区表的行（6 格）。末节"段外零引用"是 4 格表、总览是 5 格表，
 * 都按格数天然排除；表头与分隔行首格不是纯数字，也排除。
 * 原标题在生成器里做过两件事：超 120 字截断加 `…`、`|` 写成 `¦`，这里逐项还原。
 */
function ledgerRows(ledgerText) {
  const rows = [];
  for (const line of ledgerText.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 6) continue;
    if (!/^\d{1,3}$/.test(cells[0])) continue;
    rows.push({ num: cells[0], head: norm(cells[1].replace(/¦/g, '|').replace(/…$/, '')) });
  }
  if (rows.length === 0) throw new Error('账本一行都没抽到＝抽取失败');
  return rows;
}

/** 人话清单（空＝全对得上）；四条判据单点在此，合成坏形状直接喂它证明它真咬。 */
function crossCheck(nums, frozen, rows, bodies) {
  const problems = [];
  if (nums.join(',') !== frozen.join(',')) {
    const diff = [];
    for (let i = 0; i < Math.max(nums.length, frozen.length); i++) {
      if (nums[i] !== frozen[i]) diff.push(`第 ${i + 1} 位 现[${nums[i] ?? '无'}]≠冻[${frozen[i] ?? '无'}]`);
    }
    problems.push(`§12 编号序列与冻结线不一致：${diff.slice(0, 6).join('；')}`);
  }
  if (rows.length !== nums.length) {
    problems.push(`账本 ${rows.length} 行 ≠ §12 ${nums.length} 条＝投影漏条或多条`);
  }
  for (const r of rows) {
    const body = bodies.get(r.num);
    if (body === undefined) problems.push(`账本第 ${r.num} 行在 §12 里找不到同号条目`);
    else if (!body.includes(r.head)) problems.push(`账本第 ${r.num} 行的原标题在 §12 原文里逐字找不到＝手改或搬空`);
  }
  return problems;
}

const handoffLines = readText(HANDOFF).split('\n');
const nums = numbering(handoffLines);
const bodies = bodiesByNumber(handoffLines);
const rows = ledgerRows(readText(LEDGER));

describe('冻结令：§12 编号序列逐字不变（不删字·不改编号·不再追加）', () => {
  it('现树序列与冻结线逐位相等，且条数 > 0（抽取失败不许蒙绿）', () => {
    // 冻结线自己先要成立：抄漏一格（空项）会让"逐位相等"变成逐位错位，全线误红。
    expect(FROZEN).toHaveLength(197);
    expect(FROZEN.every((n) => /^\d{1,3}$/.test(n))).toBe(true);
    expect(nums.length).toBeGreaterThan(0);
    expect(nums).toEqual(FROZEN);
    expect(nums.length).toBe(197);
  });

  it('编号不是唯一键：71 出现两次、编号 0 在册，守卫按序列而不是按映射比', () => {
    expect(nums.filter((n) => n === '71')).toHaveLength(2);
    expect(nums).toContain('0');
    expect(new Set(nums).size).toBe(nums.length - 1);
  });

  it('合成探针①：末尾追加一条 196（"搬进来一条新判据"的形状）⇒红', () => {
    expect(crossCheck([...nums, '196'], FROZEN, rows, bodies)[0]).toMatch(/编号序列与冻结线不一致/);
    expect(crossCheck([...nums, '196'], FROZEN, rows, bodies)[0]).toContain('现[196]≠冻[无]');
  });

  it('合成探针②：删掉中间一条（"搬走"的形状）⇒红，且指到漂移的那一位', () => {
    const bad = nums.filter((n) => n !== '120');
    const first = crossCheck(bad, FROZEN, rows, bodies)[0];
    expect(first).toMatch(/编号序列与冻结线不一致/);
    expect(first).toContain('现[121]≠冻[120]');
  });

  it('合成探针③：把 71 的两份之一改成别的号（"顺手重编号"的形状）⇒红', () => {
    const at = nums.indexOf('71');
    const bad = [...nums];
    bad[at] = '71x';
    expect(crossCheck(bad, FROZEN, rows, bodies)[0]).toMatch(/编号序列与冻结线不一致/);
  });
});

describe('投影不是抄本：账本每行都能回 §12 逐字命中', () => {
  it('现树对得上：不一致清单为空', () => {
    expect(crossCheck(nums, FROZEN, rows, bodies)).toEqual([]);
  });

  it('账本行数＝§12 条目数（197），编号多重集与 §12 相等', () => {
    expect(rows).toHaveLength(nums.length);
    expect([...rows].map((r) => r.num).sort()).toEqual([...nums].sort());
  });

  it('合成探针④：账本某行的标题手改成 §12 里没有的句子⇒红（手改投影必被抓）', () => {
    const bad = rows.map((r) => (r.num === '73' ? { ...r, head: '词汇表 xlsx 由手工维护' } : r));
    expect(crossCheck(nums, FROZEN, bad, bodies)).toContain(
      '账本第 73 行的原标题在 §12 原文里逐字找不到＝手改或搬空',
    );
  });

  it('合成探针⑤：某条正文被搬空只留壳（编号还在）⇒红，"行首 N. "断言抓不到的这条能抓', () => {
    const gutted = new Map(bodies);
    gutted.set('73', norm('73. '));
    expect(crossCheck(nums, FROZEN, rows, gutted)).toContain(
      '账本第 73 行的原标题在 §12 原文里逐字找不到＝手改或搬空',
    );
  });

  it('合成探针⑥：账本删一行⇒条数不符当场红（不是"少一行也算对"）', () => {
    expect(crossCheck(nums, FROZEN, rows.filter((r) => r.num !== '12'), bodies)[0])
      .toMatch(/账本 196 行 ≠ §12 197 条/);
  });
});

describe('产物与现场重跑逐字节相同（幂等，且登记提交必须带上产物）', () => {
  it('跑生成器覆盖前后，账本字节一模一样；跑完树也复原', () => {
    const before = fs.readFileSync(LEDGER);
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [GENERATOR], { cwd: ROOT, encoding: 'utf8' });
    } catch (e) {
      expect.unreachable(`生成器非零退出：${e.message}`);
    }
    const after = fs.readFileSync(LEDGER);
    try {
      expect(after.equals(before)).toBe(true);
      expect(after.length).toBeGreaterThan(1000);
      expect(stdout).toContain('PROJECT_LIVING_CRITERIA.md');
    } finally {
      fs.writeFileSync(LEDGER, before);
    }
  });

  it('合成探针⑦：把账本改一个字（真实漂移的形状）⇒与现场重跑不等，守卫那条断言会红', () => {
    const clean = fs.readFileSync(LEDGER);
    const drifted = Buffer.from(clean.toString('utf8').replace('现行判据账本', '现行判据账本X'), 'utf8');
    expect(drifted.equals(clean)).toBe(false);
    fs.writeFileSync(LEDGER, drifted);
    try {
      execFileSync(process.execPath, [GENERATOR], { cwd: ROOT, encoding: 'utf8' });
      const after = fs.readFileSync(LEDGER);
      // 守卫断言的是"磁盘上那份 == 现场重跑那份"：手改过⇒两不相等⇒红。
      expect(after.equals(drifted)).toBe(false);
      // 同一棵树重跑仍回到同一份产物＝幂等（不是把漂移当成新基线）。
      expect(after.equals(clean)).toBe(true);
    } finally {
      fs.writeFileSync(LEDGER, clean);
    }
  });

  it('生成器读不到 §12 时非零退出（不是写出一个空账本）', () => {
    const probeDir = path.join(ROOT, 'node_modules', '.cache', 'living-criteria-probe');
    const probeScript = path.join(probeDir, 'scripts', 'make-living-criteria.mjs');
    fs.mkdirSync(path.dirname(probeScript), { recursive: true });
    fs.copyFileSync(GENERATOR, probeScript);
    let code = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [probeScript],
        { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      code = e.status ?? -1;
      stderr = String(e.stderr || e.message);
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/PROJECT_HANDOFF\.md/);
  });
});

describe('守卫只读不写：绿了也不许动 §12 与生成器', () => {
  it('跑完整套核验之后，§12 所在文档的字节与修改时刻逐字未动', () => {
    const before = fs.statSync(HANDOFF);
    const text = readText(HANDOFF);
    crossCheck(numbering(readText(HANDOFF).split('\n')), FROZEN, ledgerRows(readText(LEDGER)), bodiesByNumber(text.split('\n')));
    const after = fs.statSync(HANDOFF);
    expect(readText(HANDOFF)).toBe(text);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
