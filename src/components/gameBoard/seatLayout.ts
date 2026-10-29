/**
 * 席位摆放＝**视角轴**（v2.9.25 联机切片②）。
 *
 * `GameBoard` 原来只有一个游标：store 的 `currentPlayerIndex` 既决定**哪一席画在下面**，
 * 又决定**现在轮到谁动手**。本地热座这两件事永远重合（轮到谁，谁的营地就在下面），
 * 所以这一根耦合从没露馅。联机要的是「每个人的屏幕一直朝向自己的阵营，不跟着座次转」
 * （用户 2026-10-28 原话），于是这里把视角轴单独拿出来：
 *
 *  - **视角轴**（本文件）：哪一席在下、其余几席怎么摊开。
 *  - **动手轴**（`GameBoard` 里的 `cp`）：手牌、征召名单、能不能登场、高亮哪一席。
 *    这一根一字未动，仍然跟着 `currentPlayerIndex`。
 *
 * 摆放的**规则**与原来那段 `arrange()` 逐字相同，只是下标的来源换成了视角：
 * 2 人＝下/上；3 人＝下/左/右；4 人＝下/左/上/右（都是"从下面这一席起，按席位顺序往后转"）。
 * 所以没人指定视角时（本地热座、房主本机自己点）算出来的座次与今天一字不差
 * ——`seatLayout.test.ts` 里那条逐格对照的证人钉的就是这件事。
 *
 * 席位号与玩家的对应取自线上那一份口径（`netSeat.buildSeatMap` 拿 `Number(p.id)` 当席位号），
 * 所以这里**按 id 找、不按 `id-1` 算**：将来出现跳号的桌子也不会把营地摆错位置。
 */
import type { Player } from '../../store/gameStore';

export type SeatPosition = 'bottom' | 'top' | 'left' | 'right';
export type PlacedSeat<P> = { player: P; pos: SeatPosition };

/**
 * 视角落在哪一格。
 *
 * `viewSeat` 不给／不是整数／在这一桌上找不到 ⇒ **退回行动轴那一格**。这不是"宽容"，
 * 是这一刀的形状决定的：客人还没收到席位表那一刻，屏幕得照常画出一张牌桌（画出来的是
 * 跟着行动转的今天的画面），而不是白屏或崩在 `players[viewIndex]` 上。
 */
export function resolveViewIndex(
  players: Player[],
  activeIndex: number,
  viewSeat: number | null | undefined,
): number {
  if (typeof viewSeat !== 'number' || !Number.isInteger(viewSeat)) return activeIndex;
  const found = players.findIndex(p => Number(p.id) === viewSeat);
  return found >= 0 ? found : activeIndex;
}

/**
 * 按视角把在场各席摊到四个位置。人数不在 2/3/4 之列时返回空表——那是拆轴前就有的形状
 * （建房只给 2/3/4 三个档），这里只把它原样搬过来，不顺手改。
 */
export function placeSeats(players: Player[], viewIndex: number): PlacedSeat<Player>[] {
  const n = players.length;
  const o: PlacedSeat<Player>[] = [];
  const alive = () => players.find(p => p.isAlive !== false)!;
  const at = (i: number) => players[i] ?? alive();
  if (n === 2) {
    o.push({ player: at(viewIndex), pos: 'bottom' }, { player: at((viewIndex + 1) % n), pos: 'top' });
  } else if (n === 3) {
    o.push(
      { player: at(viewIndex), pos: 'bottom' },
      { player: at((viewIndex + 1) % n), pos: 'left' },
      { player: at((viewIndex + 2) % n), pos: 'right' },
    );
  } else if (n === 4) {
    o.push(
      { player: at(viewIndex), pos: 'bottom' },
      { player: at((viewIndex + 1) % n), pos: 'left' },
      { player: at((viewIndex + 2) % n), pos: 'top' },
      { player: at((viewIndex + 3) % n), pos: 'right' },
    );
  }
  return o;
}
