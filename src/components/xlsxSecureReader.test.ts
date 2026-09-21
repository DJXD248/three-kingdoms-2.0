import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 回归说明：SkillEditor 的 Excel 导入路径只依赖 XLSX.read + sheet_to_json(header:1)
// 两个只读 API。本测试读取真实 .xlsx 夹具文件（exceljs 生成的 3 行技能表，含中文
// 与空洞单元格），在 jsdom（与生产打包相同的 browser 构建解析）下用升级后的
// SheetJS CDN 构建（>=0.19.3，修复 GHSA-4r6h 原型污染 / GHSA-5pgg ReDoS）解析，
// 证明安全升级后导入路径行为不变。

// vitest 以项目根为 cwd 运行，直接拼接相对路径（import.meta.url 在 Vite 转换后非 file: URL）
const fixturePath = join(process.cwd(), 'src', 'components', '__fixtures__', 'skills-sample.xlsx');

function readFixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath));
}

function parseFixtureSheets(): XLSX.WorkBook {
  return XLSX.read(readFixtureBytes(), { type: 'array' });
}

describe('xlsx CDN build parses a real .xlsx fixture (SkillEditor import path)', () => {
  it('reads workbook and exposes sheet names', () => {
    const wb = parseFixtureSheets();
    expect(wb.SheetNames).toContain('skills');
  });

  it('sheet_to_json header:1 returns primitive cell values row by row', () => {
    const wb = parseFixtureSheets();
    const sheet = wb.Sheets['skills'];
    expect(sheet).toBeTruthy();
    const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet!, { header: 1 });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]).toEqual(['name', 'desc', 'power']);
    expect(rows[1]).toEqual(['狂风', '第一回合额外抽牌', 2]);
    // 空洞单元格（B3）在 header:1 下为 undefined/空洞，其余列保持原值
    expect(rows[2]?.[0]).toBe('刘备');
    expect(rows[2]?.[2]).toBe(1);
  });

  it('runs on a fixed CDN version, not the vulnerable npm build', () => {
    // 0.18.5 为 npm 注册表终版（含高危漏洞）；CDN 修复版自 0.19.3 起
    expect(XLSX.version).not.toBe('0.18.5');
    const [major, minor] = XLSX.version.split('.').map(Number);
    expect(major > 0 || minor >= 19).toBe(true);
  });
});
