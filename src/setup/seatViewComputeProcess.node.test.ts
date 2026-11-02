// @vitest-environment node
/**
 * 乙 线第四片的第二枚证人（2026-11-02）——**跑在 Node 环境里**：这一格既没有 `localStorage`，
 * 也没有 `document`、没有 `window`。
 *
 * 为什么要有这么一枚：另一枚证人（`seatViewCompute.test.ts`）跑在 jsdom 下，那里"发视图这条路由进程算"
 * 这件事只由源码文本与行为撑着，环境本身照样给得出浏览器那几样。这一枚不给：逐席私有视图与把关
 * 在**根本没有浏览器可借**的世界里算出来、发出去。
 *
 * 四句钉死的话：
 *  ㈠ 这一格确实没有浏览器那几样，视图与清单照样算得出来（不是"在 jsdom 里假装没用到"）；
 *  ㈡ 同一枚种子、同一份料跑两遍 ⇒ **每一位客人收到的字节**同一条读数（发出去的那半没引入第二份随机，
 *     也没让"谁收到什么"跟着进程时钟漂）。比对口径＝键序排序＋抹平 `__inst_<序号>` 那颗进程级铸造
 *     计数器（与 ㈂ 那两枚证人同一条，那东西只保证同一次进程内唯一）；
 *  ㈢ 别人那一席的牌在这台机器算出来的字节里一个编号也不出现，自己那一份照发内容；
 *  ㈣ 发清单这一步不推进对局、不动游标（房主给客人发清单、收到编号后当场重算都靠这一条）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import type { GameAction } from '../action/ActionTypes';
import { allGenerals } from '../data/generals';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { createStrategyPolicy } from '../ai/policies/strategyPolicy';
import { resetLiveReplay } from '../replay/liveReplayRecorder';
import { __resetResidentEngineContainer } from '../store/engineExecutionBridge';
import { beginInitialDraw } from '../store/engineSteps';
import { buildSeatMoves, capSeatMoves } from '../network/netSeat';
import type { NetEnvelope, NetPeer } from '../network/netProtocol';
import { isHiddenEntry } from '../network/snapshotView';
import { OPENING_DRAFT_TOTAL, confirmOpeningSeat, runOpeningToDraft, type OpeningRoster, type OpeningState } from './openingCompute';
import type { AiSeatMode } from './runtimeSetup';
import { createTableHost, legalTableActions, openingToEngineState, playTable, type TableHost } from './tableCompute';
import { processSeatView, startProcessSeatAuthority, startProcessSeatViews } from './seatViewCompute';

const SEED = 20261104;

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}

const readingOf = (value: unknown): string =>
  JSON.stringify(sortDeep(value) ?? null).replace(/__inst_[0-9a-z]+/g, '__inst_#');

const roster: OpeningRoster = { pool: allGenerals, disabledIds: new Set<string>() };

/** 全桌人类席位：AI 席根本不进席位表，㈠/㈣ 要的是"这一席绑给一个客人"。 */
const seatModes = (count: number): AiSeatMode[] =>
  Array.from({ length: count }, () => ({ isAi: false, tier: 'balanced' as const }));

function policyPicker() {
  const policy = createStrategyPolicy('balanced');
  return (arm: TableHost, playerId: number): GameAction | null => {
    const probe = new GameEngine(arm.engineState, { recordHistory: false });
    syncPlayerSkills(probe, arm.engineState);
    return policy(probe, playerId);
  };
}

/**
 * 开局那五步跑完（人类席按座位规则点满）⇒ 引擎读数 ⇒ 进程宿主 ⇒ 挂上开局抽牌并走 24 步。
 * 与 `openingCli.ts` 那条演示路同一个解法：本势力先取、给群留一颗。
 */
function startMatch(playerCount: number): OpeningState {
  let state: OpeningState = runOpeningToDraft(
    { seed: SEED, playerCount, seatModes: seatModes(playerCount), roomName: '进程发视图（Node）', draftTotal: OPENING_DRAFT_TOTAL },
    roster,
  );
  while (state.stage === 'draft') {
    const seat = state.seats[state.draftSeatIndex];
    if (!seat) break;
    const mainIds = seat.main.slice(0, OPENING_DRAFT_TOTAL - 1).map(g => g.id);
    const qunIds = seat.qun.map(g => g.id).slice(0, OPENING_DRAFT_TOTAL - mainIds.length);
    const verdict = confirmOpeningSeat(state, state.draftSeatIndex, [...mainIds, ...qunIds], roster);
    if (verdict.rejected !== null) throw new Error(`第 ${String(state.draftSeatIndex + 1)} 席那份点选被退回：${verdict.rejected}`);
    state = verdict.state;
  }
  expect(state.stage, '开局账得收口').toBe('ready');
  return state;
}

function hostOf(opening: OpeningState): TableHost {
  const played = openingToEngineState(opening);
  expect(played.rngState?.s, '进程那侧的游标＝开局账算完剩下的那一颗').toBe(opening.rng >>> 0);
  const host = createTableHost(played);
  expect(beginInitialDraw(host, played.players[0]!.id).ok, '开局抽牌得挂得上').toBe(true);
  playTable(host, { maxSteps: 24, pick: policyPicker() });
  return host;
}

/** 这一席那两份私有格子里逐张取出"只属于这一张"的编号。 */
function privateIds(player: { hand?: unknown[]; generalPool?: unknown[] }): string[] {
  const out: string[] = [];
  for (const zone of [player.hand ?? [], player.generalPool ?? []]) {
    for (const card of zone as Record<string, unknown>[]) {
      const id = String(card?.id ?? '');
      const instance = String(card?.instanceId ?? '');
      if (id) out.push(id);
      if (instance) out.push(instance);
    }
  }
  return out;
}

function stringValuesOf(value: unknown, into: Set<string> = new Set<string>()): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const item of value) stringValuesOf(item, into);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) stringValuesOf(item, into);
  }
  return into;
}

/** 在这台机器上发一遍：视图按收件人归好，信封按到达次序留着。 */
function publishEverything(host: TableHost, guests: string[]) {
  const views = new Map<string, EngineState>();
  startProcessSeatViews({
    host,
    recipients: () => host.engineState.players.map((player, index) => ({ peer: guests[index]!, seat: player.id })),
    send: (view, to) => { views.set(to, view); return true; },
  }).flush();

  const peers: NetPeer[] = [
    { id: 'h1', name: '房主', role: 'host' },
    ...guests.map(id => ({ id, name: `客人${id}`, role: 'guest' as const })),
  ];
  const envelopes: NetEnvelope[] = [];
  const auth = startProcessSeatAuthority({
    host,
    selfId: () => 'h1',
    peers: () => peers,
    send: (envelope) => { envelopes.push(envelope); return true; },
  });
  auth.syncNow();
  return { views, envelopes, auth };
}

beforeEach(() => {
  __resetResidentEngineContainer();
  resetLiveReplay();
});

/** 席位表把最小的可坐席给房主、往后按进房顺序 ⇒ 挪拍到行棋轮落在**绑着客人**的那一格。 */
function makeGuestSeatCurrent(host: TableHost, boundSeat: number): void {
  let guard = 0;
  while (host.engineState.currentPlayerId !== boundSeat && guard < 6) {
    host.endTurn();
    guard += 1;
  }
  expect(host.engineState.currentPlayerId, `挪了 ${String(guard)} 拍也没挪到第 ${String(boundSeat)} 席`).toBe(boundSeat);
}

describe('乙 第四片 ㈤ Node 环境里发出去的逐席私有视图（没有浏览器可借）', () => {
  it('这一格确实没有 localStorage／document／window：视图与清单照样算得出来', () => {
    const globals = globalThis as Record<string, unknown>;
    expect(globals.localStorage, 'Node 环境不该有本机存档这一格').toBeUndefined();
    expect(globals.document).toBeUndefined();
    expect(globals.window).toBeUndefined();

    const host = hostOf(startMatch(3));
    const guests = ['g1', 'g2', 'g3'];
    const { views, envelopes } = publishEverything(host, guests);
    expect([...views.keys()].sort()).toEqual([...guests].sort());
    for (const id of guests) expect(views.get(id)!.players).toHaveLength(3);
    // 那把一次算一格的尺与这台机器上批量发出去的那一份是同一条读数（不是各算一遍）。
    const firstSeat = host.engineState.players[0]!.id;
    expect(readingOf(views.get('g1'))).toBe(readingOf(processSeatView(host, firstSeat)));
    expect(envelopes.filter(e => e.t === 'seatmap')).toHaveLength(1);
    expect(envelopes.filter(e => e.t === 'moves').length, '绑到客人的那两席各收到一份清单').toBe(2);
  });

  it('同一枚种子跑两遍：每一位客人收到的字节同一条读数', () => {
    const first = hostOf(startMatch(2));
    const firstSent = publishEverything(first, ['g1', 'g2']);
    const firstViews = new Map([...firstSent.views].map(([k, v]) => [k, readingOf(v)]));
    const firstMoves = JSON.stringify(firstSent.envelopes.filter(e => e.t === 'moves'));

    const second = hostOf(startMatch(2));
    const secondSent = publishEverything(second, ['g1', 'g2']);

    expect(readingOf(second.engineState)).toBe(readingOf(first.engineState));
    for (const peer of ['g1', 'g2']) {
      expect(secondSent.views.has(peer)).toBe(true);
      expect(readingOf(secondSent.views.get(peer)), `${peer} 那一份两次不一样＝发出去的那半跟着进程时钟漂了`).toBe(firstViews.get(peer));
    }
    expect(JSON.stringify(secondSent.envelopes.filter(e => e.t === 'moves'))).toBe(firstMoves);
    // 正面凭证：两位客人收到的不是同一条字节（都一样＝压根没按席位算，这条线是全遮那份）。
    expect(firstViews.get('g1')).not.toBe(firstViews.get('g2'));
  });

  it('别人那一席的牌在这台机器算出来的字节里一个编号也不出现', () => {
    const host = hostOf(startMatch(3));
    const state = host.engineState;
    const withHand = state.players.filter(player => (player.hand ?? []).length > 0);
    expect(withHand.length, '走了 24 步还没有一位玩家手里有牌——这一格证人扫的是空集').toBeGreaterThan(0);

    const { views } = publishEverything(host, ['g1', 'g2', 'g3']);
    // 收件人是按下标发的（第 0 位玩家→g1、第 1 位→g2…），席位号是引擎的 playerId：两条别混。
    host.engineState.players.forEach((player, index) => {
      const view = views.get(`g${String(index + 1)}`)!;
      const received = stringValuesOf(view);
      const mine = privateIds(player);
      expect(mine.length, `第 ${String(player.id)} 席那两份格子里总得有东西可发`).toBeGreaterThan(0);
      for (const id of mine) expect(received.has(id), `自己的「${id}」要发给自己`).toBe(true);
      for (const other of host.engineState.players) {
        if (other.id === player.id) continue;
        for (const id of privateIds(other)) {
          expect(received.has(id), `第 ${String(player.id)} 席那一份里漏进了第 ${String(other.id)} 席的「${id}」`).toBe(false);
        }
        const row = (JSON.parse(JSON.stringify(view)) as { players: Record<string, unknown>[] })
          .players.find(p => p.id === other.id)!;
        for (const zone of ['hand', 'generalPool']) {
          expect((row[zone] as unknown[]).every(entry => isHiddenEntry(entry)), `第 ${String(other.id)} 席的 ${zone} 必须逐张只剩数量`).toBe(true);
        }
      }
    });
  });

  it('清单那一份在 Node 里也是按进程真值算的（探针不动牌桌、不动游标）', () => {
    const host = hostOf(startMatch(2));
    const ids = host.engineState.players.map(p => p.id);
    // 这张席位表把最小的可坐席给房主 ⇒ 客人拿的是另一格，先把它挪成行棋席。
    makeGuestSeatCurrent(host, Math.max(...ids));
    const seat = host.engineState.currentPlayerId!;
    const before = readingOf(host.engineState);
    const cursorBefore = host.engineState.rngState?.s ?? null;

    const { envelopes } = publishEverything(host, ['g1', 'g2']);
    const list = capSeatMoves(buildSeatMoves(host.engineState, legalTableActions(host, seat)));
    const hit = envelopes.filter(e => e.t === 'moves' && e.seat === seat);
    expect(hit.length, '行棋那一席要收到一份').toBe(1);
    if (hit[0]!.t !== 'moves') throw new Error('不可能走到这里');
    expect(hit[0]!.items).toEqual(list.sent);
    expect(list.sent.length, '行棋席的清单不是空表（换成空探针这里就红）').toBeGreaterThan(0);
    expect(readingOf(host.engineState), '发清单这一步绝不能推进对局').toBe(before);
    expect(host.engineState.rngState?.s ?? null).toBe(cursorBefore);
    expect(JSON.stringify(hit[0])).not.toContain('payload');
  });
});
