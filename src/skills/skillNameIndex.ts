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
 *
 * **2.9.18 补上刻意留着的那一格口子**（原话记在 HANDOFF §12-134）：DIY 卡与卡面编辑
 * 从此也是册子的进料。进料怎么接＝`setSkillBookRosterSource`，生产那一路接的是这台机器
 * 真在用的那份将领（`store/gameStore.ts` 末尾那一行）；AI 对战与 CLI 那条路**不接**，
 * 进料仍是仓库名册——这一句是两池对局读数钉得住的前提，不是顺手省的。
 * "算不算官方"仍然没有第二套判据：来源读的是记录自己身上那枚建卡时钉死的 `source`
 * （`domain/generalProvenance.ts` 的 `sourceOf`），用户 2026-10-21 给的口径
 * （「开发者模式下新增和改动的就是官方卡」）之所以能直接落到这枚字段上，是因为
 * `G-`／`D-` 这个 namespace 与 `source` 本身就是 `addAuthoredGeneral` 在开发者模式下
 * 才钉得进去的——同一件事的两个读数，不是两份规则。
 *
 * 判据按**名字**，不看将名、不看势力：这是用户 2026-10-08 裁的那条口径的另一半
 * （「官方目前不存在不同效果但重名的技能」）——真出现两个同名又不同内容的，那是一条
 * 需要人裁决的数据缺陷，所以引擎**不猜**，点名跳过（`GAIN_SKILL_AMBIGUOUS_NAME`）。
 * 如实账：**这一支在生产数据上走不到**（表上每个名字只有一份定义，重名 7 枚全部是
 * "同一枚印在两张卡上"，由 `skillNameIndex.test.ts` 的普查钉现场量着），接进 DIY
 * 进料之后仍然走不到——自制卡要撞出一个同名不同内容，得玩家自己起出那个名字。
 * 它仍然必须留在这里：第一个撞车的人一出现，它就在，不用返工。
 */
import type { SkillTableOwner, SkillTableRow } from '../data/skillTable';
import { projectSkillTable } from '../data/skillTable';
import { allGenerals, type General, type GeneralSource, type Skill } from '../data/generals';

export type SkillNameLookup =
  /** 表上有且只有一种写法 ⇒ 编译器把这枚 `skill` 原样嵌进定义，发动时落进将卡。 */
  | { status: 'found'; skill: Skill; owners: SkillTableOwner[] }
  /** 这个名字压根不在表上（拼错、或那枚技能还只是卡上的一个空壳）。 */
  | { status: 'unknown' }
  /** 同名两份以上、内容不同 ⇒ 谁也不知道要哪一枚（见文件头那条裁决口径）。 */
  | { status: 'ambiguous'; owners: SkillTableOwner[] };

/** 册子里一个名字的候选形状＝名字＋它此刻是谁家的内容（同一枚既印在官方卡又印在自制卡上时两个都列）。 */
export interface SkillBookCandidate {
  name: string;
  origins: GeneralSource[];
}

/** 生产进料：默认＝仓库名册（CLI／AI 对战那条路就停在这里）。 */
let rosterSource: () => readonly General[] = () => allGenerals;
/** 测试缝装进来的那份进料（与生产接线分开：`__reset…` 撤销它，绝不动生产那一路）。 */
let rosterOverride: (() => readonly General[]) | null = null;
/** 测试缝直接换一张表本身（同名不同内容那一支唯一能抵达的入口）。 */
let tableOverride: SkillTableRow[] | null = null;
/** 手动重算那一档存下来的那一份快照。 */
let snapshot: SkillTableRow[] | null = null;
/** 用户 2026-10-21：「现在就按每次重算来做」。关掉它的开关也留在这里，等他哪天说要手动。 */
let autoRecompute = true;

function currentRoster(): readonly General[] {
  return (rosterOverride ?? rosterSource)();
}

/** 唯一的算表处：谁问都走这里。门槛（有真内容才进表）写在 `data/skillTable.ts`，这里不重复。 */
function rows(): SkillTableRow[] {
  if (tableOverride) return tableOverride;
  if (autoRecompute) return projectSkillTable(currentRoster());
  if (!snapshot) snapshot = projectSkillTable(currentRoster());
  return snapshot;
}

function buildIndex(): Map<string, SkillTableRow[]> {
  const map = new Map<string, SkillTableRow[]>();
  for (const row of rows()) {
    const name = String(row.skill?.name ?? '').trim();
    if (!name) continue;
    const bucket = map.get(name);
    if (!bucket) map.set(name, [row]);
    else bucket.push(row);
  }
  return map;
}

/**
 * 录入面那张册子：表上出现过的名字，顺序＝表顺序，每个名字带着它今天的来源。
 * 候选清单与 `knownSkillNames()` 从同一个函数派生⇒界面绝不会出现一份名单之外的名字。
 */
export function skillBookCandidates(): SkillBookCandidate[] {
  const out: SkillBookCandidate[] = [];
  const byName = new Map<string, SkillBookCandidate>();
  for (const row of rows()) {
    const name = String(row.skill?.name ?? '').trim();
    if (!name) continue;
    let candidate = byName.get(name);
    if (!candidate) {
      candidate = { name, origins: [] };
      byName.set(name, candidate);
      out.push(candidate);
    }
    for (const owner of row.owners) {
      if (!candidate.origins.includes(owner.origin)) candidate.origins.push(owner.origin);
    }
  }
  return out;
}

/** 册子上的所有名字＝编辑器那个格子允许填的那些（下拉／候选用它）。 */
export function knownSkillNames(): string[] {
  return skillBookCandidates().map(candidate => candidate.name);
}

export function lookupSkillByName(rawName: string): SkillNameLookup {
  const name = String(rawName ?? '').trim();
  if (!name) return { status: 'unknown' };
  const bucket = buildIndex().get(name);
  if (!bucket || bucket.length === 0) return { status: 'unknown' };
  const owners = bucket.flatMap((row) => row.owners);
  // 同名两行＝同一名字写着两份不同内容（表把同名同内容已经并成一行了）。
  if (bucket.length > 1) return { status: 'ambiguous', owners };
  return { status: 'found', skill: bucket[0].skill, owners };
}

/**
 * 接上进料：把"这台机器此刻真在用的那份将领"交给册子。调用点只有一处
 * （`store/gameStore.ts` 末尾），AI 对战／CLI 那条路不调＝两池对局的进料一字没变。
 */
export function setSkillBookRosterSource(source: () => readonly General[]): void {
  rosterSource = source;
  snapshot = null;
}

/** 今天永远是 true；这一格就是用户要的那个"关闭自动重算的接口"。 */
export function isSkillBookAutoRecompute(): boolean {
  return autoRecompute;
}

export function setSkillBookAutoRecompute(on: boolean): void {
  autoRecompute = on;
  if (on) snapshot = null;
}

/**
 * 手动重算那一档的刷新入口＝界面那颗**今天还看不见**的按钮（`RuntimeEditor` 里
 * `aria-label="刷新技能册"` 那枚）背后调的函数；自动档下也能调，只是下一次问就又被重算盖掉。
 * 用户 2026-10-21：「以后到了需要启用手动重算的时候我会告诉你，你就可以直接把这一套拿出来用」。
 */
export function refreshSkillBook(): void {
  snapshot = projectSkillTable(currentRoster());
}

/** 测试缝：复位＝撤掉测试装的进料与表，生产接线（`setSkillBookRosterSource` 那一路）不动。 */
export function __resetSkillNameIndexForTests(): void {
  rosterOverride = null;
  tableOverride = null;
  snapshot = null;
  autoRecompute = true;
}

/** 测试缝：临时换一份将领名册⇒技能表跟着重投影（用来证明空壳不进表、真内容进表）。 */
export function __setSkillNameRosterForTests(generals: readonly General[]): void {
  rosterOverride = () => generals;
  snapshot = null;
}

/** 测试缝：临时换一份技能表本身（同名不同内容那一支唯一能抵达的入口）。 */
export function __setSkillNameTableForTests(rows: readonly SkillTableRow[]): void {
  tableOverride = [...rows];
}
