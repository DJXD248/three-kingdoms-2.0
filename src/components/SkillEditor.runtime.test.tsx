/**
 * SkillEditor runtime-entry smoke test — verifies the UI wiring added in 2.2.0:
 * switching a skill to multi-effect mode, picking a structured runtime effect
 * (类型/数值/目标) in the new RuntimeEditor, and saving must land a real
 * `runtime` payload in the store that the skill compiler can execute.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { compileGeneralSkills } from '../skills/skillCompiler';

function findRuntimeSelect(): HTMLSelectElement {
  const selects = Array.from(document.querySelectorAll('select'));
  const el = selects.find(s => s.options[0]?.text?.startsWith('纯描述'));
  if (!el) throw new Error('结构化效果下拉未出现');
  return el as HTMLSelectElement;
}

describe('SkillEditor: structured runtime entry', () => {
  beforeEach(() => {
    cleanup();
    useGameStore.setState({ skillEdits: {}, generalEdits: {} });
  });

  it('selecting 摸牌 in the effect card saves a runtime payload the compiler accepts', () => {
    // 2.4.1 起部分内置技能自带 runtime——编辑器冒烟须挑首技仍为纯描述的武将
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);

    // Open the general in the editor (left list button contains the name)
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    expect(listBtn).toBeTruthy();
    fireEvent.click(listBtn!);

    // Switch the first skill from single-effect to multi-effect mode
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    // Set the structured runtime effect: 摸牌
    const sel = findRuntimeSelect();
    fireEvent.change(sel, { target: { value: 'DRAW_CARD' } });

    // Default value control appears (last number input = runtime 数值 field)
    const nums = Array.from(document.querySelectorAll('input[type="number"]'));
    const num = nums[nums.length - 1] as HTMLInputElement;
    expect(num.value).toBe('1');

    fireEvent.click(screen.getByText('💾 保存修改'));

    const saved = useGameStore.getState().skillEdits[target.id];
    expect(saved).toBeTruthy();
    const eff = saved[0].effects?.[0];
    expect(eff?.runtime).toEqual({ type: 'DRAW_CARD', value: 1, target: 'TARGET' });

    // The payload reaches the runtime compiler: without a trigger nothing
    // executes yet (honest skip), proving the effect was compiled from data.
    const edited = { ...target, skills: saved.map(s => ({ ...s })) } as typeof target;
    const noTrigger = compileGeneralSkills(edited);
    expect(noTrigger.definitions).toHaveLength(0);
    expect(noTrigger.skipped.some(sk => sk.reason === 'NO_TRIGGER')).toBe(true);
  });

  it('choosing 纯描述 keeps the effect descriptive (no runtime, compiler skips)', () => {
    // 2.4.1 起部分内置技能自带 runtime——编辑器冒烟须挑首技仍为纯描述的武将
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    const sel = findRuntimeSelect();
    fireEvent.change(sel, { target: { value: 'DAMAGE' } });
    expect(findRuntimeSelect().value).toBe('DAMAGE');
    fireEvent.change(findRuntimeSelect(), { target: { value: '' } }); // back to 纯描述

    fireEvent.click(screen.getByText('💾 保存修改'));
    const saved = useGameStore.getState().skillEdits[target.id];
    expect(saved[0].effects?.[0].runtime).toBeUndefined();
  });

  it('DECK_PLACE exposes the 放置位置 selector and persists dest=TOP (v2.6.1)', () => {
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    const findDestSelect = () => Array.from(document.querySelectorAll('select'))
      .find(s => s.options[0]?.text?.startsWith('牌堆底')) as HTMLSelectElement | undefined;

    // 观顶/置牌同为上表新枚；REVEAL 无位置面→不应出现放置位置下拉
    fireEvent.change(findRuntimeSelect(), { target: { value: 'REVEAL' } });
    expect(screen.getByText(/观看牌堆顶/)).toBeTruthy();
    expect(findDestSelect()).toBeUndefined();

    fireEvent.change(findRuntimeSelect(), { target: { value: 'DECK_PLACE' } });
    expect(screen.getByText(/张手牌移入牌堆/)).toBeTruthy();
    const dest = findDestSelect();
    expect(dest).toBeTruthy();
    expect(dest!.value).toBe('BOTTOM'); // 缺省=牌堆底
    fireEvent.change(dest!, { target: { value: 'TOP' } });

    fireEvent.click(screen.getByText('💾 保存修改'));
    const saved = useGameStore.getState().skillEdits[target.id];
    expect(saved[0].effects?.[0].runtime)
      .toEqual({ type: 'DECK_PLACE', value: 1, target: 'TARGET', dest: 'TOP' });
  });
});
