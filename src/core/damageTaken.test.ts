/**
 * 受到伤害那一格的算术（2.8 刀5＝#26）·纯函数与决斗逐轮。
 *
 * 分工：`statModifiers.test.ts` 钉账本读数（哪个数字此刻是多少），`statModifierPipeline.test.ts`
 * 钉真链路（技能⇒事件⇒账本⇒下一个动作），这一档钉的是**护甲之前那一格**本身——它是三路
 * （普攻／技能伤害／决斗逐轮）唯一共用的读数函数，所以它的每一条口径都只在这里写一次。
 *
 * 口径出处：用户 2026-10-02 裁决第 4/5 条（增减与固定、固定压在护甲之前）＋ 2026-10-03
 * 重新裁定（**只有掉血才算受到伤害**；一次性"下 1 次受到伤害−1"在决斗里只算一轮，
 * 2 次算两轮）。
 */
import { describe, it, expect } from 'vitest';
import {
  ONESHOT_DAMAGE_DURATION, isOneshotModifier, pruneSpentModifiers, resolveDamageTaken,
} from './damageTaken';
import type { StatModifier } from './statModifiers';
import type { EngineState, EnginePlayer } from './GameState';
import { deriveDuelFlow } from './eventProcessors/duelEvents';

const SUBJECT = { playerId: 2, generalId: 'g2' };
const OTHER = { playerId: 2, generalId: 'g9' };

function entry(partial: Partial<StatModifier> & Pick<StatModifier, 'id' | 'seq'>): StatModifier {
  return {
    key: 'DAMAGE_TAKEN', mode: 'delta', value: -1,
    targetPlayerId: SUBJECT.playerId, targetId: SUBJECT.generalId,
    ownerPlayerId: SUBJECT.playerId, ownerGeneralId: SUBJECT.generalId,
    ownerSkillId: 'g2:磐壁:e1', locked: false, passive: true,
    ...partial,
  } as StatModifier;
}

describe('受到伤害那一格 · 读数', () => {
  it('空账本＝恒等：原始伤害原样交出去，消费清单为空（两锚不换名的结构保证）', () => {
    expect(resolveDamageTaken(undefined, SUBJECT, 3)).toEqual({ damage: 3, consumedIds: [] });
    expect(resolveDamageTaken([], SUBJECT, 3)).toEqual({ damage: 3, consumedIds: [] });
  });

  it('增减按发动先后累加，而且伤害不是负数：−5 遇 2 点⇒0，绝不是 −3', () => {
    const ledger = [
      entry({ id: 'sm:1', seq: 1, value: -1 }),
      entry({ id: 'sm:2', seq: 2, value: -2 }),
    ];
    expect(resolveDamageTaken(ledger, SUBJECT, 2)).toEqual({ damage: 0, consumedIds: [] });
  });

  it('两笔一次性增减同时在场＝一笔只挡一刀：这一刀读到 −1，下一刀才轮到第二笔', () => {
    const ledger = [
      entry({ id: 'sm:1', seq: 1, value: -1, expire: ONESHOT_DAMAGE_DURATION }),
      entry({ id: 'sm:2', seq: 2, value: -1, expire: ONESHOT_DAMAGE_DURATION }),
    ];
    const first = resolveDamageTaken(ledger, SUBJECT, 3);
    expect(first).toEqual({ damage: 2, consumedIds: ['sm:1'] });
    const after = pruneSpentModifiers(ledger, first.consumedIds);
    expect(resolveDamageTaken(after, SUBJECT, 3)).toEqual({ damage: 2, consumedIds: ['sm:2'] });
  });

  it('一次性与持续混着读：持续的照常累加，一性的那笔单独排队等自己被消费', () => {
    const ledger = [
      entry({ id: 'sm:1', seq: 1, value: -1 }),
      entry({ id: 'sm:2', seq: 2, value: -1, expire: ONESHOT_DAMAGE_DURATION }),
    ];
    expect(resolveDamageTaken(ledger, SUBJECT, 4)).toEqual({ damage: 2, consumedIds: ['sm:2'] });
  });

  it('固定压在护甲之前：「受到的伤害固定为 1」⇒交出去的就是 1，护甲那一边一个字都不改', () => {
    expect(resolveDamageTaken([entry({ id: 'sm:1', seq: 1, mode: 'set', value: 1 })], SUBJECT, 7))
      .toEqual({ damage: 1, consumedIds: [] });
  });

  it('固定生效期间增减一律不被读（同侧两笔固定打架＝后发的赢，比的是 seq）', () => {
    const ledger = [
      entry({ id: 'sm:1', seq: 1, mode: 'delta', value: -3 }),
      entry({ id: 'sm:2', seq: 2, mode: 'set', value: 4 }),
      entry({ id: 'sm:3', seq: 3, mode: 'set', value: 1 }),
    ];
    expect(resolveDamageTaken(ledger, SUBJECT, 6).damage).toBe(1);
  });

  it('赢家只认 seq、不认数组位置：同一对固定倒着放，读出来仍是后发那笔', () => {
    const ascendant = [
      entry({ id: 'sm:2', seq: 2, mode: 'set', value: 4 }),
      entry({ id: 'sm:3', seq: 3, mode: 'set', value: 1 }),
    ];
    // 上一例两笔恰好按 seq 升序入数组＝顺序与位置同向，分不清比的到底是哪个。
    // 这里把位置倒过来：赢家若跟着数组走就会读成 4。
    expect(resolveDamageTaken(ascendant, SUBJECT, 6).damage).toBe(1);
    expect(resolveDamageTaken([...ascendant].reverse(), SUBJECT, 6).damage).toBe(1);
  });

  it('串键一律不读：账本上「近战攻击力」那笔固定压不住受到的伤害', () => {
    const ledger = [entry({ id: 'sm:1', seq: 1, mode: 'set', value: 0, key: 'MELEE_ATK' })];
    expect(resolveDamageTaken(ledger, SUBJECT, 2)).toEqual({ damage: 2, consumedIds: [] });
  });

  it('只读落在这一员将身上的账：同一席位另一员的固定笔不相干', () => {
    const ledger = [entry({ id: 'sm:1', seq: 1, mode: 'set', value: 0 })];
    expect(resolveDamageTaken(ledger, OTHER, 2).damage).toBe(2);
    expect(resolveDamageTaken(ledger, SUBJECT, 2).damage).toBe(0);
  });
});

describe('受到伤害那一格 · 一次性账的消费清单', () => {
  it('一次性＝expire 那一档，不跟回合边界走；其余档都不算一次性', () => {
    expect(isOneshotModifier(entry({ id: 'sm:1', seq: 1, expire: ONESHOT_DAMAGE_DURATION }))).toBe(true);
    expect(isOneshotModifier(entry({ id: 'sm:2', seq: 2, expire: 'untilSelfTurnEnd' }))).toBe(false);
    expect(isOneshotModifier(entry({ id: 'sm:3', seq: 3 }))).toBe(false);
  });

  it('被固定压住的那笔一次性账不算被用掉——账一直在、只是不被读', () => {
    const ledger = [
      entry({ id: 'sm:1', seq: 1, value: -1, expire: ONESHOT_DAMAGE_DURATION }),
      // 固定压着它⇒这一刀的数字里压根没有 −1 的事，所以那一笔一次性账**不销**。
      entry({ id: 'sm:2', seq: 2, mode: 'set', value: 3 }),
      entry({ id: 'sm:3', seq: 3, value: -1, expire: ONESHOT_DAMAGE_DURATION }),
    ];
    const read = resolveDamageTaken(ledger, SUBJECT, 5);
    expect(read).toEqual({ damage: 3, consumedIds: [] });
    expect(pruneSpentModifiers(ledger, read.consumedIds)).toEqual(ledger);
  });

  it('固定那笔自己也可以是一次性的：用掉就销，销完增减恢复参与', () => {
    const once = entry({ id: 'sm:1', seq: 1, mode: 'set', value: 1, expire: ONESHOT_DAMAGE_DURATION });
    const steady = entry({ id: 'sm:2', seq: 2, value: -1 });
    expect(resolveDamageTaken([once, steady], SUBJECT, 4)).toEqual({ damage: 1, consumedIds: ['sm:1'] });
    const after = pruneSpentModifiers([once, steady], ['sm:1']);
    expect(resolveDamageTaken(after, SUBJECT, 4).damage).toBe(3);
  });

  it('销账不看 locked：用掉不是"别人无效化你这笔账"，锁定技的一次性账照样被自己消费掉', () => {
    const lockedOnce = entry({ id: 'sm:1', seq: 1, value: -1, expire: ONESHOT_DAMAGE_DURATION, locked: true });
    expect(resolveDamageTaken([lockedOnce], SUBJECT, 3).consumedIds).toEqual(['sm:1']);
    expect(pruneSpentModifiers([lockedOnce], ['sm:1'])).toHaveLength(0);
  });

  it('消费清单为空⇒账本逐字不变（不制造第二次写账）', () => {
    const ledger = [entry({ id: 'sm:1', seq: 1 })];
    expect(pruneSpentModifiers(ledger, [])).toEqual(ledger);
  });
});

describe('决斗逐轮 · 一次性账每轮各用一笔（用户 2026-10-03 裁决 7）', () => {
  /** 受方（受邀者）身上种几笔一次性 −1，看逐轮那一格读到的数怎么变。 */
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
      events,
      taken: rounds.map(e => (e.data as { damageTaken?: number }).damageTaken),
      removes: events.filter(e => e.type === 'STAT_MODIFY'),
      injuries: events.filter(e => e.type === 'INJURY'),
    };
  }

  it('一笔一次性＝只挡第一轮，后面几轮读的是销过的那本账', () => {
    const one = duelWithLedger([
      entry({ id: 'sm:1', seq: 1, value: -1, expire: ONESHOT_DAMAGE_DURATION, targetId: 'gB' }),
    ]);
    // 受邀者 gB 在第 1、3、5 轮挨打：第一轮被那笔账挡掉 1 点，之后照旧 2 点。
    expect(one.taken.slice(0, 3)).toEqual([1, 2, 2]);
    expect(one.removes).toHaveLength(1);
    expect(one.removes[0].data).toMatchObject({ op: 'REMOVE', ids: ['sm:1'], cause: 'DAMAGE_TAKEN' });
  });

  it('两笔一次性＝算两轮（第三轮起这一格才恢复原值），每一轮各留一条销账留痕', () => {
    const two = duelWithLedger([
      entry({ id: 'sm:1', seq: 1, value: -1, expire: ONESHOT_DAMAGE_DURATION, targetId: 'gB' }),
      entry({ id: 'sm:2', seq: 2, value: -1, expire: ONESHOT_DAMAGE_DURATION, targetId: 'gB' }),
    ]);
    expect(two.taken.slice(0, 5)).toEqual([1, 2, 1, 2, 2]);
    expect(two.removes.map(e => (e.data as { ids?: string[] }).ids)).toEqual([['sm:1'], ['sm:2']]);
  });

  it('没有一次性账时决斗逐轮逐字不变：值＝原始伤害、零条销账令', () => {
    const plain = duelWithLedger([]);
    expect(plain.taken).toEqual([2, 2, 2, 2, 2, 2]);
    expect(plain.removes).toHaveLength(0);
    // 收官＝双方各一笔累计（受邀者在前），值是这一场真掉掉的体力，不是任何单轮的数。
    expect(plain.injuries.map(e => [
      (e.data as { targetId?: string }).targetId,
      (e.data as { value?: number }).value,
    ])).toEqual([['gB', 6], ['gA', 6]]);
  });
});
