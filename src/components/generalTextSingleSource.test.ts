/**
 * v2.9.24 刀2「一句话生成将领」的**单一出处**钉子（判据的判据＝§12-110 那一族）。
 *
 * 为什么这一刀也要钉：它把玩家看得见、又能填回引擎的几样东西放到了一起——
 * 「体力」那个缺省数、五个字段的名目、势力那五档、以及"采用之后到底走哪条建卡路"。
 * 只要有一处开始手抄，下一位改的人只会改一处，于是**界面说的**与**真发生的**分叉。
 *
 * 四条（每条右边的名单＝本轮 `node` 现场量的，不是设想出来的）：
 *  ① 缺省体力那一枚数只有一处声明，其余全是 `import`；
 *  ② 兜底这一**步动作**只有 `hpOrDefault` 一个函数，源码里一张就地重算的 `hp ?? 4` 都不许留
 *     （刀2 开工前的原状正是三处内联＝§12-140⑨㈡ 点名的那件事）；
 *  ③ 建卡仍然只有那一条路：`createAuthoredGeneral` 只被 store 调，界面一律经 `addAuthoredGeneral`；
 *  ④ 这一刀是**读入侧**：反解那份文件不 import 结算／建卡／store，势力五档也只 `import` 不重述
 *     ——这条是"两锚逐字节不动"的结构性前提，钉在代码上才算数。
 *
 * 扫描口径与 `src/skills/turnLimitSingleSource.test.ts` 同一套：**注释里的提及不算第二处出处**，
 * 先剥注释再点名；证人文件（`*.test.tsx?`）不参与扫描。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const holdersOf = (needle: string) => files.filter(f => codeOf(f).includes(needle)).map(rel).sort();
const countIn = (file: string, needle: string) => codeOf(path.join(srcRoot, file)).split(needle).length - 1;

describe('一句话生成将领这一刀的单一出处', () => {
  it('取证面本身站得住：src 下非证人的源码文件确有数百个', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it('① 缺省体力那一枚数只有一处声明；界面上那四次出现各有身份', () => {
    expect(holdersOf('DEFAULT_HP_WHEN_MISSING')).toEqual([
      'components/SkillEditor.tsx',
      'domain/generalProvenance.ts',
    ]);
    expect(countIn('domain/generalProvenance.ts', 'export const DEFAULT_HP_WHEN_MISSING')).toBe(1);
    // SkillEditor 里四次＝import 一次 ＋ 三句给玩家看的话（批量新建报表／单张待处理新建／一句话生成采用）
    expect(countIn('components/SkillEditor.tsx', 'DEFAULT_HP_WHEN_MISSING')).toBe(4);
  });

  it('② 兜底这一步只有 `hpOrDefault` 一个函数；就地重算的 `?? 4` 一张都不留', () => {
    expect(holdersOf('hpOrDefault')).toEqual([
      'components/SkillEditor.tsx',
      'components/skillEditor/generalTextParse.ts',
      'domain/generalProvenance.ts',
    ]);
    expect(countIn('domain/generalProvenance.ts', 'export function hpOrDefault')).toBe(1);
    expect(holdersOf('?? 4')).toEqual([]);
  });

  it('③ 建卡只有那一条路：界面不许自己发号，`createAuthoredGeneral` 只被 store 调', () => {
    expect(holdersOf('createAuthoredGeneral')).toEqual([
      'ai/fixtures/diyGeneralFixture.ts',        // AI 考卷那份 DIY 样本（自己也要走同一条路）
      'domain/generalProvenance.ts',             // 声明处
      'store/gameStoreEditorActions.ts',         // 唯一调用处
    ]);
    expect(holdersOf('addAuthoredGeneral')).toEqual([
      'components/SkillEditor.tsx',              // 「创建」那颗钮与「一句话生成」采用那一腿，共用同一次调用
      'store/gameStoreEditorActions.ts',
      'store/gameStoreTypes.ts',
    ]);
  });

  it('④ 反解那份文件是纯读入侧：不碰结算、不碰建卡、不碰 store，势力五档也不重述', () => {
    const code = codeOf(path.join(srcRoot, 'components/skillEditor/generalTextParse.ts'));
    const imports = [...code.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    expect(imports).toEqual([
      '../../skills/skillGateText',      // 只借那一把数词尺 `parseCountNumber`
      '../../data/generals',             // 只借 `Faction` 这个类型
      '../../domain/generalProvenance',  // 只借缺省体力那一份判据
      './skillExcelParsers',             // 只借势力那五档 `IMPORT_FACTIONS`
    ]);
    for (const bad of ['core', 'store', 'engine', 'compile']) {
      expect(imports.some(spec => spec.includes(bad)), `不该 import ${bad}`).toBe(false);
    }
    expect(countIn('components/skillEditor/skillExcelParsers.ts', 'export const IMPORT_FACTIONS')).toBe(1);
    expect(holdersOf('IMPORT_FACTIONS')).toEqual([
      'components/SkillEditor.tsx',
      'components/skillEditor/generalTextParse.ts',
      'components/skillEditor/skillExcelParsers.ts',
    ]);
    // 这里绝不出现第二份五档清单（界面别处那几份是筛选下拉，不是判据）
    expect(code.includes("'魏'")).toBe(false);
  });
});
