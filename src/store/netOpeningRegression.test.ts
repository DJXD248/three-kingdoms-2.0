/**
 * 2026-11-11 同网真机回归证人。
 *
 * 现场故障：联网窗口里那颗「开始游戏」直接把阶段推到掷骰，跳过了本地建房间那一步，
 * `players` 一直是空数组 ⇒ 掷骰／分势力两屏画不出方块，且 `distributeDraftGenerals`
 * 开头「第一个玩家没有势力就返回」让整局永久停在势力分配。
 *
 * 这两条一条钉接线（按钮必须先建名册）、一条钉行为（建了名册才走得进征召）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useGameStore } from './gameStore';

// 与仓库既有「读源码断言法」同一口径（App.viewSeat.test.ts）。
const lobbySource = readFileSync(join(process.cwd(), 'src', 'components', 'OnlineLobby.tsx'), 'utf8');

describe('联网窗口「开始游戏」的开局前置', () => {
  it('按钮里必须先按房间人数建名册，再开局', () => {
    const at = lobbySource.indexOf('⚔️ 开始游戏');
    expect(at).toBeGreaterThan(0);
    const handler = lobbySource.slice(Math.max(0, at - 1400), at);
    expect(handler).toMatch(/setPlayerCount\(count\)/);
    expect(handler).toMatch(/createRoom\(\)/);
    expect(handler).toMatch(/startGame\(\)/);
  });

  it('建名册 → 开局 → 掷骰 → 分势力，1.5 秒后真的走进征召（不再卡在势力分配）', async () => {
    const s = useGameStore.getState();
    s.setPlayerCount(2);
    s.createRoom();
    expect(useGameStore.getState().players).toHaveLength(2);

    s.startGame();
    expect(useGameStore.getState().phase).toBe('diceRoll');
    s.rollDice();
    s.setPhase('factionAssign');
    s.assignFactions();
    expect(useGameStore.getState().players.every(p => p.faction !== null)).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 1800));
    expect(useGameStore.getState().phase).toBe('generalDraft');
    expect(useGameStore.getState().draftGenerals.length).toBeGreaterThan(0);
  }, 15000);
});
