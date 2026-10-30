/**
 * 联机切片⑤c（v2.9.25）房主侧那份候选名单发布者的证人——⑤d 起还带上"客人交回来的那两下"怎么办。
 *
 * 与 ⑤b 那张进度发布者差一个字：**按人各算一帧**。所以这里量的不是"发没发表"，
 * 而是"每一位各自的那一帧有没有各走各的"——一位客人那一格没动，不该按住另一位的那一帧；
 * 反之一个人身上重复的内容也不该反复上线。判据本身住 `netDraftList`，这里一条也不重演。
 *
 * ⑤d 那一段量的三样，正是派单 2026-10-30 逐字要的那三条：
 * ㈠重判只看**自己发出去的那一帧**（没发过、发的是别席、号不在那格上，都拒）；
 * ㈡办事时交给 store 的是**店里那个对象**（`toBe` 级别的同一份），不是线上来客凑出来的名字；
 * ㈢拒不得静默——那一句挂在同一枚指名名单信封的 `instruction` 上，说完就消费掉，别的一格不动。
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
type StoreView = typeof VIEW;
type Card = ReturnType<typeof card>;

/**
 * `harness` 从⑤c 那一版多带了 ⑤d 的四格（牌本身、勾一颗、交一次卷、这位绑第几席）。
 * `toggle`／`confirm` 不是记账而已：它们照 store 那两颗的做法把 `view` 改了并同步 `facts`，
 * 于是"客人点完之后的那一帧该长什么样"在这份证人是真的跟着走的。
 */
function harness(facts0: DraftListFacts, guests0: { peer: string; seat: number | null }[], view0: StoreView = VIEW) {
  const sent: { peer: string; frame: NetDraftListFrame }[] = [];
  const toggled: Card[] = [];
  let view: StoreView = { ...view0, draftGenerals: [...view0.draftGenerals], draftQunGenerals: [...view0.draftQunGenerals], selectedDraftGenerals: [...view0.selectedDraftGenerals] };
  let facts = facts0;
  let guests = guests0;
  let confirmCalls = 0;
  const host = startHostDraftList<Card>({
    facts: () => facts,
    guests: () => guests,
    send: (peer, frame) => { sent.push({ peer, frame }); },
    cards: () => ({ main: view.draftGenerals, qun: view.draftQunGenerals }),
    toggle: (c) => {
      toggled.push(c);
      view = {
        ...view,
        selectedDraftGenerals: view.selectedDraftGenerals.includes(c)
          ? view.selectedDraftGenerals.filter((x) => x !== c)
          : [...view.selectedDraftGenerals, c],
      };
      facts = draftListFactsOf(view);
    },
    confirm: () => {
      confirmCalls += 1;
      // 真 store 那颗交卷后把光标挪到下一席（并清掉这一席的勾选）；这里跟着挪，重复交卷才判得出来。
      view = { ...view, draftPlayerIndex: view.draftPlayerIndex + 1, selectedDraftGenerals: [] };
      facts = draftListFactsOf(view);
    },
    // 席位读的是权威那张表（`guests` 里的那一格），不是客人信封里自报的那一个数。
    boundSeat: (peer) => guests.find((g) => g.peer === peer)?.seat ?? null,
  });
  return {
    sent,
    toggled,
    confirmCalls: () => confirmCalls,
    setFacts: (next: DraftListFacts) => { facts = next; },
    setGuests: (next: { peer: string; seat: number | null }[]) => { guests = next; },
    /** 房主那边换了牌面（沙盒换了候选、重开一桌）：`facts` 跟着换，但那一帧的旧读数仍留在账上。 */
    patchView: (patch: Partial<StoreView>) => { view = { ...view, ...patch }; facts = draftListFactsOf(view); },
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

/** 凑够 10 名（群 1 名）的那一份材料，交给"确认"那一档用。 */
const readyView = (): StoreView => {
  const main = Array.from({ length: 9 }, (_, i) => card(`r-m${i}`, `将${i}`));
  const qun = [card('r-q0', '群将', '群')];
  return { ...VIEW, draftGenerals: main, draftQunGenerals: qun, selectedDraftGenerals: [...main, ...qun] };
};

/** 更正轮㈡ 的两份材料：名单上还剩一颗没勾的，而那一颗恰好加不进去。 */
const tenPickedView = (): StoreView => {
  const main = Array.from({ length: 10 }, (_, i) => card(`t-m${i}`, `将${i}`));
  const qun = [card('t-q0', '群将', '群')];
  // 勾着 9 主 + 1 群 = 10 名；`m9` 是那份名单上唯一没勾的一颗，而人数早就满了。
  return { ...VIEW, draftGenerals: main, draftQunGenerals: qun, selectedDraftGenerals: [...main.slice(0, 9), ...qun] };
};

const threeQunView = (): StoreView => {
  const main = Array.from({ length: 6 }, (_, i) => card(`n-m${i}`, `本${i}`));
  const qun = Array.from({ length: 4 }, (_, i) => card(`n-q${i}`, `群${i}`, '群'));
  // 勾着 6 主 + 3 群 = 9 名：还差一颗，可群势力那一档已经到顶。
  return { ...VIEW, draftGenerals: main, draftQunGenerals: qun, selectedDraftGenerals: [...main, ...qun.slice(0, 3)] };
};

describe('⑤d 客人交回来的那两下：房主按自己发过的那一帧重判，办事只走 store 那颗', () => {
  it('合法的那一颗 ⇒ 交出去的是店里那个对象，紧接着的那一帧把「已选」带上线', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow(); // g-1（第 1 席）拿到整格名单
    const before = h.sent.length;
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm0' })).toBe(true);
    // ⚠️ 派单第 5 条逐字：「绝不把线上来的任何东西当牌用」。来的那一条只有 `key`，
    // 而 `toggle` 收到的是 `VIEW.draftGenerals[0]` 这**一个**对象——同一个引用，不是按名字凑出来的 replica。
    expect(h.toggled).toEqual([VIEW.draftGenerals[0]]);
    expect(h.sent.length).toBe(before + 1);
    expect(h.sent[before].peer).toBe('g-1');
    expect(h.sent[before].frame.picked).toEqual(['m0']);
  });

  it('退一颗也走同一颗：再点一次那个号 ⇒ 店里那份被撤掉，线下的那一格跟着空', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm0' });
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm0' })).toBe(true);
    expect(h.toggled).toHaveLength(2);
    expect(h.host.frameSentTo('g-1')!.picked).toEqual([]);
  });

  it('信封里那个自报的席位号进不了门：他绑的是第 2 席，就按第 2 席判（一颗也不勾）', () => {
    // 第 1 席正在挑；`g-1` 在权威席位表上绑的是第 2 席 ⇒ "没轮到你"。
    // 他在线上怎么写那个 `seat` 都改不动这一条：`IncomingDraft` 那一种形状里压根没有席位这一格
    // （`netSession` 进门时把它丢了），这里能读的只有 `boundSeat`。
    const h = harness(MID, [{ peer: 'g-1', seat: 2 }, { peer: 'g-2', seat: 1 }]);
    h.host.syncNow();
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm0' })).toBe(false);
    expect(h.toggled).toEqual([]);
  });

  it('房主还没给他发过任何一帧 ⇒ 不认：判据不能凭空给他补一份名单', () => {
    const h = harness(MID, TWO_GUESTS);
    // 一次 syncNow 也没跑 ⇒ 那本"我发过什么"的账是空的。
    expect(h.sent).toHaveLength(0);
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm0' })).toBe(false);
    expect(h.toggled).toEqual([]);
    // 而这一趟也不许让他干等：拒话顺带把当下那一帧发了出去，他屏上从此有得看。
    expect(h.sent.map((s) => s.peer)).toEqual(['g-1', 'g-2']);
    expect(h.sent[0].frame.instruction).toContain('还没给你这一席算出候选名单');
  });

  it('那个号不在我发过的那一帧上 ⇒ 认不得，也绝不按客人带来的名字自己凑一张', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm9' })).toBe(false);
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'q1' })).toBe(false);
    expect(h.toggled).toEqual([]);
  });

  it('那一帧上的号还在、店里的名单却换了 ⇒ 回一句"查不到那张牌"，不拿旧帧去勾一张此刻不存在的牌', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    // 沙盒换了候选／重开一桌：房主这边两格短了一位，而 `last` 里那一帧还带着 m1 这个号。
    // 今天真走到这一步需要"两个读数之间换了牌面"，实际给不出；钉的是给得出时不办事、也不静默。
    h.patchView({ draftGenerals: [card('g-1', '夏侯惇')] });
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm1' })).toBe(false);
    expect(h.toggled).toEqual([]);
    expect(h.sent[h.sent.length - 1].frame.instruction).toContain('查不到那张牌');
  });

  it('确认那一档：凑够了才转交 store 那颗，没凑够就一句拒话、一次也不转交', () => {
    const r = readyView();
    const ok = harness(draftListFactsOf(r), [{ peer: 'g-1', seat: 1 }], r);
    ok.host.syncNow();
    expect(ok.host.frameSentTo('g-1')!.canConfirm).toBe(true);
    expect(ok.host.handleIncoming({ kind: 'confirm', peer: 'g-1' })).toBe(true);
    expect(ok.confirmCalls()).toBe(1);
    // 交完卷，那一席的那一格立刻换成"已经完成"——这是房主自己算出来的下一步，不是客人屏上的读数。
    expect(ok.sent[ok.sent.length - 1].frame.instruction).toContain('你这一席的征召已经完成了');

    const bad = harness(MID, [{ peer: 'g-1', seat: 1 }]);
    bad.host.syncNow();
    expect(bad.host.handleIncoming({ kind: 'confirm', peer: 'g-1' })).toBe(false);
    expect(bad.confirmCalls()).toBe(0);
    expect(bad.toggled).toEqual([]);
    // 那句里给的是房主当下的数（客人屏上那颗钮本来就是灰的，这里再说一遍为什么）。
    expect(bad.sent[bad.sent.length - 1].frame.instruction).toContain('还交不了卷：现在 0/10 名');
  });

  it('交过卷之后同一位再交一次 ⇒ 不认：那一格的光标已经不在这一席', () => {
    const r = readyView();
    const h = harness(draftListFactsOf(r), [{ peer: 'g-1', seat: 1 }], r);
    h.host.syncNow();
    expect(h.host.handleIncoming({ kind: 'confirm', peer: 'g-1' })).toBe(true);
    expect(h.host.handleIncoming({ kind: 'confirm', peer: 'g-1' })).toBe(false);
    expect(h.confirmCalls()).toBe(1);
  });

  it('拒不得静默：那句拒话走的就是已有的那一枚指名名单信封，只发给他、别的一格不动', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    const hisBefore = h.host.frameSentTo('g-1')!;
    const countBefore = h.sent.length;
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm7' })).toBe(false);
    expect(h.sent.length).toBe(countBefore + 1);
    const refusalFrame = h.sent[countBefore];
    expect(refusalFrame.peer).toBe('g-1'); // 别席没有多收一条（g-2 那一格一个字节也没动）
    expect(refusalFrame.frame.instruction).toContain('不在我发给你的那份名单上');
    // ⚠️ 只换那一句话：他屏上的名单与"已选"不能因为一句拒话被改写或清空。
    expect(refusalFrame.frame.main).toEqual(hisBefore.main);
    expect(refusalFrame.frame.qun).toEqual(hisBefore.qun);
    expect(refusalFrame.frame.picked).toEqual(hisBefore.picked);
  });

  it('那句拒话是一次性的：房主那边真有了变化，正常那句自己拼回来', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm7' });
    const refused = h.host.frameSentTo('g-1')!;
    expect(refused.instruction).toContain('不在我发给你的那份名单上');
    h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm0' }); // 这一次合法，勾上了
    const after = h.host.frameSentTo('g-1')!;
    expect(after.instruction).toContain('选择10名将领（群势力1-3名，当前0名）');
    expect(after.picked).toEqual(['m0']);
  });

  it('重连（syncNow）之后第一帧说的是当下该做什么，不是上一场挂着的那句拒话', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm7' });
    expect(h.host.frameSentTo('g-1')!.instruction).toContain('不在我发给你的那份名单上');
    h.host.syncNow();
    expect(h.host.frameSentTo('g-1')!.instruction).toContain('选择10名将领');
  });

  it('那一格换了才多发，没换的那一位不跟着收重复的（⑤d 没有新开一条通路）', () => {
    const h = harness(MID, TWO_GUESTS);
    h.host.syncNow();
    const before = h.sent.length;
    h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm0' });
    expect(h.sent.slice(before).map((s) => s.peer)).toEqual(['g-1']);
  });

  /**
   * ⚠️ 派单逐字：这一条**不能只断言返回 `false`，要断言 `send` 被调用过**——
   * "返回 false 但一条也没发"正是改之前那一处 bug 的签名：
   * `judgeDraftPick` 当时放行 ⇒ 房主叫 store 那颗 `selectDraftGeneral`，而它自己写着 `sd.length<10 ? [...sd,g] : sd`
   * 把第 11 颗按在原地不动 ⇒ 房主重算出来的那一帧与上一帧一字不差 ⇒ 一条不发 ⇒ 客人屏上点了一颗毫无回音。
   * 这一条打的就是"默"本身，不是那句判据。
   */
  it('更正轮㈡ 专打默：已勾满 10 颗、客人再点一颗没勾的 ⇒ 真的多发了一帧，那一帧上写的就是那句拒话', () => {
    const v = tenPickedView();
    const h = harness(draftListFactsOf(v), [{ peer: 'g-1', seat: 1 }], v);
    h.host.syncNow();
    const before = h.sent.length;
    const beforeFrame = h.host.frameSentTo('g-1')!;
    // 材料自己的凭据：10 颗全勾着、人数那档早就够了（`canConfirm` 是 true），所以这一颗不是"还没凑够"挡的。
    expect(beforeFrame.picked).toHaveLength(10);
    expect(beforeFrame.canConfirm).toBe(true);
    expect(beforeFrame.main.map((i) => i.key)).toContain('m9');

    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'm9' })).toBe(false);
    expect(h.sent.length, '拒话必须真的上线：客人屏上不能对着一点不动的名单干等').toBe(before + 1);
    expect(h.sent[before].peer).toBe('g-1');
    expect(h.sent[before].frame.instruction).toContain('已经勾满 10 颗');
    expect(h.toggled, 'store 那颗压根不该被叫到（改之前正是它静默不办）').toEqual([]);
    // 而那一格的内容一个字也没被这句拒话改掉：名单与「已选」仍是他自己的那一份。
    expect(h.sent[before].frame.main).toEqual(beforeFrame.main);
    expect(h.sent[before].frame.picked).toEqual(beforeFrame.picked);
  });

  it('更正轮㈡ 同一处的第二个形状：第 4 颗群牌加不进去（人数还差一颗也照样挡），退一颗仍然办得动', () => {
    const v = threeQunView();
    const h = harness(draftListFactsOf(v), [{ peer: 'g-1', seat: 1 }], v);
    h.host.syncNow();
    const before = h.sent.length;
    const frame = h.host.frameSentTo('g-1')!;
    // 正面凭据：9/10 名、群 3 名 ⇒ 人数这一档还没够（那颗确认钮是灰的），挡下 `q3` 的只可能是群上限那一条。
    expect(frame.picked).toHaveLength(9);
    expect(frame.canConfirm).toBe(false);
    expect(frame.qun.map((i) => i.key)).toContain('q3');

    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'q3' })).toBe(false);
    expect(h.sent.length).toBe(before + 1);
    expect(h.sent[before].frame.instruction).toContain('群势力最多 3 名');
    expect(h.toggled).toEqual([]);
    // 闸只拦"加不进去"这一侧：退一颗（号已在 `picked` 里）永远放行，方向与热座那句"已勾的永远可退"一致。
    expect(h.host.handleIncoming({ kind: 'pick', peer: 'g-1', key: 'q0' })).toBe(true);
    expect(h.toggled).toEqual([v.draftQunGenerals[0]]);
    expect(h.host.frameSentTo('g-1')!.picked).not.toContain('q0');
  });
});
