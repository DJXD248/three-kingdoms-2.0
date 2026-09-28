/**
 * v2.8.9 地基刀4（§H 方案A）：仓库固定 DIY 样本的**准入体检**。
 * 核心不是"文件存在"，而是这批卡**进了唯一编译路之后真的会响**：任何一条效果
 * 被编译器跳过（触发时机没映射、效果类型不结算），这份样本就成了空转的锚——
 * 所以逐张断言 `skipped` 为空、`definitions` 非空（§12-46①：漏读比读错更危险）。
 */
import { describe, expect, it } from 'vitest';
import { DIY_FIXTURE_GENERALS, DIY_FIXTURE_ID_TAG } from './diyGeneralFixture';
import { allGenerals } from '../../data/generals';
import { compileGeneralSkills } from '../../skills/skillCompiler';
import { idNamespace, isAcceptableAuthoredRecord } from '../../domain/generalProvenance';

const ids = DIY_FIXTURE_GENERALS.map(g => g.id);

describe('DIY 固定样本：记录形状（§H1 唯一存在入口＋§H2 命名空间）', () => {
  it('每张都经 createAuthoredGeneral 造出：D- 命名空间、source=DIY、号确定且不撞官方账本', () => {
    expect(DIY_FIXTURE_GENERALS.length).toBeGreaterThan(1);
    for (const g of DIY_FIXTURE_GENERALS) {
      expect(idNamespace(g.id)).toBe('D');
      expect(g.id).toBe(`D-${DIY_FIXTURE_ID_TAG}-${g.id.slice(`D-${DIY_FIXTURE_ID_TAG}-`.length)}`);
      expect(g.source).toBe('DIY');
      expect(isAcceptableAuthoredRecord(g)).toBe(true);
      expect(g.hp).toBeGreaterThan(0);
      expect(allGenerals.map(o => o.id)).not.toContain(g.id);
      // §H1：identity 在创建时就显式落值（这里显式为空＝无身份、永不锁）
      expect(g.identity).toBe('');
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('type 由体力派生（hp≥4⇒武将），不是新玩法', () => {
    for (const g of DIY_FIXTURE_GENERALS) {
      expect(g.type).toBe(g.hp >= 4 ? '武将' : '文将');
    }
  });
});

describe('DIY 固定样本：进编译器真的会响（反空转）', () => {
  it('每张卡的每条效果都编译通过，零跳过', () => {
    for (const g of DIY_FIXTURE_GENERALS) {
      const { definitions, skipped } = compileGeneralSkills(g);
      expect(skipped, `${g.name} 有效果被编译器跳过`).toEqual([]);
      expect(definitions.length, `${g.name} 没有任何可结算技能`).toBeGreaterThan(0);
    }
  });

  it('带「发动门槛」的那张：门槛逐字活到编译产物里（不是被静默丢掉）', () => {
    const gated = DIY_FIXTURE_GENERALS.filter(g =>
      g.skills.some(s => (s.effects ?? []).some(e => (e.conditions ?? []).length > 0)),
    );
    expect(gated.length, '样本里必须至少有一张带门槛的卡，否则 v2.8.3 录入面产物没被验证到').toBeGreaterThan(0);
    for (const g of gated) {
      const { definitions } = compileGeneralSkills(g);
      const carried = definitions.filter(d => ((d as { conditions?: unknown[] }).conditions ?? []).length > 0);
      expect(carried.length, `${g.name} 的门槛没能带进编译结果`).toBeGreaterThan(0);
    }
  });

  it('双效果那张：两条各自成定义（各自按触发时机独立生效）', () => {
    const twin = DIY_FIXTURE_GENERALS.find(g =>
      g.skills.some(s => (s.effects ?? []).length > 1),
    );
    expect(twin).toBeTruthy();
    const { definitions, skipped } = compileGeneralSkills(twin!);
    expect(skipped).toEqual([]);
    expect(definitions.length).toBeGreaterThanOrEqual(2);
  });

  it('只用已结算的效果类型与已有触发时机——样本没往引擎里塞新玩法', () => {
    const runtimeTypes = new Set<string>();
    for (const g of DIY_FIXTURE_GENERALS) {
      for (const s of g.skills) for (const e of s.effects ?? []) {
        runtimeTypes.add(e.runtime?.type ?? 'NO_RUNTIME');
        expect(e.trigger?.type, `${g.name}·${s.name} 有没写触发时机的效果`).toBeTruthy();
      }
    }
    expect([...runtimeTypes].sort()).toEqual(
      ['DAMAGE', 'DECK_PLACE', 'DISCARD', 'DRAW_CARD', 'EQUIP_STRIP', 'GAIN_ARMOR', 'GIVE', 'HEAL', 'REVEAL'],
    );
  });
});

describe('DIY 固定样本：势力覆盖面（座位随机只能落在样本真有的势力上）', () => {
  it('每势力都有卡，且不含官方独有的势力（晋/群）', () => {
    const factions = [...new Set(DIY_FIXTURE_GENERALS.map(g => g.faction))].sort();
    expect(factions).toEqual(['吴', '蜀', '魏']);
    for (const faction of factions) {
      expect(DIY_FIXTURE_GENERALS.filter(g => g.faction === faction).length).toBeGreaterThanOrEqual(4);
    }
  });
});
