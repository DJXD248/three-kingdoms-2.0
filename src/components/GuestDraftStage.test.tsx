/**
 * 2026-11-12 同网真机反馈的界面证人：客人屏上的征召必须是与本地**同版式的整屏画面**，
 * 而不是联网小窗口里那几行文字按钮（用户原话「征召将领的页面还是和本地模式的时候不一致」）。
 *
 * 数据一条也不在本机生成：候选、已选、能否交卷、那句人话全读房主指名发来的那一帧；
 * 点一颗交回去的只有那一帧上的位置编号。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { EngineState } from '../core/GameState';
import type { NetDraftItem, NetDraftListFrame } from '../network/netProtocol';
import GuestDraftStage from './GuestDraftStage';

const readSrc = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
afterEach(cleanup);

const item = (key: string, name: string, faction = '魏'): NetDraftItem => ({
  key, name, faction, type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: ['奋战'],
});

const frameOf = (over: Partial<NetDraftListFrame> = {}): NetDraftListFrame => ({
  seat: 2,
  total: 10,
  instruction: '选择10名将领（群势力1-3名，当前0名）',
  main: [item('m0', '夏侯惇'), item('m1', '张辽')],
  qun: [item('q0', '于吉', '群')],
  picked: [],
  canConfirm: false,
  ...over,
});

const view = (players: unknown[]): EngineState => ({
  phase: 'generalDraft',
  players,
}) as unknown as EngineState;

const twoSeats = view([
  { id: 1, name: '玩家1', faction: '魏' },
  { id: 2, name: '玩家2', faction: '蜀' },
]);

const setup = (frame: NetDraftListFrame | null, over: { onPick?: (k: string) => void; onConfirm?: () => void } = {}) => {
  const onPick = vi.fn(over.onPick ?? (() => {}));
  const onConfirm = vi.fn(over.onConfirm ?? (() => {}));
  render(<GuestDraftStage frame={frame} snapshot={twoSeats} onPick={onPick} onConfirm={onConfirm} />);
  return { onPick, onConfirm };
};

describe('客人整屏征召画面', () => {
  it('标题、进度、状态栏与本地同一套文案', () => {
    setup(frameOf());
    expect(screen.getByText('⚔️ 将领征召')).toBeTruthy();
    expect(screen.getByText('征召将领：')).toBeTruthy();
    expect(screen.getByText('玩家2')).toBeTruthy();
    // 状态栏与底部已选栏各一处，两处都要画出来（与本地同版式）。
    expect(screen.getAllByText(/已选/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/群:/)).toBeTruthy();
    expect(screen.getByText('势力将领 (2)')).toBeTruthy();
  });

  it('候选卡用的是本地那枚卡片：名字、技能、点数都画出来', () => {
    setup(frameOf());
    expect(screen.getByRole('button', { name: /夏侯惇/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /于吉/ })).toBeTruthy();
    expect(screen.getAllByText('奋战').length).toBeGreaterThan(0);
  });

  it('点一颗只把名单上的位置编号交回去，不交将名', () => {
    const { onPick } = setup(frameOf());
    screen.getByRole('button', { name: /夏侯惇/ }).click();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('m0');
  });

  it('已选栏按房主发来的 picked 画，点一下退选仍交同一个编号', () => {
    const { onPick } = setup(frameOf({ picked: ['q0'], qun: [item('q0', '于吉', '群')] }));
    const chip = screen.getByRole('button', { name: /于吉 ✕/ });
    chip.click();
    expect(onPick).toHaveBeenCalledWith('q0');
  });

  it('没凑够时确认钮灰着，字面就是房主那句原话', () => {
    setup(frameOf());
    const btn = screen.getByRole('button', { name: /选择10名将领/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('选择10名将领（群势力1-3名，当前0名）');
  });

  it('房主说凑够了才亮「✓ 确认征召」，点了只回调一次', () => {
    const { onConfirm } = setup(frameOf({ canConfirm: true, picked: ['m0', 'q0'] }));
    const btn = screen.getByRole('button', { name: '✓ 确认征召' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('没轮到这一席（空名单）时整屏还在，但不长卡片、确认仍灰', () => {
    setup(frameOf({ main: [], qun: [], instruction: '还没轮到你这一席（现在轮到第 1 席挑将）' }));
    expect(screen.getByText('⚔️ 将领征召')).toBeTruthy();
    // 提示段落与灰着的确认钮各一处：房主那句原话两边都照抄，不另写一句。
    expect(screen.getAllByText(/还没轮到你这一席/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('button', { name: /夏侯惇/ })).toBeNull();
    expect((screen.getByRole('button', { name: /还没轮到你这一席/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('一帧都没收到时也不白屏，写清在等房主', () => {
    setup(null);
    expect(screen.getByText('⚔️ 将领征召')).toBeTruthy();
    // 提示段落与灰着的确认钮都在，不白屏。
    expect(screen.getAllByText(/还没收到属于你这一席的候选名单/).length).toBeGreaterThanOrEqual(2);
  });
});

/** 房主在"这一席已交卷"之后发的那一帧：空名单＋一句人话（真机截图上的完成态）。 */
const doneFrame = () => frameOf({
  main: [], qun: [], picked: [], canConfirm: false,
  instruction: '你这一席的征召已经完成了（你那份池子已经定下来）',
});

/**
 * 同一个组件实例上「有名单 → 完成态空名单」，模拟真机上房主换发那一帧。
 * 用 rerender 而不是重新 render，正因为"画面不许变"靠的是组件记住自己上一份名单。
 */
const setupWaiting = (finalFrame: NetDraftListFrame = doneFrame()) => {
  const onPick = vi.fn();
  const onConfirm = vi.fn();
  const props = (frame: NetDraftListFrame | null) => ({ frame, snapshot: twoSeats, onPick, onConfirm });
  // 只勾第 2 张（张辽）：卡片区与底部已选栏不重名，测试能精确点中各自的按钮。
  const own = frameOf({ picked: ['m1'], canConfirm: true });
  const { rerender, container } = render(<GuestDraftStage {...props(own)} />);
  rerender(<GuestDraftStage {...props(finalFrame)} />);
  return { onPick, onConfirm, container };
};

describe('本席交卷后等别席：整屏不动，只换底部那颗钮', () => {
  it('卡片网格、已选栏、已选计数、势力名都照自己最后那份名单画', () => {
    const { container } = setupWaiting();
    expect(screen.getByRole('button', { name: /夏侯惇/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /于吉/ })).toBeTruthy();
    expect(screen.getByText('势力将领 (2)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /张辽 ✕/ })).toBeTruthy();
    expect(container.textContent?.replace(/\s+/g, '')).toContain('已选1/10');
    expect(screen.getByText('⚔️ 将领征召')).toBeTruthy();
  });

  it('按钮逐字换成那一句，且仍灰着', () => {
    setupWaiting();
    const btn = screen.getByRole('button', { name: '正在等待其他玩家完成征召' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('正在等待其他玩家完成征召');
  });

  it('房主那句「征召已经完成了」不再出现在页面任何一处', () => {
    const { container } = setupWaiting();
    expect(container.textContent).not.toContain('征召已经完成了');
  });

  it('等待期间点卡片／已选栏／确认钮都不发车（这一席的卷已经交了）', () => {
    const { onPick, onConfirm } = setupWaiting();
    screen.getByRole('button', { name: /夏侯惇/ }).click();
    screen.getByRole('button', { name: /张辽 ✕/ }).click();
    (screen.getByRole('button', { name: '正在等待其他玩家完成征召' }) as HTMLButtonElement).click();
    expect(onPick).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('房主回一句拒话（同样是空名单帧）也不会把等待语冲掉', () => {
    const { container } = setupWaiting(frameOf({
      main: [], qun: [], picked: [], canConfirm: false,
      instruction: '现在不是轮到你这一席挑将，这一条不认。',
    }));
    expect(screen.getByRole('button', { name: '正在等待其他玩家完成征召' })).toBeTruthy();
    expect(container.textContent).not.toContain('这一条不认');
    expect(screen.getByRole('button', { name: /夏侯惇/ })).toBeTruthy();
  });

  it('从没轮到过自己时不冒充"已完成在等别人"，仍照房主原话', () => {
    setup(frameOf({ main: [], qun: [], instruction: '还没轮到你这一席（现在轮到第 1 席挑将）' }));
    expect(screen.queryByRole('button', { name: '正在等待其他玩家完成征召' })).toBeNull();
    expect(screen.getAllByText(/还没轮到你这一席/).length).toBeGreaterThanOrEqual(2);
  });

  it('名单还在时按钮仍是房主那句／✓ 确认征召，不提前写等待语', () => {
    setup(frameOf());
    expect(screen.getByRole('button', { name: /选择10名将领/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '正在等待其他玩家完成征召' })).toBeNull();
  });
});

describe('与本地版式同源的接线证人', () => {
  const stage = readSrc('components', 'GuestDraftStage.tsx');
  const local = readSrc('components', 'GeneralDraft.tsx');
  const lobby = readSrc('components', 'OnlineLobby.tsx');

  it('卡片直接复用本地那枚，不另画一套', () => {
    expect(local).toContain('export function DraftCard(');
    expect(stage).toContain("import { DraftCard } from './GeneralDraft'");
    expect(stage).toContain('<DraftCard');
  });

  it('整屏的标题、两格网格、确认钮文案与本地逐字同款', () => {
    for (const text of ['⚔️ 将领征召', 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-7', '已选:', '✓ 确认征召']) {
      expect(stage).toContain(text);
      expect(local).toContain(text);
    }
  });

  it('联网浮层在征召这一段换的是整屏，不是小面板', () => {
    expect(lobby).toContain("guestPhase === 'generalDraft'");
    expect(lobby).toContain('<GuestDraftStage');
    expect(lobby).toContain('onPick={sendDraftPick}');
    expect(lobby).toContain('onConfirm={sendDraftConfirm}');
  });
});
