// 词汇表.xlsx 的守卫：md 是唯一事实源，Excel 是它的投影。
// 这三条钉分别咬三种事故：内容漏行/串列、生成字节每次都在变（仓库里塞新二进制 diff）、
// 改了 md 却忘了重跑 `npm run glossary-xlsx`（提交进来的 Excel 已经过期）。
// 读回一律用 SheetJS（写用 exceljs）＝跨库往返，不给自己当裁判。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { SHEETS, parse, renderXlsx } from './make-glossary-xlsx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'PLAYER_GLOSSARY.md');
const OUTPUT = path.join(ROOT, '词汇表.xlsx');

const MARKDOWN_RESIDUE = [/~~/, /\*\*/, /`/, /^\|?\s*:?-{3,}/, /<br\s*\/?>/i];

function sheetOf(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`工作表缺失：${name}`);
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(cell === undefined ? '' : String(cell.v ?? ''));
    }
    rows.push(row);
  }
  return rows;
}

describe('词汇表.xlsx 生成器', () => {
  const md = fs.readFileSync(SOURCE, 'utf8');
  const blocks = parse(md).blocks;

  it('八个章节都有对应工作表，且表名合规', () => {
    expect(blocks.map((b) => b.key)).toEqual(Object.keys(SHEETS));
    for (const name of Object.values(SHEETS)) {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[:\\/?*[\]]/);
    }
  });

  it('md 里每一行都逐格落进 Excel，表尾附注不丢，且没有 markdown 残留', async () => {
    const workbook = XLSX.read(await renderXlsx(md), { type: 'buffer' });
    for (const block of blocks) {
      const rows = sheetOf(workbook, SHEETS[block.key]);
      const table = rows.slice(0, block.rows.length);
      expect(table.length, SHEETS[block.key]).toBe(block.rows.length);
      for (let i = 0; i < block.rows.length; i += 1) {
        const expected = block.rows[i];
        const actual = table[i].slice(0, expected.length);
        expect(actual, `${SHEETS[block.key]} 第 ${i + 1} 行`).toEqual(expected);
      }
      // 表尾附注（如 §四 那段"徽章不是开关"）逐段落在表格之后
      const tail = rows
        .slice(block.rows.length)
        .map((r) => r[0])
        .filter((v) => v !== '');
      expect(tail, SHEETS[block.key]).toEqual(block.notes);

      for (const row of rows) {
        for (const cell of row) {
          for (const pattern of MARKDOWN_RESIDUE) {
            expect(cell, `残留 ${pattern}`).not.toMatch(pattern);
          }
        }
      }
    }
  });

  it('<br> 写成 Excel 换行：一格三行、不劈表、不留尖括号残留', async () => {
    const probe = [
      '# 探针',
      '',
      '## 一、棋盘与数字',
      '',
      '| 术语 | 大白话翻译 | 你的理解 |',
      '|---|---|---|',
      '| 将领池 | 候着的将领。 | 甲<br>乙<br>丙 |',
      '',
    ].join('\n');
    expect(parse(probe).blocks[0].rows[1][2]).toBe('甲\n乙\n丙');
    const rows = sheetOf(XLSX.read(await renderXlsx(probe), { type: 'buffer' }), SHEETS.一);
    expect(rows[1][2]).toBe('甲\n乙\n丙');
    expect(rows.length).toBe(2);
  });

  it('同一份 md 两次生成的字节完全相同（zip 时间戳必须钉死）', async () => {
    const first = await renderXlsx(md);
    const second = await renderXlsx(md);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it('提交进仓库的 词汇表.xlsx 就是当前 md 的投影（改 md 必须重跑命令）', async () => {
    const expected = await renderXlsx(md);
    const actual = fs.readFileSync(OUTPUT);
    expect(actual.length).toBe(expected.length);
    expect(Buffer.compare(actual, expected)).toBe(0);
  });
});
