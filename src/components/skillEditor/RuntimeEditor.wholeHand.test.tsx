/**
 * v2.8.13 #49（用户裁方案①）：数值 0 只在「经手牌切片结算」的三类效果里有真含义
 * （＝整只手／全部，见 core/eventProcessors/handSelection.ts:42）。录入面必须
 * 按类型分别表达"全部"，而不是全局放开数字框——后者会把 0 塞进摸牌/看顶/拆装备
 * 这些不懂 0 的类型，造出新一轮"界面写 0、引擎当 1（或当没干）"的静默失真。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { RuntimeEditor } from './RuntimeEditor';
import { WHOLE_HAND_LABEL } from '../../skills/skillExcelFormat';
import type { SkillRuntimeEffect } from '../../data/generals';

const renderWith = (runtime: SkillRuntimeEffect) => {
  const onChange = vi.fn();
  const view = render(<RuntimeEditor runtime={runtime} onChange={onChange} />);
  return {
    onChange,
    checkbox: view.container.querySelector('input[type=checkbox]') as HTMLInputElement | null,
    numberBox: view.container.querySelector('input[type=number]') as HTMLInputElement | null,
    typeSelect: Array.from(view.container.querySelectorAll('select'))
      .find(s => Array.from(s.options).some(o => o.value === 'DAMAGE')) as HTMLSelectElement,
    preview: () => Array.from(view.container.querySelectorAll('span'))
      .map(s => s.textContent ?? '').filter(t => t.includes('手牌') || t.includes('伤害') || t.includes('军备')).join(' '),
  };
};

describe('数值录入面 · 「整只手（全部）」只在该出现的类型上出现', () => {
  afterEach(cleanup);

  it.each(['DISCARD', 'GIVE', 'DECK_PLACE'] as const)('%s：勾选框存在（0＝全部是引擎认的）', type => {
    const ui = renderWith({ type, value: 1, target: 'TARGET' });
    expect(ui.checkbox).toBeTruthy();
    expect(ui.checkbox!.checked).toBe(false);
    expect(ui.numberBox).toBeTruthy();
  });

  it.each(['DRAW_CARD', 'DAMAGE', 'HEAL', 'GAIN_ARMOR', 'EQUIP_STRIP', 'REVEAL'] as const)(
    '%s：不给勾选框（这些类型的 0 没有含义，不许从界面写进去）', type => {
      const ui = renderWith({ type, value: 1, target: 'TARGET' });
      expect(ui.checkbox).toBeNull();
    });

  it('勾上⇒写 0，并且数字框让位给"全部"（留着它显示 1＝数字框与生效值分叉）', () => {
    const ui = renderWith({ type: 'DISCARD', value: 2, target: 'TARGET' });
    fireEvent.click(ui.checkbox!);
    expect(ui.onChange).toHaveBeenLastCalledWith({ type: 'DISCARD', value: 0, target: 'TARGET' });
  });

  it('已经是 0（断肠的形状）⇒勾选框初值为选中、页面上没有那个说谎的 1', () => {
    const view = render(<RuntimeEditor runtime={{ type: 'DISCARD', value: 0, target: 'ATTACKER' }}
      onChange={() => {}} />);
    const box = view.container.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(view.container.querySelector('input[type=number]')).toBeNull();
    expect(view.container.textContent).toContain(WHOLE_HAND_LABEL);
  });

  it('取消勾选⇒回到至少 1，绝不把 0 留在原地', () => {
    const ui = renderWith({ type: 'GIVE', value: 0, target: 'SELF' });
    fireEvent.click(ui.checkbox!);
    expect(ui.onChange).toHaveBeenLastCalledWith({ type: 'GIVE', value: 1, target: 'SELF' });
  });

  it('勾选与预览同源：勾上后预览说"全部"，不是说一个数', () => {
    const ui = renderWith({ type: 'DECK_PLACE', value: 0, target: 'SELF' });
    expect(ui.preview()).toContain('全部');
  });

  it('换成不懂 0 的类型时绝不把 0 带过去（这正是"界面写 0、引擎当 1"的成因）', () => {
    const ui = renderWith({ type: 'DISCARD', value: 0, target: 'TARGET' });
    fireEvent.change(ui.typeSelect, { target: { value: 'DAMAGE' } });
    expect(ui.onChange).toHaveBeenLastCalledWith({ type: 'DAMAGE', value: 1, target: 'TARGET' });
  });

  it('非全手类型的数字框照旧夹 1（本次刻意没动的半边行为，钉住别被顺手改掉）', () => {
    const ui = renderWith({ type: 'DRAW_CARD', value: 1, target: 'SELF' });
    expect(ui.numberBox!.getAttribute('min')).toBe('1');
    fireEvent.change(ui.numberBox!, { target: { value: '0' } });
    expect(ui.onChange).toHaveBeenLastCalledWith({ type: 'DRAW_CARD', value: 1, target: 'SELF' });
  });
});
