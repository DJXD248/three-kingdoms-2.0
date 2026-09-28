/**
 * v2.8.8 N2 (§H8) 第①层（录入面）：两把锁一眼可分——金锁（系统判定，不可
 * 手动加解）与白锁（用户自己锁，永远可解）。锁只挡未来的写，绝不当「停用」。
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import Codex from './Codex';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { createAuthoredGeneral } from '../domain/generalProvenance';
import { loadLockedGenerals } from '../store/editorPersistence';

const ledger = allGenerals.find(g => g.name === '关羽' && g.faction === '蜀')!;
const fixture = createAuthoredGeneral({ name: 'UI锁试将', faction: '蜀', hp: 3 }, 'DIY');
if (!fixture.ok) throw new Error('fixture 造卡失败');
const diy = fixture.general;

function arm(options: { developerMode: boolean; locked?: string[] }) {
  cleanup();
  localStorage.clear();
  useGameStore.setState({
    developerMode: options.developerMode,
    skillEdits: {},
    generalEdits: {},
    disabledGenerals: new Set<string>(),
    lockedGeneralIds: new Set<string>(options.locked ?? []),
    authoredGenerals: [diy],
    identityRegistry: [],
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

function openGeneral(name: string) {
  // The row's main button is the only button whose text carries the name;
  // icon buttons (lock/disable/delete) have emoji-only textContent.
  const listBtn = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes(name));
  expect(listBtn).toBeTruthy();
  fireEvent.click(listBtn!);
}

function saveButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes('保存修改')) as HTMLButtonElement | undefined;
}

/** 目标卡所在行（行主体按钮的父容器：行内锁开关/禁用开关/删除都在这一层）。 */
function rowOf(name: string): HTMLElement | undefined {
  const main = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes(name));
  return main?.parentElement ?? undefined;
}

/** 行上的白锁开关按钮（title 提到白锁；emoji 代理对不便用无 /u 正则比文本）。 */
function lockToggleInRow(name: string): HTMLButtonElement | undefined {
  const row = rowOf(name);
  if (!row) return undefined;
  return Array.from(row.querySelectorAll('button'))
    .find(b => (b.title ?? '').includes('白锁')) as HTMLButtonElement | undefined;
}

describe('SkillEditor: 白锁录入面（N2）', () => {
  it('行按钮一点即锁：进锁定集合、落本地档、保存按钮当场禁用', () => {
    arm({ developerMode: false });
    render(<SkillEditor onClose={() => {}} />);
    openGeneral(diy.name);
    expect(saveButton()?.disabled).toBe(false);
    const btn = lockToggleInRow(diy.name);
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(useGameStore.getState().isGeneralLocked(diy.id)).toBe(true);
    expect(loadLockedGenerals().has(diy.id)).toBe(true);
    expect(saveButton()?.disabled).toBe(true);
    // 面板说的是白锁这句话，不是官方只读那句
    expect(screen.getByText(/白锁/)).toBeTruthy();
  });

  it('白锁面板自带解锁出路：点「在此解锁」后写得回去（不是单向陷阱）', () => {
    arm({ developerMode: false, locked: [diy.id] });
    render(<SkillEditor onClose={() => {}} />);
    openGeneral(diy.name);
    expect(saveButton()?.disabled).toBe(true);
    const unlock = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes('在此解锁'));
    expect(unlock).toBeTruthy();
    fireEvent.click(unlock!);
    expect(saveButton()?.disabled).toBe(false);
  });

  it('开发者模式外官方将：金锁是系统判定的可视化，行上不给白锁开关', () => {
    arm({ developerMode: false });
    render(<SkillEditor onClose={() => {}} />);
    openGeneral(ledger.name);
    expect(lockToggleInRow(ledger.name)).toBeUndefined();
    // 金锁标记在场，且与白锁文案不同
    const gold = Array.from(document.querySelectorAll('span'))
      .find(s => (s.title ?? '').includes('金锁（系统判定）'));
    expect(gold).toBeTruthy();
    expect(gold!.className).toContain('text-yellow-400');
    expect(screen.getByText(/官方将领在开发者模式外只读/)).toBeTruthy();
  });

  it('双色一眼可分：白锁行标 sky 色 🔒、金锁行标黄色 🔒，互不冒充', () => {
    arm({ developerMode: false, locked: [diy.id] });
    render(<SkillEditor onClose={() => {}} />);
    const white = Array.from(document.querySelectorAll('span'))
      .find(s => (s.title ?? '').includes('白锁（你手动锁定）'));
    expect(white).toBeTruthy();
    expect(white!.className).toContain('text-sky-200');
    // 该行的白锁不借用金锁标记（title 是属性，得按选择器查，不能查 textContent）
    const row = white!.closest('div');
    expect(row?.querySelector('span[title*="金锁"]')).toBeNull();
  });

  it('多选工具栏有批量锁定/解锁；官方将批量加锁被拒并点名，自建将照锁', () => {
    arm({ developerMode: false });
    const view = render(<SkillEditor onClose={() => {}} />);
    const enter = Array.from(view.container.querySelectorAll('button'))
      .find(b => b.textContent?.includes('批量删除'));
    fireEvent.click(enter!);
    const selectAll = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes('全选当前'));
    fireEvent.click(selectAll!);
    const lockBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.startsWith('🔒 锁定'));
    expect(lockBtn).toBeTruthy();
    fireEvent.click(lockBtn!);
    expect(useGameStore.getState().isGeneralLocked(diy.id)).toBe(true);
    expect(useGameStore.getState().isGeneralLocked(ledger.id)).toBe(false);
    // 拒绝点名：常驻提示条（多选态下右侧面板没有落脚点）
    const strip = Array.from(document.querySelectorAll('p'))
      .find(p => p.textContent?.includes('金色锁由系统判定'));
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toContain(ledger.name);
  });

  it('锁不停内容：白锁卡的已有改动仍显示为生效（✏️），不画成停用（🚫）', () => {
    arm({ developerMode: false });
    // 构造「先改后锁」：改动合法落档，随后才锁——锁只挡未来的写
    useGameStore.getState().updateGeneralEdit(diy.id, { hp: 5 });
    useGameStore.setState({ lockedGeneralIds: new Set<string>([diy.id]) } as never);
    const view = render(<SkillEditor onClose={() => {}} />);
    const row = Array.from(view.container.querySelectorAll('button'))
      .find(b => b.textContent?.includes(diy.name));
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain('✏️');
    expect(row!.textContent).not.toContain('🚫');
    // 装配口径也照旧生效
    expect(useGameStore.getState().getGeneralWithEdits(diy).hp).toBe(5);
  });

  it('非开发者从图鉴就进得来编辑器：入口与两把锁说明都在（否则金锁永不可见）', () => {
    arm({ developerMode: false });
    render(<Codex />);
    const entry = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes('将领编辑器'));
    expect(entry).toBeTruthy();
    fireEvent.click(entry!);
    expect(screen.getByText(/金色锁＝官方将领/)).toBeTruthy();
    // 进来之后金锁/白锁两套可视化都在这张界面上（金锁卡不给开关）
    expect(Array.from(document.querySelectorAll('span')).some(s => (s.title ?? '').includes('金锁（系统判定）'))).toBe(true);
    expect(lockToggleInRow(diy.name)).toBeTruthy();
  });
});
