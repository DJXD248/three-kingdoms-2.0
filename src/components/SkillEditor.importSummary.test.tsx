/**
 * v2.8.13 导入总结面板（用户 2026-09-29 三口径）：
 * ①Excel 与文本两条导入路**共用同一份**总结 ②常驻面板＋「知道了」＋整段可复制
 * ③技能改动**只点名**。旧值一律取"写入前的当前生效视图"（#47 裁决同一口径），
 * 无变化被跳过的那些**绝不进**总结。
 *
 * 2026-10-25 口径反转后，Excel 路多了一步"玩家决定"：喂文件只开「待处理」，
 * 真正写入发生在点了「修改现有」之后——总结记的仍然是"写进去的那一下"。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { renderSummaryText } from './skillEditor/importSummary';

// v2.9.6：换成张辽「突袭」（将名唯一的官方卡）。两张同名「关羽」会让"按名字点行/按名字查将"
// 落在魏那一张；更要紧的是武圣现在带**结构化载荷**，用它做导入总结的对照物，光改体力就会
// 多报一条"技能改动"——那是内容的真变化，却会把本文件想测的"只点名体力"糊掉。
const zhangliao = allGenerals.find(g => g.id === 'wei_004')!;

const HEADER = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动',
  '触发时机', '效果模式', '技能描述', '技能门槛',
  '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛',
  '设定备注'];

const rowFor = (hp: number, name: string = zhangliao.name, faction: string = zhangliao.faction, skill: string = '突袭') => [
  name, faction, hp, zhangliao.meleeAtk, zhangliao.rangedAtk,
  skill, '无', '无', '无', '无', '无', '无',
  '', '', '', '', '', '', '', '✓ 已完成',
];

function fileFrom(rows: (string | number)[][]): File {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '魏');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([buf], '将领数据.xlsx');
}

const toastText = () => Array.from(document.querySelectorAll('span'))
  .find(s => s.textContent?.startsWith('✅') || s.textContent?.startsWith('❌'))?.textContent ?? '';

/** 面板用自己的稳定钩子，不靠 Tailwind 类名——`.whitespace-pre-wrap` 在编辑器里别处也用。 */
const panel = () => document.querySelector('[data-testid="import-summary"]');
const hasPanel = () => !!panel();
/** 读的就是"复制全文"要交出去的那段字（面板文字与剪贴板必须逐字同一个来源）。 */
const summaryText = () => document.querySelector('[data-testid="import-summary-text"]')?.textContent ?? '';

/** 待处理面板上"修改现有"那枚按钮（单候选时是按钮，多候选时是下拉）。 */
const modifyButton = () => Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent?.trim().startsWith('修改「'))!;

const storageSnapshot = () => JSON.stringify({
  s: localStorage.getItem('three_kingdoms_skill_edits'),
  g: localStorage.getItem('three_kingdoms_general_edits'),
  a: localStorage.getItem('three_kingdoms_authored_generals'),
});

function arm(developerMode = true) {
  cleanup();
  localStorage.clear();
  useGameStore.setState({
    developerMode,
    skillEdits: {},
    generalEdits: {},
    disabledGenerals: new Set<string>(),
    lockedGeneralIds: new Set<string>(),
    authoredGenerals: [],
    identityRegistry: [],
  } as Partial<ReturnType<typeof useGameStore.getState>>);
  render(<SkillEditor onClose={() => {}} />);
  fireEvent.click(screen.getByText('📄 导入'));
}

async function importFile(file: File, expectText: string) {
  const input = document.querySelector('input[type=file][accept=".xlsx,.xls"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(toastText()).toContain(expectText));
  return toastText();
}

/** 导入一张同名同势力的卡⇒点「修改现有」，这是 2026-10-25 之后唯一会写入 Excel 数据的路。 */
async function importAndModify(file: File) {
  await importFile(file, '1 名等你在下方决定');
  fireEvent.click(modifyButton());
  await waitFor(() => expect(toastText()).toContain('已更新将领'));
}

describe('导入总结 · Excel 路', () => {
  afterEach(cleanup);

  it('改体力的行⇒面板写「修改 1 名 · 张辽：体力 4→5」，条目名与改动项都点名', async () => {
    arm();
    expect(hasPanel()).toBe(false); // 没导入过⇒不弹空壳
    await importAndModify(fileFrom([rowFor(zhangliao.hp + 1)]));
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    expect(summaryText()).toContain(`· 张辽：体力 ${zhangliao.hp}→${zhangliao.hp + 1}`);
  });

  it('原样重导（内容一致）⇒点修改也不写，总结面板逐字不变', async () => {
    arm();
    const file = fileFrom([rowFor(zhangliao.hp + 1)]);
    await importAndModify(file);
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    const first = summaryText();
    const store = storageSnapshot();
    await importFile(file, '1 名等你在下方决定');
    fireEvent.click(modifyButton());
    await waitFor(() => expect(document.body.textContent).toContain('和现有卡一致'));
    expect(summaryText()).toBe(first);
    expect(summaryText()).not.toContain('修改 2 名');
    expect(storageSnapshot()).toBe(store);
  });

  it('旧值取的是生效视图而非仓库原始卡：第二次导入报「5→6」，不是「4→6」（#47 口径）', async () => {
    arm();
    await importAndModify(fileFrom([rowFor(zhangliao.hp + 1)]));
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    await importAndModify(fileFrom([rowFor(zhangliao.hp + 2)]));
    await waitFor(() => expect(summaryText()).toContain(`体力 ${zhangliao.hp + 1}→${zhangliao.hp + 2}`));
    expect(summaryText()).not.toContain(`体力 ${zhangliao.hp}→${zhangliao.hp + 2}`);
  });

  it('技能变更加一行⇒只点名是哪条技能，不铺平到槽位', async () => {
    arm();
    const row = rowFor(zhangliao.hp);
    const withSkill = [...row];
    withSkill[10] = '本机自填的一句话：官方卡面上没有这句';
    await importAndModify(fileFrom([withSkill]));
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    expect(summaryText()).toContain('技能「突袭」改动');
    expect(summaryText()).not.toContain('描述');
  });
});

describe('导入总结 · 文本路与待点选新建共用同一份', () => {
  afterEach(cleanup);

  it('文本导入报「新增技能「义绝」」，且与先前 Excel 那条累积在同一面板（两条路一份总结）', async () => {
    arm();
    await importAndModify(fileFrom([rowFor(zhangliao.hp + 1)]));
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: `${zhangliao.name}|突袭,义绝` } });
    fireEvent.click(screen.getByText('导入文本'));
    await waitFor(() => expect(summaryText()).toContain('新增技能「义绝」'));
    expect(summaryText()).toContain(`体力 ${zhangliao.hp}→${zhangliao.hp + 1}`);
  });

  it('待点选里点「新建」⇒总结记一条「新增 1 名 · 名字：技能名」', async () => {
    arm();
    await importFile(fileFrom([rowFor(4, zhangliao.name, zhangliao.faction, '试探')]), '1 名等你在下方决定');
    fireEvent.click(screen.getByText('新建'));
    await waitFor(() => expect(toastText()).toContain('已新建'));
    await waitFor(() => expect(summaryText()).toContain('新增 1 名'));
    expect(summaryText()).toContain('· 张辽：试探');
    expect(useGameStore.getState().authoredGenerals.map(g => g.name)).toContain('张辽');
  });
});

describe('导入总结 · 面板自身行为', () => {
  afterEach(cleanup);

  it('「知道了」关掉面板，但已经写进存档的内容一条都不回滚', async () => {
    arm();
    await importAndModify(fileFrom([rowFor(zhangliao.hp + 1)]));
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    const before = storageSnapshot();
    fireEvent.click(screen.getByText('知道了'));
    await waitFor(() => expect(hasPanel()).toBe(false));
    expect(storageSnapshot()).toBe(before);
    expect(useGameStore.getState().generalEdits[zhangliao.id]?.hp).toBe(zhangliao.hp + 1);
  });

  it('「复制全文」交出去的就是面板上那一段字（所见＝所得）', async () => {
    arm();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await importAndModify(fileFrom([rowFor(zhangliao.hp + 1)]));
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    fireEvent.click(screen.getByText('复制全文'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toBe(summaryText());
    expect(payload).toBe(renderSummaryText([
      { kind: 'modified', name: '张辽', items: [`体力 ${zhangliao.hp}→${zhangliao.hp + 1}`] },
    ]));
  });

  it('权限被拦下的行不进总结（"写不了"绝不被说成"改了什么"）', async () => {
    arm(false); // 玩家模式：官方将写不动
    await importFile(fileFrom([rowFor(zhangliao.hp + 1)]), '1 名等你在下方决定');
    fireEvent.click(modifyButton());
    await waitFor(() => expect(document.body.textContent).toContain('无法修改'));
    expect(hasPanel()).toBe(false);
  });
});
