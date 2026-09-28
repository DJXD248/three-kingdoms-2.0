/**
 * §H3 第①层（录入面）：非开发者会话里，官方将领不给写路径，而且把原因写在
 * 脸上——不是点一下才发现改不动，更不是显示"已保存"却什么都没写。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';

const target = allGenerals.find(g => g.name === '关羽' && g.faction === '蜀')!;

function openGeneral(name: string) {
  const listBtn = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes(name));
  expect(listBtn).toBeTruthy();
  fireEvent.click(listBtn!);
}

function saveButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes('保存修改')) as HTMLButtonElement | undefined;
}

describe('SkillEditor: 官方将只读（开发者模式外）', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useGameStore.setState({
      developerMode: false,
      skillEdits: {},
      generalEdits: {},
      disabledGenerals: new Set<string>(),
      identityRegistry: [],
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('选中官方将=保存按钮禁用 + 只读说明在场', () => {
    render(<SkillEditor onClose={() => {}} />);
    openGeneral(target.name);
    expect(saveButton()?.disabled).toBe(true);
    expect(screen.getByText(/官方将领在开发者模式外只读/)).toBeTruthy();
    // 一次都没写进 store
    expect(useGameStore.getState().generalEdits[target.id]).toBeUndefined();
  });

  it('历史官方改动：行上标停用、总览报出清单，原数据仍在档', () => {
    useGameStore.setState({ generalEdits: { [target.id]: { hp: 9 } } } as never);
    render(<SkillEditor onClose={() => {}} />);
    expect(screen.getByText(/已停用/)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(target.name)).length).toBeGreaterThan(0);
    expect(useGameStore.getState().generalEdits[target.id]).toEqual({ hp: 9 });
  });

  it('自建卡不受影响：非开发者照样能存', () => {
    const created = useGameStore.getState().addAuthoredGeneral({ name: '测试自建将', faction: '蜀', hp: 3 }, 'DIY');
    if (!created.ok) throw new Error('自建卡造不出来：' + created.reason);
    render(<SkillEditor onClose={() => {}} />);
    openGeneral('测试自建将');
    expect(saveButton()?.disabled).toBe(false);
    fireEvent.click(saveButton()!);
    expect(useGameStore.getState().skillEdits[created.general.id]).toBeDefined();
  });
});
