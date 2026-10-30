/**
 * 联机切片⑤b（v2.9.25）房主侧那张征召进度发布者的证人。
 *
 * 钉的是"什么时候发、发几次、算表的人自己看不看得见"这三件事，一条判据也不重演
 * （那张表怎么算是 `netDraftProgress` 的事，那里已经钉过）。
 */
import { describe, expect, it } from 'vitest';
import { startHostDraftProgress } from './netHostDraftProgress';
import { DRAFT_PICK_TOTAL, draftFactsOf, type DraftProgressFacts } from './netDraftProgress';
import type { NetDraftProgressRow } from './netProtocol';

/** 房主那台机器上"正在征召、第一席还没勾"那一刻的 store 形状（接线读的就是这几格）。 */
const STORE_VIEW = {
  phase: 'generalDraft',
  draftPlayerIndex: 0,
  selectedDraftGenerals: [] as { id: string }[],
  players: [
    { id: 1, name: '玩家1', generalPool: [] as { id: string }[] },
    { id: 2, name: '假客人', generalPool: [] as { id: string }[] },
  ],
};

function harness(facts0: DraftProgressFacts) {
  const sent: NetDraftProgressRow[][] = [];
  const sunk: (NetDraftProgressRow[] | null)[] = [];
  let facts = facts0;
  const host = startHostDraftProgress({
    facts: () => facts,
    send: (rows) => { sent.push(rows); },
    tableSink: (rows) => { sunk.push(rows); },
  });
  return {
    sent,
    sunk,
    setFacts: (next: DraftProgressFacts) => { facts = next; },
    host,
  };
}

const MID_DRAFT = draftFactsOf(STORE_VIEW);

describe('⑤b 房主侧进度发布者：变了才发', () => {
  it('第一趟：把当下那张表发出去，并同一份抄给房主自己那屏', () => {
    const h = harness(MID_DRAFT);
    h.host.syncNow();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toEqual([
      { seat: 1, name: '玩家1', state: 'picking', picked: 0, total: DRAFT_PICK_TOTAL },
      { seat: 2, name: '假客人', state: 'waiting', picked: 0, total: DRAFT_PICK_TOTAL },
    ]);
    expect(h.sunk).toEqual(h.sent);
  });

  it('房主那边一直点别的（store 每变一次问一遍）而那张表没动 ⇒ 一条也不发、一次也不抄', () => {
    const h = harness(MID_DRAFT);
    h.host.syncNow();
    for (let i = 0; i < 20; i += 1) h.host.notifyChange();
    expect(h.sent).toHaveLength(1);
    expect(h.sunk).toHaveLength(1);
  });

  it('房主勾了两名将 ⇒ 只多发那一张新表（正在挑那一席的数字跟着走）', () => {
    const h = harness(MID_DRAFT);
    h.host.syncNow();
    h.setFacts(draftFactsOf({ ...STORE_VIEW, selectedDraftGenerals: [{ id: 'a' }, { id: 'b' }] }));
    h.host.notifyChange();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1][0].picked).toBe(2);
    expect(h.sunk[1]).toBe(h.sent[1]);
  });

  it('还没开始征召＝线上一条也不发（不发空表），房主那屏也是"没话要说"', () => {
    const h = harness(draftFactsOf({ ...STORE_VIEW, phase: 'diceRoll' }));
    h.host.syncNow();
    h.host.notifyChange();
    expect(h.sent).toHaveLength(0);
    expect(h.sunk).toHaveLength(0);
  });

  it('一桌人征召完了 ⇒ 多发那一张"全桌都 done"的收尾表，而不是撒手不管', () => {
    const seats = [
      { seat: 1, name: '玩家1', poolSize: DRAFT_PICK_TOTAL },
      { seat: 2, name: '假客人', poolSize: 9 },
    ];
    const h = harness({ phase: 'generalDraft', draftPlayerIndex: 1, pickedCount: 3, seats });
    h.host.syncNow();
    h.setFacts({ phase: 'drawing', draftPlayerIndex: 2, pickedCount: 0, seats });
    h.host.notifyChange();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].map((r) => [r.seat, r.state, r.picked])).toEqual([
      [1, 'done', DRAFT_PICK_TOTAL],
      [2, 'done', 9],
    ]);
  });

  it('同一间房清场重来（表从有到没）⇒ 线上不发消息，房主那屏那一格回到"没话要说"', () => {
    const h = harness(MID_DRAFT);
    h.host.syncNow();
    h.setFacts(draftFactsOf({ ...STORE_VIEW, phase: 'lobby' }));
    h.host.notifyChange();
    expect(h.sent).toHaveLength(1);
    expect(h.sunk).toHaveLength(2);
    expect(h.sunk[1]).toBeNull();
  });

  it('新客人进房（名册变了）⇒ 哪怕这张表一个字没动，也要把当下这一张重发一遍', () => {
    // 与席位表 2026-10-28 那趟实测同一件事：只按内容去重会漏掉刚进来那一位，
    // 他会一直停在"还没开始征召"，而桌上正有人挑到第 7 名。
    const h = harness(MID_DRAFT);
    h.host.syncNow();
    h.host.syncNow();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toEqual(h.sent[0]);
  });
});
