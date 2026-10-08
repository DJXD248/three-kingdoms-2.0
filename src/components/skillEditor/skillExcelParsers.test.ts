// Excel 逐技能行的导入：门槛栏要变成结构化条件，读不懂的要如实报出来。
import { describe, it, expect } from 'vitest';
import { parseRowPerSkillSheet, parseSkillCell, resolveGeneralForImport, importEntryChangesNothing } from './skillExcelParsers';
import type { General } from '../../data/generals';

const FIXED = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动', '触发时机', '效果模式', '技能描述'];

const v3Header = [...FIXED, '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛', '设定备注'];
const v2Header = [...FIXED, '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '设定备注'];

const SKILL_CELL = ['关羽', '蜀', 4, 2, 1, '测试技', '无', '否', '回合结束时', '无', '手牌为 1 时回一体力'];

describe('parseRowPerSkillSheet · 门槛栏导入', () => {
  it('门槛栏写成结构化条件挂到该效果上', () => {
    const row = [...SKILL_CELL, '效果A', '回合结束时', '回复体力', 1, '自身', '回复1点体力', '手牌=1', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v3Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(unresolved).toEqual([]);
    expect(entries).toHaveLength(1);
    const eff = entries[0].skills[0].effects![0];
    expect(eff.label).toBe('效果A');
    expect(eff.runtime).toEqual({ type: 'HEAL', value: 1, target: 'SELF' });
    expect(eff.conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }]);
  });

  it('读不懂的门槛逐条报告：谁、哪个技能、第几个效果、原文是什么', () => {
    const row = [...SKILL_CELL, '效果A', '回合结束时', '回复体力', 1, '自身', '回复1点体力', '牌不够多时先看有没有马', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v3Header, row]);
    expect(entries[0].skills[0].effects![0].conditions).toBeUndefined();
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('测试技');
    expect(parseWarnings[0]).toContain('效果1');
    expect(parseWarnings[0]).toContain('牌不够多时先看有没有马');
    expect(unresolved).toEqual([]);
  });

  it('6 列（无门槛栏）的旧导出文件照旧导入，按没门槛处理', () => {
    const row = [...SKILL_CELL, '效果A', '回合结束时', '回复体力', 1, '自身', '回复1点体力', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v2Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(unresolved).toEqual([]);
    const eff = entries[0].skills[0].effects![0];
    expect(eff.conditions).toBeUndefined();
    expect(eff.runtime).toEqual({ type: 'HEAL', value: 1, target: 'SELF' });
  });

  it('整组只写了门槛、没写这是哪个效果：不凭空造效果，原文回显给导入面', () => {
    const row = [...SKILL_CELL, '无', '无', '无', '无', '无', '无', '手牌≤2', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v3Header, row]);
    expect(entries[0].skills[0].effects).toBeUndefined();
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('手牌≤2');
    expect(parseWarnings[0]).toContain('没写这是哪个效果');
    expect(unresolved).toEqual([]);
  });

  it('门槛挂在触发+描述上照样成立（没有效果类型也算一个效果）', () => {
    const row = [...SKILL_CELL, '无', '回合结束时', '无', '无', '无', '手牌为 1 时回一体力', '手牌=1', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v3Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(unresolved).toEqual([]);
    const eff = entries[0].skills[0].effects![0];
    expect(eff.conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }]);
    expect(eff.runtime).toBeUndefined();
  });
});

// ── v2.8.13 刀#49 后半（用户裁 B＋方案2）：「数值」格按类型收口，拒收的必须点名 ──
describe('parseRowPerSkillSheet · 数值格的 0 与「全部」', () => {
  it('弃牌写「全部」＝整只手，读进模型且不报错', () => {
    const row = [...SKILL_CELL, '效果A', '回合结束时', '弃牌', '全部', '伤害来源', '弃置其全部手牌', '无', ''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([v3Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(entries[0].skills[0].effects![0].runtime).toEqual({ type: 'DISCARD', value: 0, target: 'ATTACKER' });
  });

  it('摸牌写 0：按没填处理，报告里点名是谁的哪个效果', () => {
    const row = [...SKILL_CELL, '效果A', '回合结束时', '摸牌', 0, '自身', '摸光牌堆', '无', ''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([v3Header, row]);
    expect(entries[0].skills[0].effects![0].runtime).toEqual({ type: 'DRAW_CARD', target: 'SELF' });
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('关羽·测试技 效果1 数值');
    expect(parseWarnings[0]).toContain('摸牌');
    expect(parseWarnings[0]).toContain('按没填处理');
  });

  it('看牌堆顶写 0：单独提醒它的 0 不会被夹成 1（会真的看 0 张）', () => {
    const row = [...SKILL_CELL, '效果A', '回合开始时', '看牌堆顶', 0, '自身', '偷看牌堆', '无', ''];
    const { parseWarnings } = parseRowPerSkillSheet([v3Header, row]);
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('看 0 张');
  });
});

// ── v2.8.11 刀2：新增固定列「技能门槛」＝整组门槛；效果组起点改为按表头认 ──
describe('parseRowPerSkillSheet · 技能门槛（整组门槛）列', () => {
  const v4Header = [...FIXED, '技能门槛',
    '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛',
    '效果2标注', '效果2触发', '效果2效果类型', '效果2数值', '效果2目标', '效果2描述', '效果2门槛',
    '设定备注'];

  it('整组门槛落在技能上，逐项门槛仍落在各自效果上（两级各归各位）', () => {
    const row = [...SKILL_CELL, '体力≤1',
      '选项A', '回合结束时', '摸牌', 1, '自身', '摸一张', '手牌=0',
      '选项B', '回合结束时', '回复体力', 1, '自身', '回复1点', '手牌≥2', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v4Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(unresolved).toEqual([]);
    const sk = entries[0].skills[0];
    expect(sk.conditions).toEqual([{ metric: 'GENERAL_HP', op: 'LTE', value: 1 }]);
    expect(sk.effects![0].conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 0 }]);
    expect(sk.effects![1].conditions).toEqual([{ metric: 'HAND_COUNT', op: 'GTE', value: 2 }]);
  });

  it('技能门槛写「无」＝没有整组门槛', () => {
    const row = [...SKILL_CELL, '无',
      '选项A', '回合结束时', '摸牌', 1, '自身', '摸一张', '无',
      '选项B', '回合结束时', '回复体力', 1, '自身', '回复1点', '无', ''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([v4Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(entries[0].skills[0].conditions).toBeUndefined();
    expect(entries[0].skills[0].effects).toHaveLength(2);
  });

  it('技能门槛读不懂：逐条原文报出来，绝不静默丢弃', () => {
    const row = [...SKILL_CELL, '等对面先动手',
      '选项A', '回合结束时', '摸牌', 1, '自身', '摸一张', '无', '','','','','','',''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([v4Header, row]);
    expect(entries[0].skills[0].conditions).toBeUndefined();
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('技能门槛');
    expect(parseWarnings[0]).toContain('等对面先动手');
  });

  it('旧版 11 固定列（没有技能门槛列）照旧导入，整组门槛＝无', () => {
    const row = [...SKILL_CELL, '效果A', '回合结束时', '回复体力', 1, '自身', '回复1点体力', '手牌=1', ''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([v3Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(entries[0].skills[0].conditions).toBeUndefined();
    expect(entries[0].skills[0].effects![0].conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }]);
  });
});

describe('parseRowPerSkillSheet · 触发栏严格读法', () => {
  it('半截细分「受到伤害后→攻击」不猜：效果照留，触发不填，原文报出来', () => {
    const row = [...SKILL_CELL, '效果A', '受到伤害后→攻击', '伤害', 1, '被作用者', '造成1点伤害', '无', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v3Header, row]);
    const eff = entries[0].skills[0].effects![0];
    expect(eff.trigger).toBeUndefined();
    expect(eff.runtime).toEqual({ type: 'DAMAGE', value: 1, target: 'TARGET' });
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('受到伤害后→攻击');
    expect(unresolved).toEqual([]);
  });

  it('写全的细分照原样导入，不报警', () => {
    const row = [...SKILL_CELL, '效果A', '受到伤害后→攻击伤害', '回复体力', 1, '自身', '回复1点体力', '无', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v3Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(entries[0].skills[0].effects![0].trigger).toEqual({ type: 'onDamageTaken', damageSubType: 'attackDamage' });
    expect(unresolved).toEqual([]);
  });

  it('技能级触发栏看不懂时报没看懂，不落成默认触发', () => {
    const row = [...SKILL_CELL.slice(0, 8), '受到伤害后→攻击', ...SKILL_CELL.slice(9),
      '效果A', '无', '回复体力', 1, '自身', '回复1点体力', '无', ''];
    const { entries, parseWarnings, unresolved } = parseRowPerSkillSheet([v3Header, row]);
    expect(entries[0].skills[0].trigger).toBeUndefined();
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('技能触发');
    expect(parseWarnings[0]).toContain('受到伤害后→攻击');
    expect(unresolved).toEqual([]);
  });
});

// v2.8.7 地基刀3（§H8 N1）：两阶段导入的"待点选阶段"必须留住**原因**与**候选**，
// 绝不静默丢弃、也绝不自动挑第一张（ARCH_MAP §H8 判据②）。
describe('parseRowPerSkillSheet · 未解析块三态（ambiguous 保候选 / missing 可新建）', () => {
  const mk = (id: string, name: string, faction: General['faction']): General => ({
    id, name, faction, hp: 4, type: '武将', meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [],
  });
  // 官方池里司马懿跨魏/晋同名——但**势力不同**，故"名字+势力"对官方池唯一。
  // 候选路真正被触发的场景是同势力同名，测试须自己造 fixture（§H8 读码事实）。
  const pool = [mk('wei_001', '司马懿', '魏'), mk('jin_001', '司马懿', '晋'), mk('shu_900', '自建司马', '蜀')];

  it('势力填了但没命中任何同名⇒ambiguous，候选=全部同名，且不进 entries', () => {
    const row = ['司马懿', '蜀', 4, 2, 1, '测试技', '无', '否', '无', '无', '描述'];
    const { entries, unresolved } = parseRowPerSkillSheet([v2Header, row], pool);
    expect(entries).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].resolution).toBe('ambiguous');
    expect(unresolved[0].candidates.map(c => c.id)).toEqual(['wei_001', 'jin_001']);
  });

  it('同势力同名不同身份⇒ambiguous，候选只含该势力同名几张', () => {
    const dupPool = [...pool, { ...mk('shu_901', '司马懿', '蜀'), identity: '监国' }, { ...mk('shu_902', '司马懿', '蜀'), identity: '太傅' }];
    const row = ['司马懿', '蜀', 4, 2, 1, '测试技', '无', '否', '无', '无', '描述'];
    const { entries, unresolved } = parseRowPerSkillSheet([v2Header, row], dupPool);
    expect(entries).toHaveLength(0);
    expect(unresolved[0].resolution).toBe('ambiguous');
    expect(unresolved[0].candidates.map(c => c.id).sort()).toEqual(['shu_901', 'shu_902']);
  });

  it('名字没势力且同名多张⇒ambiguous；名字库里没有⇒missing（可新建）', () => {
    const amb = parseRowPerSkillSheet([v2Header, ['司马懿', '', 4, 2, 1, '测试技', '无', '否', '无', '无', '描述']], pool);
    expect(amb.unresolved[0].resolution).toBe('ambiguous');
    const mis = parseRowPerSkillSheet([v2Header, ['孙策', '吴', 4, 2, 1, '测试技', '无', '否', '无', '无', '描述']], pool);
    expect(mis.entries).toHaveLength(0);
    expect(mis.unresolved).toHaveLength(1);
    expect(mis.unresolved[0].resolution).toBe('missing');
    expect(mis.unresolved[0].candidates).toEqual([]);
  });

  it('名字+势力唯一⇒自动命中进 entries，不留进待点选', () => {
    const row = ['司马懿', '晋', 4, 2, 1, '测试技', '无', '否', '无', '无', '描述'];
    const { entries, unresolved } = parseRowPerSkillSheet([v2Header, row], pool);
    expect(unresolved).toHaveLength(0);
    expect(entries[0].general.id).toBe('jin_001');
  });
});

// 判别根本身（导入面之外，UI/后续刀复用同一根）
describe('resolveGeneralForImport · 三态判别根', () => {
  const mk = (id: string, name: string, faction: General['faction']): General => ({
    id, name, faction, hp: 4, type: '武将', meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [],
  });
  const pool = [mk('wei_001', '司马懿', '魏'), mk('jin_001', '司马懿', '晋')];

  it('势力消除歧义后唯一⇒unique；势力不匹配⇒ambiguous（不替用户猜）', () => {
    expect(resolveGeneralForImport('司马懿', '魏', pool)).toEqual({ kind: 'unique', general: pool[0] });
    const r = resolveGeneralForImport('司马懿', '蜀', pool);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates).toHaveLength(2);
  });

  it('势力为空且多张同名⇒ambiguous（旧实现的死分支正是这里静默取第一张）', () => {
    const r = resolveGeneralForImport('司马懿', '', pool);
    expect(r.kind).toBe('ambiguous');
  });

  it('空白名/查无此名⇒missing', () => {
    expect(resolveGeneralForImport('  ', '魏', pool).kind).toBe('missing');
    expect(resolveGeneralForImport('孙策', '吴', pool).kind).toBe('missing');
  });
});

// v2.8.12 真机反馈 #45：把自己导出的 Excel 原样重导，逐技能行格式没有"无变化"
// 判定⇒报成"导入 95 名"、每张官方将留下空的 ✏️ 覆盖记录。判定必须是
// **写回去会不会改变当前生效视图**，且不能靠"两边都是同一份对象"蒙对。
describe('importEntryChangesNothing · 重导自己的导出＝零改动', () => {
  const v4Header = [...FIXED, '技能门槛',
    '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛',
    '效果2标注', '效果2触发', '效果2效果类型', '效果2数值', '效果2目标', '效果2描述', '效果2门槛',
    '设定备注'];
  const ROW = [...SKILL_CELL, '体力≤1',
    '选项A', '回合结束时', '摸牌', 1, '自身', '摸一张', '手牌=0',
    '选项B', '受到伤害后→攻击伤害', '伤害', 2, '被作用者', '造成2点伤害', '手牌≥2', ''];
  /** 解析一行⇒{general（仓库原始卡）, gEdit, skills}，与导入循环拿到的完全一样。 */
  const parseRow = (row: (string | number | undefined)[] = ROW) =>
    parseRowPerSkillSheet([v4Header, row]).entries[0];
  /** 当前生效视图：编辑器保存过的技能就是这一份（effectMode 缺省、带真实 id）。 */
  const viewOf = (e: ReturnType<typeof parseRow>, skills: General['skills']) =>
    ({ ...e.general, skills });

  it('逐字重导⇒无变化（先证判定成立）', () => {
    const e = parseRow();
    expect(importEntryChangesNothing(viewOf(e, e.skills as General['skills']), e.gEdit, e.skills)).toBe(true);
  });

  it('效果 id 每次解析都重新生成⇒不得算成变化', () => {
    const e = parseRow();
    const stored = (e.skills as General['skills']).map(s => ({
      ...s, effects: s.effects?.map((f, i) => ({ ...f, id: `stale-${i}` })),
    }));
    expect(stored[0].effects![0].id).not.toBe(e.skills[0].effects![0].id);
    expect(importEntryChangesNothing(viewOf(e, stored), e.gEdit, e.skills)).toBe(true);
  });

  it('存储侧写空串、导出侧写「无」⇒同一回事，不算变化', () => {
    const noDesc = [...SKILL_CELL.slice(0, 10), '无', ...ROW.slice(11)];
    const e = parseRow(noDesc);
    expect(e.skills[0].description).toBeUndefined(); // 「无」确实读成"没有描述"
    const stored = (e.skills as General['skills']).map(s => ({ ...s, description: '' }));
    expect(importEntryChangesNothing(viewOf(e, stored), e.gEdit, e.skills)).toBe(true);
  });

  it('有效果而未写效果模式＝全部生效（导出把这一格写成「全部生效」，不得因此留标记）', () => {
    const e = parseRow();
    const withMode = (e.skills as General['skills']).map(s => ({ ...s, effectMode: 'all' as const }));
    const noMode = (e.skills as General['skills']).map(s => ({ ...s, effectMode: undefined }));
    expect(importEntryChangesNothing(viewOf(e, noMode), e.gEdit, withMode)).toBe(true);
  });

  it('门槛值改一个数字⇒判为有变化（判定不是恒真）', () => {
    const e = parseRow();
    const changed = structuredClone(e.skills) as General['skills'];
    changed[0].effects![0].conditions = [{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }];
    expect(importEntryChangesNothing(viewOf(e, changed), e.gEdit, e.skills)).toBe(false);
  });

  it('整组门槛丢了⇒有变化', () => {
    const e = parseRow();
    const changed = structuredClone(e.skills) as General['skills'];
    changed[0].conditions = undefined;
    expect(importEntryChangesNothing(viewOf(e, changed), e.gEdit, e.skills)).toBe(false);
  });

  it('触发时机细分丢了⇒有变化（不能只比名字）', () => {
    const e = parseRow();
    const changed = structuredClone(e.skills) as General['skills'];
    changed[0].effects![1].trigger = { type: 'onDamageTaken' };
    expect(importEntryChangesNothing(viewOf(e, changed), e.gEdit, e.skills)).toBe(false);
  });

  it('运行时数值/目标丢了⇒有变化', () => {
    const e = parseRow();
    const changed = structuredClone(e.skills) as General['skills'];
    changed[0].effects![0].runtime = { type: 'DRAW_CARD' };
    expect(importEntryChangesNothing(viewOf(e, changed), e.gEdit, e.skills)).toBe(false);
  });

  it('技能条数不同⇒有变化', () => {
    const e = parseRow();
    const changed = structuredClone(e.skills) as General['skills'];
    changed.push({ name: '多出来的一条' });
    expect(importEntryChangesNothing(viewOf(e, changed), e.gEdit, e.skills)).toBe(false);
  });

  it('头部数值真的改了⇒有变化；没改⇒无变化', () => {
    const e = parseRow();
    const view = viewOf(e, e.skills as General['skills']);
    expect(importEntryChangesNothing({ ...view, hp: 3 }, { hp: 4 }, e.skills)).toBe(false);
    expect(importEntryChangesNothing(view, { hp: e.general.hp }, e.skills)).toBe(true);
    expect(importEntryChangesNothing(view, { faction: '群' }, [])).toBe(false);
  });

  it('这一行不带技能、头字段也不冲突⇒整行是空操作，跳过', () => {
    const e = parseRow();
    expect(importEntryChangesNothing(viewOf(e, e.skills as General['skills']), {}, [])).toBe(true);
  });

  it('徽章两枚并存：导出再导一次仍是零改动（比对读的是同一份口径）', () => {
    const e = parseRow([...SKILL_CELL.slice(0, 6), '锁定技、遗计技', ...SKILL_CELL.slice(7),
      ...ROW.slice(11)]);
    expect(e.skills[0].tags).toEqual(['锁定技', '遗计技']);
    expect(importEntryChangesNothing(viewOf(e, e.skills as General['skills']), e.gEdit, e.skills)).toBe(true);
  });

  it('存档里还是旧单值形态的徽章⇒读得出，不因为字段换了名字就当成"没挂徽章"', () => {
    const e = parseRow([...SKILL_CELL.slice(0, 6), '限定技', ...SKILL_CELL.slice(7), ...ROW.slice(11)]);
    const stored = (e.skills as General['skills']).map(s => ({
      name: s.name, description: s.description, tag: '限定技' as const,
      effects: s.effects, forced: s.forced, trigger: s.trigger, conditions: s.conditions, effectMode: s.effectMode,
    }));
    expect(importEntryChangesNothing(viewOf(e, stored), e.gEdit, e.skills)).toBe(true);
  });
});

describe('徽章多枚 · 一句技能名的三种写法都要拆对（用户样本：闭月＝锁定技＋遗计技）', () => {
  it('尖括号里两枚⇒都记下，名字不带括号', () => {
    expect(parseSkillCell('反馈<锁定技、遗计技>：造成伤害后摸牌')).toEqual({
      name: '反馈', tags: ['锁定技', '遗计技'], description: '造成伤害后摸牌',
    });
  });

  it('描述开头连着写两枚⇒都提出来，徽章文字不得留在描述里', () => {
    expect(parseSkillCell('闭月：锁定技、遗计技，当你被击杀时…')).toEqual({
      name: '闭月', tags: ['锁定技', '遗计技'], description: '当你被击杀时…',
    });
  });

  it('一格里几种分隔写法都算两枚（表是人手填的）', () => {
    for (const cell of ['反馈<锁定技、遗计技>：x', '反馈<锁定技 遗计技>：x', '反馈<锁定技/遗计技>：x']) {
      expect(parseSkillCell(cell)!.tags).toEqual(['锁定技', '遗计技']);
    }
  });

  it('不认识的那枚不当徽章收下（不认识的必须由导入面点名，不能猜成"没有徽章"）', () => {
    expect(parseSkillCell('反馈<锁定技、被动技>：x')!.tags).toEqual(['锁定技']);
  });
});

describe('徽章多枚 · 技能标签列的读法', () => {
  const rowOf = (tagCell: string) => [...SKILL_CELL.slice(0, 6), tagCell, ...SKILL_CELL.slice(7)];

  it('「无」与空格子都是"确实没有徽章"，不是"没录"', () => {
    for (const cell of ['无', '']) {
      const { entries, parseWarnings } = parseRowPerSkillSheet([FIXED, rowOf(cell)]);
      expect(entries[0].skills[0].tags).toEqual([]);
      expect(parseWarnings).toEqual([]);
    }
  });

  it('两枚并存⇒按格子里的顺序记下', () => {
    const { entries, parseWarnings } = parseRowPerSkillSheet([FIXED, rowOf('遗计技、锁定技')]);
    expect(entries[0].skills[0].tags).toEqual(['遗计技', '锁定技']);
    expect(parseWarnings).toEqual([]);
  });

  it('拼错的那枚点名到"谁·哪个技能"，认识的那枚照收（绝不整格丢弃）', () => {
    const { entries, parseWarnings } = parseRowPerSkillSheet([FIXED, rowOf('锁定技、遗计济')]);
    expect(entries[0].skills[0].tags).toEqual(['锁定技']);
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('关羽·测试技');
    expect(parseWarnings[0]).toContain('遗计济');
  });
});

describe('parseRowPerSkillSheet · 「我听谁」列（v2.8.21 监听扩面刀）', () => {
  const GROUP8 = ['效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛', '效果1我听谁'];
  const v5Header = [...FIXED, '技能门槛', '我听谁', ...GROUP8, '设定备注'];
  const head = (trigger: string) => [...SKILL_CELL.slice(0, 8), trigger, ...SKILL_CELL.slice(9)];

  it('技能级「我听谁」挂在这条技能的触发上', () => {
    const row = [...head('受到伤害后'), '无', '听场上（所有玩家）',
      '护院', '受到伤害后', '摸牌', 1, '自身', '己方有人受伤就摸一张', '无', '听己方（同一席位）', ''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([v5Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(entries[0].skills[0].trigger).toEqual({ type: 'onDamageTaken', listenerScope: 'field' });
    expect(entries[0].skills[0].effects![0].trigger).toEqual({ type: 'onDamageTaken', listenerScope: 'allySeat' });
  });

  it('留空＝不填（缺省＝只听自己＝扩面前的逐字行为）', () => {
    const row = [...head('受到伤害后'), '无', '无', '护院', '受到伤害后', '摸牌', 1, '自身', '受伤摸一张', '无', '无', ''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([v5Header, row]);
    expect(parseWarnings).toEqual([]);
    expect(entries[0].skills[0].trigger).toEqual({ type: 'onDamageTaken' });
    expect(entries[0].skills[0].effects![0].trigger).toEqual({ type: 'onDamageTaken' });
  });

  it('时机不认这一栏／词不认识／没有触发时机：三种都点名，绝不静默收下', () => {
    const ignored = parseRowPerSkillSheet([v5Header,
      [...head('回合结束时'), '无', '听场上（所有玩家）', '无', '无', '无', '无', '无', '无', '无', '无', '']]);
    expect(ignored.entries[0].skills[0].trigger).toEqual({ type: 'onTurnEnd' });
    expect(ignored.parseWarnings).toHaveLength(1);
    expect(ignored.parseWarnings[0]).toContain('我听谁');
    expect(ignored.parseWarnings[0]).toContain('回合结束时');

    const unknown = parseRowPerSkillSheet([v5Header,
      [...head('受到伤害后'), '无', '听隔壁', '无', '无', '无', '无', '无', '无', '无', '无', '']]);
    expect(unknown.parseWarnings).toHaveLength(1);
    expect(unknown.parseWarnings[0]).toContain('听隔壁');

    const noTrigger = parseRowPerSkillSheet([v5Header,
      [...SKILL_CELL.slice(0, 8), '无', ...SKILL_CELL.slice(9), '无', '只听自己', '无', '无', '无', '无', '无', '无', '无', '无', '']]);
    expect(noTrigger.entries[0].skills[0].trigger).toBeUndefined();
    expect(noTrigger.parseWarnings).toHaveLength(1);
    expect(noTrigger.parseWarnings[0]).toContain('没有触发时机');
  });

  it('旧版 12 固定列（没有「我听谁」这一栏）照旧导入，一栏都不填', () => {
    const oldHeader = [...FIXED, '技能门槛', '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛', '设定备注'];
    const row = [...head('受到伤害后'), '无', '护院', '受到伤害后', '摸牌', 1, '自身', '受伤摸一张', '无', ''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([oldHeader, row]);
    expect(parseWarnings).toEqual([]);
    expect(entries[0].skills[0].trigger).toEqual({ type: 'onDamageTaken' });
  });

  it('这一组只写了「我听谁」⇒不凭空造效果，只回显', () => {
    const row = [...head('受到伤害后'), '无', '无', '无', '无', '无', '无', '无', '无', '无', '听场上（所有玩家）', ''];
    const { entries, parseWarnings } = parseRowPerSkillSheet([v5Header, row]);
    expect(entries[0].skills[0].effects).toBeUndefined();
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('我听谁');
  });
});

describe('importEntryChangesNothing · 两个新维度按默认档归一（v2.8.21）', () => {
  const oldHeader = [...FIXED, '技能门槛',
    '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛', '设定备注'];
  const oldRow = ['赵云', '蜀', 4, 2, 1, '回刺', '无', '否', '成为攻击目标时', '无', '被人指名就回刺', '无',
    '回刺', '成为攻击目标时', '伤害', 1, '伤害来源', '被指名就回刺', '无', ''];
  const parsed = parseRowPerSkillSheet([oldHeader, oldRow]);
  const e = parsed.entries[0];

  it('旧写法「成为攻击目标时」读成显式攻击档：与现行卡面（不写细分）是同一件事', () => {
    expect(parsed.parseWarnings).toEqual([]);
    expect(e.skills[0].trigger).toEqual({ type: 'onBecomingTarget', targetSubType: 'attackTarget' });
    const stored = (e.skills as General['skills']).map(s => ({
      ...s,
      trigger: { type: 'onBecomingTarget' as const },
      effects: s.effects?.map(f => ({ ...f, trigger: { type: 'onBecomingTarget' as const } })),
    }));
    expect(importEntryChangesNothing({ ...e.general, skills: stored }, e.gEdit, e.skills)).toBe(true);
  });

  it('但真的扩了面（听场上）⇒判为有变化，判定不是恒真', () => {
    const stored = (e.skills as General['skills']).map(s => ({
      ...s, trigger: { type: 'onBecomingTarget' as const },
    }));
    const widened = structuredClone(e.skills) as General['skills'];
    widened[0].trigger = { type: 'onBecomingTarget', targetSubType: 'attackTarget', listenerScope: 'field' };
    expect(importEntryChangesNothing({ ...e.general, skills: stored }, e.gEdit, widened)).toBe(false);
  });
});

/**
 * 2.9.3 刀A：第 12 列「获得哪个技能」.**逐列写死**（不 import 那个常量），这样列序
 * 一旦被挪动这里就变红——导出/导入两端靠列名定位，列序漂了没人喊。
 * 这一档只补"导入报告里有没有点名"那一只证人；名字本身认不认得由
 * `skills/skillNameIndex.test.ts` 与 `skills/skillExcelFormat.test.ts` 判。
 */
describe('第 12 列「获得哪个技能」的导入报告（2.9.3 刀A）', () => {
  const v12Header = [...FIXED,
    '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛',
    '效果1我听谁', '效果1改哪个数', '效果1怎么改', '效果1有效周期', '效果1获得哪个技能', '设定备注'];

  /** 效果组 12 格：只改「效果类型」与最后一格，其余按"无"。 */
  const group = (type: string, gainName: string) => [
    '觉醒', '回合开始时', type, '无', '自身', '获得技能那一条', '无', '无', '无', '无', '无', gainName,
  ];
  const row = (type: string, gainName: string) => [
    '关羽', '蜀', 4, 2, 1, '测试技', '无', '否', '回合开始时', '无', '获得技能那一条',
    ...group(type, gainName), '',
  ];
  const parse = (type: string, gainName: string) => parseRowPerSkillSheet([v12Header, row(type, gainName)]);

  it('名册上有的名字：零警告，名字原样进结构化效果', () => {
    const { entries, parseWarnings } = parse('获得技能', '屯田');
    expect(parseWarnings).toEqual([]);
    expect(entries[0].skills[0].effects![0].runtime).toEqual({ type: 'GAIN_SKILL', skillName: '屯田', target: 'SELF' });
  });

  it('名字查不到：报告里点名（谁·哪个技能·第几个效果·原文），不静默收下', () => {
    const { entries, parseWarnings } = parse('获得技能', '怒斩');
    expect(entries[0].skills[0].effects![0].runtime).toMatchObject({ type: 'GAIN_SKILL', skillName: '怒斩' });
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('关羽·测试技 效果1');
    expect(parseWarnings[0]).toContain('怒斩');
  });

  it('这一格留空＝半条效果：同样点名', () => {
    const { parseWarnings } = parse('获得技能', '无');
    expect(parseWarnings).toHaveLength(1);
    expect(parseWarnings[0]).toContain('关羽·测试技 效果1');
  });

  it('别的类型占了这一格：按没读处理并点名（与改数三格同一纪律）', () => {
    const { entries, parseWarnings } = parse('回复体力', '屯田');
    expect(entries[0].skills[0].effects![0].runtime).toEqual({ type: 'HEAL', value: undefined, target: 'SELF' });
    expect(parseWarnings.some(w => w.includes('获得哪个技能'))).toBe(true);
  });
});

