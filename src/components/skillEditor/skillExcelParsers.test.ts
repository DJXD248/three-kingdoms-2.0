// Excel 逐技能行的导入：门槛栏要变成结构化条件，读不懂的要如实报出来。
import { describe, it, expect } from 'vitest';
import { parseRowPerSkillSheet, resolveGeneralForImport, importEntryChangesNothing } from './skillExcelParsers';
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
});
