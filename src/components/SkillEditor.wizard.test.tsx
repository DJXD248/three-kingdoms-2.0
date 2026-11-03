/**
 * v2.9.21 两段式流程（§12-140①「将领→确认→技能→确认完整将领」）的界面接线证人。
 *
 * 钉六件事，全在真组件上：
 *  ① 选中将领后落在第 1 步，那一步只谈将领本人；技能那一屏不在这一步露出来；
 *  ② 那颗「确认将领」=流程的分界，**不写库**（写库仍然只有「💾 保存修改」那一条路）；
 *  ③ 第 2 步能回到第 1 步，两边改的是同一份内存态（不是两套字段）；
 *  ④ v2.9.24 刀2 起，「🪄 一句话生成将领」是真入口：采用＝只往第①步那几格里填字，
 *     **一样不写库**（刀1 那趟它还是灰占位，那时的证人是"点下去不产生任何东西"）；
 *  ⑤ 一句话里有段落没落进这张卡＝那颗「采用」**按住**、六格一字不改（用户 2026-11-04 §12-162 第 12 条；
 *     这之前那一版的证人是"点名之后照样采用、只是那一格不落"，已被这条裁翻面）；
 *  ⑥ 落进格子了、但里面还粘着没认的东西＝**另一族话**（刀2a 起）：既不许静默收下，也不许谎称"没落进去"，
 *     而且这一族**仍然放行**（采用能点）——把它也拦下来就是把两族并成一条闸。
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

/** 同一套定位，取那一格里的 `select`（势力那一格是下拉）。 */
function selectValueByLabel(labelText: string): string {
  const label = Array.from(document.querySelectorAll('label'))
    .find(l => l.textContent?.trim() === labelText);
  if (!label) throw new Error(`「${labelText}」那格不在这一屏`);
  return (label.parentElement!.querySelector('select') as HTMLSelectElement).value;
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

  // ── 第 12 条：有段落没落进这张卡＝那颗「采用」按住，六格一字都不许改。
  //    样本故意把势力写成**与这张卡不同**的一档（张辽是魏，句子说蜀）：这样"格子没动"才看得见，
  //    不会与"动了但恰好改成同一个值"混淆。
  it('一句话里有段落没落进去＝那颗采用点不动，六格一字不改', () => {
    openZhangliao();
    fireEvent.click(btnByText('🪄 一句话生成将领')!);
    const box = screen.getByLabelText('一句话生成将领') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '名：张辽文远，势力蜀，攻击力3' } });
    fireEvent.click(btnByText('按这句生成')!);
    expect(screen.getByText(/没落进去的那一段：「攻击力3」/).textContent)
      .toContain('攻击力有近战与远程两个数');
    expect(screen.getByText(/这句里有东西没落进这张卡/).textContent)
      .toContain('这颗「采用」我按住了');
    const adopt = btnByText('✔ 采用，把读到的填进上面那几格') as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
    fireEvent.click(adopt);
    // 那句明明读到了「张辽文远」与「蜀」，一个都不许进格子
    expect(nameInputValue()).toBe(zhangliao.name);
    expect(selectValueByLabel('势力')).toBe(zhangliao.faction);
    expect(fieldValueByLabel('近战 ⚔️')).toBe(String(zhangliao.meleeAtk));
    expect(useGameStore.getState().generalEdits[zhangliao.id]).toBeUndefined();
  });

  // ── 第⑥件：落进格子了、但里面还粘着没认的东西＝另一族话，**这一族第 12 条没把它算进退回**，
  //    所以那颗采用仍能点。样本用「多了一个关口的壳」那一族：它是这一族唯一的形状，
  //    与半角逗号／句号／空格那几格（都已按 §12-162 裁完）无关。
  it('落进格子那一段里还粘着没认的东西＝另起一句说，这一族仍放行，不许写成「没落进去」', () => {
    openZhangliao();
    fireEvent.click(btnByText('🪄 一句话生成将领')!);
    const box = screen.getByLabelText('一句话生成将领') as HTMLTextAreaElement;
    // 「郭淮）」整串真的落进了「名称」那一格，同时里面粘着没认的东西：
    // 这两件事必须分开说——说它"没落进去"是假话（格子明明被填了），
    // 只说"落进去了"又把玩家该改的地方藏起来。
    fireEvent.change(box, { target: { value: '势力魏，名：郭淮）' } });
    fireEvent.click(btnByText('按这句生成')!);
    expect(screen.getByText(/这一格收下了，但里面还粘着没认的东西/).textContent)
      .toContain('多了一个关口的壳');
    expect(screen.queryByText(/这句里有东西没落进这张卡/)).toBeNull();
    const adopt = btnByText('✔ 采用，把读到的填进上面那几格') as HTMLButtonElement;
    expect(adopt.disabled).toBe(false);
    fireEvent.click(adopt);
    expect(nameInputValue()).toBe('郭淮）');
    // 势力那一格是下拉，值要从 `select` 上取（`fieldValueByLabel` 只认 input）
    expect(selectValueByLabel('势力')).toBe('魏');
    // 这句没点体力／近战／远程＝一格都不动
    expect(fieldValueByLabel('体力 ❤️')).toBe(String(zhangliao.hp));
    const note = screen.getByText(/已填进：/);
    expect(note.textContent).toContain('已填进：名称／势力');
    expect(note.textContent).toContain('这几格收下了、里面还粘着没认的东西：「郭淮）」');
    // 假话的形状：把收下了那一格也说成"没落进去"
    expect(note.textContent).not.toContain('没落进去的：');
    // 与上面那条同一条硬边界：采用不等于保存
    expect(useGameStore.getState().generalEdits[zhangliao.id]).toBeUndefined();
  });

  // ── 两族同时在场：那一句"还粘着"不许替玩家把闸打开——只要有一段真没落进去，那颗钮仍按着。
  it('两族同时在场＝"没落进去"那一段照样把采用按住，两句各说各的', () => {
    openZhangliao();
    fireEvent.click(btnByText('🪄 一句话生成将领')!);
    const box = screen.getByLabelText('一句话生成将领') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '势力魏，攻击力3，名：郭淮）' } });
    fireEvent.click(btnByText('按这句生成')!);
    expect(screen.getByText(/没落进去的那一段：「攻击力3」/)).toBeTruthy();
    expect(screen.getByText(/这一格收下了，但里面还粘着没认的东西：「郭淮）」/)).toBeTruthy();
    const adopt = btnByText('✔ 采用，把读到的填进上面那几格') as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
    fireEvent.click(adopt);
    expect(nameInputValue()).toBe(zhangliao.name);
    expect(useGameStore.getState().generalEdits[zhangliao.id]).toBeUndefined();
  });

  // ── 第①件（§12-162 第 6 条：括号开了没关上＝那整截整个不要）在界面上的形状，
  //    叠上第 12 条（有段落没落进去＝退回）⇒ 今天这颗采用是**按住**的，壳前那半也进不了格子。
  //    「壳前那半是干净的名字」这一条住在纯函数证人里（generalTextParse.test.ts 第 6 条那一组）。
  it('括号开了没关上＝从壳起的整截一格不落、被点名，且那颗采用按住（壳前那半也进不了格子）', () => {
    openZhangliao();
    fireEvent.click(btnByText('🪄 一句话生成将领')!);
    const box = screen.getByLabelText('一句话生成将领') as HTMLTextAreaElement;
    // 那句里的「势力蜀」整截被没关上的壳吞进去：既没落进格子，也把那颗钮按死
    fireEvent.change(box, { target: { value: '名：张辽文远（字长文，势力蜀' } });
    fireEvent.click(btnByText('按这句生成')!);
    // 那句要点清真因在壳上，不许再说「我不知道是哪一格」
    expect(screen.getByText(/没落进去的那一段：「（字长文，势力蜀」/).textContent)
      .toContain('开了没关上');
    const adopt = btnByText('✔ 采用，把读到的填进上面那几格') as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
    fireEvent.click(adopt);
    // 怪尾巴不许进这一格，更不许进名册；壳前那半今天也没放行
    expect(nameInputValue()).toBe(zhangliao.name);
    expect(selectValueByLabel('势力')).toBe(zhangliao.faction);
    expect(screen.queryByText(/已填进：/)).toBeNull();
    // 假话的形状：既然整截没落进格子，就不许说它"收下了、里面还粘着东西"
    expect(screen.queryByText(/这几格收下了/)).toBeNull();
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
