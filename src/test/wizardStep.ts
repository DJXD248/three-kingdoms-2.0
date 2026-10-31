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

/**
 * 选中某张卡（按名字命中左栏那一行），然后走进第 2 步。
 *
 * 认的是**那一行名字自己的整串**，不是整行的"包含"：读法㈁ 把转换表的 239 张卡并进名册后，
 * 左栏同时有「夏侯惇」与「⭐夏侯惇」，按包含点会挑错人（同一个名字还可能在两个势力各一张）。
 * 所以这里只准命中一行；命中零行或多行一律抛错——这是"空跑蒙绿"的反面。
 */
export function selectGeneralAndOpenSkills(name: string) {
  const rows = Array.from(document.querySelectorAll('button')).filter(b => {
    const nameLabel = b.querySelector('div.min-w-0 > p');
    return nameLabel?.firstChild?.nodeValue?.trim() === name;
  });
  if (rows.length !== 1) {
    throw new Error(`按名字整串点「${name}」命中 ${rows.length} 行（只许 1 行）⇒ 这趟没点到人，别拿它当证据`);
  }
  const row = rows[0];
  fireEvent.click(row);
  clickIntoSkillsStep();
  return row;
}
