/**
 * 新建将领两步刀 · 刀1「新建将领也分两步」的界面接线证人（纯 jsdom 点击级）。
 *
 * 钉四件事，都对着用户 2026-11-02 那句「新建将领要不要跟编辑将领一样分两步，我选甲」：
 *  ① 措辞同源：新建那颗确认钮的词**以编辑那颗为准**，两串在同一屏里逐字对得上，
 *     且那句字面在 `SkillEditor.tsx` 里只出现一次（只有一份打字的地方，不是抄了两遍）；
 *  ② 点下去真的建卡＋人当场落到第②步（不再把人留在原地要他自己去左列点这张卡）；
 *     拒了的时候人不许被带走；
 *  ③ 新建那一排从此也能点近战／远程：填了逐字进卡，空着才交回按体力推（两把尺：体力≥4 与 <4 各一条），
 *     填 0 不等于没填；
 *  ④ 没有硬闸：顶栏「①／②」照旧随时可点，且第①步看到的数字就是卡上那份。
 *
 * 判据全部向实现要：卡的真身读 `useGameStore.getState().authoredGenerals`，
 * 措辞读两颗钮各自的 DOM 文本（不写死中文常量去做比较）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { DIY_ID_PREFIX } from '../domain/generalProvenance';

const zhangliao = allGenerals.find(g => g.id === 'wei_004')!;

const btnByText = (needle: string) => Array.from(document.querySelectorAll('button'))
  .find(b => (b.textContent ?? '').includes(needle));

/** 两颗同词的钮在同一屏里会并存，比较措辞时必须能点名其中一颗。 */
const btnByExactText = (text: string) => Array.from(document.querySelectorAll('button'))
  .find(b => (b.textContent ?? '').trim() === text);

/** 新建那一排的三个输入格（名称／体力；近战、远程走 aria-label）。 */
const nameInput = () => Array.from(document.querySelectorAll('input'))
  .find(i => (i.getAttribute('placeholder') ?? '').startsWith('名字')) as HTMLInputElement;
const hpInput = () => document.querySelector('input[title="体力"]') as HTMLInputElement;
const meleeInput = () => screen.getByLabelText('近战（新建）') as HTMLInputElement;
const rangedInput = () => screen.getByLabelText('远程（新建）') as HTMLInputElement;

/** 第①步那六格在不在（按编辑那条的标签文字取证，不靠顺序）。 */
const identityFieldsVisible = () =>
  Array.from(document.querySelectorAll('label')).some(l => l.textContent?.trim() === '近战 ⚔️');

function fieldValueByLabel(labelText: string): string {
  const label = Array.from(document.querySelectorAll('label'))
    .find(l => l.textContent?.trim() === labelText);
  if (!label) throw new Error(`「${labelText}」那格不在这一屏`);
  return (label.parentElement!.querySelector('input') as HTMLInputElement).value;
}

function openCreateRow() {
  fireEvent.click(btnByText('➕ 新建将领')!);
}

function fillCreate(o: { name?: string; hp?: string; melee?: string; ranged?: string }) {
  if (o.name !== undefined) fireEvent.change(nameInput(), { target: { value: o.name } });
  if (o.hp !== undefined) fireEvent.change(hpInput(), { target: { value: o.hp } });
  if (o.melee !== undefined) fireEvent.change(meleeInput(), { target: { value: o.melee } });
  if (o.ranged !== undefined) fireEvent.change(rangedInput(), { target: { value: o.ranged } });
}

const clickCreateConfirm = () => fireEvent.click(btnByText('确认将领，进入技能编辑')!);

describe('新建将领两段式：确认＝建卡＋自动落到第②步', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useGameStore.setState({
      authoredGenerals: [], skillEdits: {}, generalEdits: {}, developerMode: true,
      lockedGeneralIds: new Set<string>(), disabledGenerals: new Set<string>(),
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('① 新建那颗钮的词以编辑那颗为准：同串字打头、只多一句"这一步就创建"', () => {
    render(<SkillEditor onClose={() => {}} />);
    fireEvent.click(btnByText(zhangliao.name)!);          // 编辑那条落在第①步
    openCreateRow();
    const editBtn = btnByExactText('✔ 确认将领，进入技能编辑')!;   // 底栏那颗（先立的形状）
    const createBtns = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent ?? '').includes('确认将领，进入技能编辑'));
    expect(editBtn).toBeTruthy();
    expect(createBtns).toHaveLength(2);                   // 编辑那颗 + 新建那颗
    const createBtn = createBtns.find(b => b !== editBtn)!;
    const editLabel = editBtn.textContent!.trim();
    const createLabel = createBtn.textContent!.trim();
    // 逐字同源：新建那颗必须以编辑那颗整串打头，且必须更长（多出来的那句要说清"这一步真的建卡"）
    expect(createLabel.startsWith(editLabel)).toBe(true);
    expect(createLabel.length).toBeGreaterThan(editLabel.length);
    // 监督台复量判这条是弱断言（轻改后缀它不咬），所以补这一行：逐字钉住多出来那句
    expect(createLabel.slice(editLabel.length)).toBe('（这一步就创建这张将）');
    expect(createLabel).not.toBe(editLabel);              // 两条腿按下之后做的事不一样，不许一字不差
    // 措辞只有一份：那句字面在生产码里只许出现在常量声明处
    const src = readFileSync(resolve(process.cwd(), 'src/components/SkillEditor.tsx'), 'utf8');
    expect(src.split(editLabel).length - 1).toBe(1);
  });

  it('② 点新建那颗确认：卡真长出来（走唯一那条建卡路）＋人当场落到第②步', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fillCreate({ name: '关平' });                          // 体力留缺省 4、近战远程都不点
    clickCreateConfirm();

    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    const g = created[0];
    expect(g.name).toBe('关平');
    expect(g.faction).toBe('蜀');                          // 那一排的缺省势力
    expect(g.hp).toBe(4);
    expect(g.id.startsWith(DIY_ID_PREFIX)).toBe(true);    // 仍然只发 DIY 那一条号
    expect(g.source).toBe('DIY');
    // 落到第②步：技能那一屏在场，身份六格不在场
    expect(screen.getByText('技能列表')).toBeTruthy();
    expect(btnByText('保存修改')).toBeTruthy();
    expect(identityFieldsVisible()).toBe(false);
    // 回显那句话还在（这一腿没换掉建卡回执）
    expect(screen.getByText(/已新建「关平·蜀」/)).toBeTruthy();
  });

  it('②b 新建那一排的近战／远程填了就逐字进卡，不被公式覆盖', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fillCreate({ name: '关统', hp: '4', melee: '5', ranged: '6' });
    clickCreateConfirm();
    const g = useGameStore.getState().authoredGenerals[0];
    // 5／6 与体力 4 会推出的 2／1 不同，所以这条不可能是"公式碰巧对上了"
    expect(g.meleeAtk).toBe(5);
    expect(g.rangedAtk).toBe(6);
    // 第②步回到第①步，看到的就该是卡上那份
    fireEvent.click(screen.getByText('① 将领身份'));
    expect(fieldValueByLabel('近战 ⚔️')).toBe('5');
    expect(fieldValueByLabel('远程 🏹')).toBe('6');
    expect(fieldValueByLabel('体力 ❤️')).toBe('4');
  });

  it('③a1 空着＝这句话没点：体力 5（≥4）→ 武将 2／1', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fillCreate({ name: '甲', hp: '5' });
    expect(meleeInput().value).toBe('');                   // 空着就是空着，界面不偷偷补一个数
    clickCreateConfirm();
    const a = useGameStore.getState().authoredGenerals[0];
    expect([a.meleeAtk, a.rangedAtk]).toEqual([2, 1]);
    expect(a.type).toBe('武将');
  });

  it('③a2 空着＝这句话没点：体力 2（<4）→ 文将 1／2（两把尺，不止一条路对）', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fillCreate({ name: '乙', hp: '2' });
    clickCreateConfirm();
    const b = useGameStore.getState().authoredGenerals[0];
    expect([b.meleeAtk, b.rangedAtk]).toEqual([1, 2]);
    expect(b.type).toBe('文将');
  });

  it('③b 填 0 是"点了 0"，不许被当成没填又去推', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fillCreate({ name: '丙', hp: '5', melee: '0', ranged: '0' });
    clickCreateConfirm();
    const c = useGameStore.getState().authoredGenerals[0];
    expect([c.meleeAtk, c.rangedAtk]).toEqual([0, 0]);
  });

  it('③c 填了又抹掉＝回到"没点"，那一格不许留下 1 这样的脚印', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fillCreate({ name: '丁', hp: '5', melee: '3' });
    expect(meleeInput().value).toBe('3');
    fireEvent.change(meleeInput(), { target: { value: '' } });
    expect(meleeInput().value).toBe('');
    clickCreateConfirm();
    const d = useGameStore.getState().authoredGenerals[0];
    expect([d.meleeAtk, d.rangedAtk]).toEqual([2, 1]);
  });

  it('④ 建卡被拒时人不许被带走：一张卡都没有，也一个字段都不落', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    // 名字空着——那一排自己就能按出这颗钮，所以判据必须钉在"拒了还留在原地"
    clickCreateConfirm();
    expect(screen.getByText(/未创建：名字不能为空/)).toBeTruthy();
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
    expect(screen.queryByText('技能列表')).toBeNull();       // 没跳到第②步
    expect(nameInput()).toBeTruthy();                        // 那一排还在原地

    // 体力填 0（名字已填）：同一颗钮、同一条拒路，拒的那句话还得点对原因
    fillCreate({ name: '戊', hp: '0' });
    clickCreateConfirm();
    expect(screen.getByText(/未创建：体力必须是大于 0 的数字/)).toBeTruthy();
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
    expect(screen.queryByText('技能列表')).toBeNull();
  });

  it('⑤ 一句话那条入口按下"采用并按这句建这张将"，也一样落到第②步', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fireEvent.click(btnByText('🪄 一句话生成将领')!);
    fireEvent.change(screen.getByLabelText('一句话生成将领'), {
      // 三枚技能名用顿号点开（2026-11-04 §12-162 第 1 条裁「甲：切出来的名字去名册里查，查得到才切」
      // 之后，「武圣和兴师」那一路因为兴师不在名册里＝整枚退回、那颗采用按住；本条钉的是**导航那条腿**，
      // 换分隔符不改变它要证的事）
      target: { value: '名：关兴，蜀，体力4，近战2，远程1，技能：武圣、兴师' },
    });
    fireEvent.click(btnByText('按这句生成')!);
    fireEvent.click(btnByText('✔ 采用并按这句建这张将')!);

    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    const g = created[0];
    expect([g.name, g.faction, g.hp, g.meleeAtk, g.rangedAtk]).toEqual(['关兴', '蜀', 4, 2, 1]);
    expect(g.skills.map(s => s.name)).toEqual(['武圣', '兴师']);
    expect(g.skills.every(s => s.effects === undefined && s.trigger === undefined)).toBe(true);
    // 两条入口同一条路：也当场被带进第②步，技能只记名那句回显也说清了
    expect(screen.getByText('技能列表')).toBeTruthy();
    expect(screen.getByText(/技能只记名/)).toBeTruthy();
  });

  it('⑥ 没有硬闸：第②步随时能点顶栏回到第①步，再点回去也不丢人', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fillCreate({ name: '关平' });
    clickCreateConfirm();
    expect(screen.getByText('技能列表')).toBeTruthy();
    // 顶栏那两颗照旧是钮，不是灯
    fireEvent.click(screen.getByText('① 将领身份'));
    expect(identityFieldsVisible()).toBe(true);
    expect(fieldValueByLabel('名称')).toBe('关平');
    expect(fieldValueByLabel('近战 ⚔️')).toBe('2');   // 体力 4 推出来的那一份
    expect(fieldValueByLabel('远程 🏹')).toBe('1');
    fireEvent.click(screen.getByText('② 技能编辑'));
    expect(screen.getByText('技能列表')).toBeTruthy();
    expect(identityFieldsVisible()).toBe(false);
  });

  it('⑦ 新建落成后按第②步那颗保存：写库仍只有那一条路', () => {
    render(<SkillEditor onClose={() => {}} />);
    openCreateRow();
    fillCreate({ name: '关平' });
    clickCreateConfirm();
    fireEvent.click(btnByText('保存修改')!);
    const g = useGameStore.getState().authoredGenerals[0];
    expect(useGameStore.getState().authoredGenerals).toHaveLength(1);  // 保存不再多长一张卡
    expect(useGameStore.getState().skillEdits[g.id]).toBeTruthy();
    expect(screen.getByText('✅ 已保存')).toBeTruthy();
  });
});
