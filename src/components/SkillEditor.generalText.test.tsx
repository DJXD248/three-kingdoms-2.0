/**
 * v2.9.24 刀2「一句话生成将领」在**新建那一排**上的接线证人（纯 jsdom 点击级）。
 *
 * 钉三件事，都对着 §12-140⑥⑨ 那两条硬边界：
 *  ① 采用＝走 `addAuthoredGeneral` 那**唯一一条建卡路**（`id`／`source` 在那里钉死，
 *     这一腿不开第二条路、也不但写库：卡真出现在 `authoredGenerals` 里才算数）；
 *  ② 技能**只记名**：卡上那枚技能有名字、没有一个效果载荷（绝不硬编效果）；
 *  ③ 缺了必要那一格（势力）时那颗「采用」**必须点不动**，
 *     一张半卡都不许冒出来——与刀1 那条"占位必须点不动"同一条判据，只是这次钉的是**没读完的那句话**。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { useGameStore } from '../store/gameStore';
import { DEFAULT_HP_WHEN_MISSING, DIY_ID_PREFIX } from '../domain/generalProvenance';

const btnByText = (needle: string) => Array.from(document.querySelectorAll('button'))
  .find(b => (b.textContent ?? '').includes(needle));

function openCreateRow() {
  render(<SkillEditor onClose={() => {}} />);
  fireEvent.click(btnByText('➕ 新建将领')!);
  fireEvent.click(btnByText('🪄 一句话生成将领')!);
}

/** 把那句话喂给面板、点生成、再点采用（采用钮 disabled 时返回 false，让断言去判）。 */
function speakAndAdopt(text: string): boolean {
  fireEvent.change(screen.getByLabelText('一句话生成将领'), { target: { value: text } });
  fireEvent.click(btnByText('按这句生成')!);
  const adopt = btnByText('✔ 采用并按这句建这张将');
  if (!adopt || adopt.disabled) return false;
  fireEvent.click(adopt);
  return true;
}

describe('新建那一排的一句话入口：读到的字段真的进了卡', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useGameStore.setState({
      authoredGenerals: [], skillEdits: {}, generalEdits: {}, developerMode: true,
      lockedGeneralIds: new Set<string>(), disabledGenerals: new Set<string>(),
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('「名：关兴，蜀，体力4，近战2，远程1，技能：武圣和兴师」六格都落进卡', () => {
    openCreateRow();
    expect(speakAndAdopt('名：关兴，蜀，体力4，近战2，远程1，技能：武圣和兴师')).toBe(true);
    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    const g = created[0];
    expect(g.name).toBe('关兴');
    expect(g.faction).toBe('蜀');
    expect(g.hp).toBe(4);
    expect(g.meleeAtk).toBe(2);
    expect(g.rangedAtk).toBe(1);
    // 技能只记名：有名字、没效果载荷
    expect(g.skills.map(s => s.name)).toEqual(['武圣', '兴师']);
    expect(g.skills.every(s => s.effects === undefined && s.trigger === undefined)).toBe(true);
    // 仍然走那唯一一条建卡路：编号前缀＋归属都在那里钉死，这一腿没另发一套号
    expect(g.id.startsWith(DIY_ID_PREFIX)).toBe(true);
    expect(g.source).toBe('DIY');
    expect(g.identity).toBe('关兴');
  });

  it('这句话没点体力＝按缺省那一个数建，并且回显里说出来（判据与 Excel 导入同一枚）', () => {
    openCreateRow();
    expect(speakAndAdopt('名：周仓，蜀，技能：兴师')).toBe(true);
    const g = useGameStore.getState().authoredGenerals[0];
    expect(g.hp).toBe(DEFAULT_HP_WHEN_MISSING);
    // 没点近战／远程＝由体力推，不在这里重推一遍（体力 4 ⇒ 武将 2／1）
    expect(g.type).toBe('武将');
    expect(g.meleeAtk).toBe(2);
    expect(g.rangedAtk).toBe(1);
    expect(screen.getByText(/已新建/).textContent).toContain(`体力这句没点、按 ${DEFAULT_HP_WHEN_MISSING} 建`);
  });

  it('缺势力＝那颗采用点不动，一张半卡都不许冒出来', () => {
    openCreateRow();
    expect(speakAndAdopt('名：孟获')).toBe(false);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
    expect(screen.getByText(/缺了：势力/)).toBeTruthy();
  });

  it('「攻击力3」这种两个数的说法不替玩家挑：点名、且近战远程都空着回去', () => {
    openCreateRow();
    fireEvent.change(screen.getByLabelText('一句话生成将领'), { target: { value: '名：文丑，群，攻击力3' } });
    fireEvent.click(btnByText('按这句生成')!);
    expect(screen.getByText(/没落进去的那一段：「攻击力3」/).textContent).toContain('我不替你挑');
    expect(speakAndAdopt('名：文丑，群，攻击力3')).toBe(true);
    const g = useGameStore.getState().authoredGenerals[0];
    // 这句没点到近战／远程 ⇒ 由体力推（不是"读不出就填 3"）
    expect([g.meleeAtk, g.rangedAtk]).toEqual([2, 1]);
  });

  it('身份那一格一句话说了也不收：卡上挂的身份仍是上面那一排的选项（默认＝本名）', () => {
    openCreateRow();
    fireEvent.change(screen.getByLabelText('一句话生成将领'), { target: { value: '名：甲，魏，身份：三国有名' } });
    fireEvent.click(btnByText('按这句生成')!);
    expect(screen.getByText(/没落进去的那一段：「身份：三国有名」/)).toBeTruthy();
    expect(speakAndAdopt('名：甲，魏，身份：三国有名')).toBe(true);
    expect(useGameStore.getState().authoredGenerals[0].identity).toBe('甲');
  });
});
