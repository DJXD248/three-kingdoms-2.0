import { describe, expect, it } from 'vitest';
import {
  DISCONNECT_SILENCE_MS,
  HEARTBEAT_PROBE_INTERVAL_MS,
  dueProbes,
  emptyHeartbeat,
  linkRows,
  lostRows,
  markSeen,
  noteProbeSent,
  recordPong,
  sameRows,
  syncTracks,
  type HeartbeatModel,
} from './netHeartbeat';
import type { NetPeer } from './netProtocol';

/**
 * J3 的判据钉子。时刻全部喂进来（假钟），所以"15 秒"这条能当场钉死，
 * 不必真等十五秒；每条守卫都写成两边都测（差一毫秒是什么、够了又是什么），
 * 好让它在判据被改坏时真的变红。
 */
const HOST: NetPeer = { id: 'host-1', name: '房主', role: 'host' };
const GUEST: NetPeer = { id: 'guest-1', name: '客人甲', role: 'guest' };
const GUEST2: NetPeer = { id: 'guest-2', name: '客人乙', role: 'guest' };

/** 起点取一个像样的毫秒时刻：房主的钟就是这台机器的钟，判据不靠它从 0 开始。 */
const T0 = 1_700_000_000_000;

function booked(peers: NetPeer[] = [HOST, GUEST], now = T0): HeartbeatModel {
  return syncTracks(emptyHeartbeat(), peers, now);
}

describe('契约原文的两个数字（改动它俩必须过这里）', () => {
  it('阈值＝用户 2026-10-07 定稿的 15 秒；探测间隔＝契约写的约 2 秒', () => {
    expect(DISCONNECT_SILENCE_MS).toBe(15_000);
    expect(HEARTBEAT_PROBE_INTERVAL_MS).toBe(2_000);
  });
});

describe('建账：名册是唯一依据', () => {
  it('进房的人开课：房主自己也在表上，那一行 ping 还没量到＝null', () => {
    const model = booked();
    expect(model.tracks).toEqual([
      { id: HOST.id, name: HOST.name, role: 'host', lastSeenAt: T0, pingMs: null, lastProbedAt: 0 },
      { id: GUEST.id, name: GUEST.name, role: 'guest', lastSeenAt: T0, pingMs: null, lastProbedAt: 0 },
    ]);
  });

  it('老人账不动、新人建账、退房销账、改名跟着改（一切以房主那份名册为准）', () => {
    const first = booked();
    const seen = markSeen(first, GUEST.id, T0 + 500);
    const again = syncTracks(seen, [HOST, GUEST], T0 + 9_000);
    expect(again.tracks.find((t) => t.id === GUEST.id)?.lastSeenAt).toBe(T0 + 500);

    const pinged = recordPong(again, GUEST.id, T0 + 9_000, T0 + 9_050);
    expect(pinged.tracks[1].pingMs).toBe(50);

    const twoGuests = syncTracks(pinged, [HOST, GUEST, GUEST2], T0 + 1_000);
    expect(twoGuests.tracks.map((t) => t.id)).toEqual([HOST.id, GUEST.id, GUEST2.id]);
    expect(twoGuests.tracks[2].lastSeenAt).toBe(T0 + 1_000);

    const renamed = syncTracks(twoGuests, [HOST, { ...GUEST, name: '客人甲改名' }], T0 + 2_000);
    expect(renamed.tracks[1].name).toBe('客人甲改名');
    expect(renamed.tracks[1].pingMs).toBe(50);
    expect(renamed.tracks[1].lastSeenAt).toBe(T0 + 9_050);

    const gone = syncTracks(renamed, [HOST], T0 + 3_000);
    expect(gone.tracks.map((t) => t.id)).toEqual([HOST.id]);
  });

  it('收到名册外的人来信 ⇒ 不建账（不在场的人不能靠发消息挤进这张表）', () => {
    const model = booked();
    expect(markSeen(model, 'ghost', T0 + 100)).toBe(model);
    expect(recordPong(model, 'ghost', T0, T0 + 100).tracks).toEqual(model.tracks);
  });
});

describe('任何一条来信都算数（判据原文是"未收到该人任何消息"，不是"未回心跳"）', () => {
  it('来信把那个人的时钟推到当下，别人的不动', () => {
    const model = booked([HOST, GUEST, GUEST2]);
    const seen = markSeen(model, GUEST.id, T0 + 7_000);
    expect(seen.tracks.find((t) => t.id === GUEST.id)?.lastSeenAt).toBe(T0 + 7_000);
    expect(seen.tracks.find((t) => t.id === GUEST2.id)?.lastSeenAt).toBe(T0);
    expect(linkRows(seen, T0 + 7_001).find((r) => r.id === GUEST2.id)?.state).toBe('online');
  });

  it('差一毫秒不算掉线，够了才算：14 999 → 在线，15 000 → 掉线', () => {
    const model = booked();
    expect(linkRows(model, T0 + DISCONNECT_SILENCE_MS - 1).find((r) => r.id === GUEST.id)?.state).toBe('online');
    const row = linkRows(model, T0 + DISCONNECT_SILENCE_MS).find((r) => r.id === GUEST.id);
    expect(row?.state).toBe('lost');
    expect(row?.pingMs).toBeNull();
  });

  it('掉线的人又来信 ⇒ 那一行自己回到在线（不需要任何新政策，也没有粘住的标签）', () => {
    const model = booked();
    expect(linkRows(model, T0 + 20_000).find((r) => r.id === GUEST.id)?.state).toBe('lost');
    const back = markSeen(model, GUEST.id, T0 + 20_000);
    const row = linkRows(back, T0 + 20_000).find((r) => r.id === GUEST.id);
    expect(row?.state).toBe('online');
    // 数字不会因为"人回来了"就凭空冒出来：那要等下一次探测的回话。
    expect(row?.pingMs).toBeNull();
  });

  it('房主那一行永远不判掉线——判定只有房主能做，他没有可以判自己的立场', () => {
    const model = booked();
    const rows = linkRows(model, T0 + 10 * DISCONNECT_SILENCE_MS);
    expect(rows.find((r) => r.id === HOST.id)?.state).toBe('online');
    expect(lostRows(rows).map((r) => r.id)).toEqual([GUEST.id]);
  });

  it('阈值可以从外面改（接线层留了这个口子，判据本身不写死一份）', () => {
    const model = booked();
    expect(linkRows(model, T0 + 3_000, 2_000).find((r) => r.id === GUEST.id)?.state).toBe('lost');
  });
});

describe('ping 的算法：全程只用房主一个时钟，绝不两边对表', () => {
  it('往返＝房主发出探测与收到回话两个时刻之差', () => {
    const model = booked();
    const ponged = recordPong(model, GUEST.id, T0, T0 + 37);
    expect(ponged.tracks.find((t) => t.id === GUEST.id)?.pingMs).toBe(37);
    expect(linkRows(ponged, T0 + 37).find((r) => r.id === GUEST.id)).toEqual({
      id: GUEST.id, name: GUEST.name, pingMs: 37, state: 'online',
    });
  });

  it('同一刻回话就如实记 0 毫秒（不写成 null 装没量到）', () => {
    const model = booked();
    expect(recordPong(model, GUEST.id, T0, T0).tracks[1].pingMs).toBe(0);
  });

  it('小数四舍五入，报出来的是整数毫秒', () => {
    const model = booked();
    expect(recordPong(model, GUEST.id, T0, T0 + 37.6).tracks[1].pingMs).toBe(38);
  });

  it('抄回来的时刻在未来 ⇒ 这次不算，保留上一次的数，但时钟照样刷新', () => {
    const first = recordPong(booked(), GUEST.id, T0, T0 + 100);
    const cheated = recordPong(first, GUEST.id, T0 + 50_000, T0 + 200);
    expect(cheated.tracks[1].pingMs).toBe(100);
    expect(cheated.tracks[1].lastSeenAt).toBe(T0 + 200);
    expect(linkRows(cheated, T0 + 200)[1].pingMs).toBe(100);
  });

  it('离谱的大数（比阈值再宽十圈）当没量到：同样是保留上一次，不是清成 null', () => {
    const first = recordPong(booked(), GUEST.id, T0, T0 + 100);
    const huge = recordPong(first, GUEST.id, T0 - 200_000, T0 + 100);
    expect(huge.tracks[1].pingMs).toBe(100);
    const fresh = recordPong(booked(), GUEST.id, T0 - 200_000, T0);
    expect(fresh.tracks[1].pingMs).toBeNull();
  });

  it('非有限的时刻（对面塞进 Infinity）不碰数字，也不误报掉线', () => {
    const first = recordPong(booked(), GUEST.id, T0, T0 + 100);
    const nan = recordPong(first, GUEST.id, Number.POSITIVE_INFINITY, T0 + 500);
    expect(nan.tracks[1].pingMs).toBe(100);
    expect(linkRows(nan, T0 + 500)[1].state).toBe('online');
  });
});

describe('探测该发给谁：只有客人、只有到点的', () => {
  it('房主自己不被探测（他不发给自己）', () => {
    const model = booked([HOST, GUEST, GUEST2]);
    expect(dueProbes(model, T0)).toEqual([GUEST.id, GUEST2.id]);
  });

  it('刚探过的人要等满一个间隔才再探：1 999 毫秒不算到点，2 000 毫秒算', () => {
    const model = booked([HOST, GUEST, GUEST2]);
    const probed = noteProbeSent(noteProbeSent(model, GUEST.id, T0), GUEST2.id, T0);
    expect(dueProbes(probed, T0 + HEARTBEAT_PROBE_INTERVAL_MS - 1)).toEqual([]);
    expect(dueProbes(probed, T0 + HEARTBEAT_PROBE_INTERVAL_MS)).toEqual([GUEST.id, GUEST2.id]);
  });

  it('两个人各走各的表：只探过其中一个，另一个照样到点就探', () => {
    const half = noteProbeSent(booked([HOST, GUEST, GUEST2]), GUEST.id, T0);
    expect(dueProbes(half, T0)).toEqual([GUEST2.id]);
  });

  it('没探测过的人 lastProbedAt 记 0 ⇒ 第一次就立刻探（别让新客人等到下一轮才被看见）', () => {
    expect(dueProbes(booked(), T0)).toEqual([GUEST.id]);
  });
});

describe('两张表是不是同一张（决定要不要再广播、要不要重画）', () => {
  const rows = linkRows(booked(), T0);

  it('内容相同＝同一张（对象不同也算）；空表与空表也算同一张', () => {
    expect(sameRows(rows, linkRows(booked(), T0))).toBe(true);
    expect(sameRows(null, null)).toBe(true);
    expect(sameRows([], [])).toBe(true);
  });

  it('数字变了、状态变了、人多了少了、换了顺序，都算另一张', () => {
    const pinged = linkRows(recordPong(booked(), GUEST.id, T0, T0 + 37), T0);
    expect(sameRows(rows, pinged)).toBe(false);
    const lost = linkRows(booked(), T0 + DISCONNECT_SILENCE_MS);
    expect(sameRows(rows, lost)).toBe(false);
    expect(sameRows(rows, rows.slice(0, 1))).toBe(false);
    expect(sameRows(rows, rows.slice().reverse())).toBe(false);
    expect(sameRows(rows, null)).toBe(false);
  });

  it('掉线的那些人从表里取出来（界面那句提示的出处，判据不在界面里再算一遍）', () => {
    expect(lostRows(rows)).toEqual([]);
    const twoGuests = booked([HOST, GUEST, GUEST2]);
    const oneBack = markSeen(twoGuests, GUEST2.id, T0 + 20_000);
    const lost = linkRows(oneBack, T0 + 20_000);
    expect(lostRows(lost).map((r) => r.name)).toEqual([GUEST.name]);
  });
});
