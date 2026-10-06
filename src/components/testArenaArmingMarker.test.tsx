/**
 * 演练场（沙盒）整备可见性与放行接线（用户 2026-10-07：「演练场（沙盒）保留可以强行移动
 * 整备中的将，但是要说明是整备状态」）。
 *
 * 三枚证人：
 * ① 界面：演练场棋盘格与详情卡都把"整备"标出来（此前沙盒整场**一个字都不显示**，
 *    放行看起来像 bug）；
 * ② 接线：`TestArena.tsx` 里那三处移动调用**每一处都传旁路**（少一处＝沙盒里整备中的将
 *    点移动会静默失败，正是这刀要治的）；
 * ③ 端到端（store→引擎，不旁路结算）：带旁路的移动真的把整备中的将挪走、且整备状态
 *    仍在；不带旁路的同一条移动原地不动。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import TestArena from './TestArena';
import { useGameStore } from '../store/gameStore';
import type { EngineState } from '../core/GameState';
import { __resetResidentEngineContainer } from '../store/engineExecutionBridge';
import { resetLiveReplay } from '../replay/liveReplayRecorder';

const readSrc = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

function armedEngineState(): EngineState {
  const general = { id: 'sandbox_g1', name: '沙盒测试将', faction: '魏', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [] };
  const fieldGeneral = {
    general,
    currentHp: 4, maxHp: 4, meleeAtk: 2, rangedAtk: 1, armor: 0, currentArmor: 2,
    armorCards: [{ id: 'arm_1', name: '军备', type: '军备' }, { id: 'arm_2', name: '军备', type: '军备' }],
    isArming: true, hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId: 1, position: { zone: 'camp', slot: 0, areaOwnerId: 1 },
  };
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    players: [
      { id: 1, name: '玩家1', hp: 4, hand: [{ id: 'hand_1', name: '粮草', type: '粮草' }], generalPool: [], fieldGenerals: [fieldGeneral], graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [] },
      { id: 2, name: '玩家2', hp: 4, hand: [], generalPool: [], fieldGenerals: [], graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [] },
    ],
    currentPlayerId: 1, turn: 3, round: 2,
    deck: [{ id: 'deck_1', name: '粮草', type: '粮草' }],
    discardPile: [], drawState: null, isFirstTurn: false, rngState: { s: 7 }, consumedSkills: [],
  } as unknown as EngineState;
}

function positionOf(generalId: string) {
  const fg = useGameStore.getState().players.flatMap(p => p.fieldGenerals).find(f => String(f.general.id) === generalId);
  return fg ? { ...fg.position } : null;
}

describe('演练场整备可见性＋放行接线（v2.8.41）', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
    expect(useGameStore.getState().restoreEngineState(armedEngineState())).toBe(true);
  });

  afterEach(cleanup);

  it('① 沙盒棋盘格上把整备中的将标出来', () => {
    const { container } = render(<TestArena />);
    expect(container.textContent).toContain('沙盒测试将');
    // 将名里刻意不含"整备"二字⇒这里命中的只可能是那枚状态标记（否则这条证人会被将名骗过去）
    expect(screen.getAllByText('整备').length, '棋盘格上要有「整备」状态标记').toBeGreaterThanOrEqual(1);
  });

  it('① 点开详情卡：既有「整备中」徽章，说明句也只写真实放行的那一半', () => {
    const { container } = render(<TestArena />);
    // 点那张将卡＝进检视面板（演练场的详情入口是点格子）
    const tile = Array.from(container.querySelectorAll('button')).find(b => (b.textContent ?? '').includes('沙盒测试将'));
    expect(tile, '找不到整备中将领所在的格子').toBeTruthy();
    fireEvent.click(tile!);
    expect(screen.getAllByText('整备中').length, '详情卡要有「整备中」徽章').toBeGreaterThanOrEqual(1);
    const note = container.textContent ?? '';
    expect(note, '详情卡要写明正式对局里不许动、演练场只对移动放行').toContain('只对「移动」放开限制');
    expect(note, '要写明攻击这条并没有放开（引擎照拒 GENERAL_IS_ARMING）').toContain('「攻击」仍由引擎拦着');
    // 诚实钉：这句说明**不许**把"攻击"也说成放行了——本刀只裁了移动，攻击那一路没有旁路。
    expect(note).not.toMatch(/放行.{0,12}移动与攻击|移动与攻击/);
  });

  it('② 那三处移动调用每一处都带旁路（漏一处＝沙盒里点移动静默失败）', () => {
    const arena = readSrc('src', 'components', 'TestArena.tsx');
    const calls = arena.split('\n').filter(l => l.includes('moveGeneral(') && !l.includes('useGameStore(s=>s.moveGeneral)'));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const line of calls) {
      expect(line, `这一处移动没带旁路：${line.trim()}`).toContain('SANDBOX_ALLOW_ARMING');
    }
  });

  it('③ 端到端：带旁路的移动真的挪走整备中的将，且整备状态还在', () => {
    const before = positionOf('sandbox_g1');
    expect(before).toEqual({ zone: 'camp', slot: 0, areaOwnerId: 1 });
    useGameStore.getState().moveGeneral('sandbox_g1', { zone: 'front', slot: 0, areaOwnerId: 1 } as any, undefined, true);
    expect(positionOf('sandbox_g1')).toEqual({ zone: 'front', slot: 0, areaOwnerId: 1 });
    const fg = useGameStore.getState().players.flatMap(p => p.fieldGenerals).find(f => String(f.general.id) === 'sandbox_g1');
    expect(fg?.isArming, '放行移动不该顺手把整备状态清掉').toBe(true);
  });

  it('③ 对照组：不带旁路，同一条移动原地不动（＝正式对局那条路一个字没让）', () => {
    useGameStore.getState().moveGeneral('sandbox_g1', { zone: 'front', slot: 0, areaOwnerId: 1 } as any);
    expect(positionOf('sandbox_g1')).toEqual({ zone: 'camp', slot: 0, areaOwnerId: 1 });
  });
});
