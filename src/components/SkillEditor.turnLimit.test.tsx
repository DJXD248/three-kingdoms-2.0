/**
 * 「每回合限几次」那一格的界面证人（限次刀，用户 2026-10-28 五条裁决里的第③⑤条落在界面上）。
 * 这里问的不是引擎算得对不对（那本账在 `skillTurnLimit.test.ts`），而是**玩家亲手敲这格时
 * 界面说了什么、什么才真的写进技能**：
 *  · 空着＝不限制，界面必须自己把这句话讲出来（否则空会被读成"不许发动"）；
 *  · 敲进去一个合法数 ⇒ 卡面上那枚徽章当场跟着变；
 *  · 敲进去一个读不出的串 ⇒ 红字点名、**这一格不写进技能**，也绝不兜底成 1；
 *  · 清空＝取消限制（不是 0），保存下去是"没有这一格"；
 *  · 一路都只认 `data/generals.ts::isValidTurnLimit` 那一份判据、tooltip 只抄 `TURN_LIMIT_HINT` 那一份。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { TURN_LIMIT_HINT } from '../skills/skillExcelFormat';
import { selectGeneralAndOpenSkills } from '../test/wizardStep';

/** 挑一张**只有一枚技能**的官方将：这一格今天一条都没填，进去必然先是空的，
 *  而且技能屏上只有一张卡 ⇒ 取那一格不必按下标挑，读数不会串到别的卡上。 */
const target = allGenerals.find(g => g.skills?.length === 1)!;

function limitBox(): HTMLInputElement {
  return screen.getByLabelText('每回合限几次') as HTMLInputElement;
}

function typeInto(value: string) {
  fireEvent.change(limitBox(), { target: { value } });
}

function save() {
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes('保存修改'));
  if (!btn) throw new Error('没找到「💾 保存修改」——落档只有这一个入口');
  fireEvent.click(btn);
}

function savedTurnLimit(): unknown {
  return useGameStore.getState().skillEdits[target.id]?.[0]?.turnLimit;
}

function openEditor() {
  render(<SkillEditor onClose={() => {}} />);
  selectGeneralAndOpenSkills(target.name);
}

describe('限次刀 · 界面那一格', () => {
  beforeEach(() => {
    cleanup();
    useGameStore.setState({ skillEdits: {}, generalEdits: {}, developerMode: true });
  });

  it('官方卡今天这一格是空的，界面自己说清"留空＝不限制"', () => {
    openEditor();
    expect(limitBox().value).toBe('');
    expect(screen.getByText('留空＝不限制')).toBeTruthy();
    expect(screen.queryByText('每回合限1次')).toBeNull();
    // 空着保存＝这一格根本不存在，而不是"没读懂"或"0 次"
    save();
    expect(savedTurnLimit()).toBeUndefined();
  });

  it('敲 2 进去，卡面上那枚徽章当场跟着变，保存后技能上记着 2', () => {
    openEditor();
    typeInto('2');
    expect(screen.getByText('每回合限2次')).toBeTruthy();
    expect(screen.getByText('下一格回合开始归零')).toBeTruthy();
    save();
    expect(savedTurnLimit()).toBe(2);
  });

  /**
   * 上限 60 秒是 v2.9.28 读法㈁ 之后的实测：这条一次跑三回「开编辑器→保存」，编辑器每次挂载都要走一遍
   * 整份将领名单（96→335 张）。单独跑这一条 1,867 ms，而覆盖率插桩＋多 worker 并发时实测 22,216 ms
   * 撞在 vitest 默认 20 秒上（同一棵树连跑两趟：第一趟红在这一条、第二趟 168 文件全绿）。
   * 等的是真东西——名单大了，不是判据松了。
   */
  it('敲一个读不出的数：红字点名、徽章不出现、这一格不写进技能', () => {
    for (const bad of ['0', '-1', '1.5']) {
      openEditor();
      typeInto(bad);
      expect(screen.getByText('只认 1 以上的整数：这一串没写进技能')).toBeTruthy();
      expect(screen.queryByText(/每回合限\d+次/)).toBeNull();
      save();
      // 系统既不猜数、也不兜底成 1、也不当成没填——它只是没写进去，并且说了为什么
      expect(savedTurnLimit()).toBeUndefined();
      cleanup();
    }
  }, 60_000);

  it('填过的数被清空＝取消限制（不是 0 次）', () => {
    openEditor();
    typeInto('3');
    expect(screen.getByText('每回合限3次')).toBeTruthy();
    typeInto('');
    expect(screen.queryByText('每回合限3次')).toBeNull();
    expect(screen.getByText('留空＝不限制')).toBeTruthy();
    save();
    expect(savedTurnLimit()).toBeUndefined();
  });

  it('敲坏了又离开这一格，界面回到"技能上记着的那个数"，不留一个假象', () => {
    openEditor();
    typeInto('2');
    save();
    cleanup();

    openEditor();
    expect(limitBox().value).toBe('2');
    typeInto('0');
    fireEvent.blur(limitBox());
    expect(limitBox().value).toBe('2');
    expect(screen.queryByText('只认 1 以上的整数：这一串没写进技能')).toBeNull();
  });

  it('说明只有一份：徽章与输入框都挂同一句 TURN_LIMIT_HINT', () => {
    openEditor();
    typeInto('1');
    const box = limitBox();
    const holder = box.closest('div') as HTMLElement;
    expect(holder.title).toBe(TURN_LIMIT_HINT);
    expect((screen.getByText('每回合限1次') as HTMLElement).title).toBe(TURN_LIMIT_HINT);
  });
});
