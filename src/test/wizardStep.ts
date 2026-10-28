import { fireEvent } from '@testing-library/react';

/**
 * v2.9.21 两段式流程（§12-140①）：编辑器选中将领后落在第 1 步「① 将领身份」，
 * 技能那一屏在第 2 步。测试要摸技能格子，必须先点这一步——真玩家也是这么走的。
 */
export function clickIntoSkillsStep(label = '② 技能编辑') {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label);
  if (!btn) throw new Error(`没找到「${label}」按钮：两段式流程的第 2 步入口不在了`);
  fireEvent.click(btn);
  return btn;
}

/** 选中某张卡（按名字命中左栏那一行），然后走进第 2 步。 */
export function selectGeneralAndOpenSkills(name: string) {
  const row = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(name));
  if (!row) throw new Error(`没找到将领「${name}」那一行`);
  fireEvent.click(row);
  clickIntoSkillsStep();
  return row;
}
