/**
 * 2.4.1 batch one — built-in tier-1 skills (Wei+Shu+Qun, 9 entries) get their
 * first real runtime payloads, per the v2.4.0 §G construction plan.
 * This file pins the DATA shape (what the compiler sees), the honest-skip
 * sentinel for the batch, and the cross-faction duplicate-name id guard.
 * Full-chain behaviour lives in core/transitionEquivalence.test.ts (real
 * templates, all transition paths byte-identical).
 */
import { describe, it, expect } from 'vitest';
import { allGenerals, type General } from '../data/generals';
import { compileGeneralSkills, compileSkill, type SkillSkip } from './skillCompiler';
import { listTurnEndSkillCandidates } from './turnEndSkills';
import { createInitialEngineState, type EngineState } from '../core/GameState';

const BATCH1: Array<{ owner: string; name: string }> = [
  { owner: 'wei_001', name: '奸雄' },
  { owner: 'wei_003', name: '刚烈' },
  { owner: 'wei_015', name: '屯田' },
  { owner: 'shu_009', name: '狂骨' },
  { owner: 'shu_018', name: '龙吟' },
  { owner: 'shu_019', name: '伏枥' },
  { owner: 'shu_021', name: '烈刃' },
  { owner: 'qun_004', name: '肉林' },
  { owner: 'qun_010', name: '猛进' },
];

function compileAllGenerals() {
  const definitions: Array<ReturnType<typeof compileGeneralSkills>['definitions'][number] & { owner: string }> = [];
  const skipped: Array<SkillSkip & { owner: string }> = [];
  for (const g of allGenerals) {
    const result = compileGeneralSkills(g);
    definitions.push(...result.definitions.map(d => ({ ...d, owner: g.id })));
    skipped.push(...result.skipped.map(s => ({ ...s, owner: g.id })));
  }
  return { definitions, skipped };
}

describe('2.4.1 批量一 · 编译形态（§G 施工图逐字核对）', () => {
  const { definitions, skipped } = compileAllGenerals();

  it('九条全部编译入局：批量一子集恰好 9 条 runtime 定义，id 为 <将id>:<技名>:e1', () => {
    // 批量二 (v2.4.2) 后全库口径改由 builtinContentBatch2.test.ts 钉死，
    // 本文件只看批量一自身。
    const batch1Ids = new Set(BATCH1.map(b => `${b.owner}:${b.name}`));
    const mine = definitions.filter(d => batch1Ids.has(`${d.owner}:${d.name}`));
    expect(mine).toHaveLength(9);
    expect(mine.map(d => d.id).sort()).toEqual(
      BATCH1.map(b => `${b.owner}:${b.name}:e1`).sort(),
    );
  });

  it('装配哨兵：批量一技能零 NO_RUNTIME_PAYLOAD，未配载荷技能维持诚实跳过', () => {
    const batchKeys = new Set(BATCH1.map(b => `${b.owner}|${b.name}`));
    const batchSkips = skipped.filter(s => batchKeys.has(`${s.owner}|${s.skillName}`));
    expect(batchSkips).toEqual([]);
    // 全局精确账（38 定义 / 131 跳过，含 v2.6.0 批量四 EQUIP_STRIP 两条）由批量二文件钉死，此处只做下限哨兵
    expect(skipped.length).toBeGreaterThanOrEqual(131);
    expect(skipped.every(s => s.reason === 'NO_RUNTIME_PAYLOAD')).toBe(true);
  });

  it('每条都有面向玩家的中文描述（询问窗/简报可读）', () => {
    for (const d of definitions) {
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it('载荷逐字对表：触发/子滤/效果三元组与 §G 拟载一致', () => {
    const byName = new Map(definitions.map(d => [d.name, d]));
    expect(byName.get('奸雄')).toMatchObject({
      trigger: 'onDamageTaken', damageTypeFilter: undefined,
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byName.get('刚烈')).toMatchObject({
      trigger: 'onDamageTaken', damageTypeFilter: 'attack',
      effects: [{ type: 'DAMAGE', value: 1, target: 'ATTACKER' }],
    });
    expect(byName.get('屯田')).toMatchObject({
      trigger: 'onTurnEnd', turnSubType: 'selfTurn', effectId: 'e1',
      effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(byName.get('狂骨')).toMatchObject({
      trigger: 'onDamageDealt', damageTypeFilter: 'attack',
      effects: [{ type: 'HEAL', value: 1, target: 'SELF' }],
    });
    expect(byName.get('龙吟')).toMatchObject({
      trigger: 'onBecomingTarget',
      effects: [{ type: 'GAIN_ARMOR', value: 1, target: 'SELF' }],
    });
    expect(byName.get('伏枥')).toMatchObject({
      trigger: 'onTurnEnd', turnSubType: 'selfTurn',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byName.get('烈刃')).toMatchObject({
      trigger: 'onDamageDealt', damageTypeFilter: 'attack',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byName.get('肉林')).toMatchObject({
      trigger: 'onDamageTaken', damageTypeFilter: 'skill',
      effects: [{ type: 'HEAL', value: 1, target: 'SELF' }],
    });
    expect(byName.get('猛进')).toMatchObject({
      trigger: 'onBecomingTarget',
      effects: [{ type: 'DAMAGE', value: 1, target: 'ATTACKER' }],
    });
  });
});

describe('2.4.1 哨兵③ · 跨势力重名技能编译 id 唯一性', () => {
  it('同名技能挂到不同将 id 时定义 id 不相撞（ownerKey 前缀生效）', () => {
    const tuntian = allGenerals
      .find(g => g.id === 'wei_015')!
      .skills.find(s => s.name === '屯田')!;
    const asWei = compileSkill({ id: 'wei_015', name: '邓艾' }, tuntian);
    const asJin = compileSkill({ id: 'jin_007', name: '邓艾' }, tuntian);
    expect(asWei.definitions[0].id).toBe('wei_015:屯田:e1');
    expect(asJin.definitions[0].id).toBe('jin_007:屯田:e1');
    // 运行时实例 id 同样参与 keying：同名同技不同实例不互吞
    const asRuntime = compileSkill({ id: 'wei_015', name: '邓艾' }, tuntian, 'ai1_c7');
    expect(asRuntime.definitions[0].id).toBe('ai1_c7:屯田:e1');
  });

  it('当前内置库里 屯田/凿险/权计/自立/巧变/马术 等重名技能不产生重复定义 id', () => {
    const ids = new Set<string>();
    for (const g of allGenerals) {
      for (const d of compileGeneralSkills(g).definitions) {
        expect(ids.has(d.id)).toBe(false);
        ids.add(d.id);
      }
    }
    expect(ids.size).toBe(38); // v2.6.0 批量四 EQUIP_STRIP 两条后全库定义数（无碰撞）
  });
});

describe('2.4.1 决策型屯田/伏枥 · 询问窗候选直达 (真实模板)', () => {
  function stateWithField(playerId: number, generals: General[]): EngineState {
    const state = createInitialEngineState();
    state.players = [
      {
        id: playerId, name: 'P' + playerId,
        fieldGenerals: generals.map(g => ({ general: g, ownerId: playerId })),
      },
      { id: playerId === 1 ? 2 : 1, name: 'P-other', fieldGenerals: [] },
    ] as EngineState['players'];
    state.currentPlayerId = playerId;
    return state;
  }

  it('邓艾/廖化在场上时，回合结束询问窗各得一个真实候选（抽2 / 抽1）', () => {
    const dengAi = JSON.parse(JSON.stringify(allGenerals.find(g => g.id === 'wei_015')!)) as General;
    dengAi.id = 'g_deng';
    const liaoHua = JSON.parse(JSON.stringify(allGenerals.find(g => g.id === 'shu_019')!)) as General;
    liaoHua.id = 'g_liao';
    const candidates = listTurnEndSkillCandidates(stateWithField(1, [dengAi, liaoHua]), 1);
    expect(candidates).toHaveLength(2);
    const bySkill = new Map(candidates.map(c => [c.definition.name, c]));
    expect(bySkill.get('屯田')?.definition).toMatchObject({
      id: 'g_deng:屯田:e1',
      effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(bySkill.get('伏枥')?.definition).toMatchObject({
      id: 'g_liao:伏枥:e1',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
  });
});
