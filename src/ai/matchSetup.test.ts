/**
 * Match-assembly tests for the 2.2.8 seat setups (faction picks, explicit
 * general lists, seeded determinism) plus the faction-label propagation the
 * balance stats rely on. v2.8.0: explicit repeats and wrap-around duplicates
 * now collide with the identity lock — the lock rejects the whole batch with
 * a reason unless a practice-window bypass says otherwise.
 *
 * Since the 2.2.19 D-2 second cut buildMatchState is patchless-deterministic:
 * its own setup cursor stream + seed-stamped ids for cards AND skills, so the
 * tests call it bare and can deep-equal two assemblies of the same config.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMatchState,
  defaultMatchConfig,
  factionsForPoolSource,
  generalsForPoolSource,
  type SeatConfig,
} from './matchSetup';
import { allFactions, allGenerals, getGeneralsByFaction, type General } from '../data/generals';
import { DIY_FIXTURE_GENERALS } from './fixtures/diyGeneralFixture';

const build = (seed: number, overrides: Parameters<typeof defaultMatchConfig>[1]) =>
  buildMatchState(defaultMatchConfig(seed, overrides));

describe('matchSetup seat configs', () => {
  it('every seat carries a valid faction label and a faction-pure pool', () => {
    const state = build(11, { playerCount: 3, poolPerPlayer: 6 });
    expect(state.players).toHaveLength(3);
    for (const p of state.players) {
      expect(allFactions).toContain(p.faction as (typeof allFactions)[number]);
      const pool = p.generalPool as General[];
      expect(pool).toHaveLength(6);
      for (const g of pool) expect(g.faction).toBe(p.faction);
    }
  });

  it('same seed → identical assembly, patchless (full EngineState deep-equal)', () => {
    const a = build(77, { playerCount: 2, poolPerPlayer: 4 });
    const b = build(77, { playerCount: 2, poolPerPlayer: 4 });
    // Cards AND injected skills are seed-stamped, so no process-local counter
    // leaks into state — the whole assembled match must compare equal.
    expect(a).toEqual(b);
    const ids = (p: typeof a) =>
      p.players.flatMap(q => (q.generalPool as General[]).map(g => (g as { instanceId?: string }).instanceId));
    expect(ids(a)[0]).toBe(`ai77_c0`);
  });

  it('explicit faction is honoured and duplicate factions across seats are legal', () => {
    const seatConfigs: SeatConfig[] = [
      { faction: '魏' },
      { faction: '魏' },
      { faction: '蜀' },
    ];
    const state = build(21, { playerCount: 3, poolPerPlayer: 5, seatConfigs });
    expect(state.players.map(p => p.faction)).toEqual(['魏', '魏', '蜀']);
    for (const p of state.players) {
      const pool = p.generalPool as General[];
      expect(pool).toHaveLength(5);
      expect(pool.every(g => g.faction === p.faction)).toBe(true);
    }
  });

  it("blank ('' / null) and bogus faction labels are treated as not-picked", () => {
    const seatConfigs: SeatConfig[] = [{ faction: '' }, { faction: '汉' as never }, { faction: null }];
    const state = build(23, { playerCount: 3, poolPerPlayer: 4, seatConfigs });
    for (const p of state.players) {
      expect(allFactions).toContain(p.faction as (typeof allFactions)[number]);
      expect((p.generalPool as General[]).every(g => g.faction === p.faction)).toBe(true);
    }
  });

  it('explicit general list becomes the seat pool verbatim', () => {
    const seatConfigs: SeatConfig[] = [
      { faction: '魏', generals: ['wei_001', 'wei_002', 'wei_003'] },
    ];
    const state = build(31, { playerCount: 2, poolPerPlayer: 8, seatConfigs });
    const pool = state.players[0].generalPool as General[];
    expect(pool).toHaveLength(3); // list length wins over poolPerPlayer
    expect(pool.map(g => g.id)).toEqual(['wei_001_p1', 'wei_002_p1', 'wei_003_p1']);
    expect(pool.map(g => g.name)).toEqual([
      allGenerals.find(g => g.id === 'wei_001')!.name,
      allGenerals.find(g => g.id === 'wei_002')!.name,
      allGenerals.find(g => g.id === 'wei_003')!.name,
    ]);
    // stamped deterministic instance ids keep replay comparable
    expect(new Set(pool.map(g => (g as { instanceId?: string }).instanceId)).size).toBe(3);
  });

  it('v2.8.0 lock: explicit in-seat repeat rejects the whole batch with a reason', () => {
    const seatConfigs: SeatConfig[] = [
      { faction: '魏', generals: ['wei_001', 'wei_001', 'wei_002'] },
    ];
    expect(() => build(31, { playerCount: 2, poolPerPlayer: 8, seatConfigs }))
      .toThrow(/身份锁拒绝整批装配/);
  });

  it('v2.8.0 lock: cross-seat explicit same lock key rejects the batch', () => {
    const seatConfigs: SeatConfig[] = [
      { faction: '魏', generals: ['wei_001'] },
      { faction: '魏', generals: ['wei_001'] },
    ];
    expect(() => build(32, { playerCount: 2, seatConfigs })).toThrow(/身份锁拒绝整批装配/);
  });

  it('v2.8.0 bypass: 自选不受锁 + 多份开关 restore the legacy verbatim-duplicates pool', () => {
    const seatConfigs: SeatConfig[] = [
      { faction: '魏', generals: ['wei_001', 'wei_001', 'wei_002'] },
    ];
    const state = build(31, {
      playerCount: 2,
      poolPerPlayer: 8,
      seatConfigs,
      identityLock: { allowExplicitGeneralsIgnoreLock: true, allowSameIdentitySameFactionMultiCopy: true },
    });
    const pool = state.players[0].generalPool as General[];
    expect(pool.map(g => g.id)).toEqual(['wei_001_p1', 'wei_001_p1', 'wei_002_p1']);
  });

  it('generals without an explicit faction derive the label from the first pick; unknown ids are dropped', () => {
    const wu = getGeneralsByFaction('吴')[0];
    const seatConfigs: SeatConfig[] = [
      { generals: [`not_a_general_${Date.now()}`, wu.id] as string[] },
    ];
    // unknown id filtered first → faction label from the surviving first general
    const state = build(41, { playerCount: 2, seatConfigs });
    expect(state.players[0].faction).toBe(wu.faction);
    const pool = state.players[0].generalPool as General[];
    expect(pool).toHaveLength(1);
    expect(pool[0].id).toBe(`${wu.id}_p1`);
  });

  it('v2.8.0 lock: a faction pool smaller than poolPerPlayer yields distinct-only pools', () => {
    const smallest = [...allFactions].sort(
      (a, b) => getGeneralsByFaction(a).length - getGeneralsByFaction(b).length,
    )[0];
    const supply = getGeneralsByFaction(smallest).length;
    const state = build(51, {
      playerCount: 2,
      poolPerPlayer: supply + 3,
      seatConfigs: [{ faction: smallest }, { faction: smallest }],
    });
    const first = state.players[0].generalPool as General[];
    expect(first).toHaveLength(supply); // wrap duplicates dropped, each definition once
    expect(new Set(first.map(g => g.id)).size).toBe(supply);
    // seat 1 saw every definition already locked by seat 0 → empty pool
    expect(state.players[1].generalPool as General[]).toHaveLength(0);
  });

  it('v2.8.0 bypass: 多份开关 restores the wrap-around duplicate pool', () => {
    const smallest = [...allFactions].sort(
      (a, b) => getGeneralsByFaction(a).length - getGeneralsByFaction(b).length,
    )[0];
    const supply = getGeneralsByFaction(smallest).length;
    const state = build(51, {
      playerCount: 1,
      poolPerPlayer: supply + 3,
      seatConfigs: [{ faction: smallest }],
      identityLock: { allowSameIdentitySameFactionMultiCopy: true },
    });
    const pool = state.players[0].generalPool as General[];
    expect(pool).toHaveLength(supply + 3);
    expect(new Set(pool.map(g => g.id)).size).toBe(supply);
  });
});

/**
 * v2.8.9 地基刀4（§H 方案A）：`poolSource` 只换一个进料口——不加该字段时官方
 * 账本路径必须逐字不变（B10 的含义），加上之后池子里只能出现仓库固定 DIY 样本。
 */
describe('matchSetup poolSource（仓库固定 DIY 样本进料口）', () => {
  it('缺省＝官方账本本身，势力候选表与 allFactions 逐字相同（B10 不受影响）', () => {
    expect(generalsForPoolSource(undefined)).toBe(allGenerals);
    expect(generalsForPoolSource('official')).toBe(allGenerals);
    expect(factionsForPoolSource(undefined)).toEqual([...allFactions]);
  });

  it('diy-fixture：每座位的将全部来自固定样本，且只会落在样本真有的势力上', () => {
    const state = build(31, {
      playerCount: 2,
      poolPerPlayer: 4,
      skillInjection: 0,
      poolSource: 'diy-fixture',
    });
    for (const p of state.players) {
      const pool = p.generalPool as General[];
      expect(pool).toHaveLength(4);
      for (const g of pool) {
        expect(g.id.startsWith('D-fix-')).toBe(true);
        expect(DIY_FIXTURE_GENERALS.map(f => f.id)).toContain(g.id.slice(0, g.id.lastIndexOf('_p')));
      }
      expect(['魏', '蜀', '吴']).toContain(p.faction);
    }
  });

  it('同种子两次装配逐字相同（固定样本＋确定号 ⇒ 锚可复现）', () => {
    const overrides = { playerCount: 2, poolPerPlayer: 4, skillInjection: 0, poolSource: 'diy-fixture' as const };
    expect(build(41, overrides)).toEqual(build(41, overrides));
  });

  it('固定样本池里点选官方号＝查无此将（命名空间隔离，不串池），点样本号则照收', () => {
    const mixed = build(33, {
      playerCount: 2,
      poolPerPlayer: 3,
      skillInjection: 0,
      poolSource: 'diy-fixture',
      seatConfigs: [{ generals: [allGenerals[0].id] }, { generals: [DIY_FIXTURE_GENERALS[0].id] }],
    });
    // 座0 的官方号在样本池里找不到 ⇒ explicit 为空 ⇒ 走随机抽样，仍然全是样本将
    for (const p of mixed.players) {
      for (const g of p.generalPool as General[]) expect(g.id.startsWith('D-fix-')).toBe(true);
    }
    const picked = (mixed.players[1].generalPool as General[]).map(g => g.id);
    expect(picked.some(id => id.startsWith(`${DIY_FIXTURE_GENERALS[0].id}_p`))).toBe(true);
  });

  it('缺省路径仍按官方账本解析自选号（换口没把老路改坏）', () => {
    const state = build(35, { playerCount: 1, poolPerPlayer: 2, seatConfigs: [{ generals: [allGenerals[0].id] }] });
    const pool = state.players[0].generalPool as General[];
    expect(pool.map(g => g.id)).toContain(`${allGenerals[0].id}_p1`);
  });
});

/**
 * v2.8.16 裁决：演练批次不再随机给将池塞「演練・」技能——官方将自己的技能
 * 才是被测的对象。注入能力保留，但必须显式调高才生效。
 */
describe('演练技能注入：默认关闭，显式调高才开', () => {
  const skillNames = (state: ReturnType<typeof build>) =>
    state.players.flatMap(p => (p.generalPool as General[]).flatMap(g => (g.skills ?? []).map(s => s.name)));

  it('defaultMatchConfig 无覆盖 ⇒ skillInjection＝0', () => {
    expect(defaultMatchConfig(1).skillInjection).toBe(0);
  });

  it('默认装配的将池一张演练技能都没有（四个种子各验一次）', () => {
    for (const seed of [1, 7, 33, 202]) {
      const names = skillNames(build(seed, { playerCount: 2, poolPerPlayer: 6 }));
      expect(names.filter(n => n.startsWith('演練・'))).toEqual([]);
    }
  });

  it('显式 skillInjection:1 ⇒ 每将各带一张演练技能（老用途还在）', () => {
    const names = skillNames(build(1, { playerCount: 2, poolPerPlayer: 6, skillInjection: 1 }));
    expect(names.filter(n => n.startsWith('演練・'))).toHaveLength(12);
  });
});
