/**
 * v2.8.0 identity lock — buildDraftCandidates distribution-lock tests.
 * Uses synthetic pools (official content has zero same-faction same-name
 * pairs, so the lock would be no-ops there — 空转如实登记, 契约表).
 */
import { describe, it, expect } from 'vitest';
import { buildDraftCandidates } from './runtimeSetup';
import { lockKeysOf } from '../domain/identity';
import type { Faction, General } from '../data/generals';

const gen = (id: string, name: string, faction: Faction, identity?: string, type: '武将' | '文将' = '武将'): General => ({
  id, name, faction, hp: type === '武将' ? 4 : 3, type,
  meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [], identity,
});

const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

// 12 魏 + 6 群, unique names/ids unless stated.
const basePool = (): General[] => [
  ...Array.from({ length: 12 }, (_, i) => gen(`wei_${i}`, `魏将${i}`, '魏')),
  ...Array.from({ length: 6 }, (_, i) => gen(`qun_${i}`, `群将${i}`, '群')),
];

const surface = (r: { main: General[]; qun: General[] }): General[] => [...r.main, ...r.qun];

describe('buildDraftCandidates — 身份锁分发（v2.8.0）', () => {
  it('deterministic for the same seed and inputs', () => {
    const a = buildDraftCandidates('魏', new Set(), [], seeded(7), basePool());
    const b = buildDraftCandidates('魏', new Set(), [], seeded(7), basePool());
    expect(a.main.map(g => g.id)).toEqual(b.main.map(g => g.id));
    expect(a.qun.map(g => g.id)).toEqual(b.qun.map(g => g.id));
  });

  it('座内同锁去重：同身份同势力不得同面', () => {
    const pool = basePool();
    pool.push(gen('wei_dup', '魏将0复刻', '魏', '魏将0')); // same key as wei_0
    const r = buildDraftCandidates('魏', new Set(), [], seeded(11), pool);
    const keys = [...lockKeysOf(surface(r))];
    expect(keys.length).toBe(new Set(keys).size);
    const ids = surface(r).map(g => g.id);
    expect(ids.filter(id => id === 'wei_0' || id === 'wei_dup')).toHaveLength(1);
  });

  it('跨座锁（分发即锁·含未征召沉没）：已分发面挡住后续座位的同锁另一张', () => {
    const pool = basePool();
    pool.push(gen('wei_twin', '假张辽', '魏', '魏将1')); // same key as wei_1, different id
    const seat0 = buildDraftCandidates('魏', new Set(), [], seeded(3), pool);
    // Exactly one twin pair member sits on seat 0's surface.
    const carried = surface(seat0).find(g => g.id === 'wei_1' || g.id === 'wei_twin')!;
    expect(carried).toBeTruthy();
    const seat1 = buildDraftCandidates('魏', new Set(), surface(seat0), seeded(4), pool);
    const other = carried.id === 'wei_1' ? 'wei_twin' : 'wei_1';
    expect(surface(seat1).map(g => g.id)).not.toContain(other);
  });

  it('群同名全局唯一：他座已分发的群身份不再出现在本座群面', () => {
    const pool = basePool();
    pool.push(gen('qun_lu', '吕布马甲', '群', '群将0'));
    const seat0 = buildDraftCandidates('魏', new Set(), [], seeded(5), pool);
    const carried = surface(seat0).find(g => g.id === 'qun_0' || g.id === 'qun_lu');
    expect(carried).toBeTruthy();
    const seat1 = buildDraftCandidates('蜀', new Set(), surface(seat0), seeded(6), basePool().concat([pool.find(g => g.id === 'qun_lu')!]));
    const other = carried!.id === 'qun_0' ? 'qun_lu' : 'qun_0';
    expect(surface(seat1).map(g => g.id)).not.toContain(other);
  });

  it('座内主↔群双向互斥：群面避开本座主面身份（主候选优先保留）', () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => gen(`wei_${i}`, `魏将${i}`, '魏')),
      gen('qun_a', '同名者', '群', '魏将0'),
      gen('qun_b', '群将B', '群'),
      gen('qun_c', '群将C', '群'),
    ];
    const r = buildDraftCandidates('魏', new Set(), [], seeded(9), pool);
    expect(r.main.map(g => g.id)).toContain('wei_0');
    expect(r.qun.map(g => g.id)).not.toContain('qun_a');
  });

  it("DIY 与无身份豁免：可同面共存", () => {
    const pool = [
      ...Array.from({ length: 8 }, (_, i) => gen(`wei_${i}`, `魏将${i}`, '魏')),
      gen('diy_1', '自创甲', '魏', 'DIY'),
      gen('diy_2', '自创乙', '魏', 'DIY'),
      gen('free_1', '无名甲', '魏', ''),
      gen('free_2', '无名乙', '魏', ''),
    ];
    const r = buildDraftCandidates('魏', new Set(), [], seeded(13), pool);
    const ids = [...r.main, ...r.qun].map(g => g.id);
    for (const id of ['diy_1', 'diy_2', 'free_1', 'free_2']) expect(ids).toContain(id);
  });

  it('锁判定零随机消耗：不撞锁的分发记录不改变候选与随机调用次数', () => {
    const calls: number[] = [];
    const counting = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        const v = ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        calls.push(v);
        return v;
      };
    };
    // A foreign distributed card (id not in pool, key not in pool) must be a
    // pure no-op for the distribution stream.
    const foreign = [gen('other_room', '异室将', '吴', '异室身份')];
    const withLock = buildDraftCandidates('魏', new Set(), foreign, counting(21), basePool());
    const lockCalls = calls.splice(0).length;
    const bare = buildDraftCandidates('魏', new Set(), [], counting(21), basePool());
    const bareCalls = calls.splice(0).length;
    expect(lockCalls).toBe(bareCalls);
    expect(withLock.main.map(g => g.id)).toEqual(bare.main.map(g => g.id));
    expect(withLock.qun.map(g => g.id)).toEqual(bare.qun.map(g => g.id));
  });

  it('配额与旧行为一致：主面 10 张（武优先）、群面最多 5 张', () => {
    const r = buildDraftCandidates('魏', new Set(), [], seeded(31), basePool());
    expect(r.main).toHaveLength(10);
    expect(r.qun).toHaveLength(5);
    expect(r.main.every(g => g.faction === '魏')).toBe(true);
    expect(r.qun.every(g => g.faction === '群')).toBe(true);
  });
});
