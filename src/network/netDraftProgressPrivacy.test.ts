/**
 * 联机切片⑤b（v2.9.25）的隐私证人。
 *
 * 用户 2026-10-30 逐字裁过：「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」
 * 「所有玩家只看自己的阵营，不翻」⇒ 征召那一段客人只许看见进度那一行话，
 * 别席的候选牌面**整格不下发**。这条不测判据（判据住在 `netDraftProgress.test.ts`），
 * 只测"漏没漏"：拿真 store 走一遍征召（分发 → 勾几名 → 确认），把线上传的那一帧整个序列化，
 * 再拿这一桌真将的名字与档案号逐个去撞那串字符。
 *
 * 撞空不算数，所以每场都先立一条正面凭据：这一轮到底有没有真将名字可漏（`faces` 非空）、
 * 表上到底有没有那一席的行。漏检的证人比漏检的代码更危险。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { General } from '../data/generals';
import type { Player } from '../store/gameStoreTypes';
import { buildDraftProgressRows, draftFactsOf, DRAFT_PICK_TOTAL } from './netDraftProgress';
import { encodeEnvelope, parseEnvelope, type NetDraftProgressRow } from './netProtocol';

/** 两座、两个势力：座 0 征召完要往前走，座 1 得能接着抽候选。 */
const twoSeats = (): Player[] => [
  { id: 1, name: '玩家1', faction: '魏', seatOrder: 0, generalPool: [] },
  { id: 2, name: '玩家2', faction: '蜀', seatOrder: 1, generalPool: [] },
] as unknown as Player[];

/**
 * 当下这一桌的「私有信息全集」：两格候选名单 + 正在勾的那几颗 + 各席已定的征召池。
 * 这些名字与档案号出现在线上的任何一个字节里，都算这一刀破了口径。
 */
function privateFaces(): General[] {
  const s = useGameStore.getState();
  return [
    ...s.draftGenerals,
    ...s.draftQunGenerals,
    ...s.selectedDraftGenerals,
    ...s.players.flatMap((p) => p.generalPool),
  ];
}

/** 那一桌的牌面是否上了线：真将的名字（含技能名，逐条比太长，名字与技能描述里的专有名词够用）与档案号。 */
function leak(json: string, faces: General[]): string[] {
  const found: string[] = [];
  for (const g of faces) {
    if (json.includes(g.name)) found.push(`将名「${g.name}」`);
    if (json.includes(g.id)) found.push(`档案号「${g.id}」`);
    for (const sk of g.skills ?? []) {
      if (sk.description && json.includes(sk.description)) found.push(`技能说明「${sk.name}」`);
    }
  }
  return found;
}

/**
 * 房主那侧真正上线的那一帧：走 `NetRoomBridge` 同一个出表路，编码上线、再由客人那边解回来。
 * 返回的是"两端各自重新序列化"的两串字符——编码不是遮蔽，去和回都得干净才算数。
 */
function wireText(): { outgoing: string; incoming: string; rows: NetDraftProgressRow[] | null } {
  const rows = buildDraftProgressRows(draftFactsOf(useGameStore.getState()));
  if (rows === null) return { outgoing: 'null', incoming: 'null', rows: null };
  const text = encodeEnvelope({ t: 'draftprogress', from: 'host-1', rows });
  const parsed = parseEnvelope(text);
  if (parsed === null || parsed.t !== 'draftprogress') {
    throw new Error(`客人那边收不回这张进度表（收到 ${JSON.stringify(parsed)}）`);
  }
  expect(parsed.rows).toEqual(rows);
  return { outgoing: text, incoming: JSON.stringify(parsed.rows), rows };
}

/** 两端一起扫：任何一处漏出牌面，就把漏的那条名字报出来。 */
function bothEndsClean(faces: General[]): string[] {
  const { outgoing, incoming } = wireText();
  return [...leak(outgoing, faces), ...leak(incoming, faces)];
}

describe('⑤b 征召进度表的隐私证人：真 store 走一遍，线上一张牌也没有', () => {
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
    const faces = privateFaces();
    const one = faces[0];
    const planted = leak(JSON.stringify({ generals: [{ name: one.name, id: one.id }] }), faces);
    expect(planted).toContain(`将名「${one.name}」`);
    expect(planted).toContain(`档案号「${one.id}」`);
    // 同一批人脸、同一把尺，扫真表：必须是空的——这才说明上面那两下是尺量出来的，不是硬写死的。
    expect(leak(JSON.stringify(buildDraftProgressRows(draftFactsOf(useGameStore.getState()))), faces)).toEqual([]);
  });

  it('征召中途（正在勾）：候选名单一个字都没上线', () => {
    useGameStore.getState().distributeDraftGenerals();
    const s = useGameStore.getState();
    s.selectDraftGeneral(s.draftGenerals[0]);
    s.selectDraftGeneral(s.draftGenerals[1]);
    s.selectDraftGeneral(s.draftGenerals[2]);

    const faces = privateFaces();
    expect(faces.length).toBeGreaterThan(0); // 正面凭据：确实有牌可漏
    const { rows } = wireText();
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(2);
    expect(bothEndsClean(faces)).toEqual([]);
    // 正在挑那一席报的是"勾了几名"这个数，不是勾了谁。
    expect(rows!.find((r) => r.seat === 1)).toMatchObject({ state: 'picking', picked: 3, total: DRAFT_PICK_TOTAL });
    expect(rows!.find((r) => r.seat === 2)).toMatchObject({ state: 'waiting', picked: 0 });
  });

  it('座 0 确认之后：那一席的池子只有长度上线，牌面不亮（「选完亮池子」没做）', () => {
    useGameStore.getState().distributeDraftGenerals();
    const s0 = useGameStore.getState();
    for (const g of s0.draftGenerals.slice(0, 3)) s0.selectDraftGeneral(g);
    s0.confirmDraft();

    const s = useGameStore.getState();
    expect(s.players[0].generalPool).toHaveLength(3);
    expect(s.draftPlayerIndex).toBe(1);

    const faces = privateFaces();
    expect(s.players[0].generalPool.map((g) => g.name)).toHaveLength(3); // 正面凭据：那一席真有了池子
    expect(bothEndsClean(faces)).toEqual([]);
    const { rows } = wireText();
    // 「已征召 n/10」里的 n 取的是那一席池子的长度（房主机器上的事实），不是拿 10 倒推。
    expect(rows!.find((r) => r.seat === 1)).toMatchObject({ state: 'done', picked: 3 });
  });

  it('行里只有那五个字段：座次／称呼／状态／两个数，别的键一律不存在', () => {
    useGameStore.getState().distributeDraftGenerals();
    const s = useGameStore.getState();
    s.selectDraftGeneral(s.draftGenerals[0]);
    const { rows } = wireText();
    expect(rows).not.toBeNull();
    for (const row of rows!) {
      expect(Object.keys(row).sort()).toEqual(['name', 'picked', 'seat', 'state', 'total']);
      expect(row.name).toBe(s.players.find((p) => Number(p.id) === row.seat)!.name);
    }
  });

  it('征召全部走完（进入抽卡）：表还在说进度，池子还是不上线', () => {
    useGameStore.getState().distributeDraftGenerals();
    let s = useGameStore.getState();
    s.selectDraftGeneral(s.draftGenerals[0]);
    s.confirmDraft();
    s = useGameStore.getState();
    s.selectDraftGeneral(s.draftGenerals[0]);
    s.confirmDraft();

    s = useGameStore.getState();
    expect(s.phase).toBe('drawing');
    const faces = privateFaces();
    expect(faces.length).toBeGreaterThan(0);
    const { rows } = wireText();
    expect(rows).not.toBeNull();
    expect(rows!.every((r) => r.state === 'done')).toBe(true);
    expect(bothEndsClean(faces)).toEqual([]);
  });
});
