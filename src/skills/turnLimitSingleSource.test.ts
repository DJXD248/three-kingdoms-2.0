/**
 * 「每回合限 N 次」这一族的**用词只有一个出处**（限次刀，用户 2026-10-28 五条裁决）。
 *
 * 为什么钉这一条：这一刀一次往玩家眼前放了**四个串**——技能卡面上的「每回合限3次」、
 * 编辑器与 Excel 那一格的列名「每回合限几次」、界面提示「留空＝不限制」、用完那一句
 * 「本回合已用尽」。这四个串玩家看得见、又填得回引擎（列名与卡面句都要被反解读回去），
 * 正是 §12-110 那条"同轮必须补只进不出别名＋全库白名单钉"的适用现场：
 * 只要有一处开始手抄，下一位改文案的人就会只改词表、不改那一处，于是**界面说的**与
 * **引擎认的**分叉——而分叉的方向永远是"玩家看见一句话、引擎算了另一件事"。
 *
 * 四条判据＝①合法与否只认 `isValidTurnLimit` 那一份（别处不许自己重算一遍）；
 * ②用完那一句只有一份常量，置灰与拒绝共用；
 * ③卡面那句的**拼法**只有 `turnLimitHead` 一个出处，且写出侧永远是阿拉伯数字（只进不出）；
 * ④数词读法只有 `parseCountNumber` 一份，读不出＝退回点名，绝不兜底成 1。
 *
 * 扫描口径（判据的判据）：**注释与文档里的提及不算第二处出处**——这一钉问的是"代码里
 * 有没有人抄了一份字符串来用"，所以先把注释剥掉再点名；剩下每一处出现都在下面写着它为什么在。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidTurnLimit } from '../data/generals';
import { turnLimitHead } from './skillSentence';
import { TURN_LIMIT_HEADER, TURN_LIMIT_HINT, turnLimitToStr, readTurnLimitCell } from './skillExcelFormat';
import { TURN_LIMIT_EXHAUSTED_TEXT, LIMIT_EXHAUSTED_TEXT } from './skillQuota';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** 剥掉块注释与行注释，只留"代码里真的写着这一串"的那一面。 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
}

const files = walk(srcRoot);
const rel = (f: string) => path.relative(srcRoot, f).replace(/\\/g, '/');
/** 代码（非注释）里出现这一串的，全库有哪几个文件。 */
const holdersOf = (needle: string) =>
  files.filter(f => codeOf(f).includes(needle)).map(rel).sort();

describe('限次刀用词的单一出处', () => {
  it('取证面本身站得住：src 下非证人的源码文件确有数百个', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it('「本回合已用尽」只有一份常量；另两处的身份各自写清', () => {
    expect(TURN_LIMIT_EXHAUSTED_TEXT).toBe('本回合已用尽');
    expect(LIMIT_EXHAUSTED_TEXT).toBe('本局已用尽');
    // ①skillQuota＝常量本体（置灰文案与拒绝理由都从这儿取）；
    // ②Excel 批注与③"自己写效果"那块的说明确实要把这句念给玩家听＝引用性文字，不是第二份判据。
    expect(holdersOf('本回合已用尽')).toEqual([
      'components/skillEditor/SkillTextPanel.tsx',
      'skills/skillExcelFormat.ts',
      'skills/skillQuota.ts',
    ]);
    // 旧那句同形态：常量在 skillQuota，skillTags 里那句是「限定技」徽章的说明文字。
    expect(holdersOf('本局已用尽')).toEqual(['domain/skillTags.ts', 'skills/skillQuota.ts']);
  });

  it('卡面那句的拼法只有 turnLimitHead 一个出处，全库零处手抄拼好的整串', () => {
    // 写死的「每回合限＋数字＋次」一律不许出现在代码里（数字必须是插值出来的）。
    expect(files.filter(f => /每回合限\s*[0-9１-９]\s*次/.test(codeOf(f))).map(rel).sort()).toEqual([]);
    expect(holdersOf('每回合限${turnLimit}次')).toEqual(['skills/skillSentence.ts']);
    // 拼法现取：非法值一律不给句子，界面与 Excel 都问同一支。
    expect(turnLimitHead(3)).toBe('每回合限3次');
    expect(turnLimitHead(0)).toBe('');
    expect(turnLimitHead(undefined)).toBe('');
  });

  it('那一格的列名只有一份：界面那一格读的是同一个常量（不是抄一遍字）', () => {
    expect(TURN_LIMIT_HEADER).toBe('每回合限几次');
    expect(holdersOf("'每回合限几次'")).toEqual(['skills/skillExcelFormat.ts']);
    // 界面 label 与 aria-label 都取自 TURN_LIMIT_HEADER ⇒ 玩家从 Excel 抄到界面上是同一个词。
    const editor = codeOf(files.find(f => rel(f).endsWith('TurnLimitEditor.tsx'))!);
    expect(editor).toContain('aria-label={TURN_LIMIT_HEADER}');
    expect(editor).not.toContain('每回合限几次');
    expect(TURN_LIMIT_HINT).toContain('每回合限几次');
    expect(TURN_LIMIT_HINT).toContain('本回合已用尽');
  });

  it('合法判据只有一份：别处不许重算「整数且大于 0」', () => {
    const reImplemented = files
      .filter(f => /turnLimit/i.test(codeOf(f)) && /Number\.isInteger/.test(codeOf(f)))
      .map(rel).sort();
    expect(reImplemented).toEqual(['data/generals.ts']);
    expect(isValidTurnLimit(2)).toBe(true);
    expect(isValidTurnLimit(0)).toBe(false);
    expect(isValidTurnLimit(-3)).toBe(false);
    expect(isValidTurnLimit(1.5)).toBe(false);
    expect(isValidTurnLimit('2')).toBe(false);
  });

  it('写出侧只有一种写法、读入侧认多种（只进不出）', () => {
    for (const n of [1, 2, 3, 7, 10]) {
      const cell = turnLimitToStr(n);
      expect(/^[0-9]+$/.test(cell), String(n)).toBe(true);
      // 写出去的那一串必须原样读得回来
      expect(readTurnLimitCell(cell).limit, cell).toBe(n);
    }
    expect(turnLimitToStr(undefined)).toBe('无');
    expect(turnLimitToStr(0)).toBe('无');
    // 读入侧多认的写法：汉字数词、带「次」/「回」的（那一格逐字就叫「每回合限几次」）
    for (const [text, n] of [['一', 1], ['两', 2], ['三', 3], ['一次', 1], ['三次', 3], ['3次', 3], ['无', undefined]] as const) {
      const read = readTurnLimitCell(text);
      expect(read.limit, text).toBe(n);
      expect(read.unknown, text).toBeUndefined();
    }
    // 读不出＝整串退回点名，系统既不猜数也不兜底成 1
    for (const bad of ['若干', '一或二', '0', '-1', '很多']) {
      const read = readTurnLimitCell(bad);
      expect(read.limit, bad).toBeUndefined();
      expect(read.unknown, bad).toBe(bad);
    }
  });
});
