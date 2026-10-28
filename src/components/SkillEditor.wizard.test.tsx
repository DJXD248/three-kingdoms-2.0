/**
 * v2.9.21 两段式流程（§12-140①「将领→确认→技能→确认完整将领」）的界面接线证人。
 *
 * 钉五件事，全在真组件上：
 *  ① 选中将领后落在第 1 步，那一步只谈将领本人；技能那一屏不在这一步露出来；
 *  ② 那颗「确认将领」=流程的分界，**不写库**（写库仍然只有「💾 保存修改」那一条路）；
 *  ③ 第 2 步能回到第 1 步，两边改的是同一份内存态（不是两套字段）；
 *  ④ v2.9.24 刀2 起，「🪄 一句话生成将领」是真入口：采用＝只往第①步那几格里填字，
 *     **一样不写库**（刀1 那趟它还是灰占位，那时的证人是"点下去不产生任何东西"）；
 *  ⑤ 一句话里读不懂的那一段当场点名，且一个字段都不落（不半采纳、不猜）。
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
  return fieldValueByLabel('名称');
}

/** 第①步六格里某一格现在的值（按标签文字定位，不靠顺序）。 */
function fieldValueByLabel(labelText: string): string {
  const label = Array.from(document.querySelectorAll('label'))
    .find(l => l.textContent?.trim() === labelText);
  if (!label) throw new Error(`「${labelText}」那格不在这一屏`);
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

  it('「🪄 一句话生成将领」采用＝只往那六格里填字，一个字都不落档', () => {
    openZhangliao();
    fireEvent.click(btnByText('🪄 一句话生成将领')!);
    const box = screen.getByLabelText('一句话生成将领') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '名：张辽文远，势力：魏，体力5，近战3' } });
    fireEvent.click(btnByText('按这句生成')!);
    fireEvent.click(btnByText('✔ 采用，把读到的填进上面那几格')!);

    expect(nameInputValue()).toBe('张辽文远');
    expect(fieldValueByLabel('体力 ❤️')).toBe('5');
    expect(fieldValueByLabel('近战 ⚔️')).toBe('3');
    // 这句没点远程⇒那一格一字不动（绝不因为玩家没提就抹成缺省）
    expect(fieldValueByLabel('远程 🏹')).toBe(String(zhangliao.rangedAtk));
    // 采用不等于保存：写库那条路仍然只有第②步那颗「💾 保存修改」
    expect(useGameStore.getState().generalEdits[zhangliao.id]).toBeUndefined();
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
    const note = screen.getByText(/已填进：/);
    expect(note.textContent).toContain('已填进：名称／势力／体力／近战');
    expect(note.textContent).toContain('还没保存');
  });

  it('一句话里那句读不懂的照样点名，且不落进任何一格', () => {
    openZhangliao();
    fireEvent.click(btnByText('🪄 一句话生成将领')!);
    const box = screen.getByLabelText('一句话生成将领') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '张辽，势力魏，攻击力3' } });
    fireEvent.click(btnByText('按这句生成')!);
    expect(screen.getByText(/没落进去的那一段：「攻击力3」/).textContent)
      .toContain('攻击力有近战与远程两个数');
    fireEvent.click(btnByText('✔ 采用，把读到的填进上面那几格')!);
    expect(nameInputValue()).toBe('张辽');
    expect(fieldValueByLabel('近战 ⚔️')).toBe(String(zhangliao.meleeAtk));
    expect(fieldValueByLabel('远程 🏹')).toBe(String(zhangliao.rangedAtk));
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
