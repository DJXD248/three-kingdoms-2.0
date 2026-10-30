/**
 * 联机切片⑤b（v2.9.25）那一格的证人：客人屏幕上关于征召的全部话。
 *
 * 用户 2026-10-30 逐字裁过「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」
 * ⇒ 这一屏关于别人的征召只许说进度，一句都不许碰牌面。所以要钉住的有两条：
 * ㈠那句「已选 n/10」与热座征召面板上的是**同一句**（同一个形状、同一个分母），
 *   两处说出两种进度就等着挨骂；
 * ㈡这张表说"没话"（rows 为 null）时得给一句人话，而不是留一块空白让人以为卡住了。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { NetDraftProgressPanel } from './NetDraftProgressPanel';
import type { NetDraftProgressRow } from '../network/netProtocol';

const text = () => document.body.textContent ?? '';

const rows = (...patches: Partial<NetDraftProgressRow>[]): NetDraftProgressRow[] =>
  patches.map((patch, i) => ({ seat: i + 1, name: `玩家${i + 1}`, state: 'waiting' as const, picked: 0, total: 10, ...patch }));

afterEach(() => cleanup());

describe('⑤b 征召进度面板：只报走到哪儿，一个字也不碰牌面', () => {
  it('表还没话说（房主那边在掷骰／分势力）＝一句人话，不是一块空白', () => {
    render(<NetDraftProgressPanel rows={null} />);
    expect(text()).toContain('还没开始征召');
    expect(text()).not.toContain('第 1 席');
  });

  it('三种状态各有各的说法，那句「已选 n/10」与热座面板逐字同形', () => {
    render(<NetDraftProgressPanel rows={rows({ state: 'done', picked: 10 }, { state: 'picking', picked: 7 }, { state: 'waiting' })} />);
    expect(text()).toContain('第 1 席');
    expect(text()).toContain('已征召 10/10');
    expect(text()).toContain('正在征召（已选 7/10）');
    expect(text()).toContain('还没轮到');
    // 现在轮到谁这一句只跟着 `picking` 那一行走，不靠下标猜。
    expect(text()).toContain('现在轮到第 2 席');
  });

  it('桌上一圈都 done＝收尾那句；只要还有一席没完就不许出现"都定下来了"', () => {
    render(<NetDraftProgressPanel rows={rows({ state: 'done', picked: 10 }, { state: 'done', picked: 10 })} />);
    expect(text()).toContain('各家池子都定下来了');

    cleanup();
    render(<NetDraftProgressPanel rows={rows({ state: 'done', picked: 10 }, { state: 'picking', picked: 4 })} />);
    expect(text()).not.toContain('各家池子都定下来了');
  });

  it('一席都没有＝不许凭空说"都定下来了"（空表不是全员完成）', () => {
    render(<NetDraftProgressPanel rows={[]} />);
    expect(text()).not.toContain('各家池子都定下来了');
  });

  it('面板上明写这张表里没有牌（客人读屏时不该以为是自己看不到的那几格）', () => {
    render(<NetDraftProgressPanel rows={rows({ state: 'picking', picked: 1 })} />);
    expect(text()).toContain('一张牌也没有');
    expect(text()).toContain('房主算');
  });
});
