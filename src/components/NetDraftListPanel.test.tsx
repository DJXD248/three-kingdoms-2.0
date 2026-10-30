/**
 * 联机切片⑤c（v2.9.25）客人屏幕上**自己那一席**候选名单那一格的证人。
 *
 * 用户 2026-10-30 逐字裁过「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」
 * ⇒ 这一格与 ⑤b 那张表是同一句话的两半：那张表一张牌也不许有，这一格只许有我自己那一格的牌。
 * 所以要钉住的有三条：
 * ㈠画的全是**收到的**（房主算好的名单、他当下勾的那几颗、他那句人话），本机一张也不生成、一个数也不补；
 * ㈡没收到那一帧时给一句人话，不是一块空白；
 * ㈢这一版点不动——名单只能看，勾哪一颗与确认那颗钮是腿3（⑤d），界面上就明说这一点。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
  ...over,
});

afterEach(() => cleanup());

describe('⑤c 我自己那一席的候选名单：画的全是收到的', () => {
  it('还没收到属于我这一格的那一帧＝一句人话，不是一块空白、也不是一张编出来的名单', () => {
    render(<NetDraftListPanel frame={null} />);
    expect(text()).toContain('还没收到属于你这一席的那一格');
    expect(text()).not.toContain('夏侯惇');
    expect(text()).not.toContain('本势力候选');
  });

  it('收到的那一份里有什么就画什么：两张名单、牌面那几样、技能名一排、以及房主那句人话', () => {
    render(<NetDraftListPanel frame={frame()} />);
    expect(text()).toContain('第 2 席：选择10名将领（群势力1-3名，当前1名）');
    expect(text()).toContain('本势力候选（2 张）');
    expect(text()).toContain('群候选（1 张）');
    expect(text()).toContain('夏侯惇');
    expect(text()).toContain('❤4 ⚔2 🏹1');
    expect(text()).toContain('突袭、疾走');
    expect(text()).toContain('已选 1/10');
  });

  it('「已选」那一排跟着房主发来的那几个位置号走，不是本机按勾没勾算的', () => {
    const { container } = render(<NetDraftListPanel frame={frame()} />);
    expect(text()).toContain('已选 1/10');
    // 只有 q0 那颗带标记：两份名单上另外两颗（m0、m1）房主没勾，界面就不许自己给它们加标记。
    const marked = [...container.querySelectorAll('li')].filter((li) => li.textContent?.includes('已选'));
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('华雄');
    expect(text()).toContain('「已选」那一排是房主那边当下勾着的那几颗，不是本机算的');
  });

  it('位置编号不上屏：线上拿它认牌，人读的那一屏只有牌面', () => {
    render(<NetDraftListPanel frame={frame()} />);
    expect(text()).not.toContain('m0');
    expect(text()).not.toContain('q0');
  });

  it('房主发来的是空名单（"还没轮到你"那一格）⇒ 照原样说"这一格现在是空的"，一个数也不补', () => {
    render(<NetDraftListPanel frame={frame({ main: [], qun: [], picked: [], instruction: '还没轮到你这一席（现在轮到第 1 席挑将）' })} />);
    expect(text()).toContain('还没轮到你这一席（现在轮到第 1 席挑将）');
    expect(text()).toContain('这一格现在是空的（房主发过来就是空的，本机不补一张）');
    expect(text()).not.toContain('本势力候选');
    expect(text()).not.toContain('已选 0/10'); // 空格连那个分母都不摆出来，免得看着像"还能选"
  });

  it('这一格点不动：整格没有一个可点的按钮（勾哪一颗与确认＝⑤d，这一版还没接到客人这边）', () => {
    const { container } = render(<NetDraftListPanel frame={frame()} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(text()).toContain('这里的牌只能看、点不动');
    expect(text()).toContain('⑤d');
  });

  it('这一格明写它是指名发给我的那一份（别人那一格我这里从来没有过）', () => {
    render(<NetDraftListPanel frame={frame()} />);
    expect(text()).toContain('由房主按席位各算一份、指名发给对应的那个人');
    expect(text()).toContain('别人那一格我这里从来没有过');
  });

  it('类型图标跟着收到的那两个字走：武将一把刀、别的是一张卷（本机不重算这张卡是什么）', () => {
    render(<NetDraftListPanel frame={frame({ main: [item({ type: '武将' })], qun: [] })} />);
    expect(text()).toContain('⚔️ 夏侯惇');
    cleanup();
    render(<NetDraftListPanel frame={frame({ main: [item({ type: '文将' })], qun: [] })} />);
    expect(text()).toContain('📜 夏侯惇');
  });
});
