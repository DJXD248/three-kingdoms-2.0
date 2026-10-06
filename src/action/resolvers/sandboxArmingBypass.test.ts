/**
 * 演练场（沙盒）整备旁路的证人（用户 2026-10-07 裁决：「演练场（沙盒）保留可以强行移动
 * 整备中的将，但是要说明是整备状态」）。
 *
 * 四条判据：
 * ① 带 `sandboxAllowArming:true` 的 MOVE 允许整备中的将移动（＝沙盒那三处调用走的路）；
 * ② 不带、或带 `false` 一律照旧拒（＝正式对局/AI/回放那条路一个字没让）；
 * ③ 旁路**只解整备这一把闸**：已移动、文将缺消耗牌这些仍然照拒（防止"沙盒标志"变成万能钥匙）；
 * ④ 全仓 src 扫描：这个字段只许出现在解析器、store 两处类型/接线、演练场与本证人里——
 *    **尤其不许出现在 `GameBoard.tsx`**（正式棋盘一旦传它，整备闸就白补了）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MoveGeneralResolver } from './MoveGeneralResolver';
import { createAction } from '../ActionTypes';
import type { EngineState, EnginePlayer } from '../../core/GameState';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function createTestPlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id,
    name: 'Player ' + id,
    hp: 4,
    hand: [],
    generalPool: [],
    fieldGenerals: [],
    graveyard: [],
    baseHp: 10,
    baseMaxHp: 10,
    isAlive: true,
    statuses: [],
    ...overrides,
  };
}

function createTestState(players: EnginePlayer[]): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0]?.id ?? null,
    turn: 1,
    round: 1,
    deck: [],
    discardPile: [],
    drawState: null,
  };
}

function makeFieldGeneral(id: string, overrides: Record<string, any> = {}) {
  return {
    general: { id, hp: 4, type: 'warrior', generalType: 'WARRIOR' },
    currentHp: 4,
    maxHp: 4,
    meleeAtk: 2,
    rangedAtk: 1,
    armor: 0,
    currentArmor: 0,
    armorCards: [],
    isArming: false,
    hasMoved: false,
    hasAttacked: false,
    hasSupplied: false,
    justDeployed: false,
    ownerId: 1,
    position: { zone: 'camp' as const, slot: 0, areaOwnerId: 1 },
    ...overrides,
  };
}

const FRONT = { zone: 'front' as const, slot: 0, areaOwnerId: 1 };

function moveArmed(general: ReturnType<typeof makeFieldGeneral>, payload: Record<string, unknown>) {
  const resolver = new MoveGeneralResolver();
  const state = createTestState([createTestPlayer(1, { fieldGenerals: [general] })]);
  const action = createAction('MOVE_GENERAL', 1, { generalId: 'g1', target: FRONT, ...payload });
  return { resolver, state, action };
}

describe('演练场整备旁路（sandboxAllowArming）', () => {
  it('① 沙盒标志为 true：整备中的将照样能移动（产 GENERAL_MOVED，不拒）', () => {
    const { resolver, state, action } = moveArmed(
      makeFieldGeneral('g1', { ownerId: 1, isArming: true }),
      { sandboxAllowArming: true },
    );
    const events = resolver.resolve(state, action as any);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('GENERAL_MOVED');
  });

  it('② 不传该字段：照旧拒（＝正式对局/AI/回放那条路，v2.8.40 那把闸一个字没让）', () => {
    const { resolver, state, action } = moveArmed(
      makeFieldGeneral('g1', { ownerId: 1, isArming: true }),
      {},
    );
    const events = resolver.resolve(state, action as any);
    expect((events[0].data as any).reason).toBe('GENERAL_IS_ARMING');
  });

  it('② 传 false 也照旧拒（旁路只认严格 true，不接受"看起来像开"的值）', () => {
    const { resolver, state, action } = moveArmed(
      makeFieldGeneral('g1', { ownerId: 1, isArming: true }),
      { sandboxAllowArming: false },
    );
    const events = resolver.resolve(state, action as any);
    expect((events[0].data as any).reason).toBe('GENERAL_IS_ARMING');
  });

  it('③ 旁路只解整备这一把闸：本回合已移动仍然照拒', () => {
    const { resolver, state, action } = moveArmed(
      makeFieldGeneral('g1', { ownerId: 1, isArming: true, hasMoved: true }),
      { sandboxAllowArming: true },
    );
    const events = resolver.resolve(state, action as any);
    expect((events[0].data as any).reason).toBe('GENERAL_ALREADY_MOVED');
  });

  it('③ 旁路不许当万能钥匙：沙盒标志开着，文将没带消耗牌仍然照拒', () => {
    const { resolver, state, action } = moveArmed(
      makeFieldGeneral('g1', {
        ownerId: 1,
        isArming: true,
        general: { id: 'g1', hp: 4, type: '文将', generalType: 'SCHOLAR' },
      }),
      { sandboxAllowArming: true },
    );
    const events = resolver.resolve(state, action as any);
    expect((events[0].data as any).reason).toBe('SCHOLAR_REQUIRES_MOVE_COST');
  });

  it('④ 全仓扫描：该字段只许出现在解析器/store 接线/演练场与本证人，GameBoard 一处都不许有', () => {
    const self = path.basename(fileURLToPath(import.meta.url));
    const allowed = [
      'MoveGeneralResolver.ts',
      'gameStore.ts',
      'gameStoreTypes.ts',
      'TestArena.tsx',
    ].sort();
    const files = walk(srcRoot).filter(file => path.basename(file) !== self);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter(file => readFileSync(file, 'utf8').includes('sandboxAllowArming'))
      .map(file => path.basename(file))
      .sort();
    expect(offenders).toEqual(allowed);
    // 再单独钉一次最要紧的那条：正式棋盘永远不传旁路。
    const gameBoard = readFileSync(path.join(srcRoot, 'components', 'GameBoard.tsx'), 'utf8');
    expect(gameBoard.includes('sandboxAllowArming')).toBe(false);
  });
});
