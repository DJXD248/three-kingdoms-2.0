/**
 * 视角轴接线的那颗钉子（联机切片⑤，v2.9.25）。
 *
 * 这一格只管**接线**：`App` 那条裸的 `<GameBoard />` 现在必须把「我这台机器坐第几席」递进去。
 * 两根轴各自的形状 elsewhere 已经钉死——
 *  - 不传 `viewSeat` ⇒ 本地热座那帧画面一字不差：`gameBoard/GameBoard.viewAxis.test.tsx`；
 *  - 取数本身（房主读第 1 席、客人读自己那一席、没房间＝`null`）：`network/netRoom.test.ts`。
 * 中间这道缝只有两行，历来没人管过它，于是这里按仓库既有的读源码断言法（见
 * `components/surfaceConsistency.test.tsx`）把它钉住：这条缝一旦被删或者被接错，
 * 玩家侧就又一次看不见"视角朝自己阵营"这件事，而两份测试都还是绿的。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('App 的视角轴接线：牌桌拿到的那一格来自房间这一格，不是自己排的', () => {
  const app = readSrc('src', 'App.tsx');

  it('牌桌拿到了 viewSeat，而且整个文件里没有任何一条裸的 <GameBoard />', () => {
    expect(app).toMatch(/<GameBoard viewSeat=\{viewSeat\} \/>/);
    // 裸的 `<GameBoard />`（后面直接跟 `/>`）＝这一刀要拆掉的那一形态。
    expect(app).not.toMatch(/<GameBoard\s*\/>/);
  });

  it('它的取数点是 netRoom 那一格（唯一持有者），并且跟着同一个订阅刷新', () => {
    expect(app).toMatch(/import \{ getMyNetSeat, subscribeNetRoom \} from '\.\/network\/netRoom'/);
    expect(app).toMatch(
      /useSyncExternalStore\(subscribeNetRoom, getMyNetSeat, getMyNetSeat\)/,
    );
    // 不许在 App 里再排一遍座次：客人自己排＝两边读着不同的席位看牌。
    expect(app).not.toMatch(/buildSeatMap|seatOfPeer/);
  });

  it('那个 hook 在读 phase 之后、在任何提前返回之前——钩子次序不能跟着 phase 漂', () => {
    const phaseLine = app.indexOf('const phase = useGameStore');
    const viewLine = app.indexOf('const viewSeat = useSyncExternalStore');
    const earlyReturn = app.indexOf('if (IS_AI_BATTLE_WINDOW) return');
    expect(phaseLine).toBeGreaterThan(-1);
    expect(viewLine).toBeGreaterThan(phaseLine);
    expect(earlyReturn).toBeGreaterThan(viewLine);
  });
});
