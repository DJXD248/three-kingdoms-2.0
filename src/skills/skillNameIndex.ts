/**
 * 技能名 → 技能定义的唯一名册（2.9.3 刀A＝「获得技能」那条原语的解析点）。
 *
 * 为什么只准有一处：`GAIN_SKILL` 的录入面写的是一个**名字**（用户原文就这么写：
 * 「获得技能「怒斩」」）。如果编译时查一遍、发动时再查一遍、回放时又查一遍，三份
 * 答案一旦分叉，就会出现"编辑报告显示能拿到、对局里拿到的是另一枚"——那正是本项目
 * 反复登记的静默失真族（§12-55／§12-67）。所以本文件只回答一个问题，**问它的只有
 * 两个地方、而且问的是同一个函数**：编译器（把解析出来的那一枚嵌进定义，桥接层与
 * 结算侧读的都是它＝`SkillEffectData.gainedSkill`）与 Excel 导入面（只为了把"这一格
 * 填了也白填"在报告里说给人听，`skillExcelFormat.parseEffectGroup` 的 `gainIssues`）。
 * ⚠️ 闸③复算（2026-10-08）点名我原话写的是"**只有**编译器问它"——那句是字面假话
 * （导入面也问），已按实测改写成上面这一句。判据因此收窄一格、更硬：**不许有第二套
 * "像不像"的判断**，只许有第二个**问者**；发动侧与回放侧仍然一个字都不查。
 *
 * 名册的来源＝**官方将领卡上印着的技能**（`data/generals.ts` 的 `allGenerals`）。
 * DIY 卡（`store/gameStore.ts` 的 `authoredGenerals`＋卡面编辑）上的自创新技能名
 * 目前**查不到**⇒走 `GAIN_SKILL_UNKNOWN_NAME`，点名、不静默。这一格是刻意留的口子：
 * 把 DIY 接进名册要同时解决"编辑过的卡算哪一份内容"与"缓存何时失效"，另立一刀，
 * 不与本刀掺着登记（同一条纪律也写在 `GAIN_SKILL_NAME_HINT` 的批注里）。
 *
 * 判据按**名字**，不看将名、不看势力：这是用户 2026-10-08 裁的那条口径的另一半
 * （「官方目前不存在不同效果但重名的技能」）——真出现两个同名又不同内容的，那是一条
 * 需要人裁决的数据缺陷，所以引擎**不猜**，点名跳过（`GAIN_SKILL_AMBIGUOUS_NAME`）。
 * 如实账（闸③复算点名）：**这一支今天在生产数据上走不到**——"官方名册里没有同名
 * 不同内容"本身有普查钉（`skillNameIndex.test.ts` 第一例，直接量真名册），所以唯一
 * 能抵达歧义返回值的只有测试缝 `__setSkillNameRosterForTests`。它仍然必须留在这里：
 * 第一个把两枚不同技能起成同一个名字的人一出现，它就在，不用返工（同 §12-110 那条
 * "写了判据但没有证人"与"路修好但今天没车"要分开登记）。
 *
 * 惰性构建一次、之后复用：名册是模块级常量 `allGenerals` 的纯派生（零 RNG、零状态），
 * 常驻／重建／回放四条路读到的是同一份，所以它不进 EngineState、也不进录像。
 */
import type { General, Skill } from '../data/generals';
import { allGenerals } from '../data/generals';

export type SkillNameLookup =
  /** 名册里有且只有一种写法 ⇒ 编译器把这枚 `skill` 原样嵌进定义，发动时落进将卡。 */
  | { status: 'found'; skill: Skill; owners: string[] }
  /** 这个名字压根不在名册上（拼错、或那枚技能还没进池）。 */
  | { status: 'unknown' }
  /** 同名两份以上、内容不同 ⇒ 谁也不知道要哪一枚（见文件头那条裁决口径）。 */
  | { status: 'ambiguous'; owners: string[] };

/** 键序无关的稳定序列化：只用来判"这两枚是不是同一个定义"，绝不参与别的判断。 */
function canonicalSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSignature).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map(k => `${k}:${canonicalSignature(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

interface IndexEntry {
  skill: Skill;
  ownerLabel: string;
  signature: string;
}

let index: Map<string, IndexEntry[]> | null = null;
let roster: readonly General[] = allGenerals as General[];

function buildIndex(): Map<string, IndexEntry[]> {
  const map = new Map<string, IndexEntry[]>();
  for (const general of roster) {
    for (const skill of general.skills ?? []) {
      const name = String(skill?.name ?? '').trim();
      if (!name) continue;
      const bucket = map.get(name);
      const entry: IndexEntry = {
        skill,
        ownerLabel: `${general.name}（${general.faction}）`,
        signature: canonicalSignature(skill),
      };
      if (!bucket) map.set(name, [entry]);
      else bucket.push(entry);
    }
  }
  return map;
}

/** 名册里出现过的所有技能名（录入面的下拉／提示用，顺序＝首次出现顺序）。 */
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
  const owners = bucket.map(entry => entry.ownerLabel);
  const distinct = new Set(bucket.map(entry => entry.signature));
  if (distinct.size > 1) return { status: 'ambiguous', owners };
  // 同名同内容＝同一枚技能印在两张卡上：取第一份（顺序＝名册录入顺序，四路一致）。
  return { status: 'found', skill: bucket[0].skill, owners };
}

/** 测试缝：让用例读一份"改了的名册"（模块级缓存的唯一失效入口），并把名册来源
 *  一并交回默认值——只有测试能改，生产路径永远读 `data/generals.ts` 的那一份。 */
export function __resetSkillNameIndexForTests(): void {
  index = null;
  roster = allGenerals as General[];
}

/** 测试缝：临时换一份名册（用来证明"同名不同内容"这一支真的不猜）。 */
export function __setSkillNameRosterForTests(generals: readonly General[]): void {
  roster = generals;
  index = null;
}
