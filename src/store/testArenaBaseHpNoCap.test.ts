/**
 * 营地「没有体力上限」证人（用户 2026-10-06 裁决：改回"营地"叫法，且营地体力允许超过初始 6 点）。
 *
 * 判据两句话：
 * ① 开发者工具（测试擂台）不再把营地体力夹回上限——设多少就是多少、恢复也不封顶；
 * ② `baseMaxHp` 只是"初始值 6"这一份记录，不再是任何地方的天花板。
 * 对局常规路径本来就没有夹（engine 侧无 baseMaxHp 约束），这里钉住的是唯一曾存在过的夹取点。
 */
import { describe, it, expect } from 'vitest';
import { buildTestArenaActions } from './testArenaActions';
import type { GameState, Player } from './gameStore';
import { INITIAL_BASE_HP } from '../domain/constants';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 1, name: '玩家1', faction: '魏', seatOrder: 0, diceRoll: 5,
    generalPool: [], hand: [], fieldGenerals: [],
    baseHp: INITIAL_BASE_HP, baseMaxHp: INITIAL_BASE_HP,
    isAlive: true, isSpectating: false, avatarGeneral: null, graveyard: [],
    ...overrides,
  } as unknown as Player;
}

/** 只给三个营地血量动作所需的最小 state；动作只读写 players。 */
function arena(players: Player[]) {
  // get() 必须回读最近一次 set 的结果，否则连续两次动作会各自从初始值起算。
  let state = { players } as GameState;
  const actions = buildTestArenaActions(
    () => state,
    partial => { state = { ...state, ...partial } as GameState; },
    items => items,
  );
  return { actions, latest: () => state.players as Player[] };
}

describe('营地没有体力上限', () => {
  it('初始值仍是 6，并且只是记录在案、不当天花板用', () => {
    expect(INITIAL_BASE_HP).toBe(6);
    const player = makePlayer();
    expect(player.baseHp).toBe(6);
    expect(player.baseMaxHp).toBe(6);
  });

  it('直接把营地设到 20 点：不夹回 6', () => {
    const { actions, latest } = arena([makePlayer()]);
    actions.testSetBaseHp(1, 20);
    expect(latest()[0].baseHp).toBe(20);
    // 初始值那份记录不动——它不再参与夹取。
    expect(latest()[0].baseMaxHp).toBe(INITIAL_BASE_HP);
  });

  it('恢复营地体力可以越过 6 点，一路加不加顶', () => {
    const { actions, latest } = arena([makePlayer({ baseHp: 6 })]);
    actions.testHealBase(1, 5);
    expect(latest()[0].baseHp).toBe(11);
    actions.testHealBase(1, 3);
    expect(latest()[0].baseHp).toBe(14);
  });

  it('从超过 6 点的状态掉血也照实扣，不会被"抬回上限"', () => {
    const { actions, latest } = arena([makePlayer({ baseHp: 14 })]);
    actions.testDamageBase(1, 3, 'attack');
    expect(latest()[0].baseHp).toBe(11);
  });

  it('归零仍判负：没有上限≠不会出局', () => {
    const { actions, latest } = arena([makePlayer({ baseHp: 14 })]);
    actions.testSetBaseHp(1, 0);
    expect(latest()[0].baseHp).toBe(0);
    expect(latest()[0].isAlive).toBe(false);
    expect(latest()[0].isSpectating).toBe(true);
  });

  it('负数输入仍按 0 收口（只有上限被摘掉，下限留着）', () => {
    const { actions, latest } = arena([makePlayer({ baseHp: 14 })]);
    actions.testSetBaseHp(1, -7);
    expect(latest()[0].baseHp).toBe(0);
  });
});
