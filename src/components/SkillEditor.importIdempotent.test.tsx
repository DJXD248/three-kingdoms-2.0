/**
 * 2026-10-25 口径反转（用户裁决）：同名同势力**不再直接覆盖**，一律退回「待处理」
 * 让玩家选 新建 / 修改 / 跳过；同名不同势力、名册里查无此人⇒直接新建；缺势力⇒
 * 退回「缺少必要数据」。本文件钉的是反转后仍然成立的那条硬保证：
 * **光是喂进一个文件，存档一个字节都不会变**——写入只发生在玩家点了按钮之后。
 *
 * 历史由来（#45 真机反馈）：旧代码把自己刚导出的 Excel 原样重导，会报"导入 95 名"
 * 并给每张官方将留一条 ✏️ 覆盖记录。现在改成"问"，比"跳过"更严：连判定结果都不写。
 * #48（导出用 ExcelJS、导入用 SheetJS，数值 0 是"全部手牌"哨兵）仍靠全量往返守。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';

// 导出按钮真的写文件，测试里只把这份"应用自己产出的字节"截下来，再原路喂回导入。
const { savedBlobs } = vi.hoisted(() => ({ savedBlobs: [] as Blob[] }));
vi.mock('file-saver', () => ({ saveAs: (blob: Blob) => { savedBlobs.push(blob); } }));

/**
 * 取张辽当"官方将"证人：他的「突袭」在卡上仍是一枚只有名字的旧形态技能，
 * 于是下面那份手造行（技能名以外全填「无」）逐字等于卡面，才配当"内容一致"的证人。
 */
const probe = allGenerals.find(g => g.id === 'wei_004')!;

/** 与 handleExport 同形：12 固定列 + 一组 7 列效果 + 设定备注。 */
const HEADER = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动',
  '触发时机', '效果模式', '技能描述', '技能门槛',
  '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛',
  '设定备注'];

const rowFor = (hp: number) => [
  probe.name, probe.faction, hp, probe.meleeAtk, probe.rangedAtk,
  '突袭', '无', '无', '无', '无', '无', '无',
  '', '', '', '', '', '', '', '✓ 已完成',
];

const xlsxFile = (hp: number): File => {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, rowFor(hp)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '魏');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([buf], '将领数据.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

const toastText = () => Array.from(document.querySelectorAll('span'))
  .find(s => s.textContent?.startsWith('✅') || s.textContent?.startsWith('❌'))?.textContent ?? '';

const modifyButton = () => Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent?.trim().startsWith('修改「'));

const createButton = () => Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent?.trim() === '新建');

const hintText = () => Array.from(document.querySelectorAll('p'))
  .find(p => p.textContent?.includes('每行可选择'))?.textContent ?? '';

function arm(developerMode = true) {
  cleanup();
  localStorage.clear();
  useGameStore.setState({
    developerMode, // 官方将在开发者模式才可写⇒"跳过"与"被权限拦下"两件事不混淆
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

function fireImport(file: File) {
  const input = document.querySelector('input[type=file][accept=".xlsx,.xls"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, { target: { files: [file] } });
}

/** 回执自动消失前会一直是上一条文案⇒每次都等到本条真出现才往下走。 */
async function importFile(file: File, expectText: string) {
  fireImport(file);
  await waitFor(() => expect(toastText()).toContain(expectText));
  return toastText();
}

const snapshot = () => ({
  skills: JSON.stringify(useGameStore.getState().skillEdits),
  head: JSON.stringify(useGameStore.getState().generalEdits),
  authored: JSON.stringify(useGameStore.getState().authoredGenerals),
  lsSkills: localStorage.getItem('three_kingdoms_skill_edits'),
  lsHead: localStorage.getItem('three_kingdoms_general_edits'),
  lsAuthored: localStorage.getItem('three_kingdoms_authored_generals'),
});

describe('Excel 逐技能行导入 · 光喂文件不写存档（2026-10-25 口径）', () => {
  afterEach(cleanup);

  it('原样重导官方将：不写任何覆盖记录，只为这张卡开一块「待处理」', async () => {
    arm();
    const before = snapshot();
    const toast = await importFile(xlsxFile(probe.hp), '1 名等你在下方决定');
    expect(toast).toContain('新建 0 名将领');
    expect(snapshot()).toEqual(before);
    expect(useGameStore.getState().skillEdits[probe.id]).toBeUndefined();
    expect(useGameStore.getState().generalEdits[probe.id]).toBeUndefined();
    expect(snapshot().head).toBe('{}');
    // 三个选项都在：新建 / 修改这张 / 跳过。
    expect(createButton()).toBeTruthy();
    expect(modifyButton()?.textContent).toContain(`修改「${probe.name}（${probe.faction}）」`);
    expect(screen.getByText('跳过')).toBeTruthy();
  });

  it('待处理里点「修改现有」且内容一致 ⇒ 一个字节都不写，并如实说「和现有卡一致」', async () => {
    arm();
    await importFile(xlsxFile(probe.hp), '1 名等你在下方决定');
    const before = snapshot();
    fireEvent.click(modifyButton()!);
    await waitFor(() => expect(document.body.textContent).toContain('和现有卡一致'));
    expect(snapshot()).toEqual(before);
    // 面板也不该冒出一条"修改 1 名"——没写就没有改动可报。
    expect(document.querySelector('[data-testid="import-summary"]')).toBeNull();
  });

  /**
   * "写不了"绝不等于"不用写"：玩家模式下同一行官方将，点「修改现有」必须被拦下并
   * 点名原因，存档一个字节不动。差分证人：把 `handleResolvePending` 里 `mayEditGeneral`
   * 或 store 的守卫任一拿掉，本条即红。
   */
  it('玩家模式下点「修改现有」⇒ 被拦下、存档不动、不进总结', async () => {
    arm(false);
    await importFile(xlsxFile(probe.hp + 1), '1 名等你在下方决定');
    const before = snapshot();
    fireEvent.click(modifyButton()!);
    await waitFor(() => expect(document.body.textContent).toContain('无法修改'));
    expect(document.body.textContent).toContain('官方将领在开发者模式外只读');
    expect(snapshot()).toEqual(before);
    expect(document.querySelector('[data-testid="import-summary"]')).toBeNull();
  });

  it('真改了数值：导入本身不写，点了「修改现有」才写入', async () => {
    arm();
    await importFile(xlsxFile(probe.hp - 1), '1 名等你在下方决定');
    expect(useGameStore.getState().generalEdits[probe.id]).toBeUndefined(); // 还没点

    fireEvent.click(modifyButton()!);
    await waitFor(() => expect(toastText()).toContain(`已更新将领「${probe.name}」`));
    expect(useGameStore.getState().generalEdits[probe.id]?.hp).toBe(probe.hp - 1);
  });

  it('改完再导同一份文件：内容已一致 ⇒ 点「修改现有」仍是一笔都不写', async () => {
    arm();
    const file = xlsxFile(probe.hp - 1);
    await importFile(file, '1 名等你在下方决定');
    fireEvent.click(modifyButton()!);
    await waitFor(() => expect(toastText()).toContain('已更新将领'));

    const before = snapshot();
    await importFile(file, '1 名等你在下方决定');
    fireEvent.click(modifyButton()!);
    await waitFor(() => expect(document.body.textContent).toContain('和现有卡一致'));
    expect(snapshot()).toEqual(before);
    expect(useGameStore.getState().generalEdits[probe.id]?.hp).toBe(probe.hp - 1);
  });

  /**
   * #48：导出用 ExcelJS、导入用 SheetJS，两侧不对称只有全量往返才暴露——导出把官方的
   * 「数值=0」（＝引擎的"全部手牌"哨兵）原样写进格子，旧解析器按"最小 1"判它非法。
   * 现在整表往返仍然必须零写入，并且每一张有技能的卡都要真的走成一块「待处理」。
   */
  it('导出整张表再原样导回：全量零写入，每张有技能的卡都退成待处理', async () => {
    arm();
    savedBlobs.length = 0;
    fireEvent.click(screen.getByText('📤 导出Excel'));
    await waitFor(() => expect(savedBlobs).toHaveLength(1), { timeout: 20000 });
    const buf = await savedBlobs[0].arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);

    const before = snapshot();
    const toast = await importFile(
      new File([buf], '将领数据.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      '名等你在下方决定',
    );
    expect(toast).toContain('新建 0 名将领');
    // 待处理的名数＝导出的名数（有技能才成块）⇒真的走满了全表，不是空跑。
    const pending = Number(toast.match(/；(\d+) 名等你在下方决定/)?.[1] ?? -1);
    expect(pending).toBe(allGenerals.filter(g => g.skills.length > 0).length);
    expect(snapshot()).toEqual(before);
    expect(Object.keys(useGameStore.getState().skillEdits)).toHaveLength(0);
    expect(Object.keys(useGameStore.getState().generalEdits)).toHaveLength(0);
  });
});

/**
 * v2.8.12 #46（用户裁方案A＝只改措辞、不改归属）：待处理面板说"新建为 …"时
 * 必须说出这一趟真会落在哪一层——开发者模式＝官方本地草稿（G-*），
 * 玩家模式＝DIY（D-*）。归属判定住在 generalProvenance，本刀一字未动。
 * 2026-10-25：证人从"名册里没有的名字"换成"同名同势力"（前者现在直接新建、不弹面板）。
 */
describe('待处理导入 · 措辞随模式说真话（#46）', () => {
  afterEach(cleanup);

  it('开发者模式：面板与回执都说"官方本地草稿"，建出来的号是 G-*', async () => {
    arm(true);
    await importFile(xlsxFile(probe.hp), '1 名等你在下方决定');
    expect(hintText()).toContain('新建为 官方本地草稿');
    fireEvent.click(createButton()!);
    await waitFor(() => expect(toastText()).toContain(`已新建官方本地草稿「${probe.name}」`));
    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    expect(created[0].id.startsWith('G-')).toBe(true);
  });

  it('玩家模式：同一处面板说"DIY 将领"，建出来的号是 D-*', async () => {
    arm(false);
    await importFile(xlsxFile(probe.hp), '1 名等你在下方决定');
    expect(hintText()).toContain('新建为 DIY 将领');
    expect(hintText()).not.toContain('官方本地草稿');
    fireEvent.click(createButton()!);
    await waitFor(() => expect(toastText()).toContain(`已新建DIY 将领「${probe.name}」`));
    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    expect(created[0].id.startsWith('D-')).toBe(true);
  });
});
