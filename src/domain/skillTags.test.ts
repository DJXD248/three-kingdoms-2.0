/**
 * v2.8.19 徽章刀1：徽章的读写口径（用户需求 2026-09-30 更正后逐字钉住）。
 * 这一刀只把徽章"读对、写对、显示对、核对上"，**结算一处都不读它**——
 * 所以这里的断言全是词汇与对账，没有任何一条涉及伤害或时机真的响不响。
 */
import { describe, it, expect } from 'vitest';
import {
  FORCED_MEANING, TAG_SEPARATOR, formatTags, parseSkillTagsCell,
  skillTagMeanings, tagTimingWarnings, tagsOf, triggerTypesOf,
} from './skillTags';
import { allSkillTags } from '../data/generals';

describe('徽章读取 · 新旧字段都读得到，且只有一份口径', () => {
  it('新字段 tags 按序去重（同一枚徽章录两遍不报两遍）', () => {
    expect(tagsOf({ tags: ['锁定技', '遗计技', '锁定技'] })).toEqual(['锁定技', '遗计技']);
  });

  it('旧单值字段 tag 仍然读得到——丢了这个字段的后果是把限制放宽，不会报错', () => {
    expect(tagsOf({ tag: '限定技' })).toEqual(['限定技']);
  });

  it('新旧同时存在时合并且不重复（存档改到一半不能出现两枚同名徽章）', () => {
    expect(tagsOf({ tags: ['锁定技'], tag: '限定技' })).toEqual(['锁定技', '限定技']);
  });

  it('不认识的徽章名不混进结果（由调用方另行点名，不静当成徽章）', () => {
    expect(tagsOf({ tags: ['锁定技', '被动技'] as never })).toEqual(['锁定技']);
  });

  it('没有技能／没有徽章⇒空数组，不是 undefined', () => {
    expect(tagsOf(undefined)).toEqual([]);
    expect(tagsOf({})).toEqual([]);
  });

  it('用户给的样本：闭月同时挂锁定技与遗计技', () => {
    expect(tagsOf({ name: '闭月', tags: ['锁定技', '遗计技'] } as never)).toEqual(['锁定技', '遗计技']);
  });
});

describe('徽章写入 · 只有一种玩家看得懂的写法', () => {
  it('用顿号连接；没有徽章就是空串（导出格子里写「无」由调用方决定）', () => {
    expect(formatTags(['锁定技', '遗计技'])).toBe(`锁定技${TAG_SEPARATOR}遗计技`);
    expect(formatTags([])).toBe('');
  });
});

describe('徽章格解析 · 认识多少记多少，不认识的必须点名', () => {
  it('空格与「无」都＝没有徽章，不是没有录', () => {
    expect(parseSkillTagsCell(undefined)).toEqual({ tags: [], unknown: [] });
    expect(parseSkillTagsCell('')).toEqual({ tags: [], unknown: [] });
    expect(parseSkillTagsCell(' 无 ')).toEqual({ tags: [], unknown: [] });
  });

  it('一个格子里几种分隔写法都能拆（表格是人手填的，不能只认顿号）', () => {
    for (const cell of ['锁定技、遗计技', '锁定技,遗计技', '锁定技 遗计技', '锁定技+遗计技', '锁定技和遗计技']) {
      expect(parseSkillTagsCell(cell).tags).toEqual(['锁定技', '遗计技']);
    }
  });

  it('拼错的名字原样退回，绝不静默丢掉（丢了徽章＝把次数额度变成不限次数，且不会报错）', () => {
    const read = parseSkillTagsCell('锁定技、遗计济');
    expect(read.tags).toEqual(['锁定技']);
    expect(read.unknown).toEqual(['遗计济']);
  });

  it('混在徽章里的「无」不是一枚徽章', () => {
    expect(parseSkillTagsCell('无、限定技')).toEqual({ tags: ['限定技'], unknown: [] });
  });
});

describe('徽章语义 · 五枚徽章每枚都得有大白话说明，且互相独立', () => {
  it('徽章表里每个名字都有说明（新增徽章忘了配说明⇒这条先红）', () => {
    expect(Object.keys(skillTagMeanings).sort()).toEqual([...allSkillTags].sort());
  });

  it('锁定技＝不能被无效、不能被改变；绝不说成"到点自动响"', () => {
    expect(skillTagMeanings['锁定技']).toContain('不能被无效');
    expect(skillTagMeanings['锁定技']).toContain('不能被改变');
    expect(skillTagMeanings['锁定技']).not.toContain('自动发动');
  });

  it('强制发动是另一个开关：满足条件与代价后直接响，跟锁定技、跟持续生效都不搭', () => {
    expect(FORCED_MEANING).toContain('直接响');
    expect(FORCED_MEANING).toContain('没有关系');
  });

  it('觉醒技在本作尚无机制⇒说明里必须承认它现在只是分类', () => {
    expect(skillTagMeanings['觉醒技']).toContain('分类');
  });
});

describe('徽章与触发时机的对账（只点名，不改结算）', () => {
  it('没挂徽章⇒没得对账', () => {
    expect(tagTimingWarnings({ trigger: { type: 'onTurnEnd' } })).toEqual([]);
  });

  it('登场技确实响在登场时⇒一声不出', () => {
    expect(tagTimingWarnings({ tags: ['登场技'], trigger: { type: 'onDeploy' } })).toEqual([]);
    expect(tagTimingWarnings({ tags: ['登场技'], effects: [{ trigger: { type: 'onOtherDeploy' } }] })).toEqual([]);
  });

  it('遗计技响在被击杀时⇒一声不出（闭月那枚同时挂锁定技，锁定技没有时机期望）', () => {
    expect(tagTimingWarnings({ tags: ['锁定技', '遗计技'], trigger: { type: 'onDeath' } })).toEqual([]);
  });

  it('卡面写登场技而结算不在登场时响⇒点名两句话说的是什么事', () => {
    const items = tagTimingWarnings({ tags: ['登场技'], trigger: { type: 'onTurnEnd' } });
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('登场技');
    expect(items[0]).toContain('将领登场时');
    expect(items[0]).toContain('回合结束时');
  });

  it('时机一个都没录⇒不催（那是录入面的活，这里重复报只会把真问题埋了）', () => {
    expect(tagTimingWarnings({ tags: ['登场技'] })).toEqual([]);
  });

  it('效果里有期望时机也算对上报（只看技能级会误伤多效果技能）', () => {
    expect(tagTimingWarnings({
      tags: ['登场技'],
      trigger: { type: 'onTurnStart' },
      effects: [{ trigger: { type: 'onDeploy' } }],
    })).toEqual([]);
  });

  it('两枚徽章各自不对上⇒各报一条，不含糊成一句', () => {
    const items = tagTimingWarnings({ tags: ['登场技', '遗计技'], trigger: { type: 'onTurnEnd' } });
    expect(items).toHaveLength(2);
  });

  it('triggerTypesOf 把技能级与各效果级时机合并去重（对账读的就是这份）', () => {
    expect(triggerTypesOf({
      trigger: { type: 'onTurnEnd' },
      effects: [{ trigger: { type: 'onTurnEnd' } }, { trigger: { type: 'onDeath' } }, {}],
    })).toEqual(['onTurnEnd', 'onDeath']);
  });
});
