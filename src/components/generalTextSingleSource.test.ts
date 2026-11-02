/**
 * v2.9.24 刀2「一句话生成将领」的**单一出处**钉子（判据的判据＝§12-110 那一族）。
 *
 * 为什么这一刀也要钉：它把玩家看得见、又能填回引擎的几样东西放到了一起——
 * 「体力」那个缺省数、五个字段的名目、势力那五档、以及"采用之后到底走哪条建卡路"。
 * 只要有一处开始手抄，下一位改的人只会改一处，于是**界面说的**与**真发生的**分叉。
 *
 * 六条（每条右边的名单＝本轮 `node` 现场量的，不是设想出来的）：
 *  ① 缺省体力那一枚数只有一处声明，其余全是 `import`；
 *  ② 兜底这一**步动作**只有 `hpOrDefault` 一个函数，源码里一张就地重算的 `hp ?? 4` 都不许留
 *     （刀2 开工前的原状正是三处内联＝§12-140⑨㈡ 点名的那件事）；
 *  ③ 建卡仍然只有那一条路：`createAuthoredGeneral` 只被 store 调，界面一律经 `addAuthoredGeneral`；
 *  ④ 这一刀是**读入侧**：反解那份文件不 import 结算／建卡／store，势力五档也只 `import` 不重述
 *     ——这条是"两锚逐字节不动"的结构性前提，钉在代码上才算数；
 *  ⑤ 「能不能采用」这一道门槛只认将名与势力两格，**没有掺进解析器自己造的额外判据**
 *     （钉的是文件集＋"body 里不许出现 `issues`／别的字段"，不钉实现体逐字＝他日后改门槛的实现
 *      不会被这条绊住，只有"悄悄多一条判据"才红）。
 *  ⑥ 「没落进这张卡／收下了但还粘着」那两族话只有一份拼装（`unsettledSegments`），
 *     采用那**两条腿**都调它——句式在别处再抄一遍＝下次改一处、漏一处，两腿又会漂开
 *     （刀2a-v3 第⑥件裁的就是这条）。
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

/**
 * 取一枚顶层函数的**函数体**（只为了做"body 里不许出现某串"这种**负向**断言——
 * 正向逐字钉实现体是另一种东西，这里不钉）。
 * 难点是 TS 的类型谓词签名：`: draft is X & { a: string } {` 里那个 `{` 是**签名的一部分**，
 * 不是函数体。判据＝配平后紧跟**换行**的那一枚才算函数体（类型壳后面紧跟的是空格＋`{`）。
 */
function bodyOf(file: string, fnName: string): string {
  const code = codeOf(path.join(srcRoot, file));
  const at = code.search(new RegExp(`function ${fnName}\\s*\\(`));
  if (at < 0) throw new Error(`${file} 里没有 function ${fnName}`);
  // 先按小括号配平找到参数表收尾，函数体一定在它之后
  let paren = code.indexOf('(', at);
  let pdepth = 0;
  for (; paren < code.length; paren++) {
    if (code[paren] === '(') pdepth++;
    else if (code[paren] === ')') { pdepth--; if (pdepth === 0) break; }
  }
  for (let i = paren + 1; i < code.length; i++) {
    if (code[i] !== '{') continue;
    let depth = 0;
    let close = -1;
    for (let j = i; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') {
        depth--;
        if (depth === 0) { close = j; break; }
      }
    }
    if (close < 0) throw new Error(`${file} 的 ${fnName} 花括号没配平`);
    if (code[close + 1] === '\n') return code.slice(i + 1, close);
  }
  throw new Error(`${file} 的 ${fnName} 找不到函数体`);
}

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

  it('⑤ 采用门槛只认将名与势力：没有一处把解析器自己造的额外判据（`issues`／别的字段）掺进来', () => {
    // 钉文件集＝新增一个文件想自己判"能不能采用"，这条立刻红
    // 两枚判据的持有者**名单不同**（本轮现场量的）：`SkillEditor.tsx` 只调门槛那枚，
    // 「缺了哪几格」那枚只给面板显示用——照实钉两张名单，不并成一张假装对称。
    expect(holdersOf('canAdoptGeneral')).toEqual([
      'components/SkillEditor.tsx',
      'components/skillEditor/GeneralTextPanel.tsx',
      'components/skillEditor/generalTextParse.ts',
    ]);
    expect(holdersOf('missingRequiredFields')).toEqual([
      'components/skillEditor/GeneralTextPanel.tsx',
      'components/skillEditor/generalTextParse.ts',
    ]);
    // 门槛只此两枚，不许长出第二枚同名判据
    const parseFile = 'components/skillEditor/generalTextParse.ts';
    expect(countIn(parseFile, 'export function canAdoptGeneral')).toBe(1);
    expect(countIn(parseFile, 'export function missingRequiredFields')).toBe(1);
    // 负向断言：body 里不许出现"点名的材料"或别的手填字段。
    // 这**不是**逐字钉实现体——他日后改门槛的写法（换判据顺序、加注释）不会绊红，
    // 只有"悄悄多一条玩家没写过的判据"（比如把 ✕ 那几段变成不通过）才红。
    for (const fn of ['canAdoptGeneral', 'missingRequiredFields']) {
      const body = bodyOf(parseFile, fn);
      expect(body, `${fn} 的函数体里不许掺 issues`).not.toContain('issues');
      for (const otherField of ['hp', 'meleeAtk', 'rangedAtk', 'skillNames', 'ignored', 'identity', 'provenance']) {
        expect(body, `${fn} 的函数体里不许判 ${otherField}`).not.toContain(`draft.${otherField}`);
      }
    }
    expect(bodyOf(parseFile, 'missingRequiredFields')).toContain('draft.name');
    expect(bodyOf(parseFile, 'missingRequiredFields')).toContain('draft.faction');
    // 正面证人：上面那串负向断言只有"切到的确实是函数体"才算数。
    // 类型谓词签名 `: draft is X & { name: string }` 里那个 `{` 会被误当成体首，
    // 切错了 body 里既没有 `issues` 也没有别的字段＝负向断言全绿却是空跑。这两条堵死它。
    const gateBody = bodyOf(parseFile, 'canAdoptGeneral');
    expect(gateBody).toContain('missingRequiredFields(draft)');
    expect(gateBody).not.toContain('name: string');
    // 全仓（非证人）没有任何一处把"点名的段数"当成条件——掺判据最常见的写法就是这个形状
    expect(holdersOf('issues.length')).toEqual([]);
    // 界面上那枚钮只认门槛这一枚，没在原地补一条自己的判据
    expect(countIn('components/skillEditor/GeneralTextPanel.tsx', 'canAdoptGeneral(draft)')).toBe(1);
  });

  it('⑥ 那两族话只有一份拼装，两条采用腿都调它（刀2a-v3 第⑥件：两腿下次不许再漂开）', () => {
    const parseFile = 'components/skillEditor/generalTextParse.ts';
    expect(holdersOf('unsettledSegments')).toEqual([
      'components/SkillEditor.tsx',
      parseFile,
    ]);
    expect(countIn(parseFile, 'export function unsettledSegments')).toBe(1);
    // 采用那两条腿（新建那张卡／第①步填那几格）各调一次 ＋ import 一次＝3
    expect(countIn('components/SkillEditor.tsx', 'unsettledSegments')).toBe(3);
    // 句式本身在非证人源码里只许长在拼装那一处：别处照抄一遍＝下次改一处、漏一处
    expect(holdersOf('没落进去的：')).toEqual([parseFile]);
    expect(holdersOf('这几格收下了、里面还粘着没认的东西：')).toEqual([parseFile]);
    // 第 16 件那句新话与那枚"出处"痕迹也一样只许长在一处（监督台 §17③）。
    // needle **逐字取整句**：只写"没认成技能名"这种短句，日后改措辞会误红。
    expect(holdersOf('那一格写的我没认成技能名，一个都没落（逐条点名见下面）')).toEqual([parseFile]);
    expect(holdersOf('fromSkillList')).toEqual([parseFile]);
    // 拼装只报事实，不许顺手判"能不能采用"（硬闸那一格还没裁，这条钉住它别偷偷长进去）
    const body = bodyOf(parseFile, 'unsettledSegments');
    expect(body).not.toContain('canAdoptGeneral');
    expect(body).not.toContain('issues.length');
    // 正面：切到的确实是那枚函数的体（空跑的负向断言不配当证人）
    expect(body).toContain('draft.issues');
  });
});
