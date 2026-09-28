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

  it('被停用的官方禁用记录不把行划成「已禁用」：显示口径跟着装配口径走', () => {
    // 独立复算查出的口径分叉：行上原先读的是**原始** disabledGenerals，而场上
    // 读的是策略过滤后的那一份——开发者时期禁用过的官方将，刷新后界面上还画着
    // 划线，对局里却早已能用（比拒录更坏的失效形态：对用户说谎）。
    useGameStore.setState({ disabledGenerals: new Set([target.id]) } as never);
    const playerView = render(<SkillEditor onClose={() => {}} />);
    const row = Array.from(playerView.container.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    expect(row).toBeTruthy();
    expect(row!.parentElement?.className).not.toContain('opacity-40');
    expect(playerView.container.textContent).toContain('当前已禁用 0 名');
    cleanup();

    // 反向对照：同一条记录在开发者模式里确实该显示成已禁用（证明上面那条断言可失败）。
    useGameStore.setState({ developerMode: true } as never);
    const devView = render(<SkillEditor onClose={() => {}} />);
    const devRow = Array.from(devView.container.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    expect(devRow!.parentElement?.className).toContain('opacity-40');
    expect(devView.container.textContent).toContain('当前已禁用 1 名');
  });
});
