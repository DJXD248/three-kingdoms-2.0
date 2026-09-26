/**
 * v2.8.0 identity lock — pure vocabulary unit tests.
 * Contract: PROJECT_ARCH_MAP.md §F「身份锁契约表」.
 */
import { describe, it, expect } from 'vitest';
import {
  describeLockKey, DIY_IDENTITY, findIdentityConflicts, identitiesOf,
  identityOf, isLockedForSeat, lockKey, lockKeyOf, lockKeysOf, QUN_FACTION,
} from './identity';
import type { Faction, General } from '../data/generals';

type Card = Pick<General, 'name' | 'identity' | 'faction'>;
const card = (name: string, faction: Faction, identity?: string): Card => ({ name, faction, identity });

describe('identityOf — 回退链（契约 格1/格8）', () => {
  it('undefined identity falls back to the general name (官方缺省=自身名字)', () => {
    expect(identityOf(card('关羽', '蜀'))).toBe('关羽');
    expect(identityOf({ name: ' 关羽 ', identity: undefined } as Card)).toBe('关羽');
  });
  it('explicit identity wins, trimmed', () => {
    expect(identityOf(card('神关羽', '蜀', ' 关羽 '))).toBe('关羽');
  });
  it("'' / whitespace identity = 无身份 = never locks", () => {
    expect(identityOf(card('无名氏', '魏', ''))).toBeNull();
    expect(identityOf(card('无名氏', '魏', '   '))).toBeNull();
  });
  it('blank name with undefined identity also resolves to null', () => {
    expect(identityOf(card('   ', '魏'))).toBeNull();
  });
});

describe('lockKeyOf / lockKeysOf / identitiesOf', () => {
  it('lock key is (identity, faction) — 身份×势力=一类具体将', () => {
    expect(lockKeyOf(card('关羽', '蜀'))).toBe(lockKey('关羽', '蜀'));
    expect(lockKeyOf(card('关羽', '群'))).not.toBe(lockKeyOf(card('关羽', '蜀')));
    expect(describeLockKey(lockKeyOf(card('关羽', QUN_FACTION))!)).toBe('关羽·群');
  });
  it("exemptions: 'DIY' and 无身份 produce no key (格7/格8)", () => {
    expect(lockKeyOf(card('自创将', '魏', DIY_IDENTITY))).toBeNull();
    expect(lockKeyOf(card('自创将', '魏', 'DIY'))).toBeNull();
    expect(lockKeyOf(card('游勇', '群', ''))).toBeNull();
  });
  it('set collectors skip exempt cards', () => {
    const batch = [card('关羽', '蜀'), card('甲', '魏', DIY_IDENTITY), card('乙', '吴', ''), card('关羽', '群')];
    expect(lockKeysOf(batch).size).toBe(2);
    expect(identitiesOf(batch)).toEqual(new Set(['关羽']));
  });
});

describe('isLockedForSeat — 分发即锁 + 座内主群互斥（格3/格4/格6）', () => {
  const guanYuShu = card('关羽', '蜀');
  const distributed = lockKeysOf([guanYuShu, card('吕布', '群')]);

  it('same (identity, faction) already distributed ⇒ block', () => {
    expect(isLockedForSeat(card('义薄云天', '蜀', '关羽'), distributed)).toBe(true);
  });
  it('different players holding same identity in DIFFERENT factions stays allowed', () => {
    expect(isLockedForSeat(card('关羽', '魏'), distributed)).toBe(false);
  });
  it('群 candidate dodging a same-identity main card on the SAME surface (主候选优先)', () => {
    expect(isLockedForSeat(card('关羽', '群'), new Set(), new Set(['关羽']))).toBe(true);
    expect(isLockedForSeat(card('赵云', '群'), new Set(), new Set(['关羽']))).toBe(false);
  });
  it("DIY / 无身份 candidates are never blocked (格7)", () => {
    expect(isLockedForSeat(card('DIY甲', '蜀', DIY_IDENTITY), distributed)).toBe(false);
    expect(isLockedForSeat(card('流浪者', '群', ''), distributed, new Set(['流浪者']))).toBe(false);
  });
});

describe('findIdentityConflicts — 旧档撞键只提示不改写（格12）', () => {
  it('groups same-key cards and ignores exempt ones', () => {
    const found = findIdentityConflicts([
      card('关羽', '蜀'), card('二关羽', '蜀', '关羽'),
      card('关羽', '群'), card('甲', '魏', DIY_IDENTITY), card('乙', '魏', DIY_IDENTITY),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].key).toBe(lockKey('关羽', '蜀'));
    expect(found[0].names).toEqual(['关羽', '二关羽']);
  });
});
