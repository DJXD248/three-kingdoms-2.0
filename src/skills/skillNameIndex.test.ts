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
  refreshSkillBook,
  setSkillBookAutoRecompute,
  skillBookCandidates,
  __resetSkillNameIndexForTests,
  __setSkillNameRosterForTests,
  __setSkillNameTableForTests,
} from './skillNameIndex';
import { allGenerals, type General, type Skill } from '../data/generals';
import { SHEET_GENERALS } from '../data/generalsConverted';
import {
  SKILL_TABLE_OWNER_LABEL,
  authoredSkillTableEntries,
  hasSettleableContent,
  projectSkillTable,
  skillTable,
} from '../data/skillTable';
import { compileGeneralSkills } from './skillCompiler';

/** 名册里用户自己写的那一半（v2.9.28 读法㈁ 之后 `allGenerals` 还含转换表带入的 239 张，号都在 `sheet_` 名下）。 */
const SHEET_IDS = new Set(SHEET_GENERALS.map(g => g.id));
const AUTHORED_GENERALS = allGenerals.filter(g => !SHEET_IDS.has(g.id));

/** 与投影同一算法的独立序列化：证人要能自己算一遍，不复用被测实现的话术。 */
function sig(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sig).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${k}:${sig(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** 直接在**卡面**上量一遍（不走解析点），用来跟表上的读数对账。默认量整本名册，也可以只量一半。 */
function cardCensus(pool: readonly General[] = allGenerals) {
  const names = new Map<string, string[]>();
  for (const g of pool) {
    for (const s of g.skills ?? []) {
      const name = String(s?.name ?? '').trim();
      if (!name) continue;
      names.set(name, [...(names.get(name) ?? []), sig(s)]);
    }
  }
  const contentNames = [...names.keys()].filter(name => {
    const printed = pool.flatMap(g => g.skills ?? []).find(s => s.name === name)!;
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

/** 自制那一头的假将：号在 `D-` 名下、`source` 钉成 DIY＝这台机器上玩家自己建的卡。 */
const Gdiy = (name: string, skills: Skill[]): General =>
  ({ ...G(name, skills), id: `D-${name}`, source: 'DIY' });

describe('skillNameIndex · 技能表是唯一来源（2.9.7 刀）', () => {
  afterEach(() => __resetSkillNameIndexForTests());

  /**
   * 生产数据普查。这一条是「技能表只做有真内容的」那句话的落点。
   * 2026-10-31 读法㈁（转换表 239 张卡并进名册）之后名册分两半各量一遍：
   *  · 用户自己写的那 96 张＝163 个名字／有真内容 40／空壳 123（一个数没动）；
   *  · 整本 335 张＝607 个名字／有真内容仍是 40／空壳涨到 567 ⇒ 带进来的那批一枚都不会响。
   * 表上的行数＝40＋自建那 1 枚，与名册变大无关。
   */
  it('普查：有真内容的 40 枚全进表，空壳一个都没进（读法㈁ 前后同一口径）', () => {
    const full = cardCensus();
    expect(full.totalNames).toBe(607);
    expect(full.contentNames).toHaveLength(40);
    expect(full.shellNames).toHaveLength(567);
    // 只数用户写的那 96 张：三个数与 v2.9.27 逐字相同＝这刀没碰他写的东西。
    const authored = cardCensus(AUTHORED_GENERALS);
    expect(authored.totalNames).toBe(163);
    expect(authored.contentNames).toHaveLength(40);
    expect(authored.shellNames).toHaveLength(123);
    expect(authored.contentNames).toEqual(full.contentNames);
    // 表＝有真内容的（同名同内容并成一行）＋表上自建的那一枚。
    expect(skillTable).toHaveLength(41);
    expect(skillTable.map(row => row.skill.name)).toEqual([...full.contentNames, '怒斩']);
    // 空壳一个都不在表上；表上没有一行是空壳。
    for (const name of full.shellNames) expect(skillTable.some(r => r.skill.name === name)).toBe(false);
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
    expect(found.owners.map(o => o.label)).toEqual(['邓艾（魏）', '邓艾（晋）']);
    // v2.9.18：仓库名册上每一位的来源都是官方——这一句钉的是"来源不是猜的"，
    // 它读的就是记录身上那枚建卡时钉死的 `source`（缺省＝官方，与 §H2 同一判据）。
    expect(found.owners.map(o => o.origin)).toEqual(['official', 'official']);
    expect(lookupSkillByName('屯田').status).toBe('found');
  });

  it('用户写的那 96 张里没有"同名但内容不同"的两枚；读法㈁ 带进来的新事实另钉一条', () => {
    // 用户 2026-10-08 那条裁决（「官方目前不存在不同效果但重名的技能」）在他自己写的名册上照旧成立。
    const authored = cardCensus(AUTHORED_GENERALS);
    expect(authored.conflictingNames).toEqual([]);
    // 实测（2026-10-16 现场量的）：163 个名字、7 个重名，全部是同一枚技能印在两张卡上。
    expect(authored.duplicatedNames).toEqual(['凿险', '屯田', '巧变', '权计', '武圣', '自立', '马术']);
    // 重名的这两枚（有真内容的那两支）走"并成一行"这条路，而不是被当成歧义拦下。
    for (const name of ['屯田', '武圣']) {
      expect(lookupSkillByName(name).status).toBe('found');
      expect(skillTable.filter(r => r.skill.name === name)).toHaveLength(1);
    }
  });

  /**
   * 读法㈁ 带进来的新事实（2026-10-31 现场量）：转换表那 239 张卡里，有 21 个技能名与用户写过的
   * 卡**同名而文字不同**（如「龙胆」在赵云(蜀)与赵襄(蜀)上是两回事）。这撞的是用户那条裁决的字面，
   * 所以必须当场钉清楚它到底有没有伤到引擎：
   *  · 引擎问名字只问技能表（2.9.7 起），表上只有带真内容的⇒表上 41 个名字一个不撞；
   *  · 那 472 枚带进来的技能一枚都不带真内容⇒整本名册的投影与"剔掉这批后的投影"逐字一样；
   *  · 表上仅有的两处「一行两个归属」＝屯田（邓艾魏／邓艾晋）与武圣（关羽魏／关羽蜀），
   *    两组都是用户自己名册内部同名同内容（逐字节一样才并成一行），与转换表无关。
   * 哪天用户把表里某枚同名技能填上真内容，下面第二条立刻红——那是一条要他裁决的数据缺陷，不是 bug。
   */
  it('卡面 21 组"同名不同内容"全部来自转换表，而引擎那张表一枚都不撞', () => {
    const full = cardCensus();
    expect(full.conflictingNames).toHaveLength(21);
    expect(full.duplicatedNames).toHaveLength(27);
    // 表上（引擎真正会问的那一份）名字唯一⇒没有第二套答案。
    const tableNames = skillTable.map(r => r.skill.name);
    expect(new Set(tableNames).size).toBe(tableNames.length);
    // 每一组同名不同内容里，至少一枚来自转换表（用户自己那批内部没有这种分叉）。
    for (const name of full.conflictingNames) {
      const holders = allGenerals.filter(g => (g.skills ?? []).some(s => s.name === name));
      expect(
        holders.some(g => SHEET_IDS.has(g.id)),
        `「${name}」在卡面上有两种写法，可两枚都不在转换表里⇒名册里凭空多了一组分叉`,
      ).toBe(true);
    }
  });

  it('转换表那批一枚都没进技能表：两份投影逐字一样（不止数行数）', () => {
    const k = (r: readonly General[]) => projectSkillTable(r)
      .map(x => [x.skill.name, sig(x.skill)].join('|')).sort();
    expect(k(allGenerals)).toEqual(k(AUTHORED_GENERALS));
    expect(k(allGenerals)).toHaveLength(41);
    expect(SHEET_GENERALS.flatMap(g => (g.skills ?? []).filter(s => hasSettleableContent(s)))).toEqual([]);
  });

  /**
   * 表上"一行两个归属"只有两处，且两处的每一枚都是用户自己名册里的（内容逐字节一样才并成一行）——
   * 读法㈁ 没有往这两行上添任何一个归属。这一条钉的是投影既有的合并纪律：
   * 同名且**内容一样**＝同一枚（归属都留）；同名而内容不同＝两行都进、绝不合并（实测 0 组）。
   */
  it('表上带两个归属的只有屯田与武圣，两组都出自用户名册内部同名同内容', () => {
    const multi = skillTable.filter(r => r.owners.length > 1)
      .map(r => `${r.skill.name}:${r.owners.map(o => o.label).sort().join('/')}`).sort();
    expect(multi).toEqual(['屯田:邓艾（晋）/邓艾（魏）', '武圣:关羽（蜀）/关羽（魏）']);
    // 合并的资格＝两枚内容逐字节一样；各归属的 label 必须都对得上名册里真实的那张卡。
    for (const row of skillTable.filter(r => r.owners.length > 1)) {
      const printed = AUTHORED_GENERALS
        .filter(g => row.owners.some(o => `${g.name}（${g.faction}）` === o.label))
        .map(g => (g.skills ?? []).find(s => s.name === row.skill.name))
        .filter(s => s !== undefined);
      expect(printed, `「${row.skill.name}」的归属在名册里找不到对应的卡`).toHaveLength(row.owners.length);
      expect(new Set(printed.map(s => sig(s))).size, `「${row.skill.name}」两个归属不是同一枚`).toBe(1);
      expect(sig(row.skill), `「${row.skill.name}」表上那枚与卡面那枚内容分叉了`).toBe(sig(printed[0]));
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
    if (found.status === 'ambiguous') expect(found.owners.map(o => o.label)).toEqual(['甲（群）', '乙（群）']);
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
    expect(found.owners).toEqual([{ label: SKILL_TABLE_OWNER_LABEL, origin: 'official' }]);
    expect(found.skill.effects?.[0].runtime?.stat).toBe('DAMAGE_DEALT');
    expect(knownSkillNames()).toContain('怒斩');
    expect(authoredSkillTableEntries.map(s => s.name)).toEqual(['怒斩']);
  });

  it('自建清单换一枚＝表跟着换（这一支唯一能抵达歧义／缺席的入口）', () => {
    __setSkillNameTableForTests([
      { skill: { name: '新技', effects: [{ id: 'e1', runtime: { type: 'REVEAL', value: 1 } }] }, owners: [{ label: '技能表', origin: 'official' }] },
      { skill: { name: '新技', effects: [{ id: 'e1', runtime: { type: 'REVEAL', value: 2 } }] }, owners: [{ label: '技能表', origin: 'official' }] },
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
    expect(rows[0].owners).toEqual([{ label: '甲（群）', origin: 'official' }]);
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

    // 只动这一枚的载荷，别的一个字不改、**也不重新递交名册**：v2.9.18 起册子每问一次
    // 就算一次，所以它自己就进表了（表上没有第二份名单要人维护）。
    shell.effects = [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' } }];
    expect(knownSkillNames()).toContain('空壳');
    const found = lookupSkillByName('空壳');
    expect(found.status).toBe('found');
    if (found.status === 'found') expect(found.skill).toBe(shell);
  });
});

/**
 * v2.9.18 技能册那一刀：用户 2026-10-21 两句原话各钉一件——
 * ①「区分官方和DIY的最简单方式就是看是不是开发者模式下新增和改动的，所以要定义成
 *    开发者模式下改动的就是官方卡」⇒ 册子上每一行都带着出处，出处读记录自己身上那枚
 *    `source`（不新写第二套判据）；
 * ②「现在就按每次重算来做……留一个关闭自动重算的接口和增加一个现在还看不见的刷新按钮」
 *    ⇒ 默认每问一次算一次，开关与刷新一经接上就立刻能用（下面第三条把那一路整体验一遍）。
 */
describe('skillNameIndex · 技能册的进料与重算（v2.9.18）', () => {
  afterEach(() => __resetSkillNameIndexForTests());

  const withContent = (name: string): Skill =>
    ({ name, effects: [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] });

  it('自制卡上有真内容的技能进册：查得到、出处写的是玩家自制', () => {
    __setSkillNameRosterForTests([G('官将', [withContent('官方货')]), Gdiy('自创将', [withContent('自创货')])]);
    const diy = lookupSkillByName('自创货');
    expect(diy.status).toBe('found');
    if (diy.status !== 'found') return;
    expect(diy.owners).toEqual([{ label: '自创将（群）', origin: 'DIY' }]);
    expect(skillBookCandidates().map(c => c.name)).toEqual(['官方货', '自创货', '怒斩']);
    expect(skillBookCandidates().find(c => c.name === '自创货')?.origins).toEqual(['DIY']);
  });

  it('门槛还是那一把尺：自制卡上只印了名字的空壳照样不进册（没有第二套"算不算有内容"）', () => {
    __setSkillNameRosterForTests([Gdiy('自创将', [{ name: '自创空壳', description: '只有一段话' }])]);
    expect(lookupSkillByName('自创空壳').status).toBe('unknown');
    // 册子上只剩表上自建那一枚（怒斩），自制空壳没进来。
    expect(knownSkillNames()).toEqual(['怒斩']);
  });

  it('同名不同内容横跨两头⇒照样报歧义，而且把两家的出处逐个点名（引擎绝不猜）', () => {
    __setSkillNameRosterForTests([
      G('官将', [withContent('撞名')]),
      Gdiy('自创将', [{ name: '撞名', effects: [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 5, target: 'SELF' } }] }]),
    ]);
    const found = lookupSkillByName('撞名');
    expect(found.status).toBe('ambiguous');
    if (found.status !== 'ambiguous') return;
    expect(found.owners).toEqual([
      { label: '官将（群）', origin: 'official' },
      { label: '自创将（群）', origin: 'DIY' },
    ]);
    // 同名**同内容**印在两头上＝还是同一枚，两行并一行、出处两个都列。
    const shared = withContent('同货');
    __setSkillNameRosterForTests([G('官将', [shared]), Gdiy('自创将', [shared])]);
    const merged = lookupSkillByName('同货');
    expect(merged.status).toBe('found');
    if (merged.status !== 'found') return;
    expect(merged.owners.map(o => o.origin)).toEqual(['official', 'DIY']);
    expect(skillBookCandidates().find(c => c.name === '同货')?.origins).toEqual(['official', 'DIY']);
  });

  it('自动重算＝默认档（每问一次算一次）；关掉它册子冻住，点刷新才跟着走', () => {
    const roster: General[] = [G('甲', [withContent('甲货')])];
    __setSkillNameRosterForTests(roster);
    expect(knownSkillNames()).toEqual(['甲货', '怒斩']);

    // ① 今天的档：进料自己长出一枚新技能，册子下一问就有了（不必重新递交名册）。
    roster.push(Gdiy('乙', [withContent('乙货')]));
    expect(knownSkillNames()).toEqual(['甲货', '乙货', '怒斩']);

    // ② 用户要留的那一路：开关拨到手动⇒先问一次把快照存下，此后同一份进料不再重算。
    setSkillBookAutoRecompute(false);
    expect(knownSkillNames()).toEqual(['甲货', '乙货', '怒斩']);
    roster.push(Gdiy('丙', [withContent('丙货')]));
    expect(knownSkillNames()).toEqual(['甲货', '乙货', '怒斩']);
    expect(lookupSkillByName('丙货').status).toBe('unknown');

    // ③ 那颗今天还看不见的按钮＝这个函数：点一下，册子当场重算，新内容立刻进来。
    refreshSkillBook();
    expect(knownSkillNames()).toEqual(['甲货', '乙货', '丙货', '怒斩']);
    expect(lookupSkillByName('丙货').status).toBe('found');
  });

  it('普查：仓库名册身上一个"玩家自制"都没有⇒今天册子里的出处全属官方', () => {
    expect(skillTable.every(row => row.owners.every(owner => owner.origin === 'official'))).toBe(true);
    expect(skillTable.length).toBeGreaterThan(0);
    // 表上自建那一类（怒斩）也归官方：它住在仓库里，＝开发者写进去的内容。
    expect(authoredSkillTableEntries).toHaveLength(1);
  });
});
