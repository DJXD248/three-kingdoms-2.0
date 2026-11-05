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
   *
   * ⚠️ 2026-11-04（v2.9.33 甲三「只补卡面话」刀）**就地加注，上面 2026-10-31 那段原文一字未删**：
   * 那一枚 21 组是当天现场量的。本刀把用户手写名册里 90 格空壳补上他自己表里的原句之后，同一条尺复量降到
   * **16 组**。降掉的 5 组＝**义从、天妒、奇才、洛神、马术**——这五枚料里的句子与转换表在册那枚
   * **逐字相同**，填完两侧合成同一枚（分叉被消解，不是被谁抹掉；`马术` 的两侧都在本刀料里且同句）。
   * 同一刀**扣下 7 格不写**（闭月、恂恂、当先、巧变、龙胆、倾国、空城）⇒ 既没有新增一组"两句不同的话并排摆着"，
   * 也没有去统一任何一边；这 7 格与已经挂在用户面前的 4 组文本分叉（武圣、英姿、激昂、司敌）一样，
   * 等他裁哪句算数。"扣下的格今天仍必须是空的"由本文件末尾那条结构钉看着（§4 ㈢）。
   */
  it('卡面 16 组"同名不同内容"全部来自转换表，而引擎那张表一枚都不撞', () => {
    const full = cardCensus();
    expect(full.conflictingNames).toHaveLength(16);
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

/**
 * v2.9.33 甲三「只补卡面话」刀的两类证人（监督单 v2 §4 ㈡＝正向钉 90 格，㈢＝结构钉扣下的 7 格）。
 *
 * 这一刀**没有任何引擎行为**：90 格只是把用户自己表里的原句逐字搬上卡面，一枚都没有因此长出可结算
 * 内容。下面两条各管一件会被悄悄做坏的事：
 *  ㈡ 补进去的那句话是不是**料里那一句**（润色、补主语、统一标点、剥掉「锁定技，／限定技，」前缀、
 *    向转换表在册那半"对齐"——每一样都会让这里红），以及补完有没有**顺带**把某枚变成有货（那会改玩法，
 *    本刀不许）；
 *  ㈢ 扣下的 7 格今天必须**仍然空着**。这 7 组等用户裁哪句算数，裁之前谁也不许往里写字，
 *    也不许去统一另一边（把转换表那半改了＝抹掉他的裁决面）。
 *
 * 名单本身也钉死：90 项、键唯一、67 员将、与扣下的 7 格互斥——删掉名单里的任何一项，这里就红，
 * 而不是"少一格没人知道"。
 * 「两份投影逐字一样」（表没被这批话带跑）由本文件既有的
 * `it('转换表那批一枚都没进技能表：两份投影逐字一样（不止数行数）')` 看着，这里不重复。
 */
describe('skillNameIndex · v2.9.33 甲三只补卡面话：90 格逐字钉与 7 格待裁钉（v2 §4 ㈡㈢）', () => {
  /** 料里的原句快照＝[将号, 技能名, 该格应有的卡面话]，逐字取自用户自己的表（将领表 86 格＋参考表 4 格）。 */
  const JIA3_KEEP: ReadonlyArray<readonly [string, string, string]> = [
    ['qun_012', '悲歌', '回合限一次，己方角色被攻击后，你可以弃1张手牌，若为黑色，你与伤害来源角色一起流失1点体力，若为红色，你流失1点体力，己方该角色回复1点体力'],
    ['wei_014', '行殇', '锁定技，其他角色死亡时，死亡补偿的卡牌由己方玩家获得'],
    ['wei_014', '放逐', '限定技，选择1名角色，使其移出场外（调离），直到你死亡或离开场上后，从其玩家营地区域回到场上。'],
    ['wei_011', '据守', '回合结束时，若你体力值为场上角色最低之一，回复1体力'],
    ['qun_015', '智迟', '锁定技，你的所有攻击力-2，你在己方回合外受到伤害后，直到己方下个回合前受到的所有伤害为0。'],
    ['wu_006', '国色', '当你所在区域存在其他角色时，你无法被选择为攻击目标'],
    ['wu_006', '流离', '你死亡时，可以使一名其他角色也承受本次伤害'],
    ['wei_015', '凿险', '限定技，你可以对一名其他角色造成1点伤害，若其在营地区域则造成3点伤害'],
    ['jin_007', '凿险', '限定技，你可以对一名其他角色造成1点伤害，若其在营地区域则造成3点伤害'],
    ['qun_003', '离间', '回合限1次，弃2手牌使两名其他相邻的角色进行「决斗」，由你选择发起者。'],
    ['wu_020', '短兵', '可以选择将近战攻击力修改为1伤害，近战攻击时候对同一区域内另一名角色也造成伤害'],
    ['qun_004', '酒池', '①移动后本回合所有攻击力-1。②补给回复量+1'],
    ['wu_002', '奇袭', '回合限1次，可以弃置1手牌，弃对方1手牌或场上任一其他角色的2点护甲'],
    ['qun_016', '陷阵', '若你所在区域没有其他角色，你的近战攻击无视防具且伤害+1'],
    ['qun_016', '禁酒', '锁定技，你不能被补给。'],
    ['qun_009', '义从', '你移动时，可使同一区域一名角色与你一起移动'],
    ['wei_006', '天妒', '如有判定牌进入弃牌堆，你可以流失1点体力选择使己方玩家获得之'],
    ['wei_006', '遗计', '死亡时，使己方一名角色回复2点体力，一名其他角色失去2点体力'],
    ['qun_001', '急救', '其他角色被攻击前，你可以使用2张手牌在攻击开始前给该角色补给1点体力'],
    ['wu_004', '诈降', '你流失体力后，可以选择一名其他角色流失1点体力'],
    ['shu_007', '集智', '放置时，己方玩家抽1张武将牌'],
    ['shu_007', '奇才', '回合限1次，你可以弃置1张武将牌，摸1张牌'],
    ['shu_008', '烈弓', '锁定技，生命上限为1，近战伤害-1，远程伤害+2'],
    ['qun_013', '帷幕', '你受到的技能伤害-1，己方回合无法被选择为攻击目标'],
    ['qun_013', '乱武', '限定技，本使所有玩家场上所有角色按顺序马上发动一次攻击，若没有进行攻击，则流失1点体力'],
    ['qun_013', '完杀', '限定技，使一名其他角色无法被补给'],
    ['shu_010', '挑衅', '回合限1次，令一名其他攻击范围内的角色对你进行攻击，若你存活，则回复1点体力，并对其造成1点伤害'],
    ['shu_010', '志继', '回合结束若己方玩家没有手牌，则获得“观星”和锁定技：回合结束时，己方玩家丢弃所有手牌。'],
    ['wei_019', '忘隙', '限定技，使你和一名其他角色还原'],
    ['wu_014', '旋风', '回合限1次，当你叠甲或失去护甲时，其对近战区域的任意名角色造成1点伤害'],
    ['shu_001', '仁德', '回合限1次，你可以将自己的体力值任意分配给其他角色'],
    ['shu_011', '享乐', '受到伤害时候，同区域相邻的目标也会受到1点伤害'],
    ['shu_011', '放权', '回合限1次，放弃移动和攻击，使一名其他角色的技能释放限制次数+1'],
    ['shu_017', '陷嗣', '回合结束，若你回合内没有进行过攻击，流失1点体力，同一区域内的其他角色进行攻击后，你可以对其攻击目标也进行一次攻击。'],
    ['wu_012', '好施', '放置时，己方玩家抽2张牌，如有装备牌则将使用其中装备牌为一名其他玩家叠甲'],
    ['wu_007', '谦逊', '锁定技，同一区域内存在其他角色，则你受到的伤害-1'],
    ['qun_002', '无双', '近战伤害+1'],
    ['wu_003', '克己', '回合结束时，如你没有进行过攻击，可以撤退一名区域。'],
    ['shu_006', '马术', '你每回合可以额外进行一次移动'],
    ['shu_006', '铁骑', '你近战攻击的角色本回合非锁定技失效'],
    ['shu_020', '自书', '锁定技，你获得的护甲会在回合结束失去'],
    ['shu_015', '心战', '回合限1次，若有一名其他玩家控制三名及以上角色，可以弃置1张手牌，使其中一名角色失去1点体力'],
    ['shu_015', '挥泪', '锁定技：死亡时，击杀你的目标失去所有护甲'],
    ['wei_020', '峻刑', '放置时，对所有受伤角色造成1点伤害'],
    ['wei_020', '御策', '你受到已受伤的角色攻击后，回复1点体力'],
    ['shu_022', '祸首', '登场时，可以对任意一个区域内的所有目标造成1点伤害'],
    ['shu_022', '再起', '你进行补给后，所在同一区域的其他角色回复你补给回复量的一半（向下取整）'],
    ['qun_010', '马术', '你每回合可以额外进行一次移动'],
    ['shu_013', '连环', '回合限1次，选择一名角色，使其直到下个己方玩家回合前被压制'],
    ['shu_013', '涅槃', '限定技，当你被击杀时，体力值回复到3点，获得1、锁定技，受到的远程伤害+1；2、从“看破”、“八卦”、“火计”选择一名技能获得。'],
    ['wei_002', '鬼才', '限定技，使一名玩家下回合开始无法进行摸牌'],
    ['wu_016', '魂姿', '体力值为1时，弃置1张手牌，回复1点体力，获得技能「英魂」「英姿」'],
    ['wu_001', '制衡', '回合限1次，可以弃置任意己方玩家手牌和己方角色上的护甲，从卡牌池/武将池摸共计等量的牌'],
    ['wu_010', '天义', '回合限1次，己方角色受到伤害后，你可以对伤害来源进行1次攻击'],
    ['wei_017', '贞烈', '锁定技，当你成为其他角色技能或攻击目标时，你可以弃置1张手牌并失去1点体力令其无效'],
    ['wei_017', '秘计', '死亡时，使己方一名角色近战攻击力+1'],
    ['shu_012', '火计', '限定技，对一名受伤角色造成2点伤害'],
    ['wu_021', '甘露', '其他角色回合前，你可以弃1张手牌，使一名角色暂时获得己方场上一名角色的所有护甲直到该本回合结束。'],
    ['wei_008', '神速', '回合各限1次，1、你可以放弃攻击，额外进行一次移动或向后撤退1格区域。2、远程伤害+1，回合结束时体力值流失至2点，体力值低于或等于2点则不流失。'],
    ['wu_009', '天香', '当你受到伤害或流失体力时，可以使一名其他角色回复1点体力'],
    ['wu_009', '红颜', '锁定技，回合结束，你流失1点体力'],
    ['wei_010', '断粮', '除友方外，所有角色在非营地区域补给回复量-1'],
    ['wu_015', '破军', '你近战攻击体力值大于等于你的角色后，其撤退一名区域'],
    ['shu_014', '举荐', '限定技：你可以失去X点体力，令己方玩家从武将池上方翻开（2xX）张牌，选择其中x张加入手卡'],
    ['shu_014', '无言', '锁定技：你因技能受到的伤害或回复量变为0'],
    ['wei_005', '裸衣', '回合限1次，增加1点近战攻击力，受到的伤害+1。获得：锁定技：你不能获得护甲。'],
    ['wei_018', '智愚', '己方角色受到攻击伤害后，若己方玩家没有手牌则摸1张牌'],
    ['wei_013', '驱虎', '限定技，使一名其他角色对其攻击范围内一名你指定其他角色发动一次攻击'],
    ['wei_013', '节命', '锁定技，己方玩家的每回合摸牌量+1，你受到的伤害+1'],
    ['qun_008', '蛊惑', '回合限1次，你可以选择一张手牌，令任意名其他玩家猜测手牌类型，如其猜错，你使其一名角色流失1点体力，如其猜对，你流失1点体力'],
    ['qun_005', '乱击', '你可以弃置2相同花色（武将牌视为无花色）的手牌，对你近战和远程区域所有目标造成1点伤害'],
    ['qun_011', '妄尊', '锁定技：死亡时，对己方营地造成一点伤害'],
    ['qun_011', '同疾', '当你被补给，同一区域其他角色也均回复1点体力，当你受到伤害，同一区域其他角色均受到1点伤害'],
    ['wei_021', '绝情', '锁定技，你的远程伤害-1，你的攻击不造成伤害，改为目标流失与攻击力相同的体力'],
    ['wei_021', '伤逝', '死亡时，使1名其他角色流失1点体力'],
    ['shu_003', '咆哮', '回合限1次，你攻击击杀其他角色后，本回合可以额外进行一次攻击'],
    ['qun_007', '鬼道', '锁定技，所有玩家的手牌视为黑色'],
    ['wei_004', '突袭', '攻击时摸对方玩家1张手牌（如为武将牌则弃之），攻击造成的伤害可随意分配给同一区域的任意名角色'],
    ['shu_005', '涯角', '你成为攻击目标时，可以弃2张手牌回避此伤害。若以此法弃置的手牌：花色相同，则你回复1点体力；花色不同，则你对进攻角色造成1点伤害。'],
    ['wei_007', '洛神', '当你被攻击时候，可以弃置1张手牌使伤害-1，或弃置2张手牌回避此伤害'],
    ['wei_016', '权计', '受到伤害后，你移出场外（调离）直到己方下个回合开始，对伤害来源造成1点伤害'],
    ['jin_006', '权计', '受到伤害后，你移出场外（调离）直到己方下个回合开始，对伤害来源造成1点伤害'],
    ['wei_016', '自立', '锁定技，当你加入场上（回归）时，对同一区域内的其他角色造成1点伤害'],
    ['jin_006', '自立', '锁定技，当你加入场上（回归）时，对同一区域内的其他角色造成1点伤害'],
    ['wu_011', '不屈', '锁定技，你受到伤害-1，其他角色无法攻击其同一区域的其他角色'],
    ['wu_011', '奋激', '死亡时，使一名己方角色撤退一名区域。'],
    ['wu_005', '反间', '限定技，使全场任意名角色流失1点体力'],
    ['shu_004', '观星', '回合限2次，可以观看一名其他玩家的手牌'],
    ['shu_021', '巨象', '若本回合没有进行移动，则回合结束前近战攻击力+1'],
    ['qun_014', '化身', '你受到同一势力的攻击伤害-1，回合限一次，你近战攻击或被近战攻击后，转变自己势力与该角色相同'],
  ];

  /** 本刀扣下不写的 7 格（每张都同名已有另一句摆着）＝[将号, 技能名]，等用户裁。 */
  const JIA3_HELD: ReadonlyArray<readonly [string, string]> = [
    ['qun_003', '闭月'],
    ['wei_019', '恂恂'],
    ['shu_019', '当先'],
    ['wei_009', '巧变'],
    ['shu_005', '龙胆'],
    ['wei_007', '倾国'],
    ['shu_004', '空城'],
  ];

  const key = (id: string, name: string) => `${id}|${name}`;
  /** 按 将号＋技能名 取那一枚；命中零枚或多枚都返回 undefined（定位这一关自己会红）。 */
  const cellOf = (id: string, name: string): Skill | undefined => {
    const general = allGenerals.find(g => g.id === id);
    const hits = (general?.skills ?? []).filter(s => s.name === name);
    return hits.length === 1 ? hits[0] : undefined;
  };

  it('名单本身钉得住：90 项、键唯一、67 员将，且与扣下的 7 格互斥', () => {
    expect(JIA3_KEEP).toHaveLength(90);
    expect(JIA3_HELD).toHaveLength(7);
    const keys = JIA3_KEEP.map(([id, name]) => key(id, name));
    expect(new Set(keys).size).toBe(90);
    expect(new Set(JIA3_KEEP.map(([id]) => id)).size).toBe(67);
    expect(JIA3_KEEP.filter(([id, name, text]) => !id || !name || !text)).toEqual([]);
    const heldKeys = JIA3_HELD.map(([id, name]) => key(id, name));
    expect(new Set(heldKeys).size).toBe(7);
    expect(keys.filter(k => heldKeys.includes(k))).toEqual([]);
    expect(JIA3_KEEP.filter(([id]) => SHEET_IDS.has(id)).map(([id, name]) => key(id, name))).toEqual([]);
  });

  it('定位：90 个「将号|技能名」都恰好命中一枚卡面上的技能', () => {
    const bad = JIA3_KEEP
      .filter(([id, name]) => cellOf(id, name) === undefined)
      .map(([id, name]) => key(id, name));
    expect(bad, '定位不到，或那一员将身上同名命中多枚⇒本刀的范围口径漂了：' + bad.join(',')).toEqual([]);
  });

  it('逐字：90 格的 description 与料一字不差（含「锁定技，／限定技，」前缀与全部标点）', () => {
    const bad = JIA3_KEEP
      .filter(([id, name, text]) => cellOf(id, name)?.description !== text)
      .map(([id, name]) => key(id, name));
    expect(bad, '这些格的话与料不相等（被润色／剥前缀／向另一边对齐了）：' + bad.join(',')).toEqual([]);
  });

  it('仍然空壳：90 格 hasSettleableContent 全为 false＝补话没有顺带长出结算', () => {
    const bad = JIA3_KEEP
      .filter(([id, name]) => hasSettleableContent(cellOf(id, name)) === true)
      .map(([id, name]) => key(id, name));
    expect(bad, '这些格长出了可结算内容⇒本刀改到玩法了：' + bad.join(',')).toEqual([]);
  });

  it('手写批「有卡面话但无可结算内容」＝改前 0 ＋ 本刀 90（正向断言，不是"大于 0"）', () => {
    // 判据与本文件"空壳"那一把尺同源：有非空 description 且 hasSettleableContent === false。
    // 改前读数 0 是 2026-11-04 在同一棵树上现场量的（用户手写的 96 张里，凡有卡面话的那 42 格全带真内容）。
    const withTextButNoRuntime = AUTHORED_GENERALS
      .flatMap(g => g.skills ?? [])
      .filter(s => String(s.description ?? '') !== '' && !hasSettleableContent(s));
    expect(withTextButNoRuntime).toHaveLength(90);
    // 且这 90 枚**就是**名单里那 90 格：不许多、不许少、不许错位到别的将身上。
    const foundKeys = AUTHORED_GENERALS
      .flatMap(g => (g.skills ?? [])
        .filter(s => String(s.description ?? '') !== '' && !hasSettleableContent(s))
        .map(s => key(g.id, String(s.name))))
      .sort();
    expect(foundKeys).toEqual(JIA3_KEEP.map(([id, name]) => key(id, name)).sort());
  });

  it('料里那 4 格出自参考表的也在名单上（不只数总数）', () => {
    const keys = JIA3_KEEP.map(([id, name]) => key(id, name));
    for (const k of ['qun_003|离间', 'shu_022|祸首', 'shu_022|再起', 'shu_005|涯角']) {
      expect(keys, `参考表那一档的 ${k} 不在名单里`).toContain(k);
    }
    expect(JIA3_KEEP.filter(([id, name]) => ['qun_003|离间', 'shu_022|祸首', 'shu_022|再起', 'shu_005|涯角'].includes(key(id, name))).length).toBe(4);
  });

  it('扣下的 7 格：本刀一个字节都没写，今天必须仍是空的', () => {
    const notEmpty = JIA3_HELD
      .filter(([id, name]) => String(cellOf(id, name)?.description ?? '') !== '')
      .map(([id, name]) => key(id, name));
    expect(notEmpty, '这 7 组等用户裁哪句算数，裁之前谁也不许往里写字：' + notEmpty.join(',')).toEqual([]);
    // 形态钉：它们仍是「只有名字」的那一种壳（`{ name }`，连 description 这个键都不该有）。
    const shapeChanged = JIA3_HELD
      .filter(([id, name]) => 'description' in (cellOf(id, name) ?? {}))
      .map(([id, name]) => key(id, name));
    expect(shapeChanged, '这 7 格连 description 键都不该出现（写了空串也算越界）：' + shapeChanged.join(',')).toEqual([]);
  });
});
