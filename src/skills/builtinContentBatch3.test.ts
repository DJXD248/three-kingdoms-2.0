/**
 * 2.5.0 batch three — the first built-in skills riding the DISCARD primitive
 * (§G tier-2 entries promoted by the new effect type): 反馈(司马懿) and
 * 断肠(蔡文姬). This file pins the DATA shape (compiler view), the
 * whole-hand sentinel (value 0 is legal in the data layer only — Excel and
 * the editor accept ≥1), and the honest deferrals: 据守(代价/收益会被
 * 回合结束候选按定义拆开)、制衡(核心语义=任意张数，固定数值即失真)、
 * 贞烈(缺费用门控，空手牌时沦为无条件回血=发明玩法)。
 * Full-chain behaviour (反馈/断肠 real-template attack chains, air-swing
 * determinism) lives in core/transitionEquivalence.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { allGenerals } from '../data/generals';
import { compileGeneralSkills } from './skillCompiler';

function compile(ownerId: string, skillName: string) {
  const g = allGenerals.find(x => x.id === ownerId);
  if (!g) throw new Error(`missing built-in ${ownerId}`);
  const skill = g.skills.find(s => s.name === skillName);
  if (!skill) throw new Error(`missing skill ${skillName} on ${ownerId}`);
  return compileGeneralSkills(g).definitions.filter(d => d.name === skillName);
}

describe('2.5.0 批量三 · DISCARD 原语首批内置技能（§G 拟载逐字核对）', () => {
  it('反馈：受伤后（任意伤害）→ 攻击者弃 1，label 走 allDamage 子滤', () => {
    const [fankui] = compile('wei_002', '反馈');
    expect(fankui).toMatchObject({
      id: 'wei_002:反馈:e1',
      trigger: 'onDamageTaken', damageTypeFilter: undefined, effectId: 'e1',
      effects: [{ type: 'DISCARD', value: 1, target: 'ATTACKER' }],
    });
    expect(fankui.description).toContain('弃置');
  });

  it('断肠：被击杀时 → 击杀者弃光（value 0 = 整手哨兵，仅数据层合法）', () => {
    const [duanchang] = compile('qun_012', '断肠');
    expect(duanchang).toMatchObject({
      id: 'qun_012:断肠:e1',
      trigger: 'onDeath',
      effects: [{ type: 'DISCARD', value: 0, target: 'ATTACKER' }],
    });
    expect(duanchang.description).toContain('全部手牌');
  });

  it('两条均零跳过入局；鬼才/悲歌维持各自诚实去向', () => {
    const sima = compileGeneralSkills(allGenerals.find(g => g.id === 'wei_002')!);
    expect(sima.definitions.map(d => d.id)).toEqual(['wei_002:反馈:e1']);
    expect(sima.skipped.map(s => `${s.skillName}|${s.reason}`)).toEqual(['鬼才|NO_RUNTIME_PAYLOAD']);

    const cai = compileGeneralSkills(allGenerals.find(g => g.id === 'qun_012')!);
    expect(cai.definitions.map(d => d.id)).toEqual(['qun_012:断肠:e1']);
    expect(cai.skipped.map(s => `${s.skillName}|${s.reason}`)).toEqual(['悲歌|NO_RUNTIME_PAYLOAD']);
  });

  it('缓配钉死：据守/制衡/贞烈维持 NO_RUNTIME_PAYLOAD（§G 缓配理由见本文件头）', () => {
    const deferred: Array<[string, string]> = [
      ['wei_011', '据守'], ['wu_001', '制衡'], ['wei_017', '贞烈'],
    ];
    for (const [ownerId, skillName] of deferred) {
      const g = allGenerals.find(x => x.id === ownerId);
      expect(g, ownerId).toBeTruthy();
      const skip = compileGeneralSkills(g!).skipped.find(s => s.skillName === skillName);
      expect(skip, `${ownerId}|${skillName}`).toMatchObject({ reason: 'NO_RUNTIME_PAYLOAD' });
    }
  });
});
