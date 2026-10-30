/**
 * 联机切片⑤·腿1（㈢ 演出刀，v2.9.25）判据层的证人。
 *
 * 这一层只回答两句话：「开局走到第几步」与「那一步的数定下来没有」。证人因此全部对着
 * 那两句话的**边界**打：认不出来的阶段名不许猜、没掷出的那颗不许读成"掷出了 0 点"、
 * 座次序那个真的 0 不许读成"还没定"、以及这张表只许读那五个公开字段（别人那几席的牌
 * 在这格里没有落点＝不是"我们选择遮掉"，是"我们压根没去拿"）。
 */
import { describe, expect, it } from 'vitest';
import {
  diceAllSettled,
  factionsAllAssigned,
  openingOf,
  setupStepOf,
  type NetOpeningRow,
} from './netSetupSteps';

const row = (over: Partial<NetOpeningRow> = {}): NetOpeningRow => ({
  seat: 1,
  name: '甲',
  roll: 7,
  faction: '蜀',
  seatOrder: 0,
  ...over,
});

describe('㈢ 第几步：只认那些真的属于开局那一段的阶段名', () => {
  it('四段各有自己的读数：掷骰→分势力→各家征召→已进牌桌', () => {
    expect(setupStepOf('diceRoll')).toBe('dice');
    expect(setupStepOf('factionAssign')).toBe('faction');
    expect(setupStepOf('generalDraft')).toBe('draft');
    expect(setupStepOf('drawing')).toBe('play');
    expect(setupStepOf('playing')).toBe('play');
    expect(setupStepOf('gameOver')).toBe('play');
  });

  it('认不出来的值一律"这一段现在没话要说"，不往任何一档上靠', () => {
    for (const phase of ['menu', 'lobby', 'codex', 'settings', 'rules', 'testArena', 'turn', 'totally-new']) {
      expect(setupStepOf(phase)).toBe('none');
    }
    // 线上那个 phase 是个自由字符串：非字符串（含 undefined／null）也不许把它读成一档。
    expect(setupStepOf(undefined)).toBe('none');
    expect(setupStepOf(null)).toBe('none');
    expect(setupStepOf(7)).toBe('none');
  });

  it('那份读数的 players 不是一桌人时（含整个对象是 null）＝没话要说，而不是抛出去', () => {
    for (const state of [null, undefined, {}, { phase: 'diceRoll' }, { phase: 'diceRoll', players: 'nope' }]) {
      expect(openingOf(state)).toEqual({ step: 'none', rows: [] });
    }
  });
});

describe('㈢ 那一桌的读数：收到的才画，没收到的写"还没定"', () => {
  /** 房主开局前那一格写的是 0（runtimeSetup.ts:83），掷出来的是 1-12（:105）。 */
  it('点数为 0 读成"还没定"，绝不读成"掷出了 0 点"', () => {
    const { rows } = openingOf({ phase: 'diceRoll', players: [{ id: 1, name: '甲', diceRoll: 0 }] });
    expect(rows[0].roll).toBeNull();
    expect(diceAllSettled(rows)).toBe(false);
  });

  it('点数是 1 与 12 都算掷定了；非数、NaN、负数、小数与字符串都不算', () => {
    for (const value of [1, 7, 12]) {
      expect(openingOf({ phase: 'diceRoll', players: [{ id: 1, diceRoll: value }] }).rows[0].roll).toBe(value);
    }
    for (const value of [NaN, -3, 2.5, '7', null, undefined, Infinity, true]) {
      expect(openingOf({ phase: 'diceRoll', players: [{ id: 1, diceRoll: value }] }).rows[0].roll).toBeNull();
    }
  });

  /** 这一层不封顶到 12：骰子有几面是房主那台机器的规则，写死的话换一面骰子就把真读数读成"还没定"，
   *  那是另一种假话。这里钉住"大数照画"，防止将来有人顺手加一道看起来更严的闸。 */
  it('20 点照画：点数判据只管"掷过没有"，不管骰子有几面', () => {
    expect(openingOf({ phase: 'diceRoll', players: [{ id: 1, diceRoll: 20 }] }).rows[0].roll).toBe(20);
  });

  it('座次第 0 位是一个真读数（0＝先坐），不许和"这一格没带上来"混成一句', () => {
    const settled = openingOf({ phase: 'factionAssign', players: [{ id: 1, seatOrder: 0 }] });
    expect(settled.rows[0].seatOrder).toBe(0);
    for (const value of [-1, 0.5, null, undefined, '0']) {
      expect(openingOf({ phase: 'factionAssign', players: [{ id: 1, seatOrder: value }] }).rows[0].seatOrder).toBeNull();
    }
  });

  it('势力：空串读成"还没定"（分势力那一步之前 store 里就是空的）', () => {
    expect(openingOf({ phase: 'diceRoll', players: [{ id: 1, faction: '' }] }).rows[0].faction).toBeNull();
    expect(openingOf({ phase: 'factionAssign', players: [{ id: 1, faction: '魏' }] }).rows[0].faction).toBe('魏');
  });

  it('逐席读数按席位号从小到大排，与席位表／征召进度表同一把尺', () => {
    const { rows } = openingOf({
      phase: 'diceRoll',
      players: [{ id: 3, name: '丙' }, { id: 1, name: '甲' }, { id: 2, name: '乙' }],
    });
    expect(rows.map((r) => `${r.seat}:${r.name}`)).toEqual(['1:甲', '2:乙', '3:丙']);
  });

  it('没有席位号的成员不进这张表（画出来就是一个对不上任何一席的假座次）', () => {
    const { rows } = openingOf({ phase: 'diceRoll', players: [{ name: '没有号' }, { id: 2, name: '乙' }, null] });
    expect(rows.map((r) => r.seat)).toEqual([2]);
  });

  it('这张表只读那五个公开字段：别人那几席的牌不是被遮掉，是压根没去拿', () => {
    const { rows } = openingOf({
      phase: 'generalDraft',
      players: [
        {
          id: 1, name: '甲', diceRoll: 9, faction: '蜀', seatOrder: 0,
          hand: [{ id: 'p1-hand-SECRET' }],
          generalPool: [{ id: 'pool-SECRET' }],
          draftGenerals: [{ id: 'draft-SECRET' }],
          avatarGeneral: { id: 'avatar-SECRET' },
        },
      ],
    });
    expect(Object.keys(rows[0]).sort()).toEqual(['faction', 'name', 'roll', 'seat', 'seatOrder']);
    expect(JSON.stringify({ rows })).not.toMatch(/SECRET/);
  });
});

describe('㈢ 那两句"定下来了"的判据：空桌一律算还没定', () => {
  it('一席没点到 ⇒ 骰子那句不能说"停下"；一席没势力 ⇒ 势力那句不能说"分完"', () => {
    expect(diceAllSettled([row(), row({ seat: 2, roll: null })])).toBe(false);
    expect(diceAllSettled([row(), row({ seat: 2 })])).toBe(true);
    expect(factionsAllAssigned([row(), row({ seat: 2, faction: null })])).toBe(false);
    expect(factionsAllAssigned([row(), row({ seat: 2, faction: '吴' })])).toBe(true);
  });

  /** 空桌＝一个席位也没收到（快照还没到、或那份里 players 是空的）。
   *  把它读成"全都定了"会让客人屏上一格空白配一句"骰子停下"——那是假话。 */
  it('空桌不算"全定了"', () => {
    expect(diceAllSettled([])).toBe(false);
    expect(factionsAllAssigned([])).toBe(false);
  });

  it('判据读的是传进来的那份，不改它、也不缓存上一次的结果', () => {
    const rows = [row(), row({ seat: 2, roll: null })];
    expect(diceAllSettled(rows)).toBe(false);
    const settled = rows.map((r) => ({ ...r, roll: 5 }));
    expect(diceAllSettled(settled)).toBe(true);
    expect(rows[1].roll).toBeNull();
  });
});
