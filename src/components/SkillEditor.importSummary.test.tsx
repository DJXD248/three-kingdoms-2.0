/**
 * v2.8.13 导入总结面板（用户 2026-09-29 三口径）：
 * ①Excel 与文本两条导入路**共用同一份**总结 ②常驻面板＋「知道了」＋整段可复制
 * ③技能改动**只点名**。旧值一律取"写入前的当前生效视图"（#47 裁决同一口径），
 * 无变化被跳过的那些**绝不进**总结。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { renderSummaryText } from './skillEditor/importSummary';

const guanyu = allGenerals.find(g => g.id === 'shu_002')!;

const HEADER = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动',
  '触发时机', '效果模式', '技能描述', '技能门槛',
  '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛',
  '设定备注'];

const rowFor = (hp: number, name: string = guanyu.name, faction: string = guanyu.faction, skill: string = '武圣') => [
  name, faction, hp, guanyu.meleeAtk, guanyu.rangedAtk,
  skill, '无', '无', '无', '无', '无', '无',
  '', '', '', '', '', '', '', '✓ 已完成',
];

function fileFrom(rows: (string | number)[][]): File {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '蜀');
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

describe('导入总结 · Excel 路', () => {
  afterEach(cleanup);

  it('改体力的行⇒面板写「修改 1 名 · 关羽：体力 4→5」，条目名与改动项都点名', async () => {
    arm();
    expect(hasPanel()).toBe(false); // 没导入过⇒不弹空壳
    await importFile(fileFrom([rowFor(guanyu.hp + 1)]), '导入 1 名将领');
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    expect(summaryText()).toContain(`· 关羽：体力 ${guanyu.hp}→${guanyu.hp + 1}`);
  });

  it('原样重导（被跳过的那些）⇒绝不进总结，面板内容逐字不变', async () => {
    arm();
    const file = fileFrom([rowFor(guanyu.hp + 1)]);
    await importFile(file, '导入 1 名将领');
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    const first = summaryText();
    const store = storageSnapshot();
    await importFile(file, '跳过 1 名无变化');
    expect(summaryText()).toBe(first);
    expect(summaryText()).not.toContain('修改 2 名');
    expect(storageSnapshot()).toBe(store);
  });

  it('旧值取的是生效视图而非仓库原始卡：第二次导入报「5→6」，不是「4→6」（#47 口径）', async () => {
    arm();
    await importFile(fileFrom([rowFor(guanyu.hp + 1)]), '导入 1 名将领');
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    await importFile(fileFrom([rowFor(guanyu.hp + 2)]), '导入 1 名将领');
    await waitFor(() => expect(summaryText()).toContain(`体力 ${guanyu.hp + 1}→${guanyu.hp + 2}`));
    expect(summaryText()).not.toContain(`体力 ${guanyu.hp}→${guanyu.hp + 2}`);
  });

  it('技能变更加一行⇒只点名是哪条技能，不铺平到槽位', async () => {
    arm();
    const row = rowFor(guanyu.hp);
    const withSkill = [...row];
    withSkill[10] = '出牌阶段，你可以将一张红色牌当【杀】使用或打出';
    await importFile(fileFrom([withSkill]), '导入 1 名将领');
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    expect(summaryText()).toContain('技能「武圣」改动');
    expect(summaryText()).not.toContain('描述');
  });
});

describe('导入总结 · 文本路与待点选新建共用同一份', () => {
  afterEach(cleanup);

  it('文本导入报「新增技能「义绝」」，且与先前 Excel 那条累积在同一面板（两条路一份总结）', async () => {
    arm();
    await importFile(fileFrom([rowFor(guanyu.hp + 1)]), '导入 1 名将领');
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: `${guanyu.name}|武圣,义绝` } });
    fireEvent.click(screen.getByText('导入文本'));
    await waitFor(() => expect(summaryText()).toContain('新增技能「义绝」'));
    expect(summaryText()).toContain(`体力 ${guanyu.hp}→${guanyu.hp + 1}`);
  });

  it('待点选里点「新建」⇒总结记一条「新增 1 名 · 名字：技能名」', async () => {
    arm();
    await importFile(fileFrom([rowFor(4, '张三无名', '群', '试探')]), '导入 0 名将领');
    fireEvent.click(screen.getByText('新建'));
    await waitFor(() => expect(toastText()).toContain('已新建'));
    await waitFor(() => expect(summaryText()).toContain('新增 1 名'));
    expect(summaryText()).toContain('· 张三无名：试探');
    expect(useGameStore.getState().authoredGenerals.map(g => g.name)).toContain('张三无名');
  });
});

describe('导入总结 · 面板自身行为', () => {
  afterEach(cleanup);

  it('「知道了」关掉面板，但已经写进存档的内容一条都不回滚', async () => {
    arm();
    await importFile(fileFrom([rowFor(guanyu.hp + 1)]), '导入 1 名将领');
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    const before = storageSnapshot();
    fireEvent.click(screen.getByText('知道了'));
    await waitFor(() => expect(hasPanel()).toBe(false));
    expect(storageSnapshot()).toBe(before);
    expect(useGameStore.getState().generalEdits[guanyu.id]?.hp).toBe(guanyu.hp + 1);
  });

  it('「复制全文」交出去的就是面板上那一段字（所见＝所得）', async () => {
    arm();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await importFile(fileFrom([rowFor(guanyu.hp + 1)]), '导入 1 名将领');
    await waitFor(() => expect(summaryText()).toContain('修改 1 名'));
    fireEvent.click(screen.getByText('复制全文'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toBe(summaryText());
    expect(payload).toBe(renderSummaryText([
      { kind: 'modified', name: '关羽', items: [`体力 ${guanyu.hp}→${guanyu.hp + 1}`] },
    ]));
  });

  it('权限被拦下的行不进总结（"写不了"绝不被说成"改了什么"）', async () => {
    arm(false); // 玩家模式：官方将写不动
    await importFile(fileFrom([rowFor(guanyu.hp + 1)]), '拒录 1 名');
    expect(hasPanel()).toBe(false);
  });
});
