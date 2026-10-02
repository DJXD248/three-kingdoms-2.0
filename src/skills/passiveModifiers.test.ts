/**
 * 「在场即生效」那一型的落笔单元测试（2.8 刀4＝#25，用户裁决第 3 条）。
 *
 * 这一档的判别力在于**它不是一次发动**：不进问窗、不依赖「强制发动」、不耗"回合限
 * 1 次"，所以它只有一个入口（登场）与一个出口（离场扫描）。测试因此分两侧写：
 * 有在场技⇒每人每笔恰好一次；没有在场技⇒数组为空（这是两锚逐字的结构保证——
 * 事件流一字不多，不是"多了又被消化掉"）。
 */
import { describe, it, expect } from 'vitest';
import type { General, Skill } from '../data/generals';
import { allGenerals } from '../data/generals';
import { passiveEntriesOfGeneral, passiveEventsForDeploy } from './passiveModifiers';

function general(skills: Skill[], overrides: Partial<General> = {}): General {
  return {
    id: 'test_001', name: '测试将', faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills, ...overrides,
  };
}

function passiveSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: '刚毅', tags: ['锁定技'],
    trigger: { type: 'passive' },
    effects: [{
      id: 'e1',
      trigger: { type: 'passive' },
      runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' },
    }],
    ...overrides,
  };
}

describe('passiveModifiers · 登场落笔', () => {
  it('把在场技的每一笔译成 STAT_MODIFY{op:ADD}，键全部取自本次落笔的将', () => {
    const events = passiveEventsForDeploy(general([passiveSkill()]), 'g1#2', 1);
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      type: 'STAT_MODIFY',
      data: {
        op: 'ADD',
        cause: 'PASSIVE_ON_FIELD',
        modifier: {
          key: 'MELEE_ATK', mode: 'delta', value: 1,
          targetPlayerId: 1, targetId: 'g1#2',
          ownerPlayerId: 1, ownerGeneralId: 'g1#2',
          ownerSkillId: 'g1#2:刚毅:e1', ownerSkillName: '刚毅',
          locked: true, passive: true,
        },
      },
    });
  });

  it('在场笔不填 expire——它的周期就是「在场」本身（填了会被编译器点名跳过）', () => {
    const [event] = passiveEventsForDeploy(general([passiveSkill()]), 'g1#2', 1);
    expect('expire' in (event.data as any).modifier).toBe(false);
    expect((event.data as any).modifier.passive).toBe(true);
  });

  it('没有锁定技徽章⇒那一笔可以被别人的技能移走（账本仍是同一本）', () => {
    const skill = passiveSkill({ tags: undefined, tag: undefined });
    const [event] = passiveEventsForDeploy(general([skill]), 'g1#2', 1);
    expect((event.data as any).modifier.locked).toBe(false);
  });

  it('固定形态照原样落笔（读数点负责"固定压过增减"，这里不做算术）', () => {
    const skill = passiveSkill({
      effects: [{
        id: 'e1', trigger: { type: 'passive' },
        runtime: { type: 'MODIFY_STAT', value: 3, target: 'SELF', stat: 'MAX_HP', modifyMode: 'set' },
      }],
    });
    const modifier = (passiveEventsForDeploy(general([skill]), 'g1#2', 1)[0].data as any).modifier;
    expect(modifier).toMatchObject({ key: 'MAX_HP', mode: 'set', value: 3 });
  });

  it('多笔在场技按录入顺序各落一笔（顺序＝技能录入顺序）', () => {
    const skill = passiveSkill({
      effects: [
        { id: 'e1', trigger: { type: 'passive' }, runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' } },
        { id: 'e2', trigger: { type: 'passive' }, runtime: { type: 'MODIFY_STAT', value: 2, target: 'SELF', stat: 'RANGED_ATK', modifyMode: 'delta' } },
      ],
    });
    const entries = passiveEntriesOfGeneral(general([skill]), 'g1#2', 1);
    expect(entries.map(e => e.key)).toEqual(['MELEE_ATK', 'RANGED_ATK']);
    expect(entries.map(e => e.ownerSkillId)).toEqual(['g1#2:刚毅:e1', 'g1#2:刚毅:e2']);
  });

  it('没有在场技＝空数组：登场事件流一字不多（两锚不换名的结构保证）', () => {
    const withoutSkills = general([]);
    expect(passiveEntriesOfGeneral(withoutSkills, 'g1#2', 1)).toEqual([]);
    expect(passiveEventsForDeploy(withoutSkills, 'g1#2', 1)).toEqual([]);

    const descriptiveOnly = general([{ name: '观星', description: '观天象' }]);
    expect(passiveEventsForDeploy(descriptiveOnly, 'g1#2', 1)).toEqual([]);

    // 「发动」那一型的改数不算在场账：它由触发链在发动那一刻落笔。
    const activeSkill = passiveSkill({
      trigger: { type: 'onTurnStart' },
      effects: [{
        id: 'e1', trigger: { type: 'onTurnStart' },
        runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' },
      }],
    });
    expect(passiveEventsForDeploy(general([activeSkill]), 'g1#2', 1)).toEqual([]);
  });

  it('带门槛／带周期的 passive 被编译器点名跳过⇒这里连笔都没有（绝不"记录而未消费"）', () => {
    const gated = passiveSkill({ conditions: [{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }] });
    expect(passiveEntriesOfGeneral(general([gated]), 'g1#2', 1)).toEqual([]);

    const timed = passiveSkill({
      effects: [{
        id: 'e1', trigger: { type: 'passive' },
        runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta', duration: 'untilSelfTurnEnd' },
      }],
    });
    expect(passiveEntriesOfGeneral(general([timed]), 'g1#2', 1)).toEqual([]);
  });
});

/**
 * 入口存在性的静态断言（刀4 外部复核采纳项，GPT 复核 Q3 判据 2）。
 *
 * 「两锚逐字不换名」这句话有两个完全不同的原因：账本没接线（代码缺陷），或
 * 账本接了线但官方卡池里没有任何一张卡能触发它（内容现状）。只有把后者做成
 * 断言，前一种漂移才不会被误读成后者。所以这里**不跑对局**、只按内容定义追
 * 「官方卡池 → 技能 → 触发／效果」这条链：官方 95 将里既不许出现 `passive`
 * 这一型触发，也不许出现 `MODIFY_STAT` 这一类效果。哪天第一张改数官方卡落地，
 * 这条测试当场变红——那正是换锚那一刀要显式处理的事，不是一起事故。
 */
describe('passiveModifiers · 官方卡池的入口存在性（改数能力的零入口基线）', () => {
  const officials = allGenerals.filter(g => g.source !== 'DIY');

  it('官方池一张改数卡都没有：既无 passive 触发，也无 MODIFY_STAT 效果', () => {
    const withPassiveTrigger = officials.filter(g =>
      JSON.stringify(g.skills).includes('"passive"'),
    );
    const withStatEffect = officials.filter(g =>
      JSON.stringify(g.skills).includes('"MODIFY_STAT"'),
    );
    expect(officials.length).toBeGreaterThan(0);
    expect(withPassiveTrigger.map(g => g.name)).toEqual([]);
    expect(withStatEffect.map(g => g.name)).toEqual([]);
  });

  it('逐位官方将走一遍落笔⇒空数组（锚不换名的结构保证，不是"多了又被消化"）', () => {
    for (const g of officials) {
      expect(passiveEntriesOfGeneral(g, `${g.id}#1`, 1), g.name).toEqual([]);
    }
  });
});
