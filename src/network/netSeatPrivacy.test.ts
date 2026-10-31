/**
 * 切片④的证人（v2.9.25）：房主发往线上的每一句"人读的话"里，不许出现**只住在某一席
 * 自己那两格**（手牌／征召池）或牌堆里的牌名。
 *
 * 为什么这句话非得单独钉：传话线（`scripts/net-relay.mjs:182-186`）把屋里每一条文字帧
 * **抄给每一台机器**——信封上那个"指名发给谁"在传输层不是一堵墙，客人那边丢掉不发话的
 * 帧只是界面行为。所以"这句话里有没有牌名"是这一版的隐私面所在（口径＝用户 2026-10-27
 * 「②把牌名抹掉」＋「这一版不防作弊」：抹的是**意外泄露**，不是恶意翻包）。
 *
 * 两条硬证人各占一节，缺一条＝没做完：
 *  ㈠ 别人那一侧拿到的文字里查不到牌名——把房主**真正发出去**的每个信封逐字扫一遍，
 *     名单取"此刻正躺在某一席看不见的格子里"的那些牌名（场上／弃牌堆本来就公开，不算）。
 *  ㈡ 欠答那一席仍能选、选完房主真的执行了——他交回去的只有「席位＋编号」，
 *     编号是从被抹过的清单上按"选项N"念出来的；执行后牌离开手牌、将落进场、问答格清空。
 *
 * 另一头也要钉：**不许抹过头**。场上候选那种问句若被换成位置，欠答那一席就读不懂在问什么
 * （§12-112：显示那句必须逐字对得上引擎行为，且要让人读得懂）。
 */
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { cloneEngineState, type EnginePlayer, type EngineState } from '../core/GameState';
import type { GameCard } from '../data/cards';
import type { General, Skill } from '../data/generals';
import { createAction, type GameAction } from '../action/ActionTypes';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { getReactionAsk } from '../skills/reactionChain';
import type { DataSkillDefinition } from '../skills/dataTypes';
import { buildMatchState } from '../ai/matchSetup';
import { probeSeatActions } from '../store/engineExecutionBridge';
import { buildSeatMoves, describeMove } from './netSeat';
import { buildBroadcastView } from './snapshotView';
import { startHostAuthority } from './netHostAuthority';
import { startSnapshotBroadcaster } from './snapshotBroadcaster';
import type { NetEnvelope, NetPeer, NetSeatRow } from './netProtocol';

const HOST = 'peer-host';
const GUEST_B = 'peer-guest-b';
const GUEST_C = 'peer-guest-c';
const PEERS: NetPeer[] = [
  { id: HOST, name: '房主甲', role: 'host' },
  { id: GUEST_B, name: '客人乙', role: 'guest' },
  { id: GUEST_C, name: '客人丙', role: 'guest' },
];

function makeGeneral(id: string, name: string, hp: number, skills: Skill[] = []): General {
  return {
    id, name, faction: '魏', hp, type: hp >= 4 ? '武将' : '文将',
    meleeAtk: hp >= 4 ? 2 : 1, rangedAtk: hp >= 4 ? 1 : 2, armor: 0, skills,
  } as unknown as General;
}
/** 手牌／征召池里的那张"将领卡"：运行时实例号跟着 `instanceId`（与探针、登场判定同口径）。 */
function handGeneral(general: General) {
  return { ...general, id: `card_${general.id}`, instanceId: `card_${general.id}` };
}
/** 资源牌：名字刻意与类型词不同名，免得把「军备1张」那种固定措辞错当成泄露。 */
function makeResource(id: string, name: string, type = '材料') {
  return { id, name, type };
}
function makeFieldGeneral(general: General, ownerId: number, zone: 'camp' | 'front' | 'battle', slot: number, areaOwnerId: number | null) {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.hp >= 4 ? 2 : 1, rangedAtk: general.hp >= 4 ? 1 : 2,
    armor: 0, currentArmor: 0, armorCards: [], isArming: false, hasMoved: false,
    hasAttacked: false, hasSupplied: false, justDeployed: false, ownerId,
    position: { zone, slot, areaOwnerId },
  };
}
function makePlayer(id: number, name: string, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name, hp: 4, hand: [], generalPool: [], fieldGenerals: [], graveyard: [],
    baseHp: 6, baseMaxHp: 6, isAlive: true, statuses: [], ...overrides,
  } as EnginePlayer;
}
function makeState(players: EnginePlayer[]): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 3, round: 2,
    deck: [makeResource('deck_1', '木牛流马', '粮草'), makeResource('deck_2', '诸葛弩', '军备')] as unknown as GameCard[],
    discardPile: [], drawState: null,
  } as unknown as EngineState;
}
const cardsOf = (value: unknown): GameCard[] => (Array.isArray(value) ? value as GameCard[] : []);
const handOf = (state: EngineState, seat: number): GameCard[] => cardsOf(state.players.find(p => Number(p.id) === seat)?.hand);

/**
 * 此刻"只在某一席看不见的格子里"的牌名，连着它属于谁。
 * 判据是**住在哪一格**，不是拿 label 做字符串比对——牌名互相同字太常见（手牌「乐」与场上「乐进」），
 * 那种比法要么漏、要么误伤公开的名字。已经公开的地方（场上／弃牌堆）里出现过的名字不算。
 */
function privateNames(state: EngineState): Array<{ name: string; where: string }> {
  const publicZone = new Set<string>();
  for (const p of state.players) {
    for (const fg of (p.fieldGenerals as Array<{ general?: { name?: string } }> ?? [])) if (fg?.general?.name) publicZone.add(String(fg.general.name));
    for (const c of cardsOf(p.graveyard)) if (c?.name) publicZone.add(String(c.name));
  }
  for (const c of cardsOf(state.discardPile)) if (c?.name) publicZone.add(String(c.name));
  const out: Array<{ name: string; where: string }> = [];
  const seen = new Set<string>();
  const push = (name: unknown, where: string) => {
    const text = String(name ?? '');
    if (!text || publicZone.has(text) || seen.has(text)) return;
    seen.add(text);
    out.push({ name: text, where });
  };
  for (const p of state.players) {
    for (const c of cardsOf(p.hand)) push(c.name, `席${p.id}手牌`);
    for (const c of cardsOf(p.generalPool)) push(c.name, `席${p.id}征召池`);
  }
  for (const c of cardsOf(state.deck)) push(c.name, '牌堆');
  return out;
}

/**
 * 房主那一趟**真跑**：真引擎＋真房主把关（`startHostAuthority`）＋真快照节流器，
 * 每一个真正发往线上的信封原样录下来。测试只看这些读数，不另算一份。
 */
function runHost(state: EngineState, answer?: { peer: string; seat: number; index: number }) {
  const engine = new GameEngine(cloneEngineState(state), { recordHistory: false });
  syncPlayerSkills(engine, engine.state);
  const envelopes: NetEnvelope[] = [];
  const executed: GameAction[] = [];
  let rows: NetSeatRow[] = [];
  const auth = startHostAuthority({
    selfId: () => HOST,
    peers: () => PEERS,
    readState: () => engine.state,
    probe: (seat) => probeSeatActions({ engineState: engine.state }, seat),
    execute: (seat, action) => {
      executed.push({ ...action, playerId: seat });
      const events = engine.dispatch(action);
      engine.state = engine.snapshot();
      return !events.some(e => e.type === 'ACTION_REJECTED');
    },
    send: (env) => { envelopes.push(env); return true; },
    seatMapSink: (r) => { rows = r; },
  });
  const broadcaster = startSnapshotBroadcaster({
    readState: () => engine.state,
    recipients: () => PEERS.filter(p => p.role === 'guest').map(p => ({ peer: p.id, seat: rows.find(r => r.peer === p.id)?.seat ?? null })),
    send: (view, to) => { envelopes.push({ t: 'snapshot', from: HOST, to, state: view as unknown as Record<string, unknown> }); return true; },
  });
  auth.syncNow();
  broadcaster.flush();
  const before = JSON.stringify(engine.state);
  let answered = '';
  if (answer) {
    const key = buildSeatMoves(engine.state, probeSeatActions({ engineState: engine.state }, answer.seat))[answer.index].key;
    auth.handleAction({ peer: answer.peer, seat: answer.seat, key });
    answered = `key=${key} 局面变了=${JSON.stringify(engine.state) !== before}`;
    // 房主那台机器执行完会把新局面补发一次（store 订阅那一侧的同一个动作）。
    broadcaster.flush();
  }
  return { envelopes, rows, engine, executed, answered, priv: privateNames(state) };
}

/** 发往线上、且传话线会抄给全屋每一台机器的那些**文字帧**（快照单独算：那是切片③的遮蔽面）。 */
function textFrames(envelopes: NetEnvelope[]): string {
  return envelopes.filter(e => e.t !== 'snapshot').map(e => JSON.stringify(e)).join('\n');
}
function leaksIn(blob: string, priv: Array<{ name: string; where: string }>): string[] {
  return priv.filter(x => blob.includes(x.name)).map(x => `${x.name}（${x.where}）`);
}
const movesFor = (envelopes: NetEnvelope[], seat: number) => envelopes
  .filter((e): e is Extract<NetEnvelope, { t: 'moves' }> => e.t === 'moves' && e.seat === seat)
  .map(e => e.items);
const labelLines = (envelopes: NetEnvelope[], seat: number): string[] => movesFor(envelopes, seat).flat().map(i => i.label);

// ── 四个需要某席作答的真局面 ──────────────────────────────────────────────

/** A：响应问答欠在客人丙（席3）——选项名是「将名＋技能名」，两者本来就公开。 */
function reactionAskState(): EngineState {
  const hurtDraw = {
    name: '奸雄', description: '奸雄：受到伤害后可摸一张牌',
    effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  } as unknown as Skill;
  const state = makeState([
    makePlayer(1, '房主甲', { hand: [makeResource('h_1', '吴钩', '军备')] as unknown as GameCard[], fieldGenerals: [makeFieldGeneral(makeGeneral('g_a', '潘凤', 4), 1, 'battle', 0, null)] }),
    makePlayer(2, '客人乙', { hand: [makeResource('h_2', '白羽扇', '粮草')] as unknown as GameCard[], fieldGenerals: [makeFieldGeneral(makeGeneral('g_b', '乐进', 4), 2, 'battle', 0, null)] }),
    makePlayer(3, '客人丙', { hand: [makeResource('h_3', '的卢', '装备')] as unknown as GameCard[], fieldGenerals: [makeFieldGeneral(makeGeneral('g_c', '貂蝉', 3, [hurtDraw]), 3, 'battle', 1, null)] }),
  ]);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g_a', targetId: 'g_c', ranged: false, consumeCard: handOf(state, 1)[0] } as never));
  const asked = engine.snapshot();
  expect(getReactionAsk(asked)?.playerId).toBe(3);
  return asked;
}

/** 欠答席那一份清单里的"选项N"那一条（按编号找，绝不按牌名找）。 */
function optionItems(envelopes: NetEnvelope[], seat: number) {
  return labelLines(envelopes, seat).filter(l => l.startsWith('🔀'));
}
function choiceHandProducer(): DataSkillDefinition {
  return {
    id: 'cp_hand_1', name: '择弃', trigger: 'onTurnStart', description: '择一自身手牌弃置',
    choiceMode: true, choiceSource: 'HAND_CARD',
    effects: [{ type: 'DISCARD', value: 1, target: 'SELF', description: '弃置所选手牌' }],
  } as unknown as DataSkillDefinition;
}
/** B：选择问答欠在客人乙（席2），候选＝**他自己的手牌**（这三张的名字就是这一刀要抹的）。 */
function choiceHandAskState(): EngineState {
  const state = makeState([
    makePlayer(1, '房主甲', { fieldGenerals: [makeFieldGeneral(makeGeneral('s_a', '张辽', 4), 1, 'battle', 0, null)] }),
    makePlayer(2, '客人乙', {
      fieldGenerals: [makeFieldGeneral(makeGeneral('s_b', '夏侯渊', 4), 2, 'battle', 0, null)],
      hand: [makeResource('hb_1', '乌巢粮车', '粮草'), makeResource('hb_2', '绝影', '装备'), makeResource('hb_3', '杏花汤', '桃')] as unknown as GameCard[],
    }),
    makePlayer(3, '客人丙', { generalPool: [handGeneral(makeGeneral('pc_1', '赵云', 4))] as unknown as GameCard[] }),
  ]);
  const engine = new GameEngine(state);
  engine.registerPlayerSkills(2, [choiceHandProducer()]);
  engine.dispatch(createAction('END_TURN', 1));
  const asked = engine.snapshot();
  expect((asked.pendingChoice as { playerId?: number } | null)?.playerId).toBe(2);
  return asked;
}
function choiceTargetProducer(): DataSkillDefinition {
  return {
    id: 'cp_target_1', name: '择击', trigger: 'onTurnStart', description: '择一敌将，对其造成1点技能伤害',
    choiceMode: true, choiceSource: 'TARGET',
    effects: [{ type: 'DAMAGE', value: 1, target: 'TARGET', description: '对其造成1点伤害' }],
  } as unknown as DataSkillDefinition;
}
/** D：选择问答欠在客人乙（席2），候选＝**场上的将**——公开的名字一个也不许抹。 */
function choiceTargetAskState(): EngineState {
  const state = makeState([
    makePlayer(1, '房主甲', { fieldGenerals: [makeFieldGeneral(makeGeneral('t_a', '甲字兵', 6), 1, 'battle', 0, null)] }),
    makePlayer(2, '客人乙', { fieldGenerals: [makeFieldGeneral(makeGeneral('t_b', '择主', 4), 2, 'battle', 0, null)] }),
    makePlayer(3, '客人丙', {
      fieldGenerals: [makeFieldGeneral(makeGeneral('t_c', '乙字兵', 6), 3, 'battle', 0, null)],
      hand: [makeResource('hc_1', '青龙偃月刀', '装备')] as unknown as GameCard[],
    }),
  ]);
  const engine = new GameEngine(state);
  engine.registerPlayerSkills(2, [choiceTargetProducer()]);
  engine.dispatch(createAction('END_TURN', 1));
  const asked = engine.snapshot();
  expect((asked.pendingChoice as { playerId?: number } | null)?.playerId).toBe(2);
  return asked;
}
/** C：登场那一步——打的正是自己手里那张将，名字在落场之前不许上线。 */
function deployState(): EngineState {
  const state = makeState([
    makePlayer(1, '房主甲', { fieldGenerals: [makeFieldGeneral(makeGeneral('d_x', '看守', 4), 1, 'camp', 0, 1)] }),
    makePlayer(2, '客人乙', {
      hand: [handGeneral(makeGeneral('dm_1', '关羽', 2)), makeResource('dc_1', '干粮'), makeResource('dc_2', '麻绳')] as unknown as GameCard[],
      generalPool: [handGeneral(makeGeneral('dp_1', '张飞', 3))] as unknown as GameCard[],
    }),
    makePlayer(3, '客人丙', {}),
  ]);
  state.currentPlayerId = 2;
  return state;
}

describe('㈠ 别人那一侧拿到的文字里查不到牌名（真引擎＋真房主把关，逐个信封扫）', () => {
  it('B 手牌候选那种问句：清单上只剩「手牌第几张」，三张牌名一个也没上线', () => {
    const state = choiceHandAskState();
    const { envelopes, priv } = runHost(state);
    // 名单本身要先证明它不是空的：空名单的"零命中"不算证人。
    expect(priv.map(x => `${x.name}@${x.where}`)).toEqual(['乌巢粮车@席2手牌', '绝影@席2手牌', '杏花汤@席2手牌', '赵云@席3征召池', '木牛流马@牌堆', '诸葛弩@牌堆']);
    expect(leaksIn(textFrames(envelopes), priv)).toEqual([]);
    expect(optionItems(envelopes, 2)).toEqual(['🔀选项1：手牌第1张（客人乙）', '🔀选项2：手牌第2张（客人乙）', '🔀选项3：手牌第3张（客人乙）']);
  });

  it('C 登场那一步：将名此前从未出现在线上，落场之后才公开点名', () => {
    const state = deployState();
    // 答之前：线上只许说「手牌第几张」。
    const before = runHost(state);
    expect(leaksIn(textFrames(before.envelopes), before.priv)).toEqual([]);
    expect(labelLines(before.envelopes, 2).filter(l => l.startsWith('⚔️登场将领')))
      .toContain('⚔️登场将领：手牌第1张 → 营地区域第1格（消耗2张）');
    // 答之后：这一员已经在场上，公开格子里点名是允许的（那也是牌桌本来的样子）。
    const index = labelLines(before.envelopes, 2).findIndex(l => l.startsWith('⚔️登场将领'));
    const after = runHost(state, { peer: GUEST_B, seat: 2, index });
    expect(after.envelopes.map(e => JSON.stringify(e)).join('\n')).toContain('关羽');
  });

  it('A 响应问答：欠答那一席读到的还是「将名【技能名】」，而别人的手牌与牌堆一个也没漏', () => {
    const { envelopes, priv } = runHost(reactionAskState());
    expect(leaksIn(textFrames(envelopes), priv)).toEqual([]);
    expect(labelLines(envelopes, 3).some(l => l.includes('貂蝉') && l.includes('奸雄'))).toBe(true);
  });

  it('D 场上候选：那是本来就公开的名字，抹了才叫读不懂——本刀不许抹过头', () => {
    const { envelopes, priv } = runHost(choiceTargetAskState());
    expect(leaksIn(textFrames(envelopes), priv)).toEqual([]);
    const said = optionItems(envelopes, 2);
    expect(said.length).toBeGreaterThan(0);
    expect(said.join('')).toMatch(/甲字兵|乙字兵/);
  });

  it('快照那一侧照旧：指名发给别人的那份读不到你的牌，发给你的那份照样读得到你自己的牌', () => {
    const state = choiceHandAskState();
    const viewForC = buildBroadcastView(state, 3);
    const blobForC = JSON.stringify(viewForC);
    for (const name of ['乌巢粮车', '绝影', '杏花汤']) expect(blobForC.includes(name)).toBe(false);
    const viewForB = buildBroadcastView(state, 2);
    expect(cardsOf(viewForB.players.find(p => Number(p.id) === 2)?.hand).map(c => c.name)).toEqual(['乌巢粮车', '绝影', '杏花汤']);
    // 他自己的牌他自己看得见 ⇒ 抹掉清单上的名字并不会让他答不了（下一节证明答得了）。
    expect(labelLines(runHost(state).envelopes, 2).filter(l => l.startsWith('🔀')).length).toBe(3);
  });
});

describe('㈡ 该席那一侧仍能选、选完房主真的执行了', () => {
  it('B 按「选项2」那个编号交回去 ⇒ 房主本机执行、问答格清空、那张牌离开手牌', () => {
    const state = choiceHandAskState();
    const chosen = handOf(state, 2)[1].name;
    const index = labelLines(runHost(state).envelopes, 2).findIndex(l => l === '🔀选项2：手牌第2张（客人乙）');
    const { engine, executed, answered, envelopes } = runHost(state, { peer: GUEST_B, seat: 2, index });
    expect(answered).toContain('局面变了=true');
    expect(executed.map(a => a.type)).toEqual(['CHOOSE_OPTION']);
    expect(engine.state.pendingChoice ?? null).toBeNull();
    const names = handOf(engine.state, 2).map(c => c.name);
    expect(names).not.toContain(chosen);
    expect(names.length).toBe(2);
    // 执行后重发的清单里，那张被弃掉的牌名同样不许再出现。
    expect(leaksIn(textFrames(envelopes), privateNames(state))).toEqual([]);
  });

  it('C 交回登场的编号 ⇒ 关羽真的落进场，那一格从此公开点名', () => {
    const state = deployState();
    const index = labelLines(runHost(state).envelopes, 2).findIndex(l => l.startsWith('⚔️登场将领'));
    const { engine, executed, answered } = runHost(state, { peer: GUEST_B, seat: 2, index });
    expect(answered).toContain('局面变了=true');
    expect(executed.map(a => a.type)).toEqual(['DEPLOY_GENERAL']);
    const field = (engine.state.players.find(p => Number(p.id) === 2)?.fieldGenerals ?? []) as Array<{ general?: { name?: string } }>;
    expect(field.map(f => f.general?.name)).toContain('关羽');
  });

  it('抹过的清单不只有抉择与登场：那一席照样看得见结束回合这类公开出口', () => {
    const said = labelLines(runHost(deployState()).envelopes, 2);
    expect(said.some(l => l.includes('结束回合') || l.includes('抽取'))).toBe(true);
  });
});

describe('真名册扫描：每一局、每一席、每一条标签都拿私格牌名查', () => {
  it('12 局之内：标签上千条，两条要抹的路都走到，私格牌名命中 0', () => {
    let labels = 0;
    const hits: string[] = [];
    let deployTotal = 0;
    const kinds: Record<string, number> = {};
    for (let g = 0; g < 12; g += 1) {
      let state = buildMatchState({ seed: 1000 + g, playerCount: 3, poolPerPlayer: 4, deckSize: 40, skillInjection: 0.6, baseHp: 10 } as never);
      const engine = new GameEngine(cloneEngineState(state), { recordHistory: false });
      syncPlayerSkills(engine, engine.state);
      // 真名册里没有会发问句的技能：给每一席挂一枚合成生产者，把「选项」那条路也带进扫描
      // （选项 label 本来就是那一席的真手牌名，正是这一刀要抹的形状）。
      for (const p of engine.state.players) engine.registerPlayerSkills(Number(p.id), [choiceHandProducer()]);
      state = engine.state;
      for (let step = 0; step < 900; step += 1) {
        if (typeof (state.metadata as { winnerId?: unknown } | undefined)?.winnerId === 'number') break;
        const priv = privateNames(state);
        for (const p of state.players) {
          for (const action of probeSeatActions({ engineState: state }, Number(p.id))) {
            labels += 1;
            kinds[action.type] = (kinds[action.type] ?? 0) + 1;
            if (action.type === 'DEPLOY_GENERAL') deployTotal += 1;
            const label = describeMove(state, action);
            for (const x of priv) if (label.includes(x.name)) hits.push(`${action.type}: ${label} ← ${x.name}(${x.where})`);
          }
        }
        const owed = Number(
          (state.pendingChoice as { playerId?: number } | null)?.playerId
          ?? getReactionAsk(state)?.playerId
          ?? (state.drawState as { playerId?: number } | null)?.playerId
          ?? state.currentPlayerId,
        );
        const acts = probeSeatActions({ engineState: state }, owed);
        if (acts.length === 0) break;
        let advanced = false;
        for (let k = 0; k < acts.length; k += 1) {
          const events = engine.dispatch(acts[(step + k * 3) % acts.length]);
          engine.state = engine.snapshot();
          state = engine.state;
          if (!events.some(e => e.type === 'ACTION_REJECTED')) { advanced = true; break; }
        }
        if (!advanced) break;
      }
    }
    // 下面三个数＝这一趟种子（1000…1011）固定跑出来的实测读数，钉死是为了证明这一趟
    // 真的走遍了那两条路；哪天枚举面变了，这里会响，而不是悄悄变成"零命中"的空跑。
    // 2026-10-31 读法㈁（转换表 239 张卡进名册）之后现场复量：牌堆与候选面变大⇒三个数一起涨。
    expect(labels).toBe(1378);
    expect(kinds.DEPLOY_GENERAL).toBe(163);
    expect(kinds.CHOOSE_OPTION).toBe(33);
    // 登场这一步在真名册里总能在动作者手里查到位置：位置引用不会退化成那句兜底的话。
    expect(deployTotal).toBe(163);
    expect(hits).toEqual([]);
  });
});
