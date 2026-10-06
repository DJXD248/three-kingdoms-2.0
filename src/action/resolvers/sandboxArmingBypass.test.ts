/**
 * 演练场（沙盒）整备旁路的证人（用户 2026-10-07 裁决：「演练场（沙盒）保留可以强行移动
 * 整备中的将，但是要说明是整备状态」）。
 *
 * 五条判据：
 * ① 带 `sandboxAllowArming:true` 的 MOVE 允许整备中的将移动（＝沙盒那三处调用走的路）；
 * ② 不带、或带 `false` 一律照旧拒（＝正式对局/AI/回放那条路一个字没让）；
 * ③ 旁路**只解整备这一把闸**：已移动、文将缺消耗牌这些仍然照拒（防止"沙盒标志"变成万能钥匙）；
 * ④ 全仓 src 扫描：这个字段只许出现在解析器、store 两处类型/接线、演练场与本证人里——
 *    **尤其不许出现在 `GameBoard.tsx`**（正式棋盘一旦传它，整备闸就白补了）；
 * ⑤ ④ 按字段名搜，按位置传参能绕过去⇒再钉一层**元数**：`GameBoard.tsx` 里 `moveGeneral(...)`
 *    至多三个实参（＝旁路那一位结构上不存在），演练场那三处必须带第四个。
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

/**
 * 数一份源码里每一处 `moveGeneral(...)` 调用的**实参个数**（跳过字符串字面量与嵌套括号）。
 * 为什么要数参数而不是搜字段名：字段名扫描拦得住"写 `sandboxAllowArming: true`"，
 * 拦不住"第四个位置参数直接塞个 `true`"（独立复算 2026-10-07 交回的已知软肋）——
 * 而旁路恰恰就是"第四个参数"，所以把它钉成**元数**：正式棋盘 ≤3＝那一位结构上不存在。
 */
function argCountsOf(src: string, callee = 'moveGeneral'): number[] {
  const counts: number[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(`${callee}(`, from);
    if (at < 0) break;
    let i = at + callee.length + 1; // 指向开括号之后
    let depth = 1;
    let commas = 0;
    let body = '';
    let quote = '';
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === '\\') { body += ch; i++; body += src[i]; continue; }
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) break; }
      else if (ch === ',' && depth === 1) commas++;
      body += ch;
    }
    counts.push(body.trim() === '' ? 0 : commas + 1);
    from = i;
  }
  return counts;
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

  // 上面那枚扫描钉按**字段名**搜，它拦得住"写 `sandboxAllowArming: true`"，拦不住
  // "第四个位置参数直接塞个 true"（独立复算 2026-10-07 交回的已知软肋）⇒这枚钉改数**实参个数**：
  // 正式棋盘上 `moveGeneral(...)` 至多 3 个实参＝结构上不可能放行；演练场那三处必须带第 4 个。
  it('⑤ 正式棋盘的 moveGeneral 调用至多三个实参（＝旁路那一位根本不存在）', () => {
    const board = argCountsOf(readFileSync(path.join(srcRoot, 'components', 'GameBoard.tsx'), 'utf8'));
    expect(board.length, 'GameBoard 里应当有移动调用可扫').toBeGreaterThanOrEqual(1);
    for (const n of board) expect(n, `正式棋盘上出现第 4 个实参＝旁路被传进玩法：${board.join(',')}`).toBeLessThanOrEqual(3);
    const arena = argCountsOf(readFileSync(path.join(srcRoot, 'components', 'TestArena.tsx'), 'utf8'));
    expect(arena.filter(n => n === 4).length, '演练场那三处移动都得带第 4 个实参').toBeGreaterThanOrEqual(3);
  });
});
