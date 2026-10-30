/**
 * 联机切片⑤c（v2.9.25）房主侧那份候选名单发布者的证人。
 *
 * 与 ⑤b 那张进度发布者差一个字：**按人各算一帧**。所以这里量的不是"发没发表"，
 * 而是"每一位各自的那一帧有没有各走各的"——一位客人那一格没动，不该按住另一位的那一帧；
 * 反之一个人身上重复的内容也不该反复上线。判据本身住 `netDraftList`，这里一条也不重演。
 *
 * ⑤b 那位有 `tableSink`（把表抄给房主自己那屏），这一位**没有**：
 * 房主自己看的是真的征召面板 `components/GeneralDraft.tsx`，不该在同一张桌上出现两份读数。
 */
import { describe, expect, it } from 'vitest';
import { startHostDraftList } from './netHostDraftList';
import { draftListFactsOf, type DraftListFacts } from './netDraftList';
import type { NetDraftListFrame } from './netProtocol';

const card = (id: string, name: string, faction = '魏') => ({
  id, name, faction, type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: [{ name: '刚勇' }],
});

/** 两席都在桌上、第 1 席正在挑、候选择有材料（接线读的就是 store 这几格）。 */
const VIEW = {
  phase: 'generalDraft',
  draftPlayerIndex: 0,
  draftGenerals: [card('g-1', '夏侯惇'), card('g-2', '张辽')],
  draftQunGenerals: [card('g-3', '华雄', '群')],
  selectedDraftGenerals: [] as ReturnType<typeof card>[],
  players: [{ id: 1 }, { id: 2 }],
};

function harness(facts0: DraftListFacts, guests0: { peer: string; seat: number | null }[]) {
  const sent: { peer: string; frame: NetDraftListFrame }[] = [];
  let facts = facts0;
  let guests = guests0;
  const host = startHostDraftList({
    facts: () => facts,
    guests: () => guests,
    send: (peer, frame) => { sent.push({ peer, frame }); },
  });
  return {
    sent,
    setFacts: (next: DraftListFacts) => { facts = next; },
    setGuests: (next: { peer: string; seat: number | null }[]) => { guests = next; },
    host,
  };
}

const MID = draftListFactsOf(VIEW);
const TWO_GUESTS = [{ peer: 'g-1', seat: 1 }, { peer: 'g-2', seat: 2 }];

describe('⑤c 房主侧名单发布者：按人各算一帧、变了才发', () => {
  it('第一趟：两位客人各收一帧，且各自那一帧的收件人与席位是自己的', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    expect(h.sent.map((s) => s.peer)).toEqual(['g-1', 'g-2']);
    // 正在挑那一席拿到整格名单，另一席只拿到一句"还没轮到你"（空名单是真话，不是漏发）。
    expect(h.sent[0].frame.seat).toBe(1);
    expect(h.sent[0].frame.main.map((i) => i.name)).toEqual(['夏侯惇', '张辽']);
    expect(h.sent[1].frame.seat).toBe(2);
    expect(h.sent[1].frame.main).toEqual([]);
    expect(h.sent[1].frame.instruction).toContain('还没轮到你这一席');
  });

  it('界面在动而每一格都没动 ⇒ 一条也不发（20 趟重绘也只发第一趟那两条）', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    for (let i = 0; i < 20; i += 1) h.host.notifyChange();
    expect(h.sent).toHaveLength(2);
  });

  it('一位客人那一格变了 ⇒ 只多发他那一帧，另一位不许跟着收重复的', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    h.setFacts(draftListFactsOf({ ...VIEW, selectedDraftGenerals: [VIEW.draftGenerals[0]] }));
    h.host.notifyChange();
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2].peer).toBe('g-1');
    expect(h.sent[2].frame.picked).toEqual(['m0']);
  });

  it('轮到下一席 ⇒ 前一席收到"已经完成"、后一席收到名单，两帧同时发各自的路', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    h.setFacts(draftListFactsOf({ ...VIEW, draftPlayerIndex: 1 }));
    h.host.notifyChange();
    const last = h.sent.slice(-2);
    expect(last.map((s) => s.peer)).toEqual(['g-1', 'g-2']);
    expect(last[0].frame.instruction).toContain('你这一席的征召已经完成了');
    // 热座那两格候选本来就属于"当下这一席"：draftPlayerIndex 走到 1，名单就跟着换到第 2 席那一帧上。
    expect(last[1].frame.main.map((i) => i.name)).toEqual(['夏侯惇', '张辽']);
    expect(last[1].frame.picked).toEqual([]);
  });

  it('还没绑到椅子的那位（观战、椅子没排到）⇒ 一帧也不发；绑上那一刻立刻发得出', () => {
    const h = harness(MID, [{ peer: 'g-1', seat: 1 }, { peer: 'watch-1', seat: null }]);
    h.host.syncNow();
    expect(h.sent.map((s) => s.peer)).toEqual(['g-1']);
    h.setGuests([{ peer: 'g-1', seat: 1 }, { peer: 'watch-1', seat: 2 }]);
    h.host.notifyChange();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].peer).toBe('watch-1');
    expect(h.sent[1].frame.seat).toBe(2);
  });

  it('走了的那位把账清掉：他再进来时"内容没变"不许把他该收的第一帧按住', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    h.setGuests([{ peer: 'g-1', seat: 1 }]);
    h.host.notifyChange();
    expect(h.sent).toHaveLength(2); // g-2 走的那一步不多发一条
    h.setGuests(TWO_GUESTS);
    h.host.notifyChange();
    expect(h.sent).toHaveLength(3); // 重新进来的那一位拿到了当下这一帧
    expect(h.sent[2].peer).toBe('g-2');
  });

  it('名册换了人（syncNow）⇒ 哪怕每一帧一字未动，也逐人重发一遍（迟来的那位不能干等下一次点将）', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    h.host.syncNow();
    expect(h.sent).toHaveLength(4);
    expect(h.sent[2].frame).toEqual(h.sent[0].frame);
  });

  it('不在征召那一段 ⇒ 每位在场客人各收一句"现在不在征召那一段"，之后一直不发（一次一帧，不是每帧重复）', () => {
    const h = harness(draftListFactsOf({ ...VIEW, phase: 'diceRoll' }), TWO_GUESTS);
    h.host.syncNow();
    expect(h.sent).toHaveLength(2);
    expect(h.sent.every((s) => s.frame.main.length === 0 && s.frame.picked.length === 0)).toBe(true);
    expect(h.sent[0].frame.instruction).toContain('现在不在征召那一段');
    h.host.notifyChange();
    expect(h.sent).toHaveLength(2);
  });

  it('桌上一位客人也没有 ⇒ 一条也不发（房主自己那屏不经过这条路）', () => {
    const h = harness(MID, []);
    h.host.syncNow();
    h.host.notifyChange();
    h.host.syncNow();
    expect(h.sent).toHaveLength(0);
  });
});
