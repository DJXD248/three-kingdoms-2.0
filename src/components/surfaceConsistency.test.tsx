/**
 * v2.3.4（P5 产品表面一致性）回归钉：
 * ① 主菜单页脚版本号必须来自构建期 pkg.version，硬编码旧版本串（"Qoder V1.28"）不得回归；
 * ② 移动模式横幅/高亮的回合切换清残留护栏须在位；
 * ③ 检视面板五个操作按钮（前进/近战/远程/补给/叠甲）必须携带禁用原因 title 提示。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import pkg from '../../package.json';
import MainMenu from './MainMenu';

// vitest 以项目根为 cwd 运行（与 xlsxSecureReader.test.ts 同法）
const readSrc = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('v2.3.4 P5 表面一致性', () => {
  afterEach(cleanup);

  it('主菜单页脚渲染构建期版本号 Qoder V{pkg.version}，与 package.json 同源', () => {
    render(<MainMenu />);
    expect(screen.getByText(`Qoder V${pkg.version}`)).toBeTruthy();
  });

  it('MainMenu 源码不再含任何硬编码 Vx.y 版本串（永不再漂）', () => {
    const menu = readSrc('src', 'components', 'MainMenu.tsx');
    expect(menu).not.toMatch(/V\d+\.\d+/);
    expect(menu).toContain('pkg.version');
  });

  it('GameBoard 检视面板五个操作按钮均带禁用原因 title', () => {
    const gb = readSrc('src', 'components', 'GameBoard.tsx');
    const lines = gb.split('\n');
    for (const label of ['🚶前进', '⚔️近战(-1牌)', '🏹远程(-1牌)', '💊补给', '🛡️叠甲']) {
      const line = lines.find(l => l.includes('button') && l.includes(label));
      expect(line, `缺少 ${label} 按钮行`).toBeTruthy();
      expect(line!, `${label} 按钮缺 title 禁用原因`).toContain('title=');
    }
  });

  it('移动模式残留护栏在位：回合键（round:cpi）变化即清移动选择', () => {
    const gb = readSrc('src', 'components', 'GameBoard.tsx');
    expect(gb).toMatch(/const turnKey=`\$\{round\}:\$\{cpi\}`;/);
    expect(gb).toMatch(/setAdjTurnKey\(turnKey\);\s*\n\s*setMovGen\(null\);setMovTgt\(null\);setMoveOptions\(\[\]\);/);
  });
});
