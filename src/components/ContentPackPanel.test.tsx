/**
 * v2.9.12 内容包 · 界面证人。
 * 钉的是"发出去≠有人看见"那条老判据在这把刀上的形态：
 * 装了没装上、为什么没装上，必须在这一屏上说出来，而不是只写进 console。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { ContentPackPanel } from './ContentPackPanel';
import { useGameStore } from '../store/gameStore';
import { AUTHORED_GENERALS_KEY } from '../store/editorPersistence';
import { allGenerals, type General } from '../data/generals';
import { createAuthoredGeneral } from '../domain/generalProvenance';
import { buildDiyPack, packFingerprint, parseDiyPack } from '../contentPack/contentPack';
import { planInstall } from '../contentPack/installPack';

const downloadFiles = vi.hoisted(() => vi.fn());
vi.mock('../ai/browserExport', () => ({ downloadFiles }));

function diy(name: string): General {
  const created = createAuthoredGeneral({ name, faction: '蜀', hp: 4, identity: name, skills: [{ name: `${name}技` }] }, 'DIY');
  if (!created.ok) throw new Error(`setup failed: ${created.reason}`);
  return created.general;
}

function pickFile(text: string): File {
  return new File([text], '别人发我的包.tkdiy.json', { type: 'application/json' });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  return input;
}

function clickExport() {
  fireEvent.click(screen.getByRole('button', { name: /导出内容包/ }));
}

describe('内容包面板', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTHORED_GENERALS_KEY);
    downloadFiles.mockReset();
    cleanup();
    useGameStore.setState({ authoredGenerals: [], developerMode: false, generalEdits: {}, skillEdits: {}, lockedGeneralIds: new Set<string>() } as never);
  });

  it('按钮上先说清这次会带走几张（数字来自筛过的清单，不是全部卡池）', () => {
    useGameStore.setState({ authoredGenerals: [diy('张三'), { ...allGenerals[0] }] } as never);
    render(<ContentPackPanel />);
    expect(screen.getByRole('button', { name: /导出内容包/ }).textContent).toContain('1 张');
    expect(screen.getByText(/你对官方卡的修改/)).toBeTruthy();
  });

  it('一张自制也没有 ⇒ 明说导出的会是空包，不去按下载', () => {
    render(<ContentPackPanel />);
    clickExport();
    expect(screen.getByText(/一张玩家自制的将也没有/)).toBeTruthy();
    expect(downloadFiles).not.toHaveBeenCalled();
  });

  it('导出 ⇒ 文件写出去，界面回显张数、指纹与每张的名字', () => {
    const a = diy('张三'), b = diy('李四');
    useGameStore.setState({ authoredGenerals: [a, b] } as never);
    render(<ContentPackPanel />);
    clickExport();
    expect(downloadFiles).toHaveBeenCalledOnce();
    const [file] = downloadFiles.mock.calls[0][0];
    expect(file.name).toMatch(/^玩家自制将领包_\d{4}-\d{2}-\d{2}_2张_/);
    expect(file.content).toContain('"origin": "DIY"');
    expect(screen.getByText(/已导出 2 张玩家自制将领/)).toBeTruthy();
    expect(screen.getByText(/指纹 [0-9a-f]{8}-[0-9a-f]{8}/)).toBeTruthy();
    expect(screen.getAllByText(/张三/).length).toBeGreaterThan(0);
  });

  it('导出的是"本机看到的这张卡"：卡面改过之后包里带着改后的值', () => {
    const a = diy('张三');
    useGameStore.setState({ authoredGenerals: [a], generalEdits: { [a.id]: { hp: 7 } } } as never);
    render(<ContentPackPanel />);
    clickExport();
    expect(downloadFiles.mock.calls[0][0][0].content).toContain('"hp": 7');
  });

  it('导入一个合格的包 ⇒ 逐条说"装上"，库里真的多了一张', async () => {
    const a = diy('张三');
    render(<ContentPackPanel />);
    fireEvent.change(fileInput(), { target: { files: [pickFile(buildDiyPack([a]).text)] } });
    await waitFor(() => expect(screen.getByText(/核对通过，装上 1 张/)).toBeTruthy());
    expect(useGameStore.getState().authoredGenerals.map(g => g.id)).toEqual([a.id]);
    expect(screen.getByText(/合格，装上/)).toBeTruthy();
  });

  it('导入被人改过一个字的包 ⇒ ⛔ 说清与指纹对不上，并且一张也没落库', async () => {
    const a = diy('张三');
    const tampered = buildDiyPack([a]).text.replace('"name": "张三"', '"name": "张四"');
    render(<ContentPackPanel />);
    fireEvent.change(fileInput(), { target: { files: [pickFile(tampered)] } });
    await waitFor(() => expect(screen.getByText(/这个包没有装上/)).toBeTruthy());
    expect(screen.getByText(/与指纹对不上/)).toBeTruthy();
    expect(useGameStore.getState().authoredGenerals).toEqual([]);
  });

  it('导入一半好一半坏的包 ⇒ 好的那张也不装（界面与库两处都要看到零落库）', async () => {
    const good = diy('张三');
    const bad = { ...good, id: 'legacy_野路子', name: '坏将' } as General;
    // 指纹按伪造内容现算 ⇒ 读包这关放过，逼安装这一关自己抓到"编号不在 D- 名下"
    const cards = [good, bad];
    const text = JSON.stringify({
      header: { kind: 'three-kingdoms-diy-pack', format: 1, origin: 'DIY', exportedAt: '', createdWithApp: 'test', count: cards.length, fingerprint: packFingerprint(cards) },
      generals: cards,
    });
    render(<ContentPackPanel />);
    fireEvent.change(fileInput(), { target: { files: [pickFile(text)] } });
    await waitFor(() => expect(screen.getByText(/一张也没有/)).toBeTruthy());
    expect(screen.getByText(/D- 名下/)).toBeTruthy();
    expect(useGameStore.getState().authoredGenerals).toEqual([]);
    expect(localStorage.getItem(AUTHORED_GENERALS_KEY)).toBeNull();
  });

  it('重复导入同一个包 ⇒ 说"已经有了，不用重复装"，不会长出两张同名卡', async () => {
    const a = diy('张三');
    const text = buildDiyPack([a]).text;
    render(<ContentPackPanel />);
    fireEvent.change(fileInput(), { target: { files: [pickFile(text)] } });
    await waitFor(() => expect(screen.getByText(/核对通过，装上 1 张/)).toBeTruthy());
    fireEvent.change(fileInput(), { target: { files: [pickFile(text)] } });
    await waitFor(() => expect(screen.getByText(/已经有了/)).toBeTruthy());
    expect(useGameStore.getState().authoredGenerals).toHaveLength(1);
  });

  it('文件名都认不出来的东西 ⇒ 一句人话说明它不是本项目的包', async () => {
    render(<ContentPackPanel />);
    fireEvent.change(fileInput(), { target: { files: [pickFile('{"header":{"kind":"别的软件"}}')] } });
    await waitFor(() => expect(screen.getByText(/不是本项目的将领内容包/)).toBeTruthy());
  });

  // ↓ 真机实测（v2.9.12 收口那一趟）抓到的设计缺口：导出面放行、装包面整包拒 ⇒ 玩家拿到一份永远装不上的文件。
  it('本机允许但包不认的卡（技能没有名字）⇒ 点导出不写文件，逐条点名', () => {
    const broken = { ...diy('毛病将'), skills: [{ name: '' }] } as General;
    useGameStore.setState({ authoredGenerals: [broken] } as never);
    render(<ContentPackPanel />);
    clickExport();
    expect(downloadFiles).not.toHaveBeenCalled();
    expect(screen.getByText(/有 1 张带着装包那一侧不认的毛病/)).toBeTruthy();
    expect(screen.getByText(/没有技能名/)).toBeTruthy();
    expect(useGameStore.getState().authoredGenerals).toHaveLength(1);
  });

  it('预告写在按钮旁边：不用点导出也能知道有几张导不出去', () => {
    const broken = { ...diy('毛病将'), skills: [{ name: '' }] } as General;
    useGameStore.setState({ authoredGenerals: [broken, diy('张三')] } as never);
    render(<ContentPackPanel />);
    expect(screen.getByText(/其中 1 张带着包不认的毛病/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /只导出合格的 1 张/ })).toBeTruthy();
  });

  it('逃生口「只导出合格的 N 张」⇒ 文件里只有合格那张，毛病那张不写进包', () => {
    const broken = { ...diy('毛病将'), skills: [{ name: '' }] } as General;
    const good = diy('张三');
    useGameStore.setState({ authoredGenerals: [broken, good] } as never);
    render(<ContentPackPanel />);
    fireEvent.click(screen.getByRole('button', { name: /只导出合格的 1 张/ }));
    expect(downloadFiles).toHaveBeenCalledOnce();
    const [file] = downloadFiles.mock.calls[0][0];
    expect(file.content).toContain('张三');
    expect(file.content).not.toContain('毛病将');
    expect(file.name).toContain('_1张_');
    // 这份文件必须能在另一台机器上装得上：先读包再核装，两张判据都得放行
    const read = parseDiyPack(file.content);
    expect(read.ok).toBe(true);
    const plan = planInstall(read, { existingAuthored: [broken] });
    expect(plan.ok).toBe(true);
    expect(plan.install.map(g => g.name)).toEqual(['张三']);
  });

  it('两侧用的是同一份判据：同一张坏卡，导出点名的句子和导入点名的句子逐字相同', async () => {
    const broken = { ...diy('毛病将'), skills: [{ name: '' }] } as General;
    useGameStore.setState({ authoredGenerals: [broken] } as never);
    render(<ContentPackPanel />);
    clickExport();
    const exportWhy = reasons()[0];
    expect(exportWhy).toBeTruthy();
    // 伪造一份"指纹正确、内容含坏卡"的包 ⇒ 读包这关放过，逼装包这关自己点名
    const cards = [broken];
    const text = JSON.stringify({
      header: { kind: 'three-kingdoms-diy-pack', format: 1, origin: 'DIY', exportedAt: '', createdWithApp: 'test', count: cards.length, fingerprint: packFingerprint(cards) },
      generals: cards,
    });
    fireEvent.change(fileInput(), { target: { files: [pickFile(text)] } });
    await waitFor(() => expect(screen.getByText(/一张也没有/)).toBeTruthy());
    expect(reasons()).toEqual([exportWhy]);
  });
});

/** 报告区每一条 ✕/⬇️/➖ 后面那句人读的理由。 */
function reasons(): string[] {
  return Array.from(document.querySelectorAll('li'))
    .map(li => li.textContent ?? '')
    .filter(t => t.includes(' — '))
    .map(t => t.slice(t.indexOf(' — ') + 3));
}
