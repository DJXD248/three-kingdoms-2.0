/**
 * v2.9.5 称号删除刀的普查钉（裁决原文＝「把所有将领的称号都删除，我的游戏设计中将领不带称号」）。
 * 三枚证人，方向各不同：名册里没有称号这一格、编译期类型里也没有、旧存档直塞的 title 不进账。
 */
import { describe, it, expect } from 'vitest';
import { allGenerals, type General } from './generals';
import { DIY_FIXTURE_GENERALS } from '../ai/fixtures/diyGeneralFixture';
import { createAuthoredGeneral } from '../domain/generalProvenance';

type HasTitleKey = 'title' extends keyof General ? true : false;

describe('称号已从将领记录里删除（v2.9.5）', () => {
  it('官方名册每一条都不带 title 键，且张数与来源构成当场钉住', () => {
    // 335＝95＋魏关羽（v2.9.6）＋转换表带入的 239 张（v2.9.28 读法㈁）。
    // 这一格数的是"名册有没有多出带称号的条目"，加一张卡就得改一个数——它不是玩法判据，只是普查。
    expect(allGenerals).toHaveLength(335);
    for (const g of allGenerals) {
      expect(Object.keys(g)).not.toContain('title');
    }
  });

  it('仓库固定 DIY 样本同样不带（它的可辨认性靠 `D-fix-` 前缀与 `试作·` 将名）', () => {
    expect(DIY_FIXTURE_GENERALS.length).toBeGreaterThan(0);
    for (const g of DIY_FIXTURE_GENERALS) {
      expect(Object.keys(g)).not.toContain('title');
    }
  });

  it('编译期这一格也已经不在形状上（把 title 加回 General 会让这行变红）', () => {
    const witness: HasTitleKey = false;
    expect(witness).toBe(false);
  });

  it('旧存档里残留的 title 不会被造卡入口写进记录', () => {
    const stale = { name: '旧档将', faction: '蜀', hp: 4, title: '曾经的称号' } as never as Parameters<typeof createAuthoredGeneral>[0];
    const made = createAuthoredGeneral(stale, 'DIY', () => 'census-1');
    if (!made.ok) throw new Error(`旧档形状本该能成卡，实际＝${made.reason}`);
    expect(Object.keys(made.general)).not.toContain('title');
  });
});
