/**
 * #49 拼积木编辑器的界面接线证人（v2.9.8）。
 * 三件事必须在真组件上成立：挑积木⇒话替用户写出来；手改过⇒积木再变也不覆盖；
 * 手改态下那颗「↺ 用积木重写这句」一点就把生成句放回去。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { clickIntoSkillsStep } from '../test/wizardStep';

function findRuntimeSelect(): HTMLSelectElement {
  const el = Array.from(document.querySelectorAll('select'))
    .find(s => s.options[0]?.text?.startsWith('纯描述'));
  if (!el) throw new Error('结构化效果下拉未出现');
  return el as HTMLSelectElement;
}

function effectBox(): HTMLTextAreaElement {
  const el = screen.getByLabelText('效果1卡面文字') as HTMLTextAreaElement;
  expect(el).toBeTruthy();
  return el;
}

describe('拼积木→生成文字→文字还能改', () => {
  beforeEach(() => {
    cleanup();
    useGameStore.setState({ skillEdits: {}, generalEdits: {}, developerMode: true });
  });

  const openFirstPlainSkill = () => {
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    clickIntoSkillsStep();
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);
    return target;
  };

  it('挑一块积木，下面那句卡面话就替用户写好了', () => {
    openFirstPlainSkill();
    fireEvent.change(findRuntimeSelect(), { target: { value: 'DRAW_CARD' } });
    const box = effectBox();
    expect(box.value).toBe('摸 1 张牌。');

    // 数值那一格改到 3 ⇒ 句子跟着改（这句还是"上一次生成的那句"，所以跟着积木走）
    const nums = Array.from(document.querySelectorAll('input[type="number"]'));
    fireEvent.change(nums[nums.length - 1], { target: { value: '3' } });
    expect(effectBox().value).toBe('摸 3 张牌。');
    expect(screen.queryByText('↺ 用积木重写这句')).toBeNull();
  });

  it('手打过一次就不再覆盖，并且给一条回到自动生成回去的路', () => {
    openFirstPlainSkill();
    fireEvent.change(findRuntimeSelect(), { target: { value: 'DRAW_CARD' } });
    const box = effectBox();
    fireEvent.change(box, { target: { value: '摸牌，然后本回合不能再移动。' } });

    const nums = Array.from(document.querySelectorAll('input[type="number"]'));
    fireEvent.change(nums[nums.length - 1], { target: { value: '4' } });
    expect(effectBox().value).toBe('摸牌，然后本回合不能再移动。');

    const restore = screen.getByText('↺ 用积木重写这句');
    fireEvent.click(restore);
    expect(effectBox().value).toBe('摸 4 张牌。');
  });

  it('保存下去的还是那三个格子（积木＋一句人话），没有偷偷新增第四样东西', () => {
    const target = openFirstPlainSkill();
    fireEvent.change(findRuntimeSelect(), { target: { value: 'HEAL' } });
    expect(effectBox().value).toBe('回复 1 点体力。');
    fireEvent.click(screen.getByText('💾 保存修改'));

    const saved = useGameStore.getState().skillEdits[target.id];
    const eff = saved?.[0]?.effects?.[0];
    expect(eff?.runtime).toEqual({ type: 'HEAL', value: 1, target: 'TARGET' });
    expect(eff?.description).toBe('回复 1 点体力。');
    // 生成句就是卡面上那句话：编译器不读它，读的是上面那格积木。
    expect(Object.keys(saved![0])).toEqual(expect.arrayContaining(['name', 'description', 'effects']));
    expect(saved![0]).not.toHaveProperty('autoText');
  });

  it('纯文字那一档（没有积木）界面如实说明它不参与结算', () => {
    openFirstPlainSkill();
    fireEvent.click(screen.getByText('切换为单效果模式（将清除所有子效果与整组门槛）'));
    expect(screen.getByText(/这一档只有文字、没有积木/)).toBeTruthy();
  });
});
