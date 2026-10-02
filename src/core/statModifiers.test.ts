/**
 * 数值修正器账本的读数／收账规则单元测试（2.8 刀4＝#25，契约见 PROJECT_ARCH_MAP §F
 * 「数值修正器管线」十二格表）。
 *
 * 这一档测试只碰纯函数，不碰引擎：账本的全部危险性都在"读哪个数字"这一寸上，
 * 把它单独钉死，四路（常驻/重建/回放/桥接）才有的谈——四路读的是同一个函数。
 *
 * 用例按用户 2026-10-02 裁决的口径逐条对号：
 *  第 4 条 固定优先、固定在场时增减一律不被读、固定失效后增减自动恢复；
 *  第 4 条 同侧两笔固定比发动先后（后发覆盖先发）；
 *  丙案（我的建议、待裁）当事人自己那笔恒盖过同侧第三方；
 *  第 2 条 离场打断一切（名下的、落在身上的都当场断，与周期写法无关）；
 *  第 3 条 在场笔不填周期⇒回合边界不收它；
 *  第 12 条 锁定技那一笔只有 revokeModifier 会拒，生命周期收账照收。
 */
import { describe, it, expect } from 'vitest';
import {
  addModifier,
  effectiveMaxHp,
  hasModifiersTouched,
  isExpiredAtTurnBoundary,
  modifierId,
  modifierIdsExpiredAtTurnBoundary,
  modifierIdsTouchingGeneral,
  modifierIdsTouchingPlayer,
  modifiersFor,
  nextModifierSeq,
  pruneModifiersAtTurnBoundary,
  pruneModifiersOnLeave,
  resolveStatNumber,
  revokeModifier,
  type StatModifier,
  type StatModifierTarget,
} from './statModifiers';

const SELF: StatModifierTarget = { playerId: 1, generalId: 'g1' };

function mod(overrides: Partial<StatModifier> = {}): StatModifier {
  return {
    id: 'sm:1',
    seq: 1,
    key: 'MELEE_ATK',
    mode: 'delta',
    value: 1,
    targetPlayerId: SELF.playerId,
    targetId: SELF.generalId,
    ownerPlayerId: SELF.playerId,
    ownerGeneralId: SELF.generalId,
    ownerSkillId: 's1',
    locked: false,
    passive: false,
    ...overrides,
  };
}

describe('statModifiers · 读数（基础值 + 账本）', () => {
  it('没有账（空/未定义/与这位无关）时逐字返回基础值', () => {
    expect(resolveStatNumber(undefined, 'MELEE_ATK', SELF, 2)).toBe(2);
    expect(resolveStatNumber([], 'MELEE_ATK', SELF, 2)).toBe(2);
    expect(resolveStatNumber([mod({ targetId: 'g9' })], 'MELEE_ATK', SELF, 2)).toBe(2);
  });

  it('增减是累加', () => {
    const ledger = [mod({ seq: 1, value: 1 }), mod({ seq: 2, value: 2 }), mod({ seq: 3, value: -1 })];
    expect(resolveStatNumber(ledger, 'MELEE_ATK', SELF, 2)).toBe(4);
  });

  it('固定压过增减：固定在场时该数字上的增减一律不被读（但没被删）', () => {
    const ledger = [
      mod({ seq: 1, mode: 'delta', value: 3 }),
      mod({ seq: 2, mode: 'set', value: 1 }),
      mod({ seq: 3, mode: 'delta', value: 5 }),
    ];
    expect(resolveStatNumber(ledger, 'MELEE_ATK', SELF, 2)).toBe(1);
    // 固定那笔一旦不在，增减恢复参与——因为这里从不删账，只决定读哪一笔（裁决第 4 条后半）。
    expect(resolveStatNumber(ledger.filter(m => m.mode !== 'set'), 'MELEE_ATK', SELF, 2)).toBe(10);
  });

  it('同侧两笔固定比发动先后：后发的覆盖先发的', () => {
    const early = mod({ seq: 1, mode: 'set', value: 3, ownerSkillId: 'a' });
    const late = mod({ seq: 2, mode: 'set', value: 5, ownerSkillId: 'b' });
    expect(resolveStatNumber([early, late], 'MELEE_ATK', SELF, 2)).toBe(5);
    expect(resolveStatNumber([late, early], 'MELEE_ATK', SELF, 2)).toBe(5);
  });

  it('丙案（待裁）：当事人自己那笔固定恒盖过同侧第三方，与发动先后无关', () => {
    const thirdParty = mod({ seq: 9, mode: 'set', value: 7, ownerPlayerId: 3, ownerGeneralId: 'g3' });
    const own = mod({ seq: 1, mode: 'set', value: 2 });
    expect(resolveStatNumber([thirdParty, own], 'MELEE_ATK', SELF, 2)).toBe(2);
    // 反过来说明第一段真的在起作用：不是"第三方那笔不算"，是它排在当事人之前。
    const ordered = modifiersFor([thirdParty, own], 'MELEE_ATK', SELF);
    expect(ordered.map(m => m.ownerPlayerId)).toEqual([3, 1]);
  });

  it('六把钥匙各读各的，跨席位同名将的账不会串', () => {
    const ranged = mod({ key: 'RANGED_ATK', value: 4 });
    expect(resolveStatNumber([ranged], 'MELEE_ATK', SELF, 2)).toBe(2);
    expect(resolveStatNumber([ranged], 'RANGED_ATK', SELF, 2)).toBe(6);

    // 比归属必须带座次键：同一个将领实例号出现在别的席位＝另一个人。
    const otherSeat = { playerId: 2, generalId: 'g1' };
    const sameCardIdOtherSeat = mod({ targetPlayerId: 2, targetId: 'g1', value: 9 });
    expect(resolveStatNumber([sameCardIdOtherSeat], 'MELEE_ATK', SELF, 2)).toBe(2);
    expect(resolveStatNumber([sameCardIdOtherSeat], 'MELEE_ATK', otherSeat, 2)).toBe(11);
  });
});

describe('statModifiers · 落笔与编号', () => {
  it('序号＝账本已有最大序号 +1，id 由它纯派生（零新增随机面）', () => {
    expect(nextModifierSeq(undefined)).toBe(1);
    expect(nextModifierSeq([mod({ seq: 1 }), mod({ seq: 7 })])).toBe(8);
    expect(modifierId(8)).toBe('sm:8');
  });

  it('addModifier 添一笔并当场发号，不改旧账（纯函数）', () => {
    const before = [mod({ seq: 1 })];
    const after = addModifier(before, mod({ seq: 0, id: 'sm:0' }));
    expect(after.length).toBe(2);
    expect(after[1].id).toBe('sm:2');
    expect(after[1].seq).toBe(2);
    expect(before.length).toBe(1);
  });

  it('回场不续旧账：同一枚技能再落一笔是新 id、新 seq', () => {
    const entry = { ...mod(), id: '', seq: 0, ownerSkillId: 'passive1' };
    let ledger = addModifier(undefined, entry);
    ledger = addModifier(ledger, entry);
    expect(ledger.map(m => m.id)).toEqual(['sm:1', 'sm:2']);
    expect(ledger.map(m => m.seq)).toEqual([1, 2]);
  });
});

describe('statModifiers · 生命周期收账', () => {
  it('离场打断一切：名下产生的与落在身上的都当场断，与 expire 写法无关', () => {
    const owned = mod({ id: 'sm:1', seq: 1 });
    const received = mod({ id: 'sm:2', seq: 2, ownerPlayerId: 3, ownerGeneralId: 'g3' });
    const passiver = mod({
      id: 'sm:3', seq: 3, passive: true, expire: 'untilOtherTurnEnd',
      ownerPlayerId: 9, ownerGeneralId: 'g9',
    });
    const unrelated = mod({ id: 'sm:4', seq: 4, targetId: 'g2', targetPlayerId: 2, ownerPlayerId: 2, ownerGeneralId: 'g2' });
    const ledger = [owned, received, passiver, unrelated];

    expect(modifierIdsTouchingGeneral(ledger, SELF)).toEqual(['sm:1', 'sm:2', 'sm:3']);
    expect(pruneModifiersOnLeave(ledger, SELF).map(m => m.id)).toEqual(['sm:4']);
    expect(hasModifiersTouched(ledger, SELF)).toBe(true);
    expect(hasModifiersTouched([unrelated], SELF)).toBe(false);
  });

  it('席位阵亡收的是"这个人有关"的账（座次键，不看将领实例）', () => {
    const ledger = [
      mod({ id: 'sm:1', seq: 1 }),
      mod({ id: 'sm:2', seq: 2, targetPlayerId: 2, targetId: 'g2', ownerPlayerId: 2, ownerGeneralId: 'g2' }),
    ];
    expect(modifierIdsTouchingPlayer(ledger, 1)).toEqual(['sm:1']);
    expect(pruneModifiersOnLeave(ledger, { playerId: 1, generalId: 'g1' })).toHaveLength(1);
  });

  it('回合边界只收带回合周期的发动笔；在场笔（不填 expire）不收', () => {
    const selfEnd = mod({ id: 'sm:1', seq: 1, expire: 'untilSelfTurnEnd', ownerPlayerId: 1, ownerGeneralId: 'g1' });
    const otherStart = mod({ id: 'sm:2', seq: 2, expire: 'untilOtherTurnStart', ownerPlayerId: 1, ownerGeneralId: 'g1' });
    const onField = mod({ id: 'sm:3', seq: 3, passive: true });
    const ledger = [selfEnd, otherStart, onField];

    expect(isExpiredAtTurnBoundary(selfEnd, { edge: 'end', playerId: 1 })).toBe(true);
    expect(isExpiredAtTurnBoundary(selfEnd, { edge: 'start', playerId: 1 })).toBe(false);
    expect(isExpiredAtTurnBoundary(otherStart, { edge: 'start', playerId: 2 })).toBe(true);
    expect(isExpiredAtTurnBoundary(onField, { edge: 'end', playerId: 1 })).toBe(false);
    expect(modifierIdsExpiredAtTurnBoundary(ledger, { edge: 'end', playerId: 1 })).toEqual(['sm:1']);
    expect(pruneModifiersAtTurnBoundary(ledger, { edge: 'end', playerId: 1 }).map(m => m.id))
      .toEqual(['sm:2', 'sm:3']);
  });

  it('"自/他"比的是这笔账归属席位的回合，与被改的那一位无关', () => {
    const thirdPartyOnSelf = mod({
      id: 'sm:1', seq: 1, expire: 'untilSelfTurnEnd',
      ownerPlayerId: 3, ownerGeneralId: 'g3', targetPlayerId: 1, targetId: 'g1',
    });
    expect(isExpiredAtTurnBoundary(thirdPartyOnSelf, { edge: 'end', playerId: 3 })).toBe(true);
    expect(isExpiredAtTurnBoundary(thirdPartyOnSelf, { edge: 'end', playerId: 1 })).toBe(false);
  });
});

describe('statModifiers · 唯一的外部入口 revokeModifier（裁决第 12 条）', () => {
  it('未锁定的笔可以移走', () => {
    const ledger = [mod({ id: 'sm:1', seq: 1 }), mod({ id: 'sm:2', seq: 2 })];
    const result = revokeModifier(ledger, ['sm:2']);
    expect(result.refused).toEqual([]);
    expect(result.ledger.map(m => m.id)).toEqual(['sm:1']);
  });

  it('锁定技那一笔拒绝被别人移走，其余照收', () => {
    const ledger = [
      mod({ id: 'sm:1', seq: 1, locked: true }),
      mod({ id: 'sm:2', seq: 2, locked: false }),
    ];
    const result = revokeModifier(ledger, ['sm:1', 'sm:2']);
    expect(result.refused).toEqual(['sm:1']);
    expect(result.ledger.map(m => m.id)).toEqual(['sm:1']);
  });

  it('账本里没有的 id＝没什么可移，不报错也不误伤', () => {
    const ledger = [mod({ id: 'sm:1', seq: 1 })];
    expect(revokeModifier(ledger, ['sm:99'])).toEqual({ ledger: [ledger[0]], refused: [] });
    expect(revokeModifier(undefined, ['sm:99']).ledger).toEqual([]);
  });
});

describe('statModifiers · 体力上限的唯一读数', () => {
  it('卡面打印值＋账本⇒此刻的上限；它从不写回 maxHp', () => {
    const ledger = [mod({ key: 'MAX_HP', mode: 'delta', value: -1 })];
    expect(effectiveMaxHp(ledger, SELF, { maxHp: 4, currentHp: 4 })).toBe(3);
    expect(effectiveMaxHp(undefined, SELF, { maxHp: 4, currentHp: 4 })).toBe(4);
  });

  it('没有打印值时按卡面 hp 兜底（旧档/未展开的将卡）', () => {
    expect(effectiveMaxHp(undefined, SELF, { general: { hp: 3 }, currentHp: 3 })).toBe(3);
    expect(effectiveMaxHp([mod({ key: 'MAX_HP', mode: 'set', value: 1 })], SELF, { general: { hp: 3 } })).toBe(1);
  });

  it('上限读到 0 或负数是合法读数（不许存活由读数点之外裁决）', () => {
    const ledger = [mod({ key: 'MAX_HP', mode: 'set', value: 0 })];
    expect(effectiveMaxHp(ledger, SELF, { maxHp: 4 })).toBe(0);
  });
});
