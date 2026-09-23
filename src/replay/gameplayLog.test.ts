import { describe, expect, it } from 'vitest';
import type { GameAction } from '../action/ActionTypes';
import type { GameEvent } from '../core/Event';
import type { EngineState } from '../core/GameState';
import type { ReplayDocument } from './types';
import { buildGameplayLog } from './gameplayLog';

function state(over: Record<string, unknown> = {}): EngineState {
  return {
    version: 1,
    phase: 'playing',
    players: [
      { id: 1, name: '刘备', faction: '蜀' },
      { id: 2, name: '曹操', faction: '魏', isAlive: false },
    ],
    metadata: { roomId: '桃园', winnerId: 1 },
    ...over,
  } as unknown as EngineState;
}

function entry(sequence: number, action: GameAction, events: GameEvent[], after: EngineState) {
  return {
    sequence,
    timestamp: 0,
    action,
    events,
    beforeState: state(),
    afterState: after,
  };
}

describe('gameplayLog（2.2.6 对局操作日志）', () => {
  it('抬头含房间/玩家势力/结果，逐步含中文动作行', () => {
    const doc: ReplayDocument = {
      version: 1,
      roomId: '桃园',
      createdAt: new Date(2026, 8, 23, 15, 4, 5).getTime(),
      initialState: state(),
      entries: [
        entry(1, { id: 'a1', type: 'DEPLOY_GENERAL', playerId: 1, payload: { general: { name: '关羽', instanceId: 'g1' }, slot: 0, consumeCards: [1, 2] } } as GameAction, [], state()),
        entry(2, { id: 'a2', type: 'END_TURN', playerId: 1 } as GameAction, [], state({ phase: 'gameOver' })),
      ],
    };
    const log = buildGameplayLog(doc);
    expect(log).toContain('对局操作日志');
    expect(log).toContain('房间：桃园');
    expect(log).toContain('刘备(蜀)');
    expect(log).toContain('曹操(魏) 阵亡');
    expect(log).toContain('结果：刘备（蜀势力） 获胜');
    expect(log).toContain('登场 关羽(g1)');
    expect(log).toContain('结束回合');
    expect(log.split('\n').some(line => line.startsWith('❌'))).toBe(false);
  });

  it('被引擎拒绝的步骤整行 ❌ 标注并附拒绝原因', () => {
    const doc: ReplayDocument = {
      version: 1,
      roomId: 'R',
      createdAt: Date.now(),
      initialState: state(),
      entries: [
        entry(
          1,
          { id: 'a1', type: 'ATTACK', playerId: 1, payload: { attackerId: 7, targetId: 8, ranged: false } } as GameAction,
          [{ type: 'ACTION_REJECTED', data: { code: 'ALREADY_ATTACKED', message: '本回合已攻击' } } as GameEvent],
          state(),
        ),
      ],
    };
    const log = buildGameplayLog(doc);
    expect(log).toContain('❌');
    expect(log).toContain('[ALREADY_ATTACKED] 本回合已攻击');
    expect(log).toContain('[被引擎拒绝]');
    expect(log).toContain('攻击 7 → 8');
  });
});
