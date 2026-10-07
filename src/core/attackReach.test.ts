/**
 * 攻击够得着判据（v2.9.0 射程刀＝ARCH_MAP §三 `RANGE` 那一行落地）。
 *
 * 这一档要钉住三件事，缺一不可：
 *  ① **塌表不塌行为**：`core/attackBlow.ts`（引擎的闸）与 `rules/battlefieldRules.ts`
 *    （界面的名单）原先各抄一份"谁够得着谁"的硬编码表。这一档把两份合成一个距离函数，
 *    于是必须证明**默认形状与旧表逐格同果**。证法＝把两张旧表逐字抄进测试
 *    （`oldEngineTable`/`oldUiTable`），把全部组合格拉一遍做对照——这比写几条样例强，
 *    因为旧表的坑恰好在"没人想到的那一格"（第三方那片区域、战场上的归属是空、营地）。
 *  ② **射程只往外推**：下限"档 ≥ 2"不动 ⇒ 射程再高也不会把身边那一档让给远程；
 *    近战那一支根本不读上限 ⇒ 射程对近战结构性无效（用户 2026-09-28 口径）。
 *  ③ **读数点只有一个**：射程从修正器账本读（增减/固定/后发覆盖/只认被改那一员，
 *    全部复用 `resolveStatNumber`），这一档不自己发明第二轮规矩。
 */
import { describe, it, expect } from 'vitest';
import {
  BASE_ATTACK_RANGE,
  basePosition,
  canReach,
  distanceBetween,
  effectiveAttackRange,
  isReachable,
  reachRank,
  reachReference,
} from './attackReach';
import type { ReachPosition } from './attackReach';
import { addModifier } from './statModifiers';
import type { StatModifier } from './statModifiers';

type Zone = 'camp' | 'front' | 'battle';

const pos = (zone: Zone, areaOwnerId: number | null): ReachPosition => ({ zone, areaOwnerId });

/** 战场上没有"这片区域归谁"（引擎里那一格恒为 null），旧表也从未读过它。 */
const ALL_POSITIONS: ReachPosition[] = [
  pos('camp', 1), pos('camp', 2), pos('camp', 3),
  pos('front', 1), pos('front', 2), pos('front', 3),
  pos('battle', null),
];

// ── 旧表①：v2.8.41 `core/attackBlow.ts` 的 isAttackInRange（逐字抄；改一个字这条
//    证人就不成立）
function oldEngineTable(a: ReachPosition, t: ReachPosition, ranged: boolean): boolean {
  if (ranged) {
    if (a.zone === 'camp') return t.zone === 'battle';
    if (a.zone === 'front') return t.zone === 'front' && t.areaOwnerId !== a.areaOwnerId;
    if (a.zone === 'battle') return t.zone === 'camp';
    return false;
  }
  const sameArea = (x: ReachPosition, y: ReachPosition) =>
    x.zone === y.zone && x.areaOwnerId === y.areaOwnerId;
  if (sameArea(a, t)) return true;
  if (a.zone === 'camp' && t.zone === 'front' && t.areaOwnerId === a.areaOwnerId) return true;
  if (a.zone === 'front' && t.zone === 'battle') return true;
  if (a.zone === 'battle' && t.zone === 'front') return true;
  if (a.zone === 'front' && t.zone === 'camp' && t.areaOwnerId === a.areaOwnerId) return true;
  return false;
}

/** 旧表①的营地那一支（v2.8.41 的 canTargetBase）。 */
function oldEngineBase(p: ReachPosition, targetPlayerId: number, attackerPlayerId: number, ranged: boolean): boolean {
  if (targetPlayerId === attackerPlayerId) return false;
  if (ranged) return p.zone === 'battle';
  return (p.zone === 'front' || p.zone === 'camp') && p.areaOwnerId === targetPlayerId;
}

// ── 旧表②：v2.8.41 `rules/battlefieldRules.ts` 的 getValidTargets 判定（逐字抄）
function oldUiTable(a: ReachPosition, t: ReachPosition, ranged: boolean): boolean {
  const { zone, areaOwnerId } = a;
  const tz = t.zone;
  const ta = t.areaOwnerId;
  if (ranged) {
    if (zone === 'camp' && tz === 'battle') return true;
    if (zone === 'front' && tz === 'front' && ta !== areaOwnerId) return true;
    if (zone === 'battle' && tz === 'camp') return true;
    return false;
  }
  if (zone === tz && ta === areaOwnerId) return true;
  if (zone === 'camp' && tz === 'front' && ta === areaOwnerId) return true;
  if (zone === 'front' && tz === 'battle') return true;
  if (zone === 'battle' && tz === 'front') return true;
  return zone === 'front' && tz === 'camp' && ta === areaOwnerId;
}

/** 旧表②的营地那一支：它与①同文（名单与闸在这一格本来就没分叉）。 */
function oldUiBase(p: ReachPosition, playerNumber: number, attackerPlayerId: number, ranged: boolean): boolean {
  if (playerNumber === attackerPlayerId) return false;
  if (ranged) return p.zone === 'battle';
  return (p.zone === 'front' || p.zone === 'camp') && p.areaOwnerId === playerNumber;
}

interface Unit { ownerId: number, position: ReachPosition }

/** 出手的那一位：席位 1/2/3 × 它能站的七格。站位与席位刻意可以不一致
 *  （"我的将在别人那片前线"这种边角正是旧表没人测过的地方）。 */
const ATTACKERS: Unit[] = [1, 2, 3].flatMap(ownerId =>
  ALL_POSITIONS.map(position => ({ ownerId, position })));

function refOf(a: Unit): number {
  return reachReference({ position: a.position, ownerId: a.ownerId });
}

function report(rows: string[]): void {
  expect(rows.slice(0, 12), `逐格对照发现分叉（共 ${rows.length} 格）`).toEqual([]);
}

describe('够得着判据 · 塌表不塌行为（与两张旧表逐格对照）', () => {
  it('将领↔将领：默认射程下与**引擎**旧表逐格同果（同席位那一格由名单/闸的同人排除兜住）', () => {
    const rows: string[] = [];
    for (const a of ATTACKERS) {
      for (const t of ATTACKERS) {
        for (const ranged of [false, true]) {
          const sameSeat = a.ownerId === t.ownerId;
          const actual = !sameSeat && canReach(refOf(a), a.position, t.position, ranged, BASE_ATTACK_RANGE);
          const expected = !sameSeat && oldEngineTable(a.position, t.position, ranged);
          if (actual !== expected) {
            rows.push(`seat${a.ownerId}@${a.position.zone}/${a.position.areaOwnerId} ${ranged ? '远程' : '近战'} → seat${t.ownerId}@${t.position.zone}/${t.position.areaOwnerId}：新=${actual} 旧=${expected}`);
          }
        }
      }
    }
    report(rows);
  });

  it('将领↔将领：默认射程下与**界面**旧表逐格同果（含旧名单会列出的自己人那一格）', () => {
    const rows: string[] = [];
    for (const a of ATTACKERS) {
      for (const t of ATTACKERS) {
        for (const ranged of [false, true]) {
          const actual = canReach(refOf(a), a.position, t.position, ranged, BASE_ATTACK_RANGE);
          const expected = oldUiTable(a.position, t.position, ranged);
          if (actual !== expected) {
            rows.push(`seat${a.ownerId}@${a.position.zone}/${a.position.areaOwnerId} ${ranged ? '远程' : '近战'} → seat${t.ownerId}@${t.position.zone}/${t.position.areaOwnerId}：新=${actual} 旧=${expected}`);
          }
        }
      }
    }
    report(rows);
  });

  it('打营地：默认射程下与两张旧表的营地行逐格同果', () => {
    const rows: string[] = [];
    for (const a of ATTACKERS) {
      for (const targetSeat of [1, 2, 3]) {
        for (const ranged of [false, true]) {
          const actual = canReach(refOf(a), a.position, basePosition(targetSeat), ranged, BASE_ATTACK_RANGE);
          const e1 = oldEngineBase(a.position, targetSeat, a.ownerId, ranged);
          const e2 = oldUiBase(a.position, targetSeat, a.ownerId, ranged);
          if (e1 !== e2) rows.push(`旧表内部本来就不一致：营地${targetSeat} ← seat${a.ownerId}@${a.position.zone}/${a.position.areaOwnerId} ${ranged}`);
          const sameSeat = targetSeat === a.ownerId;
          if (!sameSeat && actual !== e1) {
            rows.push(`seat${a.ownerId}@${a.position.zone}/${a.position.areaOwnerId} ${ranged ? '远程' : '近战'} → 营地${targetSeat}：新=${actual} 旧=${e1}`);
          }
        }
      }
    }
    report(rows);
  });

  it('同席那一格确实是旧名单的缺口（旧表会把自家队友列进"能打的"，新函数照样判够得着，缺口在名单那一侧补）', () => {
    // 我方战场 → 我方营地队友：旧名单判"够得着"⇒真会渲染成可点；引擎拒。
    const battle = { ownerId: 1, position: pos('battle', null) };
    const ownCampMate = pos('camp', 1);
    expect(oldUiTable(battle.position, ownCampMate, true)).toBe(true);
    expect(canReach(refOf(battle), battle.position, ownCampMate, true, BASE_ATTACK_RANGE)).toBe(true);
    expect(oldEngineTable(battle.position, ownCampMate, true)).toBe(true);
    // ⇒ 所以这一刀补的是"名单别列自己人"，不是"距离判据写错了"。
  });
});

describe('距离怎么数（由近到远，用户 2026-10-07 认可）', () => {
  it('五格编号：自家营地 0 → 自家前线 1 → 战场 2 → 敌前线 3 → 敌营地 4', () => {
    expect(reachRank(pos('camp', 1), 1)).toBe(0);
    expect(reachRank(pos('front', 1), 1)).toBe(1);
    expect(reachRank(pos('battle', null), 1)).toBe(2);
    expect(reachRank(pos('front', 2), 1)).toBe(3);
    expect(reachRank(pos('camp', 2), 1)).toBe(4);
  });

  it('站在战场上时原点退回这一员将自己的席位；站在别人的区域时原点＝那片区域', () => {
    expect(refOf({ ownerId: 2, position: pos('battle', null) })).toBe(2);
    expect(refOf({ ownerId: 1, position: pos('camp', 1) })).toBe(1);
    expect(refOf({ ownerId: 1, position: pos('front', 2) })).toBe(2);
  });

  it('第三方那片＝"对面"，不需要额外分支', () => {
    expect(reachRank(pos('front', 3), 1)).toBe(3);
    expect(distanceBetween(1, pos('camp', 1), basePosition(3))).toBe(4);
  });
});

describe('射程只往外推、不把近处一并放开', () => {
  // 这一档只数"隔着几格"，它不知道席位；自家那一头的营地从战场上量也是档 2，
  // 把它挡在名单外是名单那一侧的席位过滤（证人＝`rules/battlefieldRules.test.ts`）。
  const targets: Record<string, ReachPosition> = {
    战场: pos('battle', null),
    敌前线: pos('front', 2),
    敌营地: pos('camp', 2),
  };

  const ladder: { atk: ReachPosition, base: string[], plus1: string[], plus2: string[] }[] = [
    { atk: pos('camp', 1), base: ['战场'], plus1: ['战场', '敌前线'], plus2: ['战场', '敌前线', '敌营地'] },
    { atk: pos('front', 1), base: ['敌前线'], plus1: ['敌前线', '敌营地'], plus2: ['敌前线', '敌营地'] },
    { atk: pos('battle', null), base: ['敌营地'], plus1: ['敌营地'], plus2: ['敌营地'] },
  ];

  it('射程 2（默认）＝旧表；射程 3、4 各自新增哪一格，逐格点验', () => {
    for (const row of ladder) {
      const ref = reachReference({ position: row.atk, ownerId: 1 });
      for (const [name, p] of Object.entries(targets)) {
        expect
          .soft([name, canReach(ref, row.atk, p, true, 2), canReach(ref, row.atk, p, true, 3), canReach(ref, row.atk, p, true, 4)])
          .toEqual([
            name,
            row.base.includes(name),
            row.plus1.includes(name),
            row.plus2.includes(name),
          ]);
      }
    }
  });

  it('近处那一档永远不给远程：射程拉到 9，同片区域/紧挨着照样打不着', () => {
    const near = [pos('camp', 1), pos('front', 1)];
    for (const p of near) {
      const d = distanceBetween(1, pos('camp', 1), p);
      expect(d).toBeLessThan(2);
      expect(isReachable(d, true, 9)).toBe(false);
      expect(canReach(1, pos('camp', 1), p, true, 9)).toBe(false);
    }
    // 站在战场上看自家前线/敌方前线：两边都是档 1，射程再高也不给远程。
    expect(canReach(1, pos('battle', null), pos('front', 1), true, 9)).toBe(false);
    expect(canReach(1, pos('battle', null), pos('front', 2), true, 9)).toBe(false);
  });

  it('近战那一支根本不读射程上限（射程对近战结构性无效）', () => {
    for (const a of ATTACKERS) {
      for (const t of ATTACKERS) {
        const results = [0, 1, 2, 5, 99].map(maxRange => canReach(refOf(a), a.position, t.position, false, maxRange));
        expect(results.every(r => r === results[0])).toBe(true);
      }
    }
  });

  it('上限被摁成 0/1 或减成负数 ⇒ 远程结构性为空，近战不受影响', () => {
    for (const maxRange of [0, 1, -3]) {
      expect(canReach(1, pos('camp', 1), pos('battle', null), true, maxRange)).toBe(false);
      expect(canReach(1, pos('battle', null), pos('camp', 2), true, maxRange)).toBe(false);
      expect(canReach(1, pos('camp', 1), pos('front', 1), false, maxRange)).toBe(true);
    }
  });
});

describe('射程读数点：账本 → 这一员将此刻的最远档数', () => {
  const target = { playerId: 1, generalId: 'g1' };

  function rangeEntry(overrides: Partial<StatModifier> = {}): Omit<StatModifier, 'id' | 'seq'> {
    return {
      key: 'RANGE',
      mode: 'delta',
      value: 1,
      targetPlayerId: 1,
      targetId: 'g1',
      ownerPlayerId: 1,
      ownerGeneralId: 'g1',
      ownerSkillId: 'sk1',
      locked: false,
      passive: true,
      ...overrides,
    };
  }

  it('没账＝基础值 2；缺账与空账本同果', () => {
    expect(effectiveAttackRange(undefined, target)).toBe(BASE_ATTACK_RANGE);
    expect(effectiveAttackRange([], target)).toBe(BASE_ATTACK_RANGE);
  });

  it('增减累加；固定优先并压掉增减；同侧两笔固定后发覆盖', () => {
    let ledger = addModifier([], rangeEntry());
    expect(effectiveAttackRange(ledger, target)).toBe(3);
    ledger = addModifier(ledger, rangeEntry({ value: 2 }));
    expect(effectiveAttackRange(ledger, target)).toBe(5);
    ledger = addModifier(ledger, rangeEntry({ mode: 'set', value: 4 }));
    expect(effectiveAttackRange(ledger, target)).toBe(4);
    ledger = addModifier(ledger, rangeEntry({ mode: 'set', value: 1 }));
    expect(effectiveAttackRange(ledger, target)).toBe(1);
  });

  it('账只认被改的那一员将（同席另一员、他席同实例号都不吃这笔账）', () => {
    const ledger = addModifier([], rangeEntry());
    expect(effectiveAttackRange(ledger, { playerId: 1, generalId: 'g2' })).toBe(BASE_ATTACK_RANGE);
    expect(effectiveAttackRange(ledger, { playerId: 2, generalId: 'g1' })).toBe(BASE_ATTACK_RANGE);
    expect(effectiveAttackRange(ledger, target)).toBe(3);
  });

  it('这笔账真的能把"够不着"变成"够得着"（档 3 在射程 2 拒、射程 3 收）', () => {
    const ledger = addModifier([], rangeEntry());
    const maxRange = effectiveAttackRange(ledger, target);
    expect(canReach(1, pos('camp', 1), pos('front', 2), true, maxRange)).toBe(true);
    expect(canReach(1, pos('camp', 1), pos('front', 2), true, BASE_ATTACK_RANGE)).toBe(false);
    expect(canReach(1, pos('camp', 1), pos('camp', 2), true, maxRange)).toBe(false);
  });
});
