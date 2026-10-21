/**
 * 发动通知的单点推导（v2.9.17，用户 2026-10-21 裁决后半句＝「一定要通知玩家有什么
 * 技能发动了」）。判据只有一条＝事件流里有没有 `SKILL_ACTIVATED` 那一身，而那一身
 * 分两种（v2.9.15 立）：带 `stableId` 的记账那一身／不带的那一声纯通知。这里钉的是
 * 两种都要看得见、且一次都不重不漏。
 */
import { describe, it, expect } from 'vitest';
import { activationNoticesFrom } from './activationNotices';
import type { GameEvent } from '../core/Event';
import type { EngineState } from '../core/GameState';
import type { General } from '../data/generals';

function general(id: string, skillName: string, description: string): General {
  return {
    id, instanceId: id, name: '将' + id, faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0,
    skills: [{ name: skillName, description, effects: [] }],
  } as unknown as General;
}

const fieldGeneral = (general: General, ownerId: number) => ({
  general, currentHp: 3, maxHp: 3, ownerId, position: { zone: 'front', slot: 0, areaOwnerId: ownerId },
});

function stateWith(generals: General[]): EngineState {
  return {
    version: 1, phase: 'playing', turn: 7,
    players: [
      { id: 1, name: '玩家1', fieldGenerals: generals.map(general => fieldGeneral(general, 1)), graveyard: [] },
    ],
    currentPlayerId: 1,
  } as unknown as EngineState;
}

function activated(data: Record<string, unknown>): GameEvent {
  return { type: 'SKILL_ACTIVATED', data } as GameEvent;
}

describe('activationNotices · 发动通知单点推导 (v2.9.17)', () => {
  const state = stateWith([general('g_a', '夜袭', '回合结束时摸一张')]);

  it('带台账的那一身：消息用卡面原文、id 用 stableId', () => {
    const notices = activationNoticesFrom([activated({
      playerId: 1, generalId: 'g_a', skillId: 'g_a:夜袭:e1', skillName: '夜袭', stableId: '7:g_a:夜袭:e1',
    })], state);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      id: '7:g_a:夜袭:e1',
      generalName: '将g_a',
      skillName: '夜袭',
      message: '回合结束时摸一张',
    });
  });

  it('纯通知的那一身（不带 stableId）照样看得见，同批两声也不撞键', () => {
    const notices = activationNoticesFrom([
      activated({ playerId: 1, generalId: 'g_a', skillId: 'g_a:夜袭:e1', skillName: '夜袭' }),
      activated({ playerId: 1, generalId: 'g_a', skillId: 'g_a:夜袭:e2', skillName: '夜袭' }),
    ], state);
    expect(notices).toHaveLength(2);
    expect(new Set(notices.map(notice => notice.id)).size).toBe(2);
  });

  it('除 SKILL_ACTIVATED 以外的一身都不算发动（回合结束提交里那些事件不该飘通知）', () => {
    expect(activationNoticesFrom([
      { type: 'TURN_START', data: { playerId: 1 } } as GameEvent,
      { type: 'DRAW', data: { playerId: 1, count: 1 } } as GameEvent,
    ], state)).toHaveLength(0);
  });

  it('解不出卡面（坟场也捞不着）就退化成「<技能名>发动了」，绝不静默', () => {
    const notices = activationNoticesFrom([activated({
      playerId: 1, generalId: 'g_gone', skillId: 'g_gone:疾风:e1', skillName: '疾风',
    })], state);
    expect(notices[0]).toMatchObject({ generalName: 'g_gone', message: '疾风发动了' });
  });
});
