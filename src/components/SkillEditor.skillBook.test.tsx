/**
 * v2.9.18 技能册·录入面那三格"看得见"的证人。
 *
 * 用户这一刀的原文：「把自己编辑过的 DIY 卡放进『获得技能』那张册子、并且册子里要区分好
 * DIY 技能与官方技能」＋「增加一个现在还看不见的刷新按钮」。所以下面钉四件事：
 * ① 下拉里每个名字后面带着它的出处（官方／玩家自制），自制卡真的出现在这张册子里；
 * ② 那句小计说的是此刻册子里的数量，不是抄下来的死数字；
 * ③ 下拉里有这个名字⇒警告那句"表上没有"就不出现＝候选清单与警告是同一次计算的两半，
 *    界面不许自己再拿另一把尺量一遍（那正是本项目反复登记的"两处各说一套"）；
 * ④ 刷新那颗按钮**今天不出现**，只有把自动重算关掉那天才出现（这一套随时能拿出来用）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals, type Skill } from '../data/generals';
import { hasSettleableContent } from '../data/skillTable';
import { setSkillBookAutoRecompute, __resetSkillNameIndexForTests } from '../skills/skillNameIndex';
import { useGameStore } from '../store/gameStore';
import { AUTHORED_GENERALS_KEY } from '../store/editorPersistence';

/** 效果卡里那个「获得技能名」输入框所在的整块（编辑器头部没有这个格子）。 */
function gainNameInput(): HTMLInputElement {
  return document.querySelector('input[aria-label="获得技能名"]') as HTMLInputElement;
}

function bookOptions(): HTMLOptionElement[] {
  return Array.from(document.querySelectorAll('#tk-gain-skill-names option')) as HTMLOptionElement[];
}

function findRuntimeSelect(): HTMLSelectElement {
  const selects = Array.from(document.querySelectorAll('select'));
  const el = selects.find(s => s.options[0]?.text?.startsWith('纯描述'));
  if (!el) throw new Error('结构化效果下拉未出现');
  return el as HTMLSelectElement;
}

const settledSkill = (name: string): Skill => ({
  name,
  description: '出牌阶段，你摸一张牌',
  effects: [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
});

describe('SkillEditor: 技能册的出处与那颗还没露面的刷新按钮（v2.9.18）', () => {
  beforeEach(() => {
    cleanup();
    localStorage.removeItem(AUTHORED_GENERALS_KEY);
    __resetSkillNameIndexForTests();
    setSkillBookAutoRecompute(true);
    useGameStore.setState({
      skillEdits: {}, generalEdits: {}, authoredGenerals: [], developerMode: true, lockedGeneralIds: new Set<string>(),
    } as never);
    // 打开一员"首技还是空壳"的官方卡，把效果类型切到「获得技能」——册子那一格只在这档出现。
    render(<SkillEditor onClose={() => {}} />);
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0
      && g.skills.every(s => !hasSettleableContent(s)))!;
    fireEvent.click(Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(target.name))!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);
    fireEvent.change(findRuntimeSelect(), { target: { value: 'GAIN_SKILL' } });
  });

  afterEach(() => {
    cleanup();
    setSkillBookAutoRecompute(true);
    __resetSkillNameIndexForTests();
    useGameStore.setState({ skillEdits: {}, authoredGenerals: [], developerMode: false } as never);
  });

  it('① 下拉里每个名字后面写着出处；新建的自制卡真的进了这张册子', () => {
    const before = bookOptions();
    const tuotian = before.find(o => o.value === '屯田');
    expect(tuotian).toBeTruthy();
    expect(tuotian!.textContent).toBe('官方');
    // 官方卡上的技能今天全属官方，所以此刻下拉里没有任何一条写着玩家自制。
    expect(before.some(o => (o.textContent ?? '').includes('玩家自制'))).toBe(false);

    let createdOk = false;
    act(() => {
      createdOk = useGameStore.getState().addAuthoredGeneral(
        { name: '册子试验将', faction: '群', hp: 4, identity: '册子试验身份', skills: [settledSkill('自创摸一张')] },
        'DIY',
      ).ok;
    });
    expect(createdOk).toBe(true);

    // 不必刷新页面、不必重开编辑器：这一屏下一次渲染读到的就是重算过的册子。
    fireEvent.change(gainNameInput(), { target: { value: '屯田' } });
    const after = bookOptions();
    const diy = after.find(o => o.value === '自创摸一张');
    expect(diy).toBeTruthy();
    expect(diy!.textContent).toBe('玩家自制');
  });

  it('② 那句小计跟着册子走：加一张自制卡，玩家自制那一档从 0 枚变成 1 枚', () => {
    const line = Array.from(document.querySelectorAll('p'))
      .find(el => (el.textContent ?? '').includes('下拉里名字后面那半截写的是出处'))!;
    expect(line.textContent).toMatch(/此刻册子里 \d+ 枚官方 · 0 枚玩家自制/);

    act(() => {
      useGameStore.getState().addAuthoredGeneral(
        { name: '册子试验将', faction: '群', hp: 4, identity: '册子试验身份', skills: [settledSkill('自创摸一张')] },
        'DIY',
      );
    });
    fireEvent.change(gainNameInput(), { target: { value: '屯田' } });
    expect(Array.from(document.querySelectorAll('p'))
      .find(el => (el.textContent ?? '').includes('下拉里名字后面那半截写的是出处'))!.textContent)
      .toMatch(/此刻册子里 \d+ 枚官方 · 1 枚玩家自制/);
  });

  it('③ 下拉里有这个名字⇒那句"表上没有"就不出现（候选与警告是同一份算出来的两半）', () => {
    act(() => {
      useGameStore.getState().addAuthoredGeneral(
        { name: '册子试验将', faction: '群', hp: 4, identity: '册子试验身份', skills: [settledSkill('自创摸一张')] },
        'DIY',
      );
    });
    fireEvent.change(gainNameInput(), { target: { value: '自创摸一张' } });
    expect(bookOptions().some(o => o.value === '自创摸一张')).toBe(true);
    expect(screen.queryByText(/技能表里暂时没有「自创摸一张」/)).toBeNull();
  });

  it('④ 今天自动重算开着⇒那颗刷新按钮不出现；关掉自动重算它就在（用户要留的那一套）', () => {
    expect(screen.queryByRole('button', { name: '刷新技能册' })).toBeNull();

    setSkillBookAutoRecompute(false);
    fireEvent.change(gainNameInput(), { target: { value: '屯田' } });
    const button = screen.getByRole('button', { name: '刷新技能册' });
    // 点了不能炸：它就是把册子按这台机器现在的内容重算一遍。
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: '刷新技能册' })).toBeTruthy();
  });
});
