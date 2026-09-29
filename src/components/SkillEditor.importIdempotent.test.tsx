/**
 * v2.8.12 真机反馈 #45：逐技能行格式（＝导出文件的格式）的导入必须有"无变化"
 * 判定。用户把自己刚导出的 Excel 原样再导一次，旧代码会报"导入 95 名将领"、
 * 并给每张官方将留下一条 ✏️ 覆盖记录（退出开发者模式后还被算进"N 处改动已停用"）。
 * 这里走真链路：造文件→喂页面上那个 <input type=file>→读回执与存档。
 * 同一个机件还用来钉 #46：待点选面板的"新建为 …"措辞必须跟着模式说真话
 * （开发者模式落的是官方本地草稿 G-*，玩家模式才是 DIY D-*）。
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

const guanyu = allGenerals.find(g => g.id === 'shu_002')!;

/** 与 handleExport 同形：12 固定列 + 一组 7 列效果 + 设定备注。 */
const HEADER = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动',
  '触发时机', '效果模式', '技能描述', '技能门槛',
  '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛',
  '设定备注'];

const rowFor = (hp: number) => [
  guanyu.name, guanyu.faction, hp, guanyu.meleeAtk, guanyu.rangedAtk,
  '武圣', '无', '无', '无', '无', '无', '无',
  '', '', '', '', '', '', '', '✓ 已完成',
];

const xlsxFile = (hp: number): File => {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, rowFor(hp)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '蜀');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([buf], '将领数据.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

const toastText = () => Array.from(document.querySelectorAll('span'))
  .find(s => s.textContent?.startsWith('✅') || s.textContent?.startsWith('❌'))?.textContent ?? '';

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
  lsSkills: localStorage.getItem('three_kingdoms_skill_edits'),
  lsHead: localStorage.getItem('three_kingdoms_general_edits'),
});

describe('Excel 逐技能行导入 · 无变化判定（#45）', () => {
  afterEach(cleanup);

  it('原样重导未改动的官方将：报"跳过…无变化"、不记"导入"、零覆盖记录', async () => {
    arm();
    const toast = await importFile(xlsxFile(guanyu.hp), '跳过 1 名无变化');
    expect(toast).toContain('导入 0 名将领');
    expect(useGameStore.getState().skillEdits[guanyu.id]).toBeUndefined();
    expect(useGameStore.getState().generalEdits[guanyu.id]).toBeUndefined();
    expect(snapshot().head).toBe('{}');
  });

  /**
   * 「无变化」这条判定**只在写得动的时候才许认**（复算第③闸指出这一条当时只有静态
   * 成立、没有测试钉）。玩家模式下同一行官方将：既没变化、也写不动⇒必须报**拒录**，
   * 绝不许报"无变化"——把"我没有权限写"说成"这行不用写"是最坏的一类假成功。
   * 差分证人：删掉 `isNoChangeRow` 里的 `mayEditGeneral(id) &&` 前置门，本条即红。
   */
  it('玩家模式下无变化的官方行⇒报"拒录"而不是"无变化"（权限优先于跳过）', async () => {
    arm(false);
    const before = snapshot();
    const toast = await importFile(xlsxFile(guanyu.hp), '拒录 1 名');
    expect(toast).toContain('拒录 1 名');
    expect(toast).not.toContain('无变化');
    expect(toast).toContain('导入 0 名将领');
    expect(snapshot()).toEqual(before);
  });

  it('真改了数值的行照旧写入；同一份文件第二次导入则跳过、存档一条字节都不多', async () => {
    arm();
    const file = xlsxFile(guanyu.hp - 1);
    await importFile(file, '导入 1 名将领');
    expect(useGameStore.getState().generalEdits[guanyu.id]?.hp).toBe(guanyu.hp - 1);

    const before = snapshot();
    const second = await importFile(file, '跳过 1 名无变化');
    expect(second).toContain('导入 0 名将领');
    expect(snapshot()).toEqual(before);
  });

  /**
   * 已登记的局限（#47，不是本刀引入）：解析器算"要改哪些字段"是**相对仓库原始卡**，
   * 所以写回原始值的单元格撤不掉覆盖记录。这条测试钉住"跳过"判定的真实口径＝
   * "写回去会不会变"，而不是"文件与库里是否一致"——将来若改成相对生效视图，这条会红。
   */
  it('文件写回原始体力⇒撤不掉已有覆盖记录，判定为"无变化"而不是假装导入成功', async () => {
    arm();
    await importFile(xlsxFile(guanyu.hp - 1), '导入 1 名将领');
    const before = snapshot();
    const toast = await importFile(xlsxFile(guanyu.hp), '跳过 1 名无变化');
    expect(toast).toContain('导入 0 名将领');
    expect(snapshot()).toEqual(before);
    expect(useGameStore.getState().generalEdits[guanyu.id]?.hp).toBe(guanyu.hp - 1);
  });

  /**
   * #48（真机跑出来的那条，同属"重导自己的导出文件"这个抱怨）：上面几条喂的是
   * 手造行，这条喂**应用自己导出的字节**。导出用 ExcelJS、导入用 SheetJS，
   * 两侧不对称只有全量往返才暴露——导出把官方的「数值=0」（＝引擎的"全部手牌"
   * 哨兵）原样写进格子，旧解析器按"最小 1"判它非法，于是导入自己的文件会把
   * 蔡文姬·断肠从「弃置全部手牌」悄悄改成「弃置 1 张」，还留一条 ✏️。
   */
  it('导出整张表再原样导回：全量零写入，回执只报跳过（#45＋#48 全量口径）', async () => {
    arm();
    savedBlobs.length = 0;
    fireEvent.click(screen.getByText('📤 导出Excel'));
    await waitFor(() => expect(savedBlobs).toHaveLength(1), { timeout: 20000 });
    const buf = await savedBlobs[0].arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);

    const before = snapshot();
    const toast = await importFile(
      new File([buf], '将领数据.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      '名无变化',
    );
    expect(toast).toContain('导入 0 名将领');
    // 跳过的名数＝导出的名数（有技能才成块）⇒真的走满了全表，不是空跑。
    const skipped = Number(toast.match(/跳过 (\d+) 名无变化/)?.[1] ?? -1);
    expect(skipped).toBe(allGenerals.filter(g => g.skills.length > 0).length);
    expect(snapshot()).toEqual(before);
    expect(Object.keys(useGameStore.getState().skillEdits)).toHaveLength(0);
    expect(Object.keys(useGameStore.getState().generalEdits)).toHaveLength(0);
  });
});

/**
 * v2.8.12 #46（用户裁方案A＝只改措辞、不改归属）：待点选面板说"新建为 …"时
 * 必须说出这一趟真会落在哪一层——开发者模式＝官方本地草稿（G-*），
 * 玩家模式＝DIY（D-*）。归属判定住在 generalProvenance，本刀一字未动。
 */
describe('待点选导入 · 措辞随模式说真话（#46）', () => {
  afterEach(cleanup);

  const unknownFile = () => {
    const row = ['张三无名', '群', 4, 2, 1, '试探', '无', '无', '无', '无', '试探一下', '无',
      '', '', '', '', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet([HEADER, row]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '群');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    return new File([buf], '未知将.xlsx');
  };

  const hintText = () => Array.from(document.querySelectorAll('p'))
    .find(p => p.textContent?.includes('每行可选择'))?.textContent ?? '';

  const createButton = () => Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.trim() === '新建');

  it('开发者模式：面板与回执都说"官方本地草稿"，建出来的号是 G-*', async () => {
    arm(true);
    fireImport(unknownFile());
    await waitFor(() => expect(hintText()).toContain('每行可选择'));
    expect(hintText()).toContain('新建为 官方本地草稿');
    fireEvent.click(createButton()!);
    await waitFor(() => expect(toastText()).toContain('已新建官方本地草稿「张三无名」'));
    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    expect(created[0].id.startsWith('G-')).toBe(true);
  });

  it('玩家模式：同一处面板说"DIY 将领"，建出来的号是 D-*', async () => {
    arm(false);
    fireImport(unknownFile());
    await waitFor(() => expect(hintText()).toContain('每行可选择'));
    expect(hintText()).toContain('新建为 DIY 将领');
    expect(hintText()).not.toContain('官方本地草稿');
    fireEvent.click(createButton()!);
    await waitFor(() => expect(toastText()).toContain('已新建DIY 将领「张三无名」'));
    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    expect(created[0].id.startsWith('D-')).toBe(true);
  });
});
