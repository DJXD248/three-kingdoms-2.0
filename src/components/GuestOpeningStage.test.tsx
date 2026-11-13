/**
 * 2026-11-11 同网真机反馈的界面证人：客人屏上开局那两段必须与热座同一版式，
 * 且只画房主发来的读数（没收到写「?」，不画本机编出来的数），整屏没有按钮。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { EngineState } from '../core/GameState';
import GuestOpeningStage from './GuestOpeningStage';

const view = (state: Record<string, unknown>): EngineState => state as unknown as EngineState;

const twoSeats = (phase: string, extra: Record<string, unknown>) => view({
  phase,
  players: [
    { id: 1, name: '房主乙', ...extra },
    { id: 2, name: '客人甲', ...extra },
  ],
});

describe('客人屏上的开局全屏画面', () => {
  it('掷骰那一段：标题、副标题与热座逐字一致，点数画的是收到的那个', () => {
    render(<GuestOpeningStage snapshot={view({
      phase: 'diceRoll',
      players: [
        { id: 1, name: '房主乙', diceRoll: 11, seatOrder: 0, faction: '' },
        { id: 2, name: '客人甲', diceRoll: 4, seatOrder: 1, faction: '' },
      ],
    })} />);
    expect(screen.getByText('🎲 投掷骰子')).toBeTruthy();
    expect(screen.getByText('12面骰子决定座次')).toBeTruthy();
    expect(screen.getByText('房主乙')).toBeTruthy();
    expect(screen.getByText('客人甲')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('🏅 座次: 1')).toBeTruthy();
    cleanup();
  });

  it('点数还没收到时画「?」，不画本机编出来的数', () => {
    render(<GuestOpeningStage snapshot={twoSeats('diceRoll', { diceRoll: 0, seatOrder: 0, faction: '' })} />);
    expect(screen.getAllByText('?').length).toBeGreaterThan(0);
    expect(screen.queryByText('掷出 0 点')).toBeNull();
    cleanup();
  });

  it('分势力那一段：标题、副标题与热座逐字一致，势力画的是收到的那个', () => {
    render(<GuestOpeningStage snapshot={view({
      phase: 'factionAssign',
      players: [
        { id: 1, name: '房主乙', diceRoll: 11, seatOrder: 0, faction: '魏' },
        { id: 2, name: '客人甲', diceRoll: 4, seatOrder: 1, faction: '蜀' },
      ],
    })} />);
    expect(screen.getByText('🎌 势力分配')).toBeTruthy();
    expect(screen.getByText('随机分配玩家主势力')).toBeTruthy();
    expect(screen.getByText('魏')).toBeTruthy();
    expect(screen.getByText('蜀')).toBeTruthy();
    expect(screen.getByText('座次 1')).toBeTruthy();
    cleanup();
  });

  it('整屏没有任何按钮：骰子与势力都由房主那台机器定', () => {
    render(<GuestOpeningStage snapshot={view({ phase: 'diceRoll', players: [] })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/这一屏只读/)).toBeTruthy();
    cleanup();
  });
});

/**
 * 接线证人：客人那屏必须真的切到这块全屏画面，否则界面组件写得再像，
 * 客人还是一直停在那块小浮层上（2026-11-11 真机「客机没有画面变化」的原样）。
 */
describe('联网浮层切到全屏开局画面的接线', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'OnlineLobby.tsx'), 'utf8');

  it('只有客人、且房主快照落在掷骰／分势力／征召这三段时才切', () => {
    expect(src).toContain("session?.role === 'guest'");
    expect(src).toContain("guestPhase === 'diceRoll'");
    expect(src).toContain("guestPhase === 'factionAssign'");
    expect(src).toContain("guestPhase === 'generalDraft'");
    expect(src).toContain('<GuestOpeningStage snapshot={guestSnapshot} />');
  });

  it('切画面时小浮层让位，但组件仍挂载（连线与收快照的回调不丢）', () => {
    // 2026-11-12 起这段是三元：征召走 GuestDraftStage，前两段仍走 GuestOpeningStage。
    // 这里钉住新形状，不放宽成「只要出现某个组件名就算接上」。
    expect(src).toContain("{guestStage && (guestPhase === 'generalDraft'");
    expect(src).toContain('<GuestDraftStage');
    expect(src).toContain("${guestStage ? ' hidden' : ''}");
  });
});
