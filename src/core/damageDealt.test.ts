/**
 * 造成伤害那一格的算术（2.9.4 刀＝#54）·纯函数、场合对表与决斗逐轮。
 *
 * 分工照旧：`statModifiers.test.ts` 钉账本读数，`damageTaken.test.ts` 钉受方那一格，
 * `skills/statModifierPipeline.test.ts` 钉真链路（跨侧相撞那两枚在那里）；这一档钉的是
 * **造方那一格**本身——它是三路（普攻／技能伤害／决斗逐轮）唯一共用的造方读数函数，
 * 加上「生效场合」那把只对这一把钥匙存在的对表规则，所以它的每一条口径只在这里写一次。
 *
 * 口径出处：用户 2026-10-14 当面裁决「第4条，**扣护甲前算**」＋「第一条，**决斗的每一轮都算**」
 * ＋ 2026-10-08 的怒斩两条腿原文（「你进行决斗计算或近战攻击有护甲的角色时伤害+1」）与
 * 「**决斗不算近战攻击**，所以不存在+2」、护甲「**≥1 即算**」。
 */
import { describe, it, expect } from 'vitest';
import {
  attackDealtContext, duelDealtContext, occasionHolds, resolveDamageDealt,
  resolveDamageDealtFromSource, dealtDamageOrRaw, skillDealtContext,
} from './damageDealt';
import { ONESHOT_DAMAGE_DURATION, pruneSpentModifiers } from './damageLedgerRun';
import { resolveDamageTaken } from './damageTaken';
import { DAMAGE_DEALT_OCCASIONS, type DamageDealtOccasion, type StatModifier } from './statModifiers';
import type { DamageDealtOccasionType } from '../data/generals';
import type { EngineState, EnginePlayer } from './GameState';
import { deriveDuelFlow } from './eventProcessors/duelEvents';

/**
 * 两张清单必须是同一个集合：核心那一份是运行时真值表（编译器按它逐字校验 localStorage／
 * Excel 里读出来的字符串），数据层那一份是录入面的类型。这里钉的是**双向可赋值**——
 * 任何一边多一枚少一枚都编译不过（`npm run check` 那一闸），零运行时成本。
 */
type SameSet<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _occasionListsAgree: SameSet<DamageDealtOccasionType, DamageDealtOccasion> = true;
void _occasionListsAgree;

const ATTACKER = { playerId: 1, generalId: 'gA' };
const VICTIM = { playerId: 2, generalId: 'gB' };

function dealt(partial: Partial<StatModifier> & Pick<StatModifier, 'id' | 'seq'>): StatModifier {
  return {
    key: 'DAMAGE_DEALT', mode: 'delta', value: 1,
    targetPlayerId: ATTACKER.playerId, targetId: ATTACKER.generalId,
    ownerPlayerId: ATTACKER.playerId, ownerGeneralId: ATTACKER.generalId,
    ownerSkillId: 'gA:怒斩:e1', locked: false, passive: true,
    ...partial,
  } as StatModifier;
}

const MELEE_VS_ARMOR = attackDealtContext(false, 1);
const MELEE_VS_NO_ARMOR = attackDealtContext(false, 0);
const RANGED = attackDealtContext(true, 3);
const DUEL = duelDealtContext(0);
const SKILL = skillDealtContext(4);

describe('造成伤害那一格 · 读数', () => {
  it('场合清单＝两枚封闭枚举（绝不接任意谓词），且数值与卡面原文逐字对得上', () => {
    expect([...DAMAGE_DEALT_OCCASIONS].sort()).toEqual(['duel', 'meleeVsArmored']);
    expect(occasionHolds('duel', DUEL)).toBe(true);
    expect(occasionHolds('duel', MELEE_VS_ARMOR)).toBe(false);
    expect(occasionHolds('meleeVsArmored', MELEE_VS_ARMOR)).toBe(true);
    // 护甲「≥1 即算」是用户 2026-10-08 裁的：0 就不算，2 也算——比的是有没有，不是多少。
    expect(occasionHolds('meleeVsArmored', MELEE_VS_NO_ARMOR)).toBe(false);
    expect(occasionHolds('meleeVsArmored', attackDealtContext(false, 2))).toBe(true);
    // 「决斗不算近战攻击」的落点就在决斗上下文那一格：近战位恒 false，护甲再多也不吃。
    expect(occasionHolds('meleeVsArmored', { inDuel: true, meleeAttack: false, targetArmor: 5 })).toBe(false);
    expect(occasionHolds('meleeVsArmored', RANGED)).toBe(false);
    expect(occasionHolds('meleeVsArmored', SKILL)).toBe(false);
  });

  it('空账本＝恒等：原始伤害原样交出去，消费清单为空（两锚不换名的结构保证）', () => {
    expect(resolveDamageDealt(undefined, ATTACKER, 3, MELEE_VS_ARMOR)).toEqual({ damage: 3, consumedIds: [] });
    expect(resolveDamageDealt([], ATTACKER, 3, MELEE_VS_ARMOR)).toEqual({ damage: 3, consumedIds: [] });
  });

  it('增减按发动先后累加，而且伤害不是负数：−5 遇 2 点⇒0，绝不是 −3', () => {
    const ledger = [dealt({ id: 'sm:1', seq: 1, value: 1 }), dealt({ id: 'sm:2', seq: 2, value: 2 })];
    expect(resolveDamageDealt(ledger, ATTACKER, 1, MELEE_VS_ARMOR)).toEqual({ damage: 4, consumedIds: [] });
    expect(resolveDamageDealt([dealt({ id: 'sm:1', seq: 1, value: -5 })], ATTACKER, 2, MELEE_VS_ARMOR).damage).toBe(0);
  });

  it('怒斩的两条腿各给一次 +1，而结构上永远不会同时成立⇒封顶 +1，不需要任何钳制', () => {
    const both = [
      dealt({ id: 'sm:1', seq: 1, occasion: 'duel' }),
      dealt({ id: 'sm:2', seq: 2, occasion: 'meleeVsArmored' }),
    ];
    expect(resolveDamageDealt(both, ATTACKER, 2, DUEL)).toEqual({ damage: 3, consumedIds: [] });
    expect(resolveDamageDealt(both, ATTACKER, 2, MELEE_VS_ARMOR)).toEqual({ damage: 3, consumedIds: [] });
    // 两条腿都不认的时刻：一笔都不算。
    expect(resolveDamageDealt(both, ATTACKER, 2, RANGED)).toEqual({ damage: 2, consumedIds: [] });
    expect(resolveDamageDealt(both, ATTACKER, 2, SKILL)).toEqual({ damage: 2, consumedIds: [] });
    expect(resolveDamageDealt(both, ATTACKER, 2, MELEE_VS_NO_ARMOR)).toEqual({ damage: 2, consumedIds: [] });
  });

  it('不带场合的笔＝不分场合，哪一路都算（这是缺省，不是"没填所以不生效"）', () => {
    const ledger = [dealt({ id: 'sm:1', seq: 1 })];
    for (const ctx of [DUEL, MELEE_VS_ARMOR, MELEE_VS_NO_ARMOR, RANGED, SKILL]) {
      expect(resolveDamageDealt(ledger, ATTACKER, 2, ctx).damage).toBe(3);
    }
  });

  it('场合是逐笔筛的：筛掉的笔不进加法，也不参与固定争先', () => {
    const ledger = [
      dealt({ id: 'sm:1', seq: 1, mode: 'set', value: 9, occasion: 'duel' }),
      dealt({ id: 'sm:2', seq: 2, value: 1 }),
    ];
    // 决斗：那笔固定赢⇒9。普攻：固定笔压根没进筛选⇒只剩 +1。
    expect(resolveDamageDealt(ledger, ATTACKER, 2, DUEL).damage).toBe(9);
    expect(resolveDamageDealt(ledger, ATTACKER, 2, MELEE_VS_ARMOR).damage).toBe(3);
  });

  it('固定压过增减，同侧两笔固定打架＝后发的赢（比 seq，不比数组位置）', () => {
    const ledger = [
      dealt({ id: 'sm:1', seq: 1, value: 3 }),
      dealt({ id: 'sm:2', seq: 2, mode: 'set', value: 4 }),
      dealt({ id: 'sm:3', seq: 3, mode: 'set', value: 1 }),
    ];
    expect(resolveDamageDealt(ledger, ATTACKER, 6, MELEE_VS_ARMOR).damage).toBe(1);
    expect(resolveDamageDealt([...ledger].reverse(), ATTACKER, 6, MELEE_VS_ARMOR).damage).toBe(1);
  });

  it('一次性账在造方这一格同样"读到才销"：这一刀用掉，下一刀照旧', () => {
    const ledger = [dealt({ id: 'sm:1', seq: 1, expire: ONESHOT_DAMAGE_DURATION })];
    const first = resolveDamageDealt(ledger, ATTACKER, 2, MELEE_VS_ARMOR);
    expect(first).toEqual({ damage: 3, consumedIds: ['sm:1'] });
    const after = pruneSpentModifiers(ledger, first.consumedIds);
    expect(resolveDamageDealt(after, ATTACKER, 2, MELEE_VS_ARMOR)).toEqual({ damage: 2, consumedIds: [] });
  });

  it('被固定压住的那笔一次性账不算被用掉——账一直在、只是不被读', () => {
    const ledger = [
      dealt({ id: 'sm:1', seq: 1, expire: ONESHOT_DAMAGE_DURATION }),
      dealt({ id: 'sm:2', seq: 2, mode: 'set', value: 3 }),
    ];
    const read = resolveDamageDealt(ledger, ATTACKER, 5, MELEE_VS_ARMOR);
    expect(read).toEqual({ damage: 3, consumedIds: [] });
    expect(pruneSpentModifiers(ledger, read.consumedIds)).toEqual(ledger);
  });

  it('场合不成立的账，即便是一次性的也不被销（没读到＝没用到）', () => {
    const ledger = [dealt({ id: 'sm:1', seq: 1, expire: ONESHOT_DAMAGE_DURATION, occasion: 'duel' })];
    expect(resolveDamageDealt(ledger, ATTACKER, 2, MELEE_VS_ARMOR)).toEqual({ damage: 2, consumedIds: [] });
  });

  it('串键一律不读：账本上「近战攻击力」那笔加不进造成伤害那一格', () => {
    const ledger = [dealt({ id: 'sm:1', seq: 1, value: 5, key: 'MELEE_ATK' })];
    expect(resolveDamageDealt(ledger, ATTACKER, 2, MELEE_VS_ARMOR)).toEqual({ damage: 2, consumedIds: [] });
  });

  it('读的是**打出去的那一员将**身上的账：同一席位另一员、以及受方那一员的都不算', () => {
    const ledger = [dealt({ id: 'sm:1', seq: 1, value: 1 })];
    expect(resolveDamageDealt(ledger, { playerId: 1, generalId: 'gZ' }, 2, MELEE_VS_ARMOR).damage).toBe(2);
    expect(resolveDamageDealt(ledger, { playerId: 2, generalId: 'gA' }, 2, MELEE_VS_ARMOR).damage).toBe(2);
    expect(resolveDamageDealt(ledger, ATTACKER, 2, MELEE_VS_ARMOR).damage).toBe(3);
  });
});

describe('造成伤害 · 与受方那一格的先后（跨侧固定赢家＝受方）', () => {
  it('+1 落在**进护甲之前**那一格：造方先、受方后，两道过完才交给护甲出口', () => {
    const dealtLedger = [dealt({ id: 'sm:1', seq: 1, value: 1 })];
    const takenLedger = [
      dealt({ id: 'sm:2', seq: 2, key: 'DAMAGE_TAKEN', value: -1, targetPlayerId: VICTIM.playerId, targetId: VICTIM.generalId, ownerPlayerId: VICTIM.playerId, ownerGeneralId: VICTIM.generalId }),
    ];
    const ledger = [...dealtLedger, ...takenLedger];
    const first = resolveDamageDealt(ledger, ATTACKER, 3, MELEE_VS_ARMOR);
    const second = resolveDamageTaken(ledger, VICTIM, first.damage);
    expect(first.damage).toBe(4);
    expect(second.damage).toBe(3);
  });

  it('造方"固定为 9"压不过受方"固定为 1"——赢家是受方，靠的是入算次序而不是任何一次判断', () => {
    const ledger = [
      dealt({ id: 'sm:1', seq: 1, mode: 'set', value: 9 }),
      dealt({ id: 'sm:2', seq: 2, key: 'DAMAGE_TAKEN', mode: 'set', value: 1, targetPlayerId: VICTIM.playerId, targetId: VICTIM.generalId, ownerPlayerId: VICTIM.playerId, ownerGeneralId: VICTIM.generalId }),
    ];
    const dealtRead = resolveDamageDealt(ledger, ATTACKER, 4, MELEE_VS_ARMOR);
    expect(dealtRead.damage).toBe(9);
    expect(resolveDamageTaken(ledger, VICTIM, dealtRead.damage).damage).toBe(1);
  });
  it('同一副账换个写法（数组位置与生效编号一起反向）⇒赢家仍由入算次序兑出', () => {
    const ledger = [
      dealt({ id: 'sm:2', seq: 1, key: 'DAMAGE_TAKEN', mode: 'set', value: 1, targetPlayerId: VICTIM.playerId, targetId: VICTIM.generalId, ownerPlayerId: VICTIM.playerId, ownerGeneralId: VICTIM.generalId }),
      dealt({ id: 'sm:1', seq: 2, mode: 'set', value: 9 }),
    ];
    const dealtRead = resolveDamageDealt(ledger, ATTACKER, 4, MELEE_VS_ARMOR);
    expect(dealtRead.damage).toBe(9);
    expect(resolveDamageTaken(ledger, VICTIM, dealtRead.damage).damage).toBe(1);
  });
});

describe('造成伤害 · 来源解不出＝结构上没有这一格', () => {
  it('没有攻方键（不是某一员将打出去的伤害）⇒ 返回 null，调用点原样往下走', () => {
    const ledger = [dealt({ id: 'sm:1', seq: 1 })];
    expect(resolveDamageDealtFromSource(ledger, undefined, 3, SKILL)).toBeNull();
    expect(resolveDamageDealtFromSource(ledger, { sourceGeneralId: null }, 3, SKILL)).toBeNull();
    expect(resolveDamageDealtFromSource(ledger, { sourceGeneralId: 'gA' }, 3, SKILL)).toBeNull();
    expect(resolveDamageDealtFromSource(ledger, { sourcePlayerId: 1 }, 3, SKILL)).toBeNull();
    expect(resolveDamageDealtFromSource(ledger, { sourcePlayerId: 1, sourceGeneralId: 'gA' }, 3, SKILL))
      .toEqual({ damage: 4, consumedIds: [] });
  });

  it('`dealtDamageOrRaw` 那一格：解不出来源仍然把 raw 夹到 ≥0，且消费清单为空', () => {
    const ledger = [dealt({ id: 'sm:1', seq: 1, value: -3 })];
    expect(dealtDamageOrRaw(ledger, undefined, 2, SKILL)).toEqual({ damage: 2, consumedIds: [] });
    expect(dealtDamageOrRaw(ledger, undefined, -4, SKILL)).toEqual({ damage: 0, consumedIds: [] });
    // 解得出来源时它必须与纯函数逐字同答案——结算侧与派生侧复核销账用的就是这一句。
    expect(dealtDamageOrRaw(ledger, { sourcePlayerId: 1, sourceGeneralId: 'gA' }, 2, SKILL))
      .toEqual(resolveDamageDealt(ledger, ATTACKER, 2, SKILL));
  });
});

describe('决斗逐轮 · 造方那一格每轮各读一次（用户 2026-10-14「决斗的每一轮都算」）', () => {
  /** 受方（受邀者 gB）身上的账不影响这一档；这里的账一律种在**攻方 gA** 身上。 */
  function duelWithLedger(ledger: StatModifier[]) {
    const general = (id: string, ownerId: number) => ({
      general: {
        id, name: '决斗将' + id, faction: '魏', hp: 10, type: '武将',
        meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [],
      },
      currentHp: 10, maxHp: 10, meleeAtk: 2, rangedAtk: 1,
      armor: 0, currentArmor: 0, armorCards: [], ownerId,
      position: { zone: 'front', slot: 0, areaOwnerId: ownerId },
    });
    const player = (id: number, fg: unknown): EnginePlayer => ({
      id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [fg],
      graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
    } as EnginePlayer);
    const state = {
      version: 1, phase: 'playing', timelinePhase: 'ACTION',
      players: [player(1, general('gA', 1)), player(2, general('gB', 2))],
      currentPlayerId: 1, turn: 3, round: 1, deck: [], discardPile: [], drawState: null,
      statModifiers: ledger,
    } as unknown as EngineState;
    const events = deriveDuelFlow(state, {
      type: 'DUEL',
      data: {
        sourcePlayerId: 1, sourceGeneralId: 'gA', targetPlayerId: 2, targetId: 'gB',
        skillId: 'gA:搦战:e1', damageType: 'skill',
      },
    });
    const rounds = events.filter(e => e.type === 'DAMAGE');
    return {
      taken: rounds.map(e => (e.data as { damageTaken?: number }).damageTaken),
      removes: events.filter(e => e.type === 'STAT_MODIFY'),
      injuries: events.filter(e => e.type === 'INJURY'),
    };
  }

  it('吃决斗那条腿＝gA 打出去的每一轮（第 1、3、5 轮）都 +1，gB 还手的那几轮不受影响', () => {
    const one = duelWithLedger([
      dealt({ id: 'sm:1', seq: 1, occasion: 'duel', targetId: 'gA' }),
    ]);
    expect(one.taken).toEqual([3, 2, 3, 2, 3, 2]);
    expect(one.removes).toHaveLength(0);
    // 收官按角色累计＝这一场真掉掉的体力之和（9＝3+3+3）。
    expect(one.injuries.map(e => [
      (e.data as { targetId?: string }).targetId,
      (e.data as { value?: number }).value,
    ])).toEqual([['gB', 9], ['gA', 6]]);
  });

  it('近战那条腿在决斗里一律不算（决斗不算近战攻击⇒不会 +2）', () => {
    const leg = duelWithLedger([
      dealt({ id: 'sm:1', seq: 1, occasion: 'meleeVsArmored', targetId: 'gA' }),
    ]);
    expect(leg.taken).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('一次性 +1 在决斗里只算一轮（与受方那一格同一条口径），销账令注明 cause＝DAMAGE_DEALT', () => {
    const once = duelWithLedger([
      dealt({ id: 'sm:1', seq: 1, expire: ONESHOT_DAMAGE_DURATION, targetId: 'gA' }),
    ]);
    expect(once.taken).toEqual([3, 2, 2, 2, 2, 2]);
    expect(once.removes).toHaveLength(1);
    expect(once.removes[0].data).toMatchObject({ op: 'REMOVE', ids: ['sm:1'], cause: 'DAMAGE_DEALT' });
  });

  it('决斗里两侧「固定」同场相撞＝每一轮都是造方先、受方后（受方盖过造方）', () => {
    // 决斗是唯一"两侧每轮都在同一次结算里相撞"的路：gA 打出去的三轮里，造方固定为 9 必须被
    // gB 身上那笔受方固定为 1 盖掉；gB 还手的三轮里 gA 没人护着，照卡面 2 点。
    const ledger = [
      dealt({ id: 'sm:1', seq: 1, mode: 'set', value: 9, targetId: 'gA', ownerGeneralId: 'gA', ownerPlayerId: 1 }),
      dealt({ id: 'sm:2', seq: 2, key: 'DAMAGE_TAKEN', mode: 'set', value: 1, targetPlayerId: 2, targetId: 'gB', ownerPlayerId: 2, ownerGeneralId: 'gB' }),
    ];
    const cross = duelWithLedger(ledger);
    expect(cross.taken).toEqual([1, 2, 1, 2, 1, 2]);
    // 两笔在数组里倒过来写、生效编号也倒过来：读数一字不变⇒赢家不是书写顺序给的。
    const reversed = duelWithLedger([ledger[1], ledger[0]]);
    expect(reversed.taken).toEqual([1, 2, 1, 2, 1, 2]);
    // 收官按角色累计＝真掉掉的体力之和（受方那一笔把三轮摁成 3 点）。
    expect(cross.injuries.map(e => [
      (e.data as { targetId?: string }).targetId,
      (e.data as { value?: number }).value,
    ])).toEqual([['gB', 3], ['gA', 6]]);
  });

  it('没有账时决斗逐轮逐字不变：值＝原始伤害、零条销账令（两锚逐字的结构保证）', () => {
    const plain = duelWithLedger([]);
    expect(plain.taken).toEqual([2, 2, 2, 2, 2, 2]);
    expect(plain.removes).toHaveLength(0);
    expect(plain.injuries.map(e => [
      (e.data as { targetId?: string }).targetId,
      (e.data as { value?: number }).value,
    ])).toEqual([['gB', 6], ['gA', 6]]);
  });
});
