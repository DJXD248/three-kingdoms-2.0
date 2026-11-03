/**
 * v2.9.24 刀2「一句话生成将领」在**新建那一排**上的接线证人（纯 jsdom 点击级）。
 *
 * 钉四件事，都对着 §12-140⑥⑨ 那两条硬边界 ＋ 用户 2026-11-04 §12-162 那 12 条：
 *  ① 采用＝走 `addAuthoredGeneral` 那**唯一一条建卡路**（`id`／`source` 在那里钉死，
 *     这一腿不开第二条路：卡真出现在 `authoredGenerals` 里才算数）；
 *  ② 技能**只记名**：卡上那枚技能有名字、没有一个效果载荷（绝不硬编效果）；
 *  ③ 缺了必要那一格（将名／势力）时那颗「采用」**必须点不动**，一张半卡都不许冒出来；
 *  ④ **第 12 条**：有段落没落进这张卡＝那颗「采用」一样按住，并且界面要说出错在哪里；
 *     「收下了、但里面还粘着没认的东西」是**另一族**，那一族仍放行（卡照建），
 *     报告只许说那一族自己的话，不许写成"没落进去"。
 *
 * 每一条"按住"的证人都**两面**：既判那颗钮 `disabled`，也判 `authoredGenerals` 仍是 0 长度
 * ——只判前者的话，将来有人把钮做成"看着灰但还绑着 handler"就没人拦；只判后者同理。
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

/** 只把那句话喂给面板并点「按这句生成」（不碰采用钮），让下面的断言各自判。 */
function speak(text: string) {
  fireEvent.change(screen.getByLabelText('一句话生成将领'), { target: { value: text } });
  fireEvent.click(btnByText('按这句生成')!);
}

function adoptBtn(): HTMLButtonElement {
  const adopt = btnByText('✔ 采用并按这句建这张将');
  if (!adopt) throw new Error('那颗「采用」不在这屏');
  return adopt as HTMLButtonElement;
}

/** 点采用（钮按着＝点不动，返回 false 让断言去判）。 */
function adoptAfterSpeaking(): boolean {
  const adopt = adoptBtn();
  if (adopt.disabled) return false;
  fireEvent.click(adopt);
  return true;
}

/** 生成＋采用一整趟。 */
function speakAndAdopt(text: string): boolean {
  speak(text);
  return adoptAfterSpeaking();
}

/** 那句"有东西没落进去"的界面话（措辞必须与真行为逐字对得上，§12-112）。 */
const UNLANDED_SENTENCE = '这句里有东西没落进这张卡——上面带 ✕ 的每一行都点了名、说了为什么。这颗「采用」我按住了，改完这句话再点。';

describe('新建那一排的一句话入口：读到的字段真的进了卡', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useGameStore.setState({
      authoredGenerals: [], skillEdits: {}, generalEdits: {}, developerMode: true,
      lockedGeneralIds: new Set<string>(), disabledGenerals: new Set<string>(),
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('「名：关兴，蜀，体力4，近战2，远程1，技能：武圣和咆哮」六格都落进卡', () => {
    openCreateRow();
    expect(speakAndAdopt('名：关兴，蜀，体力4，近战2，远程1，技能：武圣和咆哮')).toBe(true);
    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    const g = created[0];
    expect(g.name).toBe('关兴');
    expect(g.faction).toBe('蜀');
    expect(g.hp).toBe(4);
    expect(g.meleeAtk).toBe(2);
    expect(g.rangedAtk).toBe(1);
    // 第 1 条（甲）：两枚都在名册里，「和」才当分隔⇒切成两枚技能名
    expect(g.skills.map(s => s.name)).toEqual(['武圣', '咆哮']);
    // 技能只记名：有名字、没效果载荷
    expect(g.skills.every(s => s.effects === undefined && s.trigger === undefined)).toBe(true);
    // 仍然走那唯一一条建卡路：编号前缀＋归属都在那里钉死，这一腿没另发一套号
    expect(g.id.startsWith(DIY_ID_PREFIX)).toBe(true);
    expect(g.source).toBe('DIY');
    expect(g.identity).toBe('关兴');
  });

  it('〔第 5 条〕技能那格裸写顿号＝与带壳同一把尺，卡上落两枚名字', () => {
    openCreateRow();
    expect(speakAndAdopt('名：关兴，蜀，体力4，近战2，远程1，技能：武圣、咆哮')).toBe(true);
    expect(useGameStore.getState().authoredGenerals[0].skills.map(s => s.name)).toEqual(['武圣', '咆哮']);
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
    speak('名：孟获');
    expect(adoptBtn().disabled).toBe(true);
    expect(adoptAfterSpeaking()).toBe(false);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
    expect(screen.getByText(/缺了：势力/).textContent).toContain('这颗「采用」按着');
  });

  // ── 第 11 条（2026-11-04 裁「取消按位置猜」）**推翻了 v2.9.26 那条"裸写也认名"**：
  //    旧证人钉的是「一位郭淮，魏」落库「郭淮」，今天改钉"将名这一格空着＋缺了＋钮按住"。
  //    剥帽子那判据没死，只是从此只在「名：」那一路还活着（下面那一枚）。
  it('〔第 11 条〕没写「名：」＝不替玩家按位置猜：将名那格空着、那一段点名、那颗采用按住', () => {
    openCreateRow();
    speak('孟获');
    expect(screen.getByText(/缺了：将名／势力/).textContent).toContain('这两格我不替您猜');
    expect(screen.getByText(/没落进去的那一段：「孟获」/)).toBeTruthy();
    expect(adoptBtn().disabled).toBe(true);
    expect(adoptAfterSpeaking()).toBe(false);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
  });

  it('〔第 11 条〕段首那顶帽子不许进将名，但写了「名：」才认：「名：一位郭淮，魏」落库的是「郭淮」', () => {
    openCreateRow();
    speak('名：一位郭淮，魏');
    expect(screen.getByText(/将名：郭淮/)).toBeTruthy();
    expect(screen.getByText(/我当成连接词忽略掉的：一位/)).toBeTruthy();
    expect(adoptAfterSpeaking()).toBe(true);
    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('郭淮');
    expect(created[0].identity).toBe('郭淮');
  });

  it('〔第 1 条·甲〕「武圣和兴师」兴师名册查不到＝整枚不落、那颗采用按住、一张卡都不建', () => {
    openCreateRow();
    speak('名：关兴，蜀，体力4，近战2，远程1，技能：武圣和兴师');
    expect(screen.getByText(/没落进去的那一段：「武圣和兴师」/).textContent)
      .toContain('名册上查不到这种技能名');
    expect(screen.getByText(/技能：那一格写的我没认成技能名/).textContent)
      .toBe('· 技能：那一格写的我没认成技能名，一个都没落（逐条点名见下面）');
    expect(adoptBtn().disabled).toBe(true);
    expect(adoptAfterSpeaking()).toBe(false);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
  });

  // ── 第 12 条：这句话里有段落没落进这张卡＝退回＋那颗钮按住＋说明错在哪里（§12-162 ③）。
  //    旧证人钉的是"卡照样建、只报事实"，那条已被这条裁翻面。
  it('〔第 12 条〕有段落没落进去＝界面说出错在哪里、那颗采用按住、一张卡都不建', () => {
    openCreateRow();
    speak('名：郭淮，蜀，攻击力3，技能：体力4');
    expect(screen.getByText(UNLANDED_SENTENCE)).toBeTruthy();
    expect(screen.getByText(/没落进去的那一段：「攻击力3」/)).toBeTruthy();
    expect(screen.getByText(/没落进去的那一段：「体力4」/)).toBeTruthy();
    expect(adoptBtn().disabled).toBe(true);
    expect(adoptAfterSpeaking()).toBe(false);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
  });

  it('〔第 12 条〕「攻击力3」两个数不替玩家挑＝点名、采用按住，近战远程一格都不许被猜着填', () => {
    openCreateRow();
    speak('名：文丑，群，攻击力3');
    expect(screen.getByText(/没落进去的那一段：「攻击力3」/).textContent).toContain('我不替你挑');
    expect(adoptBtn().disabled).toBe(true);
    expect(adoptAfterSpeaking()).toBe(false);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
  });

  it('〔第 12 条〕身份那一格一句话说了也不收＝点名、采用按住；去掉那句才建，身份仍是上面那一排的选项（默认＝本名）', () => {
    openCreateRow();
    speak('名：甲，魏，身份：三国有名');
    expect(screen.getByText(/没落进去的那一段：「身份：三国有名」/).textContent)
      .toContain('这一格要你自己在那一排里选');
    expect(adoptBtn().disabled).toBe(true);
    expect(adoptAfterSpeaking()).toBe(false);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);

    expect(speakAndAdopt('名：甲，魏')).toBe(true);
    expect(useGameStore.getState().authoredGenerals[0].identity).toBe('甲');
  });

  // ── 〔第 12 条·反向〕"退回"只圈**没落进去**那一族。落进格子了、但里面还粘着没认的东西＝另一族，
  //    那一族仍放行（卡照建）。这一枚挡"把两族并成一条闸"那种改法：谁把 glued 也算进退回，这里立刻红；
  //    反过来谁把"没落进去"放回放行，上面那几枚红。
  it('〔第 12 条·反向〕只有"收下了但还粘着"那一族放行：卡照建，报告只说那一族的话', () => {
    openCreateRow();
    expect(speakAndAdopt('名：郭淮），蜀')).toBe(true);
    const created = useGameStore.getState().authoredGenerals;
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('郭淮）');
    const report = screen.getByText(/已新建/).textContent ?? '';
    expect(report).toContain('这几格收下了、里面还粘着没认的东西：「郭淮）」');
    expect(report).not.toContain('没落进去的：');
    expect(screen.queryByText(UNLANDED_SENTENCE)).toBeNull();
  });
});
