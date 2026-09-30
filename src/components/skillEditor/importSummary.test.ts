/**
 * v2.8.13 导入总结（用户需求 2026-09-29）：一次导入后要说清"新增了什么、改了什么"，
 * 且**改动的旧值＝写入前的当前生效视图**（与 #47 裁决同一口径：导入是"A 改 B"的数据改动）。
 * 这里是纯函数层；真实链路（喂文件→读面板）在 SkillEditor.importSummary.test.tsx。
 */
import { describe, it, expect } from 'vitest';
import {
  snapshotForSummary, describeChanges, createdEntry, mergeSummaryEntry, renderSummaryText,
  type SummarySnapshot,
} from './importSummary';
import type { General } from '../../data/generals';

const snap = (over: Partial<SummarySnapshot> = {}): SummarySnapshot => ({
  name: '关羽',
  faction: '蜀',
  hp: 4,
  meleeAtk: 2,
  rangedAtk: 1,
  skills: [{ name: '武圣', description: '', tags: '' }],
  tagWarnings: [],
  ...over,
});

const itemsOf = (before: SummarySnapshot, after: SummarySnapshot) =>
  describeChanges(before, after)?.items ?? [];

describe('导入总结 · 字段改动只点名并写出旧→新', () => {
  it('四个可改字段各报一条，措辞与编辑器/Excel 表头同词（势力/体力/近战/远程）', () => {
    expect(itemsOf(snap(), snap({
      faction: '魏', hp: 5, meleeAtk: 3, rangedAtk: 2,
    }))).toEqual(['势力 蜀→魏', '体力 4→5', '近战 2→3', '远程 1→2']);
  });

  it('什么都没变⇒不产生条目（绝不列一条空改动冒充"改过"）', () => {
    expect(describeChanges(snap(), snap())).toBeNull();
  });

  it('只有技能文本变了也算改动：点名那条技能，不铺平到"哪个槽变了"', () => {
    expect(itemsOf(
      snap(),
      snap({ skills: [{ name: '武圣', description: '杀招额外伤害', tags: '锁定技' }] }),
    )).toEqual(['技能「武圣」改动']);
  });
});

describe('导入总结 · 技能清单的增删与顺序', () => {
  it('新增与移除各点名一次，同名多张按张数如实报', () => {
    expect(itemsOf(
      snap({ skills: [{ name: '武圣', description: '', tags: '' }, { name: '旧技', description: '', tags: '' }] }),
      snap({ skills: [{ name: '武圣', description: '', tags: '' }, { name: '义绝', description: '', tags: '' }] }),
    )).toEqual(['新增技能「义绝」', '移除技能「旧技」']);
  });

  it('集合没变、只换了顺序⇒单独说一句，绝不说成增删', () => {
    expect(itemsOf(
      snap({ skills: [{ name: '甲', description: '', tags: '' }, { name: '乙', description: '', tags: '' }] }),
      snap({ skills: [{ name: '乙', description: '', tags: '' }, { name: '甲', description: '', tags: '' }] }),
    )).toEqual(['技能顺序调整']);
  });

  it('同名技能张数变了⇒不报"改动"（那是增删，两条不能混着说）', () => {
    const items = itemsOf(
      snap({ skills: [{ name: '武圣', description: '', tags: '' }] }),
      snap({ skills: [{ name: '武圣', description: '', tags: '' }, { name: '武圣', description: '第二张', tags: '' }] }),
    );
    expect(items).toEqual(['新增技能「武圣」']);
    expect(items.join('')).not.toContain('改动');
  });
});

describe('导入总结 · 汇总与文本形态', () => {
  it('条目名取写入后那份（改名过的将不会顶着旧名报账）', () => {
    expect(describeChanges(snap({ name: '关羽' }), snap({ name: '关云长', hp: 5 }))?.name).toBe('关云长');
  });

  it('同一名将领一次导入里被写两次⇒合成一条、重复项不刷两遍', () => {
    let acc = mergeSummaryEntry([], { kind: 'modified', name: '关羽', items: ['体力 4→5'] });
    acc = mergeSummaryEntry(acc, { kind: 'modified', name: '关羽', items: ['体力 4→5', '远程 1→2'] });
    expect(acc).toHaveLength(1);
    expect(acc[0]).toEqual({ kind: 'modified', name: '关羽', items: ['体力 4→5', '远程 1→2'] });
  });

  it('新增与修改是两类事实⇒不互相吞并', () => {
    const acc = mergeSummaryEntry(
      [{ kind: 'created', name: '貂蝉', skills: ['闭月'] }],
      { kind: 'modified', name: '貂蝉', items: ['体力 4→5'] },
    );
    expect(acc).toHaveLength(2);
  });

  it('renderSummaryText＝用户要的那两行形状（新增列技能名、修改列改动项）', () => {
    const text = renderSummaryText([
      createdEntry('貂蝉', ['闭月', '离间']),
      createdEntry('陈宫', ['明策', '迟智']),
      { kind: 'modified', name: '关羽', items: ['远程 1→2'] },
      { kind: 'modified', name: '张飞', items: ['技能「咆哮」改动'] },
    ]);
    expect(text).toBe(
      '新增 2 名\n· 貂蝉：闭月、离间\n· 陈宫：明策、迟智\n\n修改 2 名\n· 关羽：远程 1→2\n· 张飞：技能「咆哮」改动',
    );
  });

  it('一张都没有⇒空串（面板因此不会弹一个空壳）', () => {
    expect(renderSummaryText([])).toBe('');
  });
});

describe('导入总结 · 快照读的就是递进来的那份视图', () => {
  it('把带覆盖记录的生效卡递进来⇒快照带的是生效值，不是仓库原始值', () => {
    const effective = {
      id: 'shu_002', name: '关羽', faction: '蜀', type: '武将', hp: 5,
      meleeAtk: 2, rangedAtk: 3, armor: 0,
      skills: [{ name: '武圣', description: 'x' }],
    } as unknown as General;
    expect(snapshotForSummary(effective)).toMatchObject({ hp: 5, rangedAtk: 3 });
  });
});
