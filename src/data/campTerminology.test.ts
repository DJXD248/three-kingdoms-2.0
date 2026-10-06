/**
 * "营地"叫法统一证人（用户 2026-10-06 裁决：本营 ↔ 营地，改回"营地"这个叫法）。
 *
 * 三条判据：
 * ① 那三枚营地相关触发时机的中文标签（＝编辑器/Excel 选项字符串的唯一来源）都写"营地"；
 * ② 全仓 src 下"本营"零残留（扫描含注释与玩家可见文案，防止改名漏一处）；
 * ③ 规则页写明营地没有体力上限。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { triggerTypeLabels } from './generals';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('营地叫法统一', () => {
  it('三枚营地触发时机标签都写"营地"', () => {
    expect(triggerTypeLabels.onBaseTargetedAtk).toBe('营地成为攻击目标时');
    expect(triggerTypeLabels.onBaseTargetedSkill).toBe('营地成为技能目标时');
    expect(triggerTypeLabels.onBaseDamaged).toBe('营地受到伤害时');
  });

  it('src 下再无"本营"二字（含注释与界面文案）', () => {
    // 合法残留只有两处：Excel 读入侧那三枚旧格（`skillExcelFormat.ts`）与钉住它的证人。
    // 界面、写出侧、日志、规则页——一处都不许有。
    const self = path.basename(fileURLToPath(import.meta.url));
    const allowed = ['skillExcelFormat.ts', 'skillExcelFormat.test.ts'].sort();
    const files = walk(srcRoot).filter(file => path.basename(file) !== self);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter(file => readFileSync(file, 'utf8').includes('本营'))
      .map(file => path.basename(file))
      .sort();
    expect(offenders).toEqual(allowed);
  });

  it('旧词只剩读入侧那一处：别名表里恰好三枚营地系旧格', () => {
    const file = path.join(srcRoot, 'skills', 'skillExcelFormat.ts');
    const occurrences = (readFileSync(file, 'utf8').match(/本营/g) ?? []).length;
    // 3 个别名键 + 1 句注释，多一处就是有人把旧词又写出去了。
    expect(occurrences).toBe(4);
  });

  it('规则页写明营地没有体力上限、允许超过 6 点', () => {
    const rules = readFileSync(path.join(srcRoot, 'components', 'Rules.tsx'), 'utf8');
    expect(rules).toContain('没有体力上限');
    expect(rules).toContain('营地初始 6 点体力');
  });
});
