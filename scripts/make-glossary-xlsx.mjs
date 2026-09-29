// 把仓库根的 PLAYER_GLOSSARY.md 生成玩家可直接填写的 Excel：词汇表.xlsx
// 单一事实源＝那份 md；改完 md 重跑 `npm run glossary-xlsx` 即可，绝不手抄。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'PLAYER_GLOSSARY.md');
const OUTPUT = path.join(ROOT, '词汇表.xlsx');

// zip 条目的时间戳必须是固定值：exceljs 底层 jszip 每个条目都写 `new Date()`，
// 同一份 md 每次重跑都会得到一串不同的字节 ⇒ 仓库里每次都是一条新的二进制 diff。
const EPOCH = new Date(Date.UTC(2026, 8, 29));

// 章节号 → 工作表名（Excel 表名不能有 : \\ / ? * [ ]，且限 31 字）
export const SHEETS = {
  一: '一 棋盘与数字',
  二: '二 行动按钮与提示',
  三: '三 抽卡与开局',
  四: '四 技能相关词',
  五: '五 结算录像日志',
  六: '六 图鉴设置开发者',
  七: '七 界面里没有的词',
  八: '八 措辞与规则冲突',
};

const TITLE_LINE = /^##\s*([一二三四五六七八九十])、/;

function clean(cell) {
  return cell
    .replace(/~~([\s\S]*?)~~/g, '$1（旧说法，已作废）')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

function splitRow(line) {
  return line.split('|').slice(1, -1).map(clean);
}

export function parse(md) {
  const blocks = [];
  let cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const head = raw.match(TITLE_LINE);
    if (head) {
      cur = { key: head[1], rows: [], notes: [] };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.trim().startsWith('|')) {
      const cells = splitRow(raw);
      const isSeparator = cells.every((c) => /^[-:\s]*$/.test(c));
      if (!isSeparator && cells.length > 0) cur.rows.push(cells);
      continue;
    }
    const prose = clean(raw);
    if (prose && cur) cur.notes.push(prose);
  }
  const preamble = md
    .slice(0, md.indexOf('\n## 一、'))
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('# ') && !/^[-\s]*$/.test(l.trim()))
    .map((l) => l.trim().replace(/^-\s*/, '· '))
    .map((l) => l.replace(/\*\*([\s\S]*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1'));
  const docTitle = (md.match(/^#\s*(.+)$/m) || [, '玩家词汇 · 大白话对照表'])[1].trim();
  return { blocks, preamble, docTitle };
}

function styleHeader(row) {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF8EA9DB' } } };
  });
}

async function zipDeterministic(wb) {
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  for (const entry of Object.values(zip.files)) entry.date = EPOCH;
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function buildWorkbook(mdText) {
  const { blocks, preamble, docTitle } = parse(mdText);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'THREE_KINGDOMS 2.0';
  wb.created = EPOCH;
  wb.modified = EPOCH;

  const intro = wb.addWorksheet('说明');
  intro.getColumn(1).width = 118;
  intro.addRow([docTitle]);
  intro.getRow(1).font = { bold: true, size: 14 };
  intro.addRow(['']);
  for (const line of preamble) intro.addRow([line]);
  intro.addRow(['']);
  intro.addRow(['工作表一览：']);
  for (const b of blocks) {
    intro.addRow([`${SHEETS[b.key]}：${b.rows.length - 1} 条`]);
  }
  intro.getColumn(1).eachCell((c) => {
    c.alignment = { wrapText: true, vertical: 'top' };
  });

  const widths = {
    一: [18, 88, 34],
    二: [26, 80, 34],
    三: [30, 76, 34],
    四: [34, 72, 34],
    五: [30, 76, 34],
    六: [30, 76, 34],
    七: [26, 84, 34],
    八: [5, 16, 50, 50, 30],
  };

  for (const b of blocks) {
    if (!b.rows.length) continue;
    const ws = wb.addWorksheet(SHEETS[b.key]);
    const header = b.rows[0];
    const headRow = ws.addRow(header);
    styleHeader(headRow);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    (widths[b.key] ?? header.map(() => 30)).forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    for (const cells of b.rows.slice(1)) {
      while (cells.length < header.length) cells.push('');
      const row = ws.addRow(cells);
      row.alignment = { wrapText: true, vertical: 'top' };
    }
    if (b.notes.length) {
      ws.addRow([]);
      for (const note of b.notes) {
        const row = ws.addRow([note]);
        row.alignment = { wrapText: true, vertical: 'top' };
        row.font = { italic: true, color: { argb: 'FF7F7F7F' } };
        ws.mergeCells(row.number, 1, row.number, header.length);
      }
    }
  }

  return wb;
}

export async function renderXlsx(mdText) {
  return zipDeterministic(buildWorkbook(mdText));
}

export function sheetCounts(mdText) {
  return parse(mdText).blocks.map((b) => `${SHEETS[b.key]}=${b.rows.length - 1}`);
}

async function main() {
  const md = fs.readFileSync(SOURCE, 'utf8');
  fs.writeFileSync(OUTPUT, await renderXlsx(md));
  console.log(`写入 ${path.basename(OUTPUT)}：${sheetCounts(md).join(' ')}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
