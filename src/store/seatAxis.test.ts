/**
 * 2026-11-13 同网真机卡点的回归证人：征召阶段「轮到谁」必须用挑将席，
 * 不能用出牌席。骰子会把 players 按点数重排，所以数组第 0 个不一定是房主。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeSeatForStage } from './seatAxis';

/** 骰子重排后的顺序：第 0 个是客人（id 2），第 1 个是房主（id 1）。 */
const reordered = [{ id: 2 }, { id: 1 }];

describe('阶段与席位的那根轴', () => {
  it('征召：读 draftPlayerIndex，不读 currentPlayerIndex', () => {
    expect(activeSeatForStage('generalDraft', reordered, 0, 1)).toBe(1);
    expect(activeSeatForStage('generalDraft', reordered, 0, 0)).toBe(2);
    // 出牌席换成任意值也不该改变征召的结果。
    expect(activeSeatForStage('generalDraft', reordered, 1, 1)).toBe(1);
  });

  it('抽卡／牌桌：仍读 currentPlayerIndex，行为一字不变', () => {
    expect(activeSeatForStage('drawing', reordered, 1, 0)).toBe(1);
    expect(activeSeatForStage('playing', reordered, 0, 1)).toBe(2);
  });

  it('其它界面态按出牌席；下标越界返回 null（不猜一个席位）', () => {
    expect(activeSeatForStage('menu', reordered, 1, 0)).toBe(1);
    expect(activeSeatForStage('generalDraft', reordered, 0, 9)).toBeNull();
    expect(activeSeatForStage('playing', [], 0, 0)).toBeNull();
  });

  it('席位号是字符串也归一成数字', () => {
    expect(activeSeatForStage('generalDraft', [{ id: '3' }], 0, 0)).toBe(3);
  });
});

describe('接线证人：App 真的换了这根轴', () => {
  const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

  it('席位闸调用纯函数，并把挑将席读进来', () => {
    expect(app).toContain("import { activeSeatForStage } from './store/seatAxis'");
    expect(app).toContain("const draftIndex = useGameStore(s => s.draftPlayerIndex)");
    expect(app).toContain('activeSeatForStage(phase, netPlayers, netActiveIndex, draftIndex)');
  });

  it('「不是自己那一席就锁」这道闸本身没被放宽', () => {
    expect(app).toMatch(/viewSeat !== null && activeSeat !== null && activeSeat !== viewSeat/);
    expect(app).toMatch(/phase === 'generalDraft' \|\| phase === 'drawing' \|\| phase === 'playing'/);
    expect(app).toMatch(/<GeneralDraft seatLocked=\{seatLocked\} \/>/);
  });
});
