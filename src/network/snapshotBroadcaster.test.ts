/**
 * 房主发快照的节流证人：一次出手会连着落好几笔事实，客人只需要最后那个样子。
 * 钉的是几件事——满间隔立刻发、没满攒成一笔到点发最新的、只是界面在动不发、
 * 没有收件人不白费力气，以及发出去的那一份是遮蔽过的。
 * 切片③（v2.9.25）把"一份给全桌"改成"每人一份"，所以这里还钉：
 * 一位收件人一条、指名给谁、同一席位只算一份、没排上席位的拿全遮那份。
 */
import { describe, expect, it } from 'vitest';
import type { EngineState } from '../core/GameState';
import { MIN_BROADCAST_INTERVAL_MS, startSnapshotBroadcaster, type SnapshotRecipient } from './snapshotBroadcaster';

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

/** 一条线上消息：算给哪一席的那一份，指名发给了谁。 */
type Wire = { view: EngineState; to: string };

function harness(initial: EngineState = state('a'), recipients: SnapshotRecipient[] = [{ peer: 'g-1', seat: null }]) {
  let clock = 1_000;
  let current = initial;
  let targets = recipients;
  const sent: Wire[] = [];
  const queue: Array<{ at: number; fn: () => void } | null> = [];

  const bc = startSnapshotBroadcaster({
    readState: () => current,
    send: (view, to) => {
      sent.push({ view, to });
      return true;
    },
    recipients: () => targets,
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
    peers: () => sent.map((s) => s.to),
    phases: () => sent.map((s) => s.view.phase),
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
    setRecipients(value: SnapshotRecipient[]) { targets = value; },
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
    const wire = JSON.stringify(h.sent[0].view);
    expect(wire).not.toContain('暗牌一号');
    expect(wire).toContain('"hidden":true');
    expect(h.sent[0].view.players[0].hand).toHaveLength(1);
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

  it('没有收件人 ⇒ 不发；有人进来后 flush 补一份当下的，不用等下一次变化', () => {
    const h = harness();
    h.setRecipients([]);
    h.bc.notifyChange();
    expect(h.sent).toHaveLength(0);

    h.setRecipients([{ peer: 'g-1', seat: 1 }]);
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

/**
 * 切片③（v2.9.25）：一次变化＝屋里每人一条，每条指名给一个收件人，
 * 而每条里的私有内容只放开**他那一席**。这里摆一张两席桌（1 号甲、2 号乙，各有暗牌），
 * 断言的是"互相看不见"——这才是这一刀真正买到的东西。
 */
describe('切片③：按席位各出一份，一人一条', () => {
  const twoSeats = state('turn', {
    players: [
      { id: 1, name: '甲', hand: [{ name: '甲的暗牌' }], generalPool: [{ name: '甲的将' }] },
      { id: 2, name: '乙', hand: [{ name: '乙的暗牌' }], generalPool: [{ name: '乙的将' }] },
    ],
    currentPlayerId: 1,
  });

  it('两位客人各坐一席 ⇒ 一条局面发两条，各自指名、各自只看见自己的手牌', () => {
    const h = harness(twoSeats, [{ peer: 'g-1', seat: 1 }, { peer: 'g-2', seat: 2 }]);
    h.bc.notifyChange();

    expect(h.peers()).toEqual(['g-1', 'g-2']);
    const forG1 = JSON.stringify(h.sent[0].view);
    const forG2 = JSON.stringify(h.sent[1].view);
    expect(forG1).toContain('甲的暗牌');
    expect(forG1).not.toContain('乙的暗牌');
    expect(forG2).toContain('乙的暗牌');
    expect(forG2).not.toContain('甲的暗牌');
    // 放开的只有"收件人自己那一席"那两格：别人的手牌／池子与牌堆顺序谁都不发。
    expect(forG1).not.toContain('乙的将');
    expect(forG2).not.toContain('甲的将');
    expect(h.bc.stats().sent).toBe(2);
  });

  it('一条都没排上席位的 ⇒ 拿全遮那一份（＝切片③之前大家看到的同一份）', () => {
    const h = harness(twoSeats, [{ peer: 'g-9', seat: null }]);
    h.bc.notifyChange();
    const wire = JSON.stringify(h.sent[0].view);
    expect(wire).not.toContain('甲的暗牌');
    expect(wire).not.toContain('乙的暗牌');
    expect(h.sent[0].view.players[0].hand).toHaveLength(1);
    expect(h.peers()).toEqual(['g-9']);
  });

  it('两位收件人对上同一席位 ⇒ 视图只算一份（同一个引用），但仍一人一条', () => {
    const h = harness(twoSeats, [{ peer: 'g-1', seat: 2 }, { peer: 'g-2', seat: 2 }]);
    h.bc.notifyChange();
    expect(h.peers()).toEqual(['g-1', 'g-2']);
    expect(h.sent[1].view).toBe(h.sent[0].view);
  });

  it('发出去的两份各是指名给谁的：`to` 就是那条的收件人', () => {
    const h = harness(twoSeats, [{ peer: 'g-1', seat: 1 }, { peer: 'g-2', seat: 2 }]);
    h.bc.flush();
    expect(h.sent.map((s) => s.to)).toEqual(['g-1', 'g-2']);
  });
});
