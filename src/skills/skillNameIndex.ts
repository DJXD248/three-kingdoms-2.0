/**
 * 技能名 → 技能定义的唯一解析点（2.9.3 刀A＝「获得技能」那条原语的解析点）。
 *
 * 为什么只准有一处：`GAIN_SKILL` 的录入面写的是一个**名字**（用户原文就这么写：
 * 「获得技能「怒斩」」）。如果编译时查一遍、发动时再查一遍、回放时又查一遍，三份
 * 答案一旦分叉，就会出现"编辑报告显示能拿到、对局里拿到的是另一枚"——那正是本项目
 * 反复登记的静默失真族（§12-55／§12-67）。所以本文件只回答一个问题，**问它的只有
 * 两个地方、而且问的是同一个函数**：编译器（把解析出来的那一枚嵌进定义，桥接层与
 * 结算侧读的都是它＝`SkillEffectData.gainedSkill`）与 Excel 导入面（只为了把"这一格
 * 填了也白填"在报告里说给人听，`skillExcelFormat.parseEffectGroup` 的 `gainIssues`）。
 * 闸③复算（2026-10-08）立的那条口径照旧生效：**不许有第二套"像不像"的判断**，
 * 只许有第二个**问者**；发动侧与回放侧仍然一个字都不查。
 *
 * **2.9.7 起，解析点只有一个来源＝技能表**（`data/skillTable.ts`）。用户那句
 * 「获得技能只能在技能表中获取」今天才是字面成立的：过去这里还直接读将领名册，
 * 于是卡上一枚"只有名字、没有内容"的技能也能被查出来、被"获得"一个空的。
 * 现在表上没有的名字＝`GAIN_SKILL_UNKNOWN_NAME`，点名、不静默。
 * 表本身怎么长出来（卡上有真内容的投影＋表上自建的）写在 `data/skillTable.ts` 文件头，
 * **判据不在本文件里重复一遍**——本文件只管按名字问一次。
 * DIY 卡（`store/gameStore.ts` 的 `authoredGenerals`＋卡面编辑）上的自创新技能名
 * 仍然不在表上⇒同样走 `GAIN_SKILL_UNKNOWN_NAME`。这一格是刻意留的口子：
 * 把 DIY 接进表要同时解决"编辑过的卡算哪一份内容"与"缓存何时失效"，另立一刀，
 * 不与本刀掺着登记（同一条纪律也写在 `GAIN_SKILL_NAME_HINT` 的批注里）。
 *
 * 判据按**名字**，不看将名、不看势力：这是用户 2026-10-08 裁的那条口径的另一半
 * （「官方目前不存在不同效果但重名的技能」）——真出现两个同名又不同内容的，那是一条
 * 需要人裁决的数据缺陷，所以引擎**不猜**，点名跳过（`GAIN_SKILL_AMBIGUOUS_NAME`）。
 * 如实账：**这一支今天在生产数据上走不到**——表上每个名字只有一份定义，这条由
 * `skills/skillNameIndex.test.ts` 的普查钉现场量着（重名 7 枚全部是"同一枚印在两张卡上"），
 * 所以唯一能抵达歧义返回值的只有那两条测试缝（换一份将领名册、或直接换一张表）。
 * 它仍然必须留在这里：第一个把两枚不同技能起成同一个名字的人一出现，它就在，不用返工。
 *
 * 惰性构建一次、之后复用：表是模块级常量 `allGenerals` 的纯派生（零 RNG、零状态），
 * 常驻／建局／回放三条路读到的是同一份，所以它不进 EngineState、也不进录像。
 */
import type { SkillTableRow } from '../data/skillTable';
import { projectSkillTable } from '../data/skillTable';
import { allGenerals } from '../data/generals';
import type { General, Skill } from '../data/generals';

export type SkillNameLookup =
  /** 表上有且只有一种写法 ⇒ 编译器把这枚 `skill` 原样嵌进定义，发动时落进将卡。 */
  | { status: 'found'; skill: Skill; owners: string[] }
  /** 这个名字压根不在表上（拼错、DIY 自创、或那枚技能还只是卡上的一个空壳）。 */
  | { status: 'unknown' }
  /** 同名两份以上、内容不同 ⇒ 谁也不知道要哪一枚（见文件头那条裁决口径）。 */
  | { status: 'ambiguous'; owners: string[] };

let index: Map<string, SkillTableRow[]> | null = null;
/** 投影的进料：生产路径永远是 `allGenerals`，只有测试缝能换一份。 */
let roster: readonly General[] = allGenerals;
let table: SkillTableRow[] | null = null;

function buildTable(): SkillTableRow[] {
  if (!table) table = projectSkillTable(roster);
  return table;
}

function buildIndex(): Map<string, SkillTableRow[]> {
  const map = new Map<string, SkillTableRow[]>();
  for (const row of buildTable()) {
    const name = String(row.skill?.name ?? '').trim();
    if (!name) continue;
    const bucket = map.get(name);
    if (!bucket) map.set(name, [row]);
    else bucket.push(row);
  }
  return map;
}

/** 表上出现过的所有技能名＝技能表的那些名字（录入面的下拉／候选用它，顺序＝表顺序）。 */
export function knownSkillNames(): string[] {
  if (!index) index = buildIndex();
  return [...index.keys()];
}

export function lookupSkillByName(rawName: string): SkillNameLookup {
  const name = String(rawName ?? '').trim();
  if (!name) return { status: 'unknown' };
  if (!index) index = buildIndex();
  const bucket = index.get(name);
  if (!bucket || bucket.length === 0) return { status: 'unknown' };
  const owners = bucket.flatMap((row) => row.owners);
  // 同名两行＝同一名字写着两份不同内容（表把同名同内容已经并成一行了）。
  if (bucket.length > 1) return { status: 'ambiguous', owners };
  return { status: 'found', skill: bucket[0].skill, owners };
}

/** 测试缝：让用例换一份将领名册⇒技能表重投影（模块级缓存的唯一失效入口之一）。 */
export function __resetSkillNameIndexForTests(): void {
  index = null;
  roster = allGenerals;
  table = null;
}

/** 测试缝：临时换一份将领名册⇒技能表跟着重投影（用来证明空壳不进表、真内容进表）。 */
export function __setSkillNameRosterForTests(generals: readonly General[]): void {
  roster = generals;
  index = null;
  table = null;
}

/** 测试缝：临时换一份技能表本身（同名不同内容那一支唯一能抵达的入口）。 */
export function __setSkillNameTableForTests(rows: readonly SkillTableRow[]): void {
  table = [...rows];
  index = null;
}
