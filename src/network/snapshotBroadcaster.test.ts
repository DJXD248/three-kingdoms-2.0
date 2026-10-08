/**
 * 房主发快照的节流证人：一次出手会连着落好几笔事实，客人只需要最后那个样子。
 * 钉的是四件事——满间隔立刻发、没满攒成一笔到点发最新的、只是界面在动不发、
 * 房间里没客人不白费力气，以及发出去的那一份是遮蔽过的。
 */
import { describe, expect, it } from 'vitest';
import type { EngineState } from '../core/GameState';
import { MIN_BROADCAST_INTERVAL_MS, startSnapshotBroadcaster } from './snapshotBroadcaster';

function state(marker: string, extra: Partial<EngineState> = {}): EngineState {
  return {
    version: 1,
    phase: marker,
    players: [],
    currentPlayerId: null,
    turn: 1,
    round: 1,
    deck: [],
    discardPile: [],
    ...extra,
  } as EngineState;
}

function harness(initial: EngineState = state('a')) {
  let clock = 1_000;
  let current = initial;
  let guests = true;
  const sent: EngineState[] = [];
  const queue: Array<{ at: number; fn: () => void } | null> = [];

  const bc = startSnapshotBroadcaster({
    readState: () => current,
    send: (view) => {
      sent.push(view);
      return true;
    },
    hasGuests: () => guests,
    now: () => clock,
    schedule: (fn, ms) => {
      queue.push({ at: clock + ms, fn });
      return (queue.length - 1) as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (handle) => {
      queue[handle as unknown as number] = null;
    },
  });

  return {
    bc,
    sent,
    phases: () => sent.map((s) => s.phase),
    advance(ms: number) {
      clock += ms;
      for (let i = 0; i < queue.length; i += 1) {
        const item = queue[i];
        if (item && item.at <= clock) {
          queue[i] = null;
          item.fn();
        }
      }
    },
    setGuests(value: boolean) { guests = value; },
    setState(value: EngineState) { current = value; },
  };
}

describe('J2 房主发快照的节流', () => {
  it('刚开局没有上一次可比 ⇒ 第一次变化立刻发', () => {
    const h = harness();
    h.bc.notifyChange();
    expect(h.phases()).toEqual(['a']);
  });

  it('发出去的是遮蔽视图，不是原始局面：手牌内容不上线', () => {
    const h = harness(state('turn', {
      players: [{ id: 1, name: '甲', hand: [{ secretName: '暗牌一号' }] }],
      currentPlayerId: 1,
    }));
    h.bc.notifyChange();
    const wire = JSON.stringify(h.sent[0]);
    expect(wire).not.toContain('暗牌一号');
    expect(wire).toContain('"hidden":true');
    expect(h.sent[0].players[0].hand).toHaveLength(1);
  });

  it('没满间隔的连续变化并成一笔，到点发的是最新那一份', () => {
    const h = harness();
    h.bc.notifyChange();
    h.setState(state('b'));
    h.bc.notifyChange();
    h.setState(state('c'));
    h.bc.notifyChange();
    expect(h.phases()).toEqual(['a']);
    expect(h.bc.stats()).toEqual({ sent: 1, coalesced: 1 });

    h.advance(MIN_BROADCAST_INTERVAL_MS);
    expect(h.phases()).toEqual(['a', 'c']);
  });

  it('间隔是从上一次真发出去那一刻算的，补发完就能再接上下一笔', () => {
    const h = harness();
    h.bc.notifyChange(); // 立刻发 a
    h.setState(state('b'));
    h.bc.notifyChange(); // 没满间隔 ⇒ 待补
    h.advance(MIN_BROADCAST_INTERVAL_MS); // 到点补发 b
    h.advance(MIN_BROADCAST_INTERVAL_MS); // 时钟又走满一轮
    h.setState(state('c'));
    h.bc.notifyChange(); // 这次没有待补 ⇒ 立刻发
    expect(h.phases()).toEqual(['a', 'b', 'c']);
  });

  it('局面引用没变（只是界面在动）⇒ 一条都不发', () => {
    const h = harness();
    h.bc.notifyChange();
    h.bc.notifyChange();
    h.bc.notifyChange();
    expect(h.phases()).toEqual(['a']);
  });

  it('房间里没有客人 ⇒ 不发；客人进来后 flush 补一份当下的，不用等下一次变化', () => {
    const h = harness();
    h.setGuests(false);
    h.bc.notifyChange();
    expect(h.sent).toHaveLength(0);

    h.setGuests(true);
    h.bc.flush();
    expect(h.phases()).toEqual(['a']);
  });

  it('stop 之后到点不再补发（离开房间不留悬挂定时器）', () => {
    const h = harness();
    h.bc.notifyChange();
    h.setState(state('b'));
    h.bc.notifyChange();
    h.bc.stop();
    h.advance(MIN_BROADCAST_INTERVAL_MS * 3);
    expect(h.phases()).toEqual(['a']);
  });
});
