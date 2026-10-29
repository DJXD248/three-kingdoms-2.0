/**
 * 视角轴证人（v2.9.25 联机切片②）。
 *
 * 这一刀不改变任何人看得见的画面：它只是把「哪一席画在下面」从「现在轮到谁动手」里
 * 摘出来。所以证人的重点不是"新行为对不对"，而是**旧行为一字没动**，外加"两根轴真的
 * 能分开"。三件事各有一组钉子：
 *
 *  ① **逐格对照拆轴前那段 `arrange()`**：2／3／4 人桌 × 每一个行动格，期望是把老写法
 *     在测试里照抄一遍算出来的（不是从新函数反推的），新函数必须逐格等于它。
 *  ② **两轴分家**：同一张 2 人桌，房主视角与客人视角正好上下相反；4 人桌视角转到别席时，
 *     其余三席跟着**视角**往后排、不跟着行动席排。
 *  ③ **指不到就退回**：客人还没收到席位表那一刻屏幕照样画得出牌桌，绝不崩在越界下标上。
 */
import { describe, expect, it } from 'vitest';
import { placeSeats, resolveViewIndex, type PlacedSeat } from './seatLayout';
import type { Player } from '../../store/gameStore';

function seat(id: number, isAlive = true): Player {
  return { id, name: `玩家${id}`, isAlive } as Player;
}
function table(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => seat(i + 1));
}
/** 摊好的座次压成 `{ bottom: 席位号, ... }`，好逐格比。 */
function byPos(placed: PlacedSeat<Player>[]): Record<string, number> {
  return Object.fromEntries(placed.map((p) => [p.pos, p.player.id]));
}

/** 拆轴前那段 `arrange()` 的摊法：下面＝行动那一席，其余按席位顺序往后转。 */
const OLD_LAYOUT: Record<number, ('bottom' | 'top' | 'left' | 'right')[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
};

describe('seatLayout：没人指定视角时＝拆轴前的画面（逐格对照）', () => {
  for (const n of [2, 3, 4]) {
    for (let activeIndex = 0; activeIndex < n; activeIndex += 1) {
      it(`${n} 人桌·动手在第 ${activeIndex + 1} 格 ⇒ 四格座次与老写法完全相同`, () => {
        const players = table(n);
        const expected: Record<string, number> = {};
        OLD_LAYOUT[n].forEach((pos, offset) => {
          expected[pos] = players[(activeIndex + offset) % n].id;
        });
        expect(byPos(placeSeats(players, resolveViewIndex(players, activeIndex, null)))).toEqual(expected);
      });
    }
  }

  it('`viewSeat` 与"动手那一格"给的是同一个席位 ⇒ 得到的画面与不传一字不差', () => {
    for (const n of [2, 3, 4]) {
      for (let activeIndex = 0; activeIndex < n; activeIndex += 1) {
        const players = table(n);
        const actingSeatId = players[activeIndex].id;
        expect(placeSeats(players, resolveViewIndex(players, activeIndex, actingSeatId)))
          .toEqual(placeSeats(players, resolveViewIndex(players, activeIndex, null)));
      }
    }
  });
});

describe('seatLayout：视角轴与动手轴真的分得开', () => {
  it('2 人桌·此刻轮到第 2 席：房主（坐第 1 席）与客人（坐第 2 席）看到的上下正好相反', () => {
    const players = table(2);
    // 动手轴那个下标（1＝第 2 席）两人是同一个：牌桌真相只有一份，谁在动手也是同一个答案。
    expect(byPos(placeSeats(players, resolveViewIndex(players, 1, 1)))).toEqual({ bottom: 1, top: 2 });
    expect(byPos(placeSeats(players, resolveViewIndex(players, 1, 2)))).toEqual({ bottom: 2, top: 1 });
  });

  it('4 人桌·视角转到第 3 席 ⇒ 左／上／右跟着视角往后排，不跟着动手那一席排', () => {
    const players = table(4);
    // 动手还在第 1 席（activeIndex=0），视角要第 3 席在下：
    // 老写法会把第 1 席放下面（bottom:1,left:2,top:3,right:4）——这里必须不是那个形状。
    expect(byPos(placeSeats(players, resolveViewIndex(players, 0, 3)))).toEqual({ bottom: 3, left: 4, top: 1, right: 2 });
    expect(byPos(placeSeats(players, resolveViewIndex(players, 0, null)))).toEqual({ bottom: 1, left: 2, top: 3, right: 4 });
  });

  it('席位号按玩家 id 找、不按位置算 ⇒ 跳号的桌子也不摆错', () => {
    const players = [seat(3), seat(7), seat(11)];
    expect(resolveViewIndex(players, 0, 7)).toBe(1);
    expect(byPos(placeSeats(players, resolveViewIndex(players, 0, 7)))).toEqual({ bottom: 7, left: 11, right: 3 });
  });
});

describe('seatLayout：指不到那一席就退回动手那一格（绝不画崩）', () => {
  const players = table(2);

  it('还没收到席位表／席位号是编的／不是整数 ⇒ 一律退回行动那一格', () => {
    for (const bogus of [null, undefined, 0, -1, 99, NaN, 1.5, '1' as unknown as number]) {
      expect(resolveViewIndex(players, 1, bogus), `viewSeat=${String(bogus)}`).toBe(1);
    }
  });

  it('拆轴前那句「找个还没阵亡的」兜底还在位（越界下标也不会端出 undefined）', () => {
    const mixed = [seat(1, false), seat(2), seat(3)];
    expect(placeSeats(mixed, 7).map((p) => p.player.id)).toEqual([2, 3, 1]);
  });

  it('人数不在 2/3/4 之列 ⇒ 与拆轴前一样返回空表（这一条只钉"没顺手改坏"）', () => {
    expect(placeSeats(table(5), 0)).toEqual([]);
    expect(placeSeats([], 0)).toEqual([]);
  });
});
