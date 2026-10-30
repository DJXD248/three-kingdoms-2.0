/**
 * 联机切片⑤c（v2.9.25）逐席候选名单的隐私证人。
 *
 * 用户 2026-10-30 逐字裁过：「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」
 * ⑤b 那条证人量的是"这张全桌表里一张牌也没有"；这一条量的是同一句话的另一半——
 * **牌面可以上线，但只许上属于收信人那一格的那些**：
 * 拿真 store 走一遍征召（分发 → 勾几名 → 确认 → 下一席），每一趟把桌上**每一席各自的那一帧**
 * 都编码上线、再由客人那边解回来，然后逐张拿真将的名字、技能说明与档案号去撞那两串字符。
 *
 * 撞空不算数，所以每一场都先立正面凭据：收信人那一格到底有没有真名可撞（`faces` 非空、
 * 名单非空）、别人那一格到底是不是真的空。漏检的证人比漏检的代码更危险。
 *
 * 判据不住这里（那是 `netDraftList.test.ts` 的事），这里只测"漏没漏"。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { General } from '../data/generals';
import type { Player } from '../store/gameStoreTypes';
import { buildDraftListFrame, draftListFactsOf } from './netDraftList';
import { encodeEnvelope, parseEnvelope, type NetDraftListFrame } from './netProtocol';

/** 两座、两个势力：座 0 征召完要往前走，座 1 得能接着抽候选。 */
const twoSeats = (): Player[] => [
  { id: 1, name: '玩家1', faction: '魏', seatOrder: 0, generalPool: [] },
  { id: 2, name: '玩家2', faction: '蜀', seatOrder: 1, generalPool: [] },
] as unknown as Player[];

/** 桌上此刻存在的所有牌面（两格候选 + 正在勾的那几颗 + 各席已定的池子）。 */
function allFaces(): General[] {
  const s = useGameStore.getState();
  return [
    ...s.draftGenerals,
    ...s.draftQunGenerals,
    ...s.selectedDraftGenerals,
    ...s.players.flatMap((p) => p.generalPool),
  ];
}

/**
 * 房主那侧真正上线的那些帧：走 `NetRoomBridge` 同一条出帧路（同一把摘取尺、同一个建帧函数），
 * 每席一帧，编码上线、再由客人那边解回来。返回的是"两端各自重新序列化"的两串字符——
 * 编码不是遮蔽，去和回都得干净才算数。
 */
function wireFrames(): { peer: string; seat: number; outgoing: string; incoming: string; frame: NetDraftListFrame }[] {
  const state = useGameStore.getState();
  const facts = draftListFactsOf(state);
  return facts.seats.map((seat) => {
    const frame = buildDraftListFrame(facts, seat);
    if (frame === null) throw new Error(`第 ${seat} 席那一帧算不出来（接线那边就会一条不发）`);
    const outgoing = encodeEnvelope({ t: 'draftlist', from: 'host-1', to: `peer-${seat}`, ...frame });
    const parsed = parseEnvelope(outgoing);
    if (parsed === null || parsed.t !== 'draftlist') {
      throw new Error(`客人那边收不回第 ${seat} 席的候选名单（收到 ${JSON.stringify(parsed)}）`);
    }
    expect(parsed).toEqual({ t: 'draftlist', from: 'host-1', to: `peer-${seat}`, ...frame });
    // 信封上那个收件人必须就是他本人：传话程序按 `to` 投递，写错等于把别人的名单送进你这屏。
    expect(parsed.to).toBe(`peer-${seat}`);
    return { peer: `peer-${seat}`, seat, outgoing, incoming: JSON.stringify(parsed), frame };
  });
}

/** 将名与技能说明：牌面上画得出的那两样，逐张撞。 */
function leak(json: string, faces: General[]): string[] {
  const found: string[] = [];
  for (const g of faces) {
    if (json.includes(g.name)) found.push(`将名「${g.name}」`);
    for (const sk of g.skills ?? []) {
      if (sk.description && json.includes(sk.description)) found.push(`技能说明「${sk.name}」`);
    }
  }
  return found;
}

/** 档案号（`g.id`）：位置编号是线上唯一的指认方式，这一样在任何一帧里都不该有。 */
function leakedIds(json: string, faces: General[]): string[] {
  return faces.filter((g) => json.includes(g.id)).map((g) => `档案号「${g.id}」（${g.name}）`);
}

describe('⑤c 逐席候选名单的隐私证人：真 store 走一遍，别席那一格一个字节也不漏', () => {
  beforeEach(() => {
    useGameStore.setState({
      players: twoSeats(),
      phase: 'lobby',
      draftPlayerIndex: 0,
      selectedDraftGenerals: [],
      draftGenerals: [],
      draftQunGenerals: [],
      draftDistributed: [],
      generalEdits: {},
      skillEdits: {},
      disabledGenerals: new Set<string>(),
      authoredGenerals: [],
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('证人自己是活的：硬把一颗真将塞进那一串字符，它必须报出来（否则前面那几场全是空跑）', () => {
    useGameStore.getState().distributeDraftGenerals();
    const faces = allFaces();
    expect(faces.length).toBeGreaterThan(0);
    const one = faces[0];
    const planted = leak(JSON.stringify({ generals: [{ name: one.name, id: one.id, description: 'x' }] }), faces);
    expect(planted).toContain(`将名「${one.name}」`);
    expect(leakedIds(JSON.stringify({ generals: [{ id: one.id }] }), faces)).toContain(`档案号「${one.id}」（${one.name}）`);
    // 同一批人脸、同一把尺扫"不该有牌面"的那一帧（第 2 席还没轮到他）：必须是空的。
    const notHisTurn = wireFrames().find((w) => w.seat === 2)!;
    expect(notHisTurn.frame.main).toEqual([]);
    expect(leak(notHisTurn.outgoing + notHisTurn.incoming, allFaces())).toEqual([]);
  });

  it('正在挑第 1 席（勾了两名）：只有他那一帧带牌面，第 2 席那一帧一张牌也没有', () => {
    useGameStore.getState().distributeDraftGenerals();
    const s = useGameStore.getState();
    s.selectDraftGeneral(s.draftGenerals[0]);
    s.selectDraftGeneral(s.draftGenerals[1]);

    const faces = allFaces();
    expect(faces.length).toBeGreaterThan(0); // 正面凭据：这一桌真的有牌可漏
    const frames = wireFrames();
    expect(frames).toHaveLength(2);

    const mine = frames.find((w) => w.seat === 1)!;
    // 正面凭据：他自己那一格的名字确实上了线（这一腿要做的正是这件事）。
    expect(mine.frame.main.length + mine.frame.qun.length).toBeGreaterThan(0);
    expect(mine.incoming).toContain(s.draftGenerals[0].name);
    expect(mine.frame.picked).toHaveLength(2);
    // 别人那一格：整帧只有座位号、两个数和一句人话。
    const other = frames.find((w) => w.seat === 2)!;
    expect(other.frame.main).toEqual([]);
    expect(other.frame.qun).toEqual([]);
    expect(other.frame.picked).toEqual([]);
    expect(leak(other.outgoing + other.incoming, faces)).toEqual([]);
    expect(other.incoming).not.toContain(s.draftGenerals[0].name);
  });

  it('档案号一个也不上线：连他自己那一帧也只认位置编号（m0…／q0…）', () => {
    useGameStore.getState().distributeDraftGenerals();
    const s = useGameStore.getState();
    s.selectDraftGeneral(s.draftGenerals[0]);
    s.selectDraftGeneral(s.draftQunGenerals[0]);
    const faces = allFaces();
    for (const w of wireFrames()) {
      expect(leakedIds(w.outgoing + w.incoming, faces)).toEqual([]);
      expect(Object.keys(w.frame.main[0] ?? {})).not.toContain('id');
    }
    // 正面凭据：线上认牌用的那两个号就在帧里（腿3 交回"勾哪一颗"靠它）。
    const mine = wireFrames().find((w) => w.seat === 1)!;
    expect(mine.frame.picked).toEqual(['m0', 'q0']);
    expect(mine.incoming).toContain('"m0"');
  });

  it('座 0 确认之后：他的池子在任何一帧里都不出现（「选完亮池子」这一版没做）', () => {
    useGameStore.getState().distributeDraftGenerals();
    const s0 = useGameStore.getState();
    for (const g of s0.draftGenerals.slice(0, 3)) s0.selectDraftGeneral(g);
    s0.confirmDraft();

    const s = useGameStore.getState();
    expect(s.players[0].generalPool).toHaveLength(3); // 正面凭据：座 1 真有了已征召的池子
    expect(s.draftPlayerIndex).toBe(1);

    const faces = allFaces();
    const poolNames = s.players[0].generalPool.map((g) => g.name);
    const frames = wireFrames();
    // 上一席那一格：整帧只剩一句人话 ⇒ 拿全桌人脸扫它，必须是空的。
    const done = frames.find((w) => w.seat === 1)!;
    expect(done.frame.instruction).toContain('你这一席的征召已经完成了');
    expect(done.frame.main).toEqual([]);
    expect(leak(done.outgoing + done.incoming, faces)).toEqual([]);
    expect(leakedIds(done.outgoing + done.incoming, faces)).toEqual([]);
    // 正在挑那一格：他自己的候选照旧上线（这一腿要的就是这个），但别人刚定下的那三张不许混进来。
    const picking = frames.find((w) => w.seat === 2)!;
    expect(picking.frame.main.length + picking.frame.qun.length).toBeGreaterThan(0);
    for (const name of poolNames) {
      expect(picking.outgoing).not.toContain(name);
      expect(picking.incoming).not.toContain(name);
    }
  });

  it('那句人话与热座那颗钮逐字一致，群牌人数两种数法在真材料上不许说两套', () => {
    useGameStore.getState().distributeDraftGenerals();
    const s = useGameStore.getState();
    const qun = s.draftQunGenerals.slice(0, 2);
    expect(qun.length).toBeGreaterThan(0); // 正面凭据：这一桌的群那一格真发了牌
    for (const g of qun) s.selectDraftGeneral(g);
    for (const g of s.draftGenerals.slice(0, 2)) s.selectDraftGeneral(g);

    const state = useGameStore.getState();
    // 热座面板的那把尺（`GeneralDraft.tsx:18`）：按牌面势力那个字数群。
    const hotSeatQunCount = state.selectedDraftGenerals.filter((g) => g.faction === '群').length;
    const mine = wireFrames().find((w) => w.seat === Number(state.players[state.draftPlayerIndex].id))!;
    expect(mine.frame.instruction).toBe(`选择10名将领（群势力1-3名，当前${hotSeatQunCount}名）`);
    expect(hotSeatQunCount).toBe(2);
    // 而这一格按位置号数（在 `q…` 那一段里的颗数）⇒ 同一个数。
    expect(mine.frame.picked.filter((k) => k.startsWith('q'))).toHaveLength(hotSeatQunCount);
  });

  it('两席全走完（进入抽卡）：每一格都只剩一句人话，池子仍然一张不上线', () => {
    useGameStore.getState().distributeDraftGenerals();
    let s = useGameStore.getState();
    s.selectDraftGeneral(s.draftGenerals[0]);
    s.confirmDraft();
    s = useGameStore.getState();
    s.selectDraftGeneral(s.draftGenerals[0]);
    s.confirmDraft();

    s = useGameStore.getState();
    expect(s.phase).toBe('drawing');
    expect(s.players.every((p) => p.generalPool.length > 0)).toBe(true);
    const faces = allFaces();
    expect(faces.length).toBeGreaterThan(0);
    for (const w of wireFrames()) {
      expect(w.frame.main).toEqual([]);
      expect(w.frame.qun).toEqual([]);
      expect(w.frame.picked).toEqual([]);
      expect(leak(w.outgoing + w.incoming, faces)).toEqual([]);
      expect(leakedIds(w.outgoing + w.incoming, faces)).toEqual([]);
    }
  });

  it('帧里只有那七个字段：座次／总数／一句话／两份名单／勾了哪几颗／够不够交卷，别的键一律不存在', () => {
    useGameStore.getState().distributeDraftGenerals();
    for (const w of wireFrames()) {
      // ⑤d 多出来的那一个 `canConfirm` 是一个布尔，不是一张牌、不是一个档案号——它把"够不够"这一句话
      // 说清就完了，客人那边拿它决定那颗钮灰不灰，自己不再算第二遍（隐私口径没有因为它宽一寸）。
      expect(Object.keys(w.frame).sort()).toEqual(['canConfirm', 'instruction', 'main', 'picked', 'qun', 'seat', 'total']);
      expect(typeof w.frame.canConfirm).toBe('boolean');
      for (const item of [...w.frame.main, ...w.frame.qun]) {
        expect(Object.keys(item).sort()).toEqual(['faction', 'hp', 'key', 'meleeAtk', 'name', 'rangedAtk', 'skills', 'type']);
      }
    }
  });
});
