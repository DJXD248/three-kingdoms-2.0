/**
 * 2.9.3 刀A：「获得技能」这条原语的唯一解析点——技能名名册。
 *
 * 这里钉的是三件事：① 名字查得出来（同名同内容＝同一枚，取名册第一份）；
 * ② 查不出来／同名不同内容 ⇒ **不猜**，交回状态让上层点名；
 * ③ 用户 2026-10-08 那条裁决口径（「官方目前不存在不同效果但重名的技能」）
 *    今天是**实测**成立的，把它钉住——以后真出现冲突，这条证人先变红，
 *    而不是某个玩家的"获得技能"悄悄拿到了另一枚。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  knownSkillNames,
  lookupSkillByName,
  __resetSkillNameIndexForTests,
  __setSkillNameRosterForTests,
} from './skillNameIndex';
import { allGenerals, type General, type Skill } from '../data/generals';

/** 与名册同一算法的独立序列化：证人要能自己算一遍，不复用被测实现的话术。 */
function sig(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sig).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${k}:${sig(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function rosterCensus() {
  const byName = new Map<string, string[]>();
  for (const g of allGenerals) {
    for (const s of g.skills ?? []) {
      const name = String(s?.name ?? '').trim();
      if (!name) continue;
      byName.set(name, [...(byName.get(name) ?? []), sig(s)]);
    }
  }
  const duplicated = [...byName.entries()].filter(([, sigs]) => sigs.length > 1);
  return {
    totalNames: byName.size,
    duplicatedNames: duplicated.map(([name]) => name).sort(),
    conflictingNames: duplicated.filter(([, sigs]) => new Set(sigs).size > 1).map(([name]) => name),
    namesWithRuntime: [...byName.keys()].filter(name => {
      const found = lookupSkillByName(name);
      return found.status === 'found' && (found.skill.effects ?? []).some(e => e.runtime);
    }),
  };
}

const G = (name: string, skills: Skill[]): General =>
  ({ id: `t_${name}`, name, faction: '群', hp: 4, type: '武将', meleeAtk: 2, rangedAtk: 1, armor: 0, skills });

describe('skillNameIndex · 名册认名（2.9.3 刀A 唯一解析点）', () => {
  afterEach(() => __resetSkillNameIndexForTests());

  it('官方名册里没有"同名但内容不同"的两枚——用户那条裁决今天是实测成立的', () => {
    const census = rosterCensus();
    expect(census.conflictingNames).toEqual([]);
    // 实测（2026-10-08）：162 个名字、6 个重名，全部是同一枚技能印在两张卡上。
    expect(census.totalNames).toBe(162);
    expect(census.duplicatedNames).toEqual(['凿险', '屯田', '巧变', '权计', '自立', '马术']);
    // 重名的这几枚必须走"取第一份"这条路，而不是被当成歧义拦下。
    for (const name of census.duplicatedNames) {
      const found = lookupSkillByName(name);
      expect(found.status).toBe('found');
    }
  });

  it('同名同内容＝同一枚：拿到的就是名册上第一份，反复问答案不变', () => {
    const owner = allGenerals.find(g => (g.skills ?? []).some(s => s.name === '屯田'))!;
    const printed = owner.skills!.find(s => s.name === '屯田')!;
    const first = lookupSkillByName('屯田');
    expect(first.status).toBe('found');
    if (first.status !== 'found') return;
    expect(first.skill).toBe(printed);
    expect(first.owners).toEqual(['邓艾（魏）', '邓艾（晋）']);
    expect(lookupSkillByName('屯田').status).toBe('found');
  });

  it('认名字不认将名：拼错、空串、只有空白都算查不到（绝不"最像的那一个"）', () => {
    expect(lookupSkillByName('奸雄')).toMatchObject({ status: 'found' });
    expect(lookupSkillByName('奸雄 ')).toMatchObject({ status: 'found' });
    expect(lookupSkillByName('全名')).toMatchObject({ status: 'unknown' });
    expect(lookupSkillByName('曹操')).toMatchObject({ status: 'unknown' });
    expect(lookupSkillByName('')).toMatchObject({ status: 'unknown' });
    expect(lookupSkillByName('   ')).toMatchObject({ status: 'unknown' });
  });

  it('同名不同内容 ⇒ 不裁决、只报歧义（把名单交回上层点名）', () => {
    __setSkillNameRosterForTests([
      G('甲', [{ name: '观星', effects: [{ id: 'e1', description: '看两张', runtime: { type: 'REVEAL', value: 2 } }] }]),
      G('乙', [{ name: '观星', effects: [{ id: 'e1', description: '看三张', runtime: { type: 'REVEAL', value: 3 } }] }]),
      G('丙', [{ name: '观星', description: '一段话' }]),
    ]);
    const found = lookupSkillByName('观星');
    expect(found.status).toBe('ambiguous');
    if (found.status === 'ambiguous') expect(found.owners).toEqual(['甲（群）', '乙（群）', '丙（群）']);
  });

  it('录入面的名字清单＝名册上出现过的全部（去重、按首次出现顺序）', () => {
    const names = knownSkillNames();
    expect(names).toHaveLength(rosterCensus().totalNames);
    expect(names).toContain('奸雄');
    expect(names.filter(n => n === '屯田')).toHaveLength(1);
    __setSkillNameRosterForTests([G('甲', [{ name: '新技' }, { name: '新技' }])]);
    expect(knownSkillNames()).toEqual(['新技']);
  });
});
