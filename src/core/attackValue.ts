/**
 * Shared attack-power arithmetic (canonical home: core layer).
 *
 * Extracted from AttackResolver (same move `applyArmorDamage` made in 2.2.x)
 * so the melee attack power of a general has exactly ONE implementation.
 * The duel flow (2.8 刀9, ARCH_MAP §F "DUEL 决斗流程原语") reads each round's
 * damage through this function plus core/armorDamage.ts — a duel must never
 * carry its own copy of the damage math, or the two would drift apart the
 * moment the 攻击力增减 layer (#25/#26) lands and both sides have to pick it up
 * together.
 *
 * v2.8 刀4（#25）：账本在这里接上——`ctx` 缺省（今日所有调用点都没账可传）时逐字
 * 等于刀前。读数点唯一：近战/远程两把钥匙都从这一个函数过，决斗与攻击因此不可能
 * 各算各的。
 */
import type { StatModifier, StatModifierKey, StatModifierTarget } from './statModifiers';
import { resolveStatNumber } from './statModifiers';

/** 读数点需要的两样东西：账本＋被读的那一位是谁（座次＋将领实例号）。 */
export interface AttackValueContext {
  ledger?: StatModifier[];
  target?: StatModifierTarget;
}

export function getAttackValue(attacker: any, ranged: boolean, ctx?: AttackValueContext) {
  const explicit = ranged ? attacker?.rangedAtk : attacker?.meleeAtk;
  const base = typeof explicit === 'number'
    ? Math.max(0, explicit)
    : (() => {
        const hp = Number(attacker?.maxHp ?? attacker?.general?.hp ?? 0);
        return ranged ? (hp >= 4 ? 1 : 2) : (hp >= 4 ? 2 : 1);
      })();
  const target = ctx?.target;
  if (!target || !ctx?.ledger || ctx.ledger.length === 0) return base;
  const key: StatModifierKey = ranged ? 'RANGED_ATK' : 'MELEE_ATK';
  return resolveStatNumber(ctx.ledger, key, target, base);
}
