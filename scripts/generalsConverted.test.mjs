/**
 * 「读法㈁＝318 将真进名册」的守卫测试（用户 2026-10-31 裁「先走读法㈁」）。
 * 验收不复造判据：直接 import 生成器自己导出的那几份读表函数，从仓库根那张
 * 转换后_三国卡牌.xlsx 现算一遍，与已提交的 src/data/generalsConverted.ts 逐字对账。
 * 手改成品、或改了表却忘跑 `npm run roster-from-xlsx`，这里先红。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFromSource, groupGenerals, readOfficialPairs, readSheetRows, renderFile } from './make-converted-generals.mjs';
import { allGenerals } from '../src/data/generals.ts';
import { SHEET_GENERALS } from '../src/data/generalsConverted.ts';
import { hasSettleableContent } from '../src/data/skillTable.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'src', 'data', 'generalsConverted.ts');
const ROSTER = path.join(ROOT, 'src', 'data', 'generals.ts');

describe('读法㈁ 的守卫：转换表那一批真进名册', () => {
  it('成品逐字＝从表重跑一遍（手改成品或改表没重跑⇒红）', () => {
    const { withIds, totalGenerals, skippedCount } = buildFromSource();
    expect(fs.readFileSync(OUTPUT, 'utf8')).toBe(renderFile(withIds, totalGenerals, skippedCount));
  });

  it('318＝跳过 79＋收下 239，而且收下的每一张在名册原文里都查不到（同名同势力＝一张都不许重）', () => {
    const { withIds, totalGenerals, skippedCount } = buildFromSource();
    const official = new Set(readOfficialPairs(fs.readFileSync(ROSTER, 'utf8')));
    expect(totalGenerals).toBe(318);
    expect(skippedCount).toBe(79);
    expect(withIds.map((g) => g.key).sort()).toEqual(groupGenerals(readSheetRows())
      .filter((g) => !official.has(g.key)).map((g) => g.key).sort());
    for (const g of withIds) expect(official.has(g.key), `${g.name}（${g.faction}）名册里已经有了`).toBe(false);
  });

  it('名册整体没有同名同势力两张；这 239 张排在末尾、前 96 张的位置一个字没动', () => {
    const pairs = allGenerals.map((g) => `${g.name}|${g.faction}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const ids = allGenerals.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allGenerals).toHaveLength(335);
    expect(SHEET_GENERALS).toHaveLength(239);
    expect(ids.slice(0, 96)).toEqual(allGenerals.slice(0, 96).filter((g) => !g.id.startsWith('sheet_')).map((g) => g.id));
    expect(ids.slice(96).sort()).toEqual(SHEET_GENERALS.map((g) => g.id).sort());
    for (const g of SHEET_GENERALS) expect(g.id.startsWith('sheet_'), g.id).toBe(true);
  });

  it('带进来的每一枚只有卡面文字：没有载荷、没有强制发动、没有每回合限几次', () => {
    const skills = SHEET_GENERALS.flatMap((g) => g.skills ?? []);
    expect(skills).toHaveLength(472);
    expect(skills.filter((s) => hasSettleableContent(s))).toEqual([]);
    for (const s of skills) {
      expect(s.forced, `「${s.name}」悄悄挂上了强制发动`).toBeFalsy();
      expect(s.turnLimit, `「${s.name}」悄悄挂上了每回合限几次`).toBeUndefined();
      expect(s.trigger, `「${s.name}」悄悄挂上了触发时机`).toBeUndefined();
      expect(s.conditions, `「${s.name}」悄悄挂上了门槛`).toBeUndefined();
    }
  });

  /**
   * 词汇表「觉醒技」那一格现在写着"挂这枚徽章的 3 条里只有单骑会真响"——这条就是它的证人。
   * 徽章是从表里照搬的（第 7 列），但搬不进**内容**：编译器对没有载荷的那 472 枚一律记诚实跳过。
   */
  it('徽章照搬、内容不带：全名册挂「觉醒技」的 3 条里只有魏关羽「单骑」带真内容', () => {
    const worn = (tag) => allGenerals
      .flatMap((g) => (g.skills ?? [])
        .filter((s) => (s.tags ?? []).includes(tag))
        .map((s) => `${g.name}（${g.faction}）:${s.name}:${hasSettleableContent(s) ? '会响' : '只印了个名字'}`))
      .sort();
    expect(worn('觉醒技')).toEqual(['关羽（魏）:单骑:会响', '毋丘俭（魏）:鸿举:只印了个名字', '诸葛诞（魏）:举义:只印了个名字'].sort());
    for (const tag of ['锁定技', '限定技', '觉醒技']) {
      expect(SHEET_GENERALS.flatMap((g) => (g.skills ?? []).filter((s) => (s.tags ?? []).includes(tag) && hasSettleableContent(s))), `${tag} 混进了真内容`).toEqual([]);
    }
  });
});