/**
 * v2.9.9「自己写效果 → 生成技能给玩家确认 → 采用后进拼积木格子」的界面接线证人。
 *
 * 钉的是用户那句话的四件事，全在真组件上：
 *  ① 一句话能生成出可结算的积木，并且先让玩家看见"系统会怎么说"；
 *  ② 看不懂的那一段**当场原文点名**＋一句照着改得动的理由，一条也不半收；
 *  ③ 采用之后落进的就是今天那几格积木（不新增第四样存储、不新增第二条结算路）；
 *  ④ 下拉里有、引擎还没接线的那类时机：照样生成、照样能采用，但必须说一句"今天还不响"。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { clickIntoSkillsStep } from '../test/wizardStep';

function openFirstPlainSkill() {
  const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
  render(<SkillEditor onClose={() => {}} />);
  const listBtn = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes(target.name));
  fireEvent.click(listBtn!);
  // v2.9.21 两段式：选中后落在第 1 步，技能那一屏要点「② 技能编辑」才露出来。
  clickIntoSkillsStep();
  return target;
}

function openTextPanel() {
  // 一员将可能有好几枚技能、每枚一格面板，取第一枚那格。
  fireEvent.click(screen.getAllByText('✍️ 自己写效果（一句话生成积木）')[0]);
  return screen.getByLabelText('自己写效果') as HTMLTextAreaElement;
}

function writeAndGenerate(text: string) {
  fireEvent.change(openTextPanel(), { target: { value: text } });
  fireEvent.click(screen.getAllByText('按这句生成')[0]);
}

function clickAdopt(label: string) {
  fireEvent.click(screen.getAllByText(label)[0]);
}

describe('自己写效果：生成 → 确认 → 进积木', () => {
  beforeEach(() => {
    cleanup();
    useGameStore.setState({ skillEdits: {}, generalEdits: {}, developerMode: true });
  });

  it('写一句能懂的话：先给出"系统会怎么说"，采用后进的就是那几格积木', () => {
    openFirstPlainSkill();
    writeAndGenerate('受到伤害后，对伤害来源，回复 1 点体力。');
    expect(screen.getByText('✔ 受到伤害后，对伤害来源，回复 1 点体力。')).toBeTruthy();

    clickAdopt('✔ 采用这 1 条效果（进下面的拼积木格子逐条改）');
    const box = screen.getByLabelText('效果1卡面文字') as HTMLTextAreaElement;
    expect(box.value).toBe('受到伤害后，对伤害来源，回复 1 点体力。');
    // 积木格子真的在：结构化效果那一档下拉摆在面前，玩家可以逐格改。
    const rt = Array.from(document.querySelectorAll('select'))
      .find(s => s.options[0]?.text?.startsWith('纯描述')) as HTMLSelectElement;
    expect(rt.value).toBe('HEAL');
  });

  it('看不懂的那一段逐段点名，并且一句也不半收', () => {
    openFirstPlainSkill();
    // v2.9.13：例子从「其他角色摸两张牌」换成「其他玩家摸两张牌」——用户裁定前者是
    // **用词错误**（本作没有「角色摸牌」），单独归了一档，见下面那一条。
    writeAndGenerate('其他玩家摸两张牌。');
    const line = screen.getByText(/不支持的一段/).textContent ?? '';
    expect(line).toContain('其他玩家摸两张牌');
    expect(line).toContain('还没做');
    expect(screen.getByText(/一句也没生成/)).toBeTruthy();
    expect(screen.queryByText(/^✔ 采用这/)).toBeNull();
  });

  it('「其他角色摸两张牌」＝用词错误：界面讲的是"角色没有手牌这一格"，不是"内容还没做"', () => {
    openFirstPlainSkill();
    writeAndGenerate('其他角色摸两张牌。');
    const line = screen.getByText(/不支持的一段/).textContent ?? '';
    expect(line).toContain('没有手牌');
    expect(line).toContain('其他玩家摸两张牌');
    expect(screen.getByText(/一句也没生成/)).toBeTruthy();
    expect(screen.queryByText(/^✔ 采用这/)).toBeNull();
  });

  it('半懂的那一句：认得的动作也不许只收一半（"对谁"读不懂＝整条退回）', () => {
    openFirstPlainSkill();
    writeAndGenerate('对场上所有人，造成 1 点技能伤害。');
    expect(screen.queryByText('✔ 造成伤害后，造成 1 点技能伤害。')).toBeNull();
    expect(screen.getAllByText(/不支持的一段/).length).toBeGreaterThan(1);
  });

  it('徽章写进了效果句：这句其余部分照收，另说一句该去哪儿勾', () => {
    openFirstPlainSkill();
    writeAndGenerate('限定技，回复 1 点体力。');
    expect(screen.getByText(/是徽章，不写在效果句里/)).toBeTruthy();
    expect(screen.getAllByText('✔ 采用这 1 条效果（进下面的拼积木格子逐条改）').length).toBeGreaterThan(0);
  });

  it('还没接线的时机：照样生成、照样能采用，但当场说明"今天还不响"', () => {
    openFirstPlainSkill();
    writeAndGenerate('其他将领登场时（其他玩家将领登场），摸 1 张牌。');
    expect(screen.getByText(/今天还不会响/)).toBeTruthy();
    clickAdopt('✔ 采用这 1 条效果（进下面的拼积木格子逐条改）');
    expect((screen.getByLabelText('效果1卡面文字') as HTMLTextAreaElement).value)
      .toBe('其他将领登场时（其他玩家将领登场），摸 1 张牌。');
  });

  it('保存下去的还是那三格积木＋一句人话，没有第四样东西', () => {
    const target = openFirstPlainSkill();
    writeAndGenerate('以下依次生效，回合开始时，摸 2 张牌；造成伤害后，造成 1 点技能伤害。');
    expect(screen.getByText(/模式按您写的头一句记下了：以下依次生效/)).toBeTruthy();
    clickAdopt('✔ 采用这 2 条效果（进下面的拼积木格子逐条改）');
    fireEvent.click(screen.getByText('💾 保存修改'));

    const saved = useGameStore.getState().skillEdits[target.id]?.[0];
    expect(saved?.effectMode).toBe('chain');
    expect(saved?.effects?.map(e => e.runtime?.type)).toEqual(['DRAW_CARD', 'DAMAGE']);
    expect(saved?.effects?.[0].description).toBe('回合开始时，摸 2 张牌。');
    expect(saved).not.toHaveProperty('freeText');
  });
});
