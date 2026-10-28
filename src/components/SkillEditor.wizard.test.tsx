/**
 * v2.9.21 两段式流程（§12-140①「将领→确认→技能→确认完整将领」）的界面接线证人。
 *
 * 钉四件事，全在真组件上：
 *  ① 选中将领后落在第 1 步，那一步只谈将领本人；技能那一屏不在这一步露出来；
 *  ② 那颗「确认将领」=流程的分界，**不写库**（写库仍然只有「💾 保存修改」那一条路）；
 *  ③ 第 2 步能回到第 1 步，两边改的是同一份内存态（不是两套字段）；
 *  ④ 一句话生成将领那一格今天只是位置，**按下去不产生任何东西**（下一刀才接线）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';

const zhangliao = allGenerals.find(g => g.id === 'wei_004')!;

const btnByText = (needle: string) => Array.from(document.querySelectorAll('button'))
  .find(b => (b.textContent ?? '').includes(needle));

/** 这一屏的身份格子（名称／身份／势力／体力／近战／远程）在不在——按标签文字取证。 */
const identityFieldsVisible = () =>
  Array.from(document.querySelectorAll('label')).some(l => l.textContent?.trim() === '近战 ⚔️');

/** 「名称」那一格现在的值。 */
function nameInputValue(): string {
  const label = Array.from(document.querySelectorAll('label'))
    .find(l => l.textContent?.trim() === '名称');
  if (!label) throw new Error('「名称」那格不在这一屏');
  return (label.parentElement!.querySelector('input') as HTMLInputElement).value;
}

function openZhangliao() {
  render(<SkillEditor onClose={() => {}} />);
  fireEvent.click(btnByText(zhangliao.name)!);
}

describe('两段式流程：① 将领身份 → 确认 → ② 技能编辑', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useGameStore.setState({
      skillEdits: {}, generalEdits: {}, developerMode: true,
      lockedGeneralIds: new Set<string>(), disabledGenerals: new Set<string>(),
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('选中将领落在第 1 步：身份六格在场，技能那一屏不出现', () => {
    openZhangliao();
    expect(screen.getByText('① 将领身份')).toBeTruthy();
    expect(screen.getByText('② 技能编辑')).toBeTruthy();
    // 第 1 步只谈本人：名称／势力／体力／近战／远程 六格在场
    expect(identityFieldsVisible()).toBe(true);
    expect(nameInputValue()).toBe(zhangliao.name);
    // 技能那一屏（含那颗保存）不在第 1 步露面
    expect(screen.queryByText('技能列表')).toBeNull();
    expect(btnByText('保存修改')).toBeUndefined();
    expect(screen.getByText('✔ 确认将领，进入技能编辑')).toBeTruthy();
  });

  it('点「确认将领」只换屏、一个字都不写库', () => {
    openZhangliao();
    const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.trim() === '名称')!;
    const input = label.parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '张辽改' } });
    fireEvent.click(screen.getByText('✔ 确认将领，进入技能编辑'));

    // 已经在第 2 步了
    expect(screen.getByText('技能列表')).toBeTruthy();
    // 但 store 里没有任何改动——写库那条路没被这条流程复制成第二条
    expect(useGameStore.getState().generalEdits[zhangliao.id]).toBeUndefined();
    expect(useGameStore.getState().skillEdits[zhangliao.id]).toBeUndefined();
    // 内存态还在：回到第 1 步，刚才打的那三个字还挂着（同一份字段，不是两套）
    fireEvent.click(screen.getByText('← 回到将领身份'));
    expect(nameInputValue()).toBe('张辽改');
  });

  it('第 2 步的保存仍然走同一条路，写进去的就是那六格＋技能', () => {
    openZhangliao();
    fireEvent.click(screen.getByText('✔ 确认将领，进入技能编辑'));
    expect(identityFieldsVisible()).toBe(false);   // 第 2 步不再摆身份格，改名字要回第 1 步
    fireEvent.click(screen.getByText('← 回到将领身份'));
    const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.trim() === '名称')!;
    const input = label.parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '张辽' } });
    fireEvent.click(screen.getByText('✔ 确认将领，进入技能编辑'));
    fireEvent.click(screen.getByText('💾 保存修改'));
    expect(useGameStore.getState().skillEdits[zhangliao.id]).toBeTruthy();
    expect(screen.getByText('✅ 已保存')).toBeTruthy();
  });

  it('「🪄 一句话生成」这一格今天按下去不产生任何东西（位置先亮出来）', () => {
    openZhangliao();
    const magic = btnByText('🪄 一句话生成');
    expect(magic).toBeTruthy();
    expect(magic!.disabled).toBe(true);
    fireEvent.click(magic!);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
    expect(useGameStore.getState().generalEdits[zhangliao.id]).toBeUndefined();
  });

  it('再选一张卡会回到第 1 步（不会带着上一次的屏往下走）', () => {
    openZhangliao();
    fireEvent.click(screen.getByText('✔ 确认将领，进入技能编辑'));
    expect(screen.getByText('技能列表')).toBeTruthy();
    // 界面上有两颗「关闭」：头部那颗收整个编辑器、底栏这颗只收这张面板。
    const closes = Array.from(document.querySelectorAll('button')).filter(b => b.textContent === '关闭');
    expect(closes).toHaveLength(2);
    fireEvent.click(closes[1]);
    const other = allGenerals.find(g => g.id !== zhangliao.id && (g.skills[0]?.effects?.length ?? 0) === 0)!;
    fireEvent.click(btnByText(other.name)!);
    expect(screen.queryByText('技能列表')).toBeNull();
    expect(nameInputValue()).toBe(other.name);
  });
});
