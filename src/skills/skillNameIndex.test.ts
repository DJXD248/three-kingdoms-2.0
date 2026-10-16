/**
 * 「获得技能」那一档的唯一解析点＝技能表（2.9.3 刀A 立起来的解析点，
 * 2.9.7 刀把它的**来源收成一张表**）。
 *
 * 这里钉的是四件事：
 * ① 解析点只认技能表这一个来源（用户原话「获得技能只能在技能表中获取」）；
 * ② 表上**只做有真内容的**（用户 2026-10-16 那句「技能表只做有真内容的」）——
 *    卡上那枚技能有没有结构化载荷是唯一门槛，只有名字的空壳一律不进表、
 *    填进「获得技能」会被点名 `GAIN_SKILL_UNKNOWN_NAME`；
 * ③ 表上那一枚**就是卡上那一个对象**（投影，不是抄第二份）⇒ 不存在两处定义分叉；
 * ④ 用户 2026-10-08 那条裁决口径（「官方目前不存在不同效果但重名的技能」）今天是
 *    **实测**成立的，把它钉住——以后真出现冲突，这条证人先变红，
 *    而不是某个玩家的"获得技能"悄悄拿到了另一枚。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  knownSkillNames,
  lookupSkillByName,
  __resetSkillNameIndexForTests,
  __setSkillNameRosterForTests,
  __setSkillNameTableForTests,
} from './skillNameIndex';
import { allGenerals, type General, type Skill } from '../data/generals';
import {
  SKILL_TABLE_OWNER_LABEL,
  authoredSkillTableEntries,
  hasSettleableContent,
  projectSkillTable,
  skillTable,
} from '../data/skillTable';
import { compileGeneralSkills } from './skillCompiler';

/** 与投影同一算法的独立序列化：证人要能自己算一遍，不复用被测实现的话术。 */
function sig(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sig).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${k}:${sig(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** 直接在**卡面**上量一遍（不走解析点），用来跟表上的读数对账。 */
function cardCensus() {
  const names = new Map<string, string[]>();
  for (const g of allGenerals) {
    for (const s of g.skills ?? []) {
      const name = String(s?.name ?? '').trim();
      if (!name) continue;
      names.set(name, [...(names.get(name) ?? []), sig(s)]);
    }
  }
  const contentNames = [...names.keys()].filter(name => {
    const printed = allGenerals.flatMap(g => g.skills ?? []).find(s => s.name === name)!;
    return hasSettleableContent(printed);
  });
  const duplicated = [...names.entries()].filter(([, sigs]) => sigs.length > 1);
  return {
    totalNames: names.size,
    contentNames,
    shellNames: [...names.keys()].filter(n => !contentNames.includes(n)),
    duplicatedNames: duplicated.map(([name]) => name).sort(),
    conflictingNames: duplicated.filter(([, sigs]) => new Set(sigs).size > 1).map(([name]) => name),
  };
}

const G = (name: string, skills: Skill[]): General =>
  ({ id: `t_${name}`, name, faction: '群', hp: 4, type: '武将', meleeAtk: 2, rangedAtk: 1, armor: 0, skills });

describe('skillNameIndex · 技能表是唯一来源（2.9.7 刀）', () => {
  afterEach(() => __resetSkillNameIndexForTests());

  /**
   * 生产数据普查。这一条是「技能表只做有真内容的」那句话的落点：
   * 三个数（卡面不同名 163／有真内容 40／空壳 123）全部**现场量**，表上的行数＝40＋自建那 1 枚。
   */
  it('普查：卡上 163 个名字里有真内容的 40 枚全进表，123 个空壳一个都没进', () => {
    const census = cardCensus();
    expect(census.totalNames).toBe(163);
    expect(census.contentNames).toHaveLength(40);
    expect(census.shellNames).toHaveLength(123);
    // 表＝有真内容的（同名同内容并成一行）＋表上自建的那一枚。
    expect(skillTable).toHaveLength(41);
    expect(skillTable.map(row => row.skill.name)).toEqual([...census.contentNames, '怒斩']);
    // 空壳一个都不在表上；表上没有一行是空壳。
    for (const name of census.shellNames) expect(skillTable.some(r => r.skill.name === name)).toBe(false);
    expect(skillTable.filter(r => !hasSettleableContent(r.skill))).toEqual([]);
  });

  it('录入面的候选名字清单＝表上那 41 个（不再把 123 个空壳摆在下拉里骗人）', () => {
    const names = knownSkillNames();
    expect(names).toHaveLength(41);
    expect(names).toContain('奸雄');
    expect(names.filter(n => n === '屯田')).toHaveLength(1);
    expect(names).toContain('怒斩');
    // 空壳代表三枚现场挑的：卡上印着、但没有结构化载荷。
    for (const shell of ['观星', '空城', '马术']) {
      expect(names).not.toContain(shell);
      expect(lookupSkillByName(shell).status).toBe('unknown');
    }
  });

  it('卡上有真内容＝表上那一行交出来的**就是卡上那一个对象**（投影，不是第二份定义）', () => {
    const printed = allGenerals.flatMap(g => g.skills ?? []).find(s => s.name === '屯田')!;
    const found = lookupSkillByName('屯田');
    expect(found.status).toBe('found');
    if (found.status !== 'found') return;
    expect(found.skill).toBe(printed);
    // 同名同内容印在两员将卡上＝同一枚，owners 两个都留（归属那一格不丢信息）。
    expect(found.owners).toEqual(['邓艾（魏）', '邓艾（晋）']);
    expect(lookupSkillByName('屯田').status).toBe('found');
  });

  it('官方名册里没有"同名但内容不同"的两枚——用户那条裁决今天是实测成立的', () => {
    const census = cardCensus();
    expect(census.conflictingNames).toEqual([]);
    // 实测（2026-10-16 现场量的）：163 个名字、7 个重名，全部是同一枚技能印在两张卡上。
    expect(census.duplicatedNames).toEqual(['凿险', '屯田', '巧变', '权计', '武圣', '自立', '马术']);
    // 重名的这两枚（有真内容的那两支）走"并成一行"这条路，而不是被当成歧义拦下。
    for (const name of ['屯田', '武圣']) {
      expect(lookupSkillByName(name).status).toBe('found');
      expect(skillTable.filter(r => r.skill.name === name)).toHaveLength(1);
    }
  });

  it('认名字不认将名：拼错、带空格、空串、将名都算查不到（绝不"最像的那一个"）', () => {
    expect(lookupSkillByName('奸雄')).toMatchObject({ status: 'found' });
    expect(lookupSkillByName('奸雄 ')).toMatchObject({ status: 'found' });
    expect(lookupSkillByName('全名')).toMatchObject({ status: 'unknown' });
    expect(lookupSkillByName('曹操')).toMatchObject({ status: 'unknown' });
    expect(lookupSkillByName('')).toMatchObject({ status: 'unknown' });
    expect(lookupSkillByName('   ')).toMatchObject({ status: 'unknown' });
  });

  it('同名不同内容 ⇒ 不裁决、只报歧义（把名单交回上层点名）', () => {
    __setSkillNameRosterForTests([
      G('甲', [{ name: '观澜', effects: [{ id: 'e1', runtime: { type: 'REVEAL', value: 2 } }] }]),
      G('乙', [{ name: '观澜', effects: [{ id: 'e1', runtime: { type: 'REVEAL', value: 3 } }] }]),
      G('丙', [{ name: '观澜', description: '一段话' }]),
    ]);
    const found = lookupSkillByName('观澜');
    expect(found.status).toBe('ambiguous');
    if (found.status === 'ambiguous') expect(found.owners).toEqual(['甲（群）', '乙（群）']);
    // 丙那张只有描述、没有载荷⇒压根没进表，歧义名单里不该有它（门槛只放行有真内容的）。
  });
});

/**
 * 表上自建那一类：不印在任何将卡上的技能（觉醒白送的「怒斩」）。
 * 2.9.4 那批下来时这张表**只有**这一类，所以当年的文件叫「独立技能表」；
 * 2.9.7 起卡上有真内容的那 40 枚也在同一张表上了，自建这一类仍然照旧查得到。
 */
describe('skillNameIndex · 表上自建的那一枚（怒斩）', () => {
  afterEach(() => __resetSkillNameIndexForTests());

  it('卡上没有、表上有＝查得到，归属那一格写的是表名（不是某员将）', () => {
    const found = lookupSkillByName('怒斩');
    expect(found.status).toBe('found');
    if (found.status !== 'found') return;
    expect(found.owners).toEqual([SKILL_TABLE_OWNER_LABEL]);
    expect(found.skill.effects?.[0].runtime?.stat).toBe('DAMAGE_DEALT');
    expect(knownSkillNames()).toContain('怒斩');
    expect(authoredSkillTableEntries.map(s => s.name)).toEqual(['怒斩']);
  });

  it('自建清单换一枚＝表跟着换（这一支唯一能抵达歧义／缺席的入口）', () => {
    __setSkillNameTableForTests([
      { skill: { name: '新技', effects: [{ id: 'e1', runtime: { type: 'REVEAL', value: 1 } }] }, owners: ['技能表'] },
      { skill: { name: '新技', effects: [{ id: 'e1', runtime: { type: 'REVEAL', value: 2 } }] }, owners: ['技能表'] },
    ]);
    expect(knownSkillNames()).toEqual(['新技']);
    const found = lookupSkillByName('新技');
    expect(found.status).toBe('ambiguous');
  });

  /**
   * 生产数据普查。表上自建的只有「怒斩」一枚；它与魏关羽卡上「单骑」白送的那一枚
   * 必须是**同一个对象**：获得技能时按名字查表拿到的就是编译落进去的那份。
   * （要不要动两锚＝跑出来才算，不靠这里预告，§12-121③。）
   */
  it('普查：表上自建那一行长什么形状，且与编译嵌进「单骑」的是同一个对象', () => {
    __resetSkillNameIndexForTests();
    const found = lookupSkillByName('怒斩');
    expect(found.status).toBe('found');
    if (found.status !== 'found') return;
    expect((found.skill.effects ?? []).map(e => e.runtime?.occasion)).toEqual(['duel', 'meleeVsArmored']);
    const compiled = compileGeneralSkills(allGenerals.find(g => g.id === 'wei_022')!)
      .definitions.find(d => d.id === 'wei_022:单骑:chain')!;
    const granted = compiled.effects.find(e => e.type === 'GAIN_SKILL')?.gainedSkill;
    expect(granted).toBe(found.skill);
  });

  it('投影本身：换一份假名册，只有带载荷的那枚进表（判据只有一处＝hasSettleableContent）', () => {
    const rows = projectSkillTable([
      G('甲', [
        { name: '有货', effects: [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] },
        { name: '空壳', description: '只有一段话' },
      ]),
    ], []);
    expect(rows.map(r => r.skill.name)).toEqual(['有货']);
    expect(rows[0].owners).toEqual(['甲（群）']);
  });

  /** "进表"不是我把这批名字抄进一张名单，而是**当场投影**的结果：同一份假名册，
   *  只把那枚空壳挂上一段可结算内容，它下一趟就自己进表——界面与 Excel 那句
   *  "卡上那枚技能哪天挂上内容，它自动进表、这一条就跟着生效"因此有据可依。 */
  it('挂上内容⇒自动进表（投影不是死名单）：同一份名册，只改那一枚的载荷', () => {
    const shell: Skill = { name: '空壳', description: '只有一段话' };
    const roster: General[] = [G('甲', [
      { name: '有货', effects: [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] },
      shell,
    ])];

    __setSkillNameRosterForTests(roster);
    expect(lookupSkillByName('空壳').status).toBe('unknown');
    expect(knownSkillNames()).not.toContain('空壳');

    // 只动这一枚的载荷，别的一个字不改：它自己就进表了（表上没有第二份名单要人维护）。
    shell.effects = [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' } }];
    __setSkillNameRosterForTests(roster);
    expect(knownSkillNames()).toContain('空壳');
    const found = lookupSkillByName('空壳');
    expect(found.status).toBe('found');
    if (found.status === 'found') expect(found.skill).toBe(shell);
  });
});
