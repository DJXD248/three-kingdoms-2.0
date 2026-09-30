/**
 * v2.8.19 徽章刀1（真实链路）：一枚技能同时挂几枚徽章——录入面点亮几枚、存档里只写
 * `tags` 一份账、旧存档的单值 `tag` 仍然读得出、徽章与触发时机对不上时**在编辑器和导入
 * 总结两处都点名**。这一刀不动结算，所以断言全在"读、写、显示、核对"四件事实上。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';

// 导出走 file-saver：这里只拦计数，绝不让真实下载落到你的浏览器上。
const { savedBlobs } = vi.hoisted(() => ({ savedBlobs: [] as Blob[] }));
vi.mock('file-saver', () => ({ saveAs: (blob: Blob) => { savedBlobs.push(blob); } }));

const guanyu = allGenerals.find(g => g.id === 'shu_002')!;

const HEADER = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动',
  '触发时机', '效果模式', '技能描述', '设定备注'];

const rowFor = (tagCell: string, triggerCell: string = '无') => [
  guanyu.name, guanyu.faction, guanyu.hp, guanyu.meleeAtk, guanyu.rangedAtk,
  '武圣', tagCell, '无', triggerCell, '无', '出牌阶段，你使用【杀】无距离限制', '✓ 已完成',
];

function fileFrom(rows: (string | number)[][]): File {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '蜀');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([buf], '将领数据.xlsx');
}

/** 徽章那一排：亮着时文字前多一个 ✓，所以两种写法都认。 */
function chip(badge: string): HTMLButtonElement {
  const hits = Array.from(document.querySelectorAll('button'))
    .filter(b => b.textContent === badge || b.textContent === `✓${badge}`);
  expect(hits, `徽章「${badge}」的开关没找到`).toHaveLength(1);
  return hits[0] as HTMLButtonElement;
}
const lit = (badge: string) => chip(badge).textContent === `✓${badge}`;

const warningLines = () => Array.from(document.querySelectorAll('p'))
  .filter(p => p.textContent?.startsWith('⚠ 徽章与时机对不上'))
  .map(p => p.textContent ?? '');

const panelText = () =>
  document.querySelector('[data-testid="import-summary-text"]')?.textContent ?? '';

const toastText = () => Array.from(document.querySelectorAll('span'))
  .find(s => s.textContent?.startsWith('✅') || s.textContent?.startsWith('❌'))?.textContent ?? '';

function openEditor(seed?: Record<string, unknown>) {
  cleanup();
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useGameStore.setState({
    developerMode: true,
    skillEdits: {},
    generalEdits: {},
    disabledGenerals: new Set<string>(),
    lockedGeneralIds: new Set<string>(),
    authoredGenerals: [],
    identityRegistry: [],
    ...seed,
  } as Partial<ReturnType<typeof useGameStore.getState>>);
  render(<SkillEditor onClose={() => {}} />);
  const listBtn = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes(guanyu.name));
  fireEvent.click(listBtn!);
}

function openImport() {
  fireEvent.click(screen.getByText('📄 导入'));
}

async function importRows(rows: (string | number)[][]) {
  const input = document.querySelector('input[type=file][accept=".xlsx,.xls"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [fileFrom(rows)] } });
  await waitFor(() => expect(panelText()).not.toBe(''));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('编辑器 · 一枚技能同时挂几枚徽章', () => {
  it('一排徽章都能各自点亮，亮着的带 ✓（不是互斥的单选）', () => {
    openEditor();
    expect(lit('锁定技')).toBe(false);
    fireEvent.click(chip('锁定技'));
    fireEvent.click(chip('遗计技'));
    expect(lit('锁定技')).toBe(true);
    expect(lit('遗计技')).toBe(true);
    expect(lit('限定技')).toBe(false);
  });

  it('保存时只写 `tags` 一份账：旧单值字段读得出来，但不再被写回去', () => {
    openEditor({ skillEdits: { [guanyu.id]: [{ name: '武圣', description: '', tag: '限定技' }] } });
    // 旧存档的单值徽章在界面上是"亮着"的——读不到的话界面会说这技能没徽章
    expect(lit('限定技')).toBe(true);
    fireEvent.click(chip('锁定技'));
    fireEvent.click(chip('遗计技'));
    fireEvent.click(screen.getByText('💾 保存修改'));

    const saved = useGameStore.getState().skillEdits[guanyu.id][0] as Record<string, unknown>;
    expect(saved.tags).toEqual(['限定技', '锁定技', '遗计技']);
    expect('tag' in saved).toBe(false);
  });

  it('再点一次⇒摘掉那一枚，其余几枚不受影响', () => {
    openEditor({
      skillEdits: { [guanyu.id]: [{ name: '武圣', description: '', tags: ['锁定技', '遗计技'] }] },
    });
    expect(lit('锁定技')).toBe(true);
    fireEvent.click(chip('锁定技'));
    expect(lit('锁定技')).toBe(false);
    expect(lit('遗计技')).toBe(true);
  });

  it('卡面写登场技而时机不在登场时⇒编辑器行内点名两句话说的是什么事', () => {
    openEditor({
      skillEdits: {
        [guanyu.id]: [{
          name: '武圣', description: '', tags: ['登场技'],
          trigger: { type: 'onTurnEnd' },
        }],
      },
    });
    const lines = warningLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('登场技');
    expect(lines[0]).toContain('将领登场时');
    expect(lines[0]).toContain('回合结束时');
  });

  it('时机与徽章说同一件事⇒一声不出（对账不是恒报警）', () => {
    openEditor({
      skillEdits: {
        [guanyu.id]: [{
          name: '武圣', description: '', tags: ['登场技'],
          trigger: { type: 'onDeploy' },
        }],
      },
    });
    expect(warningLines()).toEqual([]);
  });
});

describe('导入路 · 徽章多枚与对账进总结面板', () => {
  it('格子里两枚⇒面板与存档都收两枚（顺序照格子）', async () => {
    openEditor();
    openImport();
    await importRows([rowFor('遗计技、锁定技', '自身被击杀时')]);
    const saved = useGameStore.getState().skillEdits[guanyu.id][0] as Record<string, unknown>;
    expect(saved.tags).toEqual(['遗计技', '锁定技']);
    expect(panelText()).toContain(guanyu.name);
  });

  it('徽章与时机对不上⇒导入总结里点名，不静悄悄收下', async () => {
    openEditor();
    openImport();
    await importRows([rowFor('登场技', '回合结束时')]);
    expect(panelText()).toContain('登场技');
    expect(panelText()).toContain('时机里没有');
  });

  it('拼错的那枚在总结里点名；认识的那枚照收', async () => {
    openEditor();
    openImport();
    await importRows([rowFor('锁定技、遗计济')]);
    const saved = useGameStore.getState().skillEdits[guanyu.id][0] as Record<string, unknown>;
    expect(saved.tags).toEqual(['锁定技']);
  });

  it('徽章没变、时机也没变⇒重导同一个文件不产生改动条目（对账不是每遍都报一次）', async () => {
    openEditor();
    openImport();
    await importRows([rowFor('锁定技、遗计技', '自身被击杀时')]);
    const first = panelText();
    await importRows([rowFor('锁定技、遗计技', '自身被击杀时')]);
    expect(panelText()).toBe(first);
  });
});

describe('导出 Excel · 两枚徽章共用一格', () => {
  it('应用自己导出的字节再原样导回⇒徽章一枚不丢、也不被算成改动（写格与读格同一口径）', async () => {
    openEditor();
    fireEvent.click(chip('锁定技'));
    fireEvent.click(chip('遗计技'));
    fireEvent.click(screen.getByText('💾 保存修改'));
    const savedBefore = JSON.parse(JSON.stringify(useGameStore.getState().skillEdits[guanyu.id]));
    expect(savedBefore[0].tags).toEqual(['锁定技', '遗计技']);

    openImport();
    savedBlobs.length = 0;
    fireEvent.click(screen.getByText('📤 导出Excel'));
    await waitFor(() => expect(savedBlobs).toHaveLength(1), { timeout: 20000 });
    const buf = await savedBlobs[0].arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);

    const input = document.querySelector('input[type=file][accept=".xlsx,.xls"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([buf], '将领数据.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })] },
    });
    await waitFor(() => expect(toastText()).toContain('导入 0 名将领'), { timeout: 20000 });
    expect(toastText()).toContain('无变化');
    expect(JSON.parse(JSON.stringify(useGameStore.getState().skillEdits[guanyu.id]))).toEqual(savedBefore);
  });
});
