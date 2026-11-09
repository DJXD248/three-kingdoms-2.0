/**
 * 切片⑥（窄投影）：问窗题面的派生与通线路。
 *
 * 题面/候选/可否/原因只给欠答的那一席，效果与牌面引用留在房主侧：这一道里没有
 * `events`、`cardKeys`、选择肢内部引用——所有会打开"做了什么、由哪张卡触发"的字段
 * 全部不出这一道（卡面引用在禁弹谱上，`NEVER_SENT_TOP_LEVEL` 的三样更不放开）；
 * 数值投影满载，512 KB 的线宽量得精。客人那边的门样（`netSession` 抽走 `ask`）住
 * 下面 `netSession.test.ts`，这里只量尺寸和空壳。
 */
import { describe, expect, it } from 'vitest';
import { MAX_WIRE_BYTES, parseEnvelope, encodeEnvelope, type NetEnvelope } from './netProtocol';

import type { TurnEndAsk } from '../store/gameStoreTypes';
import type { ReactionWindowState } from '../triggers/types';
import type { EngineState } from '../core/GameState';
import { deriveNarrowQuestionFace } from './askFace';

const SEATS = {
  /** 一套活的回合结束询问窗（刀 1 刀 2 窗口那一份的完整形状） */
  turnEndAsk: {
    playerId: 2,
    windowId: 'rw-1',
    candidates: [
      { skillId: 'g_yue:虎啸:e1', generalId: 'g_yue', generalName: '月英', skillName: '虎啸', description: '摸一张牌', activatable: true, disabledReason: null },
      { skillId: 'g_huang:气合:e2', generalId: 'g_huang', generalName: '黄', skillName: '气合', description: '体力回复 1 点', activatable: false, disabledReason: '体力≥99' },
    ],
  } as TurnEndAsk,
  reactionWindow: {
    id: 'rw-1',
    sourceEventId: 'e-1',
    sourceEventType: 'onTurnEnd' as ReactionWindowState['sourceEventType'],
    participants: [1, 2, 3],
    passed: [1],
    openedAt: 1000,
    closed: false,
  } as ReactionWindowState,
  /** 房主发出去的那一份（遮蔽过的 + 挂上窄投影）：`t` 集合只见 `snapshot` */
  snapshot: { version: 1, phase: 'playing', timelinePhase: 'ACTION', players: [], currentPlayerId: 2, turn: 3, round: 2, deck: [], discardPile: [] } as EngineState,
};

describe('askFace：窄投影题面的尺寸与空壳', () => {
  it('题面/候选/可否/原因逐字原样输出（把不可发动的那枚置灰候选也照写）', () => {
    const frame = deriveNarrowQuestionFace(SEATS.turnEndAsk, SEATS.reactionWindow);
    expect(frame).toEqual({
      turnEndAsk: {
        playerId: 2,
        windowId: 'rw-1',
        candidates: [
          { skillId: 'g_yue:虎啸:e1', generalId: 'g_yue', generalName: '月英', skillName: '虎啸', description: '摸一张牌', activatable: true, disabledReason: null },
          { skillId: 'g_huang:气合:e2', generalId: 'g_huang', generalName: '黄', skillName: '气合', description: '体力回复 1 点', activatable: false, disabledReason: '体力≥99' },
        ],
      },
      waitingSeats: [2, 3],
    });
  });

  it('已经把答案交了的席位剔除出还差谁没答（原序不变）', () => {
    const frame = deriveNarrowQuestionFace(SEATS.turnEndAsk, {
      ...SEATS.reactionWindow, passed: [2],
    });
    expect(frame.waitingSeats).toEqual([1, 3]);
  });

  it('没有窗口答者（热座）＝一份名单也没有', () => {
    expect(deriveNarrowQuestionFace(SEATS.turnEndAsk, null)).toEqual({
      turnEndAsk: { playerId: 2, windowId: 'rw-1', candidates: SEATS.turnEndAsk.candidates },
      waitingSeats: [],
    });
  });

  it('窗口没挂＝只递还差谁能收齐的名单（并没有题面），空账本也不造第二份账', () => {
    expect(deriveNarrowQuestionFace(undefined, SEATS.reactionWindow)).toEqual({
      turnEndAsk: undefined,
      waitingSeats: [2, 3],
    });
    expect(deriveNarrowQuestionFace(undefined, null)).toEqual({
      turnEndAsk: undefined,
      waitingSeats: [],
    });
  });

  it('选项里不能出现效果与牌面引用：整个客人的帧里不会出现 events/cardKey', () => {
    const frame = deriveNarrowQuestionFace(SEATS.turnEndAsk, SEATS.reactionWindow);
    expect(JSON.stringify(frame)).not.toContain('cardKeys');
    expect(JSON.stringify(frame)).not.toContain('cardKey');
    expect(JSON.stringify(frame)).not.toContain('events');
  });

  it('无损上线：封成信封再拆回来，状态里的 ask 还在，别的格一字不差', () => {
    const state = SEATS.snapshot;
    const frame = deriveNarrowQuestionFace(SEATS.turnEndAsk, SEATS.reactionWindow);
    const packet: NetEnvelope = { t: 'snapshot', from: 'host-1', to: 'g-1', state: { ...state, ask: frame } };
    const text = encodeEnvelope(packet);
    expect(text.length).toBeLessThanOrEqual(MAX_WIRE_BYTES);
    const round = parseEnvelope(text);
    expect(round).not.toBeNull();
    // 在协议层 round 是个句号：先把信封头与状态从 union 里析出来。
    const env = round! as unknown as { t: string; from: string; to: string; state: Record<string, unknown> };
    expect(env.t).toBe('snapshot');
    expect(env.from).toBe('host-1');
    expect(env.to).toBe('g-1');
    const extracted = env.state;
    expect(extracted.ask).toEqual(frame);
    // ask 抽走后的余留下来的：连同 SEATS.snapshot 一字不差。
    const body = { ...extracted };
    delete body.ask;
    expect(body).toEqual(state);
  });
  it('客人的答案题面封成载荷来量：二进制长度不到 2 KB，远远在 512 KB 门内', () => {
    const frame = deriveNarrowQuestionFace(SEATS.turnEndAsk, SEATS.reactionWindow);
    const text = JSON.stringify(frame);
    const bytes = new TextEncoder().encode(text).length;
    expect(bytes).toBeLessThan(2 * 1024);
  });
});
