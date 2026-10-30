/**
 * 联机切片⑤（v2.9.25）客人屏幕上**自己那一席**候选名单那一格的证人（腿3/⑤d 起这一格点得动）。
 *
 * 用户 2026-10-30 逐字裁过「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」
 * ⇒ 这一格与 ⑤b 那张表是同一句话的两半：那张表一张牌也不许有，这一格只许有我自己那一格的牌。
 * 所以要钉住的有三条：
 * ㈠画的全是**收到的**（房主算好的名单、他当下勾的那几颗、他那句人话、以及那颗「确认征召」能不能按），
 *   本机一张也不生成、一个数也不补；
 * ㈡没收到那一帧时给一句人话，不是一块空白；
 * ㈢腿3（⑤d）之后点得动，但**点下去交回线上的只有那个位置编号**——将名、档案号、任何理由都不在这条路上。
 *   ⑤c 那一版写的"只能看、点不动"两句这一版必须一句都不在（旧句不在也是一条判据）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NetDraftListPanel } from './NetDraftListPanel';
import type { NetDraftItem, NetDraftListFrame } from '../network/netProtocol';

const text = () => document.body.textContent ?? '';

const item = (over: Partial<NetDraftItem>): NetDraftItem => ({
  key: 'm0', name: '夏侯惇', faction: '魏', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: ['刚勇'],
  ...over,
});

const frame = (over: Partial<NetDraftListFrame> = {}): NetDraftListFrame => ({
  seat: 2,
  total: 10,
  instruction: '选择10名将领（群势力1-3名，当前1名）',
  main: [item({}), item({ key: 'm1', name: '张辽', skills: ['突袭', '疾走'] })],
  qun: [item({ key: 'q0', name: '华雄', faction: '群', type: '文将', hp: 3, meleeAtk: 1, rangedAtk: 2, skills: [] })],
  picked: ['q0'],
  canConfirm: false,
  ...over,
});

/** 这一格的两个出口都是回调：证人拿 spy 看"交回去的那一条里到底有什么"。 */
function show(f: NetDraftListFrame | null) {
  const onPick = vi.fn();
  const onConfirm = vi.fn();
  const view = render(<NetDraftListPanel frame={f} onPick={onPick} onConfirm={onConfirm} />);
  return { ...view, onPick, onConfirm };
}

/** 按牌面上的字样找到那一颗（位置编号压根不上屏，所以只能按名字点）。 */
const cardButton = (name: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(name));
  if (!found) throw new Error(`屏上没有写着「${name}」的那一颗`);
  return found as HTMLButtonElement;
};

afterEach(() => cleanup());

describe('⑤c 我自己那一席的候选名单：画的全是收到的', () => {
  it('还没收到属于我这一格的那一帧＝一句人话，不是一块空白、也不是一张编出来的名单', () => {
    show(null);
    expect(text()).toContain('还没收到属于你这一席的那一格');
    expect(text()).not.toContain('夏侯惇');
    expect(text()).not.toContain('本势力候选');
  });

  it('收到的那一份里有什么就画什么：两张名单、牌面那几样、技能名一排、以及房主那句人话', () => {
    show(frame());
    expect(text()).toContain('第 2 席：选择10名将领（群势力1-3名，当前1名）');
    expect(text()).toContain('本势力候选（2 张）');
    expect(text()).toContain('群候选（1 张）');
    expect(text()).toContain('夏侯惇');
    expect(text()).toContain('❤4 ⚔2 🏹1');
    expect(text()).toContain('突袭、疾走');
    expect(text()).toContain('已选 1/10');
  });

  it('「已选」那一排跟着房主发来的那几个位置号走，不是本机按勾没勾算的', () => {
    const { container } = show(frame());
    expect(text()).toContain('已选 1/10');
    // 只有 q0 那颗带标记：两份名单上另外两颗（m0、m1）房主没勾，界面就不许自己给它们加标记。
    const marked = [...container.querySelectorAll('li')].filter((li) => li.textContent?.includes('已选'));
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('华雄');
    expect(text()).toContain('「已选」那一排是房主那边当下勾着的那几颗，不是本机算的');
  });

  it('位置编号不上屏：线上拿它认牌，人读的那一屏只有牌面', () => {
    show(frame());
    expect(text()).not.toContain('m0');
    expect(text()).not.toContain('q0');
  });

  it('房主发来的是空名单（"还没轮到你"那一格）⇒ 照原样说"这一格现在是空的"，一个数也不补', () => {
    show(frame({ main: [], qun: [], picked: [], instruction: '还没轮到你这一席（现在轮到第 1 席挑将）' }));
    expect(text()).toContain('还没轮到你这一席（现在轮到第 1 席挑将）');
    expect(text()).toContain('这一格现在是空的（房主发过来就是空的，本机不补一张）');
    expect(text()).not.toContain('本势力候选');
    expect(text()).not.toContain('已选 0/10'); // 空格连那个分母都不摆出来，免得看着像"还能选"
  });

  it('这一格明写它是指名发给我的那一份（别人那一格我这里从来没有过）', () => {
    show(frame());
    expect(text()).toContain('由房主按席位各算一份、指名发给对应的那个人');
    expect(text()).toContain('别人那一格我这里从来没有过');
  });

  it('类型图标跟着收到的那两个字走：武将一把刀、别的是一张卷（本机不重算这张卡是什么）', () => {
    show(frame({ main: [item({ type: '武将' })], qun: [] }));
    expect(text()).toContain('⚔️ 夏侯惇');
    cleanup();
    show(frame({ main: [item({ type: '文将' })], qun: [] }));
    expect(text()).toContain('📜 夏侯惇');
  });
});

describe('⑤d 这一格现在点得动：点下去交回去的只有那个位置编号', () => {
  it('两份名单上每一颗牌都是一颗钮，点它 ⇒ 交回来的就是房主那一帧上的号，别的一个字也没有', () => {
    const h = show(frame());
    fireEvent.click(cardButton('夏侯惇'));
    fireEvent.click(cardButton('张辽'));
    fireEvent.click(cardButton('华雄'));
    // 逐字对上派单第 2 条：那一条只带"这一格的第几张"。将名（夏侯惇）、档案号、任何理由都不许跟着上来。
    expect(h.onPick.mock.calls).toEqual([['m0'], ['m1'], ['q0']]);
    expect(JSON.stringify(h.onPick.mock.calls)).not.toContain('夏侯惇');
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it('那颗「确认征召」按房主送上来的那个布尔决定能不能按（本机不重算那条上下限）', () => {
    const notYet = show(frame());
    const btn = cardButton('还没凑够');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(notYet.onConfirm).not.toHaveBeenCalled();

    cleanup();
    const ready = show(frame({ canConfirm: true, instruction: '名单凑够了 10 名（群势力 1 名）·按下「确认征召」就交这一席的卷' }));
    const go = cardButton('确认征召');
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(ready.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('牌那颗钮一律不灰（这里看不到房主那侧的上下限，灰掉＝让人对着一张不亮的钮瞎猜）', () => {
    const { container } = show(frame({ picked: [] }));
    const cards = [...container.querySelectorAll<HTMLButtonElement>('li button')];
    expect(cards).toHaveLength(3);
    expect(cards.every((b) => !b.disabled)).toBe(true);
  });

  it('没轮到你的那一席依旧一颗钮也不长（一份名单都没有，点将与确认都长在有名单那一格底下）', () => {
    const { container } = show(frame({ main: [], qun: [], picked: [], canConfirm: false, instruction: '还没轮到你这一席（现在轮到第 1 席挑将）' }));
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('⑤c 那两句"只能看、点不动"必须一个字都不在，换成说清交回去的是什么的那一句', () => {
    show(frame());
    expect(text()).not.toContain('只能看、点不动');
    expect(text()).not.toContain('还没接到客人这边');
    expect(text()).not.toContain('这一版还没做');
    expect(text()).toContain('点一颗＝把房主这一帧上的那个位置编号交回给他');
    expect(text()).toContain('将名与档案号压根不上线');
  });
});
