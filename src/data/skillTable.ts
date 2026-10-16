/**
 * 技能表＝「获得技能」这一档唯一认的名单（2.9.7 刀；前身是 2.9.4 的「独立技能表」＝
 * `data/standaloneSkills.ts`，那一版这张表只收养"不印在任何将卡上"的技能）。
 *
 * 用户原始需求两句（2026-10-08 傍晚）：「帮我把官方卡的所有技能拉取出来，放入技能表中」
 * ＋「获得技能只能在技能表中获取」；2026-10-16 的开工令把范围钉死成
 * 「**技能表只做有真内容的**」⇒ 只有名字、没有可结算 payload 的那些不进表。
 *
 * **表怎么长出来**（这一条是这一刀的形状，不是随手实现）：
 * ①**卡上有真内容的**＝从将领名册当场投影出来，表里放的是**同一个定义对象**（不是抄第二份）。
 *   ⇒ 不存在"表里一个样、卡上另一个样"这种分叉，也不会有人改完卡忘了改表：
 *   卡上那枚技能哪天挂上真内容，它自动进表；编译器按名字拿到的就是卡上那一份。
 * ②**表上自建的**＝不印在任何将卡上的那一类（觉醒白送的「怒斩」）。这一份只能手写在这里。
 *
 * 表里**不需要的东西**同样是判据：只挂名的空壳（现场量＝123 枚）不在表上，
 * 「获得技能」填了它们⇒编译器点名 `GAIN_SKILL_UNKNOWN_NAME`，不再"获得一个空的"。
 * 这一格变化玩家看得见：编辑器那个名字格子的候选从 163 个名字缩到表上这 41 个。
 *
 * 投影只在模块加载时算一次：名册是模块级常量（零 RNG、零状态），常驻／建局／回放
 * 三条路读到同一份表⇒这张表不进 EngineState、也不进录像。
 */
import type { General, Skill } from './generals';
import { allGenerals } from './generals';

/** 这张表上"自建那一类"的归属标签（歧义报告里"这一枚是谁家的"那一格）。 */
export const SKILL_TABLE_OWNER_LABEL = '技能表';

/**
 * 「有真内容」的唯一判据：至少一条效果带着可结算的结构化载荷（`runtime`）。
 * 只有描述、只有徽章、只有名字的都算空壳。⚠️ 这一句**同时**是进表的门槛与
 * 普查钉量的那把尺——两处用两套写法＝漂移的开端。
 */
export function hasSettleableContent(skill: Skill | undefined): boolean {
  const effects = skill?.effects ?? [];
  return effects.some((effect) => Boolean(effect?.runtime));
}

/** 键序无关的稳定序列化：只用来判"这两枚是不是同一个定义"，绝不参与别的判断。 */
function canonicalSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSignature).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${k}:${canonicalSignature(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 表上的一行＝一枚技能＋它印在谁身上（归属标签可以有好几个：同名同内容印在两员将卡上）。 */
export interface SkillTableRow {
  skill: Skill;
  owners: string[];
}

/**
 * 怒斩＝觉醒技「单骑」达成时白送的那一枚，描述原文逐字出自用户
 * （2026-10-08 01:42 那句的括号部分：「你进行决斗计算或近战攻击有护甲的角色时伤害+1」；
 * 整条需求已入 HANDOFF §12-117①）。它不印在任何将卡上⇒只能住在表上。
 *
 * 那一句里的「或」拆成**两条独立的账**，各带一个生效场合（`occasion`），由
 * `core/damageDealt.ts` 那一格读数点当场对表（入算次序＝攻击力→造成伤害→受到伤害→
 * 护甲抵扣→扣血，这一把 +1 落在**进护甲之前**＝用户 2026-10-14 裁的第 4 条）：
 *  · `duel`＝进行决斗计算时 +1，且**每一轮各算一次**（同轮裁的第 1 条）；
 *  · `meleeVsArmored`＝近战攻击有护甲的角色时 +1（"有护甲"＝护甲 ≥1 就算，同轮裁的第 3 条）。
 *
 * **封顶 +1、永不叠加**：这不是推的，是用户本人撤回的（原话「不对，我重新看了一下，
 * 怒斩是近战攻击有护甲的角色时伤害+1，决斗不算近战攻击，所以不存在+2」⇒ §12-117⑮），
 * 而引擎侧确实结构上到不了 +2：`duelDealtContext` 硬写 `meleeAttack:false`，
 * 决斗里那一击压根不带"近战"这个属性⇒两条腿在同一格里不可能同时成立。
 * 挂在同一枚「在场即生效」上＝用户 2026-10-14 单独裁过的那一格（「允许」），
 * 所以这里是**一个技能、两条效果**。
 *
 * 这两格是空的、不是漏了：`passive` 那一型的账只随"人在不在场"变，所以
 * `duration` 一填就被编译器点名跳过（`PASSIVE_DURATION_CONFLICT`）、门槛同理
 * （`PASSIVE_CONDITION_UNSUPPORTED`）；场合（`occasion`）也不是门槛，是账自己带着的标签。
 */
const SK_NUZHAN: Skill = {
  name: '怒斩',
  description: '你进行决斗计算或近战攻击有护甲的角色时伤害+1',
  trigger: { type: 'passive' },
  effects: [
    {
      id: 'e1',
      trigger: { type: 'passive' },
      runtime: { type: 'MODIFY_STAT', stat: 'DAMAGE_DEALT', modifyMode: 'delta', value: 1, target: 'SELF', occasion: 'duel' },
    },
    {
      id: 'e2',
      trigger: { type: 'passive' },
      runtime: { type: 'MODIFY_STAT', stat: 'DAMAGE_DEALT', modifyMode: 'delta', value: 1, target: 'SELF', occasion: 'meleeVsArmored' },
    },
  ],
};

/** 表上自建的那几枚（不印在任何将卡上、只能住在表里的）。顺序＝录入顺序。 */
export const authoredSkillTableEntries: readonly Skill[] = [SK_NUZHAN];

/**
 * 把「将领名册＋表上自建」投影成一张技能表。同名且**内容逐字节一样**＝同一枚，并成一行
 * （归属标签两个都留）；同名而内容不同⇒两行都进表，查名那一头照样报歧义、**绝不合并**。
 * 顺序＝名册首次出现顺序，自建那几枚排最后（四路读到同一份⇒确定性）。
 */
export function projectSkillTable(
  roster: readonly General[],
  authored: readonly Skill[] = authoredSkillTableEntries,
): SkillTableRow[] {
  const rows: SkillTableRow[] = [];
  const seen = new Map<string, SkillTableRow>();
  const add = (skill: Skill, owner: string) => {
    if (!hasSettleableContent(skill)) return;
    const name = String(skill?.name ?? '').trim();
    if (!name) return;
    const key = `${name}\u0000${canonicalSignature(skill)}`;
    const existing = seen.get(key);
    if (existing) {
      if (!existing.owners.includes(owner)) existing.owners.push(owner);
      return;
    }
    const row: SkillTableRow = { skill, owners: [owner] };
    seen.set(key, row);
    rows.push(row);
  };
  for (const general of roster) {
    for (const skill of general.skills ?? []) add(skill, `${general.name}（${general.faction}）`);
  }
  for (const skill of authored) add(skill, SKILL_TABLE_OWNER_LABEL);
  return rows;
}

/** 生产数据那一张表（＝名册 `allGenerals` 的纯派生＋表上自建那几枚）。 */
export const skillTable: readonly SkillTableRow[] = projectSkillTable(allGenerals);
