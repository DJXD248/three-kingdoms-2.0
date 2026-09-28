// Excel 逐技能行的导入：门槛栏要变成结构化条件，读不懂的要如实报出来。
import { describe, it, expect } from 'vitest';
import { parseRowPerSkillSheet } from './skillExcelParsers';

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
