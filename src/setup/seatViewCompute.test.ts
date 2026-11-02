/**
 * 乙 线第四片的证人（2026-11-02）＝**逐席私有视图由进程发**。
 *
 * 这一片要成立的是六句，每一句都落在可执行的判据上：
 *
 * ㈠ **进程那一侧的面还是干净的**，而且这一份**没有另造一把尺**：遮蔽那层的一个零件也不许出现在这里
 *    （`HIDDEN_MARKER`／`maskCount`），席位表/清单/封顶也不重抄——出现第二套遮蔽＝两份会漂移的口径，
 *    正是本线一路在防的东西。
 *
 * ㈡ **两臂发给同一席的那一份逐字节同一条**＝同一份开局读数分别喂浏览器 store 与进程宿主之后，
 *    逐席算出的视图（含 `seat:null` 那一格观战面）一模一样。㈂ 钉的是"牌桌那 14 步两臂同读数"，
 *    这里钉的是"从同一份读数**发出去**的那一份也同一条"。
 *
 * ㈢ **发出去的那一份读的是进程那台机器的账，不是浏览器 store 的账**＝把 store 故意留在开局那一刻、
 *    只推进进程那一臂，发出去的字节必须跟着进程走。这一句是"由进程发"的字面意思；
 *    写成断言而不是注释，是因为反过来接错一根线（`readState` 指回 store）在这一片里完全可能悄悄发生。
 *
 * ㈣ **每个玩家只收到他自己那一份**：别人那一席的手牌与征召池**逐张**只剩 `{hidden:true}`，
 *    而那些牌自己的编号在收件人拿到的整串字节里**一个值都不出现**；自己那一份照发内容。
 *    牌堆更严——次序都不给。正面凭证钉在两处：源读数里确实有牌（否则"扫不到"是空跑）、
 *    自己那些编号确实以值出现。
 *
 * ㈤ **清单与把关也接在进程真值上**：席位表按进程局面算、逐席清单按 `legalTableActions` 算、
 *    客人交回的编号在进程那臂执行（浏览器 store 一个字节都不动）、对不上的编号退回且**真的上线**。
 *
 * ㈥ 那格没搬的（人类席"逢人就问"的窗）在这里钉**量出来的两半**：进程算给那一席的私有清单里，
 *    该问的那枚技能照出现（所以"玩家看不见这个选项"不成立）；客人交回那一格的编号，
 *    `act`/`actno` 这两个已有信封就把答与回执走完（所以这一格**不需要新信封**、协议版本仍是 1）。
 *    真缺的是进程驱动循环不为人类席停一拍——那一拍归界面与措辞那片，见 `seatViewCompute.ts` 文件头 ㈣。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGenerals, type General, type Skill } from '../data/generals';
import { GameEngine } from '../core/GameEngine';
import { cloneEngineState, type EnginePlayer, type EngineState } from '../core/GameState';
import type { GameAction } from '../action/ActionTypes';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { createStrategyPolicy } from '../ai/policies/strategyPolicy';
import { resetLiveReplay } from '../replay/liveReplayRecorder';
import { useGameStore } from '../store/gameStore';
import { __resetResidentEngineContainer } from '../store/engineExecutionBridge';
import { applyEngineStateToStore } from '../store/gameStateAdapter';
import { MOVE_REFUSAL, buildSeatMoves, capSeatMoves } from '../network/netSeat';
import type { NetEnvelope, NetPeer, NetSeatRow } from '../network/netProtocol';
import { NET_PROTOCOL_VERSION } from '../network/netProtocol';
import { HIDDEN_MARKER, buildBroadcastView, isHiddenEntry } from '../network/snapshotView';
import { listTurnEndSkillCandidates } from '../skills/turnEndSkills';
import { OPENING_DRAFT_TOTAL, confirmOpeningSeat, runOpeningToDraft, type OpeningRoster, type OpeningState } from './openingCompute';
import type { AiSeatMode } from './runtimeSetup';
import { applyTableAction, createTableHost, legalTableActions, openingToEngineState, playTable, stepTable, type TableHost } from './tableCompute';
import { processSeatView, startProcessSeatAuthority, startProcessSeatViews } from './seatViewCompute';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = 20261103;

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

/** 键序无关＋抹平进程级铸造序号（与 ㈂ 那两枚证人同一条比对口径）。 */
const readingOf = (value: unknown): string =>
  JSON.stringify(sortDeep(value) ?? null).replace(/__inst_[0-9a-z]+/g, '__inst_#');

/** 一席一份发出去的字节的唯一序列化口径（比对与扫描共用，免得两处各写一遍）。 */
const wireOf = (view: EngineState): string => JSON.stringify(view);

function codeOf(file: string): string {
  return readFileSync(path.join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const roster: OpeningRoster = { pool: allGenerals, disabledIds: new Set<string>() };

/** 全桌人类席位：㈤/㈥ 要的是"这一席绑给一个客人"，AI 席根本不进席位表。 */
const humanSeatModes = (count: number): AiSeatMode[] =>
  Array.from({ length: count }, () => ({ isAi: false, tier: 'balanced' as const }));

/**
 * 开局那五步在进程里跑完（人类席按座位规则点满）⇒ 引擎读数 ⇒ 进程宿主。
 * 与 `openingCli.ts` 那条演示路同一个解法：本势力先取、给群留一颗。
 */
function processOpening(playerCount: number): { engineState: EngineState; host: TableHost } {
  let state: OpeningState = runOpeningToDraft(
    { seed: SEED, playerCount, seatModes: humanSeatModes(playerCount), roomName: '进程发视图', draftTotal: OPENING_DRAFT_TOTAL },
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
  expect(state.stage, '开局账得收口，否则这一局还没开始').toBe('ready');
  const engineState = openingToEngineState(state);
  return { engineState, host: createTableHost(cloneEngineState(engineState)) };
}

/** 把同一份读数喂进浏览器那一臂（走生产镜像）。 */
function installBrowserArm(engineState: EngineState): void {
  useGameStore.setState({
    phase: 'menu', players: [], turnEndAsk: null, reactionWindow: null,
    skillActivations: [], drawContext: null, revealedDrawCards: [], isTestMode: false,
  } as Partial<ReturnType<typeof useGameStore.getState>>);
  applyEngineStateToStore(cloneEngineState(engineState), patch => {
    useGameStore.setState(patch as Partial<ReturnType<typeof useGameStore.getState>>);
  });
}

const storeArm = () => useGameStore.getState().engineState;

function policyPicker() {
  const policy = createStrategyPolicy('balanced');
  return (arm: TableHost, playerId: number): GameAction | null => {
    const probe = new GameEngine(arm.engineState, { recordHistory: false });
    syncPlayerSkills(probe, arm.engineState);
    return policy(probe, playerId);
  };
}

/** 只推进"这一位手里有没有牌"这一件事：跑到有人抽上手牌为止（隐私那一句要有真材料）。 */
function dealSomeCards(host: TableHost, maxSteps = 120): number {
  const pick = policyPicker();
  let steps = 0;
  for (; steps < maxSteps; steps += 1) {
    if (host.engineState.players.some(player => (player.hand ?? []).length > 0)) break;
    if (host.engineState.phase === 'gameOver') break;
    if (!stepTable(host, pick)) break;
  }
  return steps;
}

/** 进程发出去的信封都落进这只盒子（进程这一侧没有 WebSocket）。 */
function captureSends() {
  const envs: NetEnvelope[] = [];
  return { envs, send: (envelope: NetEnvelope) => { envs.push(envelope); return true; } };
}

const peersOf = (guests: string[]): NetPeer[] => [
  { id: 'h1', name: '房主', role: 'host' },
  ...guests.map((id, i) => ({ id, name: `客人${String(i + 1)}`, role: 'guest' as const })),
];

/** 这张席位表里**绑给客人**的那几格（房主自己那一席不上清单，所以要点名排掉）。 */
function guestSeats(rows: NetSeatRow[]): Map<number, string> {
  return new Map(rows.filter(r => r.peer !== null && r.peer !== 'h1').map(r => [r.seat, r.peer as string]));
}

/** 这一席那两份私有格子里的牌，逐张取出"只属于这一张"的编号。 */
function privateIds(player: EnginePlayer): string[] {
  const out: string[] = [];
  for (const zone of [(player.hand ?? []) as unknown[], (player.generalPool ?? []) as unknown[]]) {
    for (const card of zone as Record<string, unknown>[]) {
      const id = String(card?.id ?? '');
      const instance = String(card?.instanceId ?? '');
      if (id) out.push(id);
      if (instance) out.push(instance);
    }
  }
  return out;
}

/** 收到的那份字节里**出现过**的每一个字符串值（按值取，不做子串匹配——子串会把 '1' 匹配进所有数字）。 */
function stringValuesOf(value: unknown, into: Set<string> = new Set<string>()): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const item of value) stringValuesOf(item, into);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) stringValuesOf(item, into);
  }
  return into;
}

/** 挪拍到行棋席落在一个绑着客人的格子上；挪不动就明说（绝不让断言对着空集绿）。 */
function seatBoundToGuest(host: TableHost, bound: Map<number, string>, onRotate: () => void, maxTurns = 8): number {
  let guard = 0;
  while (guard < maxTurns && !bound.has(Number(host.engineState.currentPlayerId))) {
    onRotate();
    guard += 1;
  }
  const seat = Number(host.engineState.currentPlayerId);
  expect(bound.has(seat), `挪了 ${String(guard)} 拍也没把行棋轮交给绑着客人的席位（绑的席位：${[...bound.keys()].join(',')}）`).toBe(true);
  return seat;
}

beforeEach(() => {
  __resetResidentEngineContainer();
  resetLiveReplay();
});

afterEach(() => {
  __resetResidentEngineContainer();
  resetLiveReplay();
});

describe('乙 第四片 ㈠ 进程那一侧的面是干净的，而且没有另造一把遮蔽的尺', () => {
  const file = 'seatViewCompute.ts';

  it('不读本机存档、不碰浏览器、不 import 会自读名册的 gameStore', () => {
    const code = codeOf(file);
    for (const banned of ['localStorage', 'sessionStorage', 'document.', 'window.', 'zustand', 'node:fs', 'readFileSync']) {
      expect(code, `${file} 不该出现「${banned}」`).not.toContain(banned);
    }
    expect(code, `${file} 不许导入会自读名册的 gameStore`).not.toMatch(/from\s+['"][^'"]*\/gameStore['"]/);
  });

  it('遮蔽、节流、席位表与把关全是复用：只把数据源换成进程那台机器的账', () => {
    const code = codeOf(file);
    for (const shared of [
      'buildBroadcastView', 'startSnapshotBroadcaster', 'startHostAuthority',
      'legalTableActions', 'applyTableAction', 'host.engineState',
    ]) {
      expect(code, `这里应当调 ${shared}，而不是自己再写一份`).toContain(shared);
    }
  });

  it('第二套遮蔽与第二套清单算法一寸也不许长在这里', () => {
    const code = codeOf(file);
    for (const ownRuler of ['HIDDEN_MARKER', 'maskCount', 'hidden:', 'buildSeatMoves', 'capSeatMoves', 'buildSeatMap']) {
      expect(code, `「${ownRuler}」只许住在网络层那把尺里，进程这一侧不许重抄`).not.toContain(ownRuler);
    }
  });
});

describe('乙 第四片 ㈡ 同一份读数喂两臂 ⇒ 发出去的逐席视图逐字节同一条', () => {
  it('三席各一份＋观战面，四份都逐字节相等', () => {
    const { engineState, host } = processOpening(3);
    installBrowserArm(engineState);
    for (const seat of [...engineState.players.map(p => p.id), null]) {
      const byProcess = wireOf(processSeatView(host, seat));
      const byBrowser = wireOf(buildBroadcastView(storeArm(), seat));
      expect(byProcess, `第 ${String(seat)} 席那一份两臂不同条`).toBe(byBrowser);
      // 正面凭证：这一份不是空串出来的——三席就得出三行，换了别的读数就会红。
      expect((JSON.parse(byProcess) as { players: unknown[] }).players).toHaveLength(3);
    }
  });
});

describe('乙 第四片 ㈢ 发出去的那一份读的是进程那本账', () => {
  it('store 停在开局那一刻、只推进进程 ⇒ 发出的字节跟着进程走', () => {
    const { engineState, host } = processOpening(2);
    installBrowserArm(engineState);
    const storeAtStart = wireOf(buildBroadcastView(storeArm(), 1));

    // 发布者**先挂上**再推进牌桌：反过来（先推进再挂）会让"读数在挂上那一刻被扣住"这种
    // 接错线的写法照样绿（2026-11-02 改坏取证第三枚实测：那一版 19 枚证人全绿＝证人有个洞）。
    const box: { to: string; view: EngineState }[] = [];
    const views = startProcessSeatViews({
      host,
      recipients: () => [{ peer: 'g1', seat: 1 }, { peer: 'g2', seat: 2 }],
      send: (view, to) => { box.push({ to, view }); return true; },
    });

    playTable(host, { maxSteps: 40, pick: policyPicker() });
    expect(readingOf(storeArm()), '这一趟只该动进程那臂').toBe(readingOf(engineState));
    expect(readingOf(host.engineState), '进程那臂 40 步没把账推动＝下面两句比的是同一份，白跑').not.toBe(readingOf(engineState));

    views.flush();

    expect(box.map(item => item.to)).toEqual(['g1', 'g2']);
    for (const item of box) {
      expect(wireOf(item.view)).toBe(wireOf(processSeatView(host, item.to === 'g1' ? 1 : 2)));
    }
    // 反面对照：发出去的不是 store 那一份（真接错一根线就死在这一句）。
    expect(wireOf(box[0]!.view)).not.toBe(storeAtStart);
  });

  it('同一席位两位收件人共用一份内容；还没绑上的拿另一份；引用没动一条也不发', () => {
    const { host } = processOpening(2);
    expect(dealSomeCards(host)).toBeLessThan(120);
    const state = host.engineState;
    const seatOne = state.players[0]!.id;
    const box: { to: string; view: EngineState }[] = [];
    const views = startProcessSeatViews({
      host,
      recipients: () => [
        { peer: 'g1', seat: seatOne },
        { peer: 'g1b', seat: seatOne },
        { peer: 'g0', seat: null },
      ],
      send: (view, to) => { box.push({ to, view }); return true; },
    });
    views.notifyChange();
    expect(box).toHaveLength(3);
    expect(wireOf(box[0]!.view)).toBe(wireOf(box[1]!.view));
    expect(wireOf(box[2]!.view)).not.toBe(wireOf(box[0]!.view));
    // 同一席位那两格：算一份给两个人（不是按人各算一遍＝两把尺会漂）。
    const own = privateIds(state.players.find(p => p.id === seatOne)!);
    expect(own.length).toBeGreaterThan(0);
    expect(stringValuesOf(box[0]!.view).has(own[0]!)).toBe(true);
    expect(stringValuesOf(box[2]!.view).has(own[0]!)).toBe(false);
    const sentBefore = views.stats().sent;
    views.notifyChange();
    expect(views.stats().sent, '引用没动＝只是界面在动，一条也不发').toBe(sentBefore);
  });
});

describe('乙 第四片 ㈣ 每个玩家只收到他自己那一份', () => {
  it('别人手里的牌：编号一个也不在他收到的字节里，自己那一份照发内容，牌堆只报张数', () => {
    const { host } = processOpening(3);
    const steps = dealSomeCards(host);
    const state = host.engineState;

    // 正面凭证：源读数里确实有"手里有牌"的那一席，否则下面扫不到是空跑。
    const withHand = state.players.filter(player => (player.hand ?? []).length > 0);
    expect(steps, '没跑出有人手里有牌的那些步').toBeLessThan(120);
    expect(withHand.length).toBeGreaterThan(0);

    const box: { to: string; view: EngineState }[] = [];
    startProcessSeatViews({
      host,
      recipients: () => state.players.map(player => ({ peer: `p${player.id}`, seat: player.id })),
      send: (view, to) => { box.push({ to, view }); return true; },
    }).flush();
    expect(box).toHaveLength(state.players.length);

    const deckIds = ((state.deck ?? []) as unknown as Record<string, unknown>[]).map(card => String(card?.id ?? ''));
    expect(deckIds.length, '牌堆空了就没有"次序连本席都不给"这一件事可钉').toBeGreaterThan(0);

    for (const item of box) {
      const mine = state.players.find(player => `p${player.id}` === item.to)!;
      const received = stringValuesOf(item.view);
      const parsed = JSON.parse(wireOf(item.view)) as { players: Record<string, unknown>[]; deck: unknown[] };

      // ① 自己那一份照发内容（正面）。
      const myIds = privateIds(mine);
      expect(myIds.length, `第 ${String(mine.id)} 席自己那两份格子里总得有东西可发`).toBeGreaterThan(0);
      for (const id of myIds) expect(received.has(id), `自己手里的「${id}」必须在他收到的那一份里`).toBe(true);

      // ② 别人的私有内容：逐张只剩数量，且编号一个值都不出现。
      for (const other of state.players) {
        if (other.id === mine.id) continue;
        const row = parsed.players.find(p => p.id === other.id)!;
        for (const zone of ['hand', 'generalPool']) {
          const entries = row[zone] as unknown[];
          expect(entries, `第 ${String(other.id)} 席的 ${zone} 张数要报出来`).toHaveLength(((other[zone] as unknown[]) ?? []).length);
          expect(entries.every(entry => isHiddenEntry(entry)), `第 ${String(other.id)} 席的 ${zone} 必须逐张只剩数量`).toBe(true);
        }
        for (const id of privateIds(other)) {
          expect(received.has(id), `第 ${String(mine.id)} 席收到了第 ${String(other.id)} 席的牌「${id}」＝漏了`).toBe(false);
        }
      }

      // ③ 牌堆只报张数（次序连本席都不给）；游标与两处待答绝不上线。
      expect(parsed.deck).toHaveLength(deckIds.length);
      expect(parsed.deck.every(entry => isHiddenEntry(entry)), '牌堆每一张都只剩"这里有一张"').toBe(true);
      const revealedMine = new Set(myIds);
      for (const id of deckIds) {
        if (revealedMine.has(id)) continue;
        expect(received.has(id), `牌堆里那张「${id}」不该出现在任何人的字节里`).toBe(false);
      }
      for (const banned of ['rngState', 'pendingChoice', 'pendingReaction']) {
        expect(Object.keys(parsed), `顶格不许出现「${banned}」`).not.toContain(banned);
      }
    }
  });

  it('观战面（还没绑上那一格）一席的牌面也不给', () => {
    const { host } = processOpening(2);
    expect(dealSomeCards(host)).toBeLessThan(120);
    const state = host.engineState;
    const spectator = processSeatView(host, null);
    const received = stringValuesOf(spectator);
    for (const player of state.players) {
      const ids = privateIds(player);
      expect(ids.length, '这一席那两份格子里得有东西，否则这一格扫的是空集').toBeGreaterThan(0);
      for (const id of ids) expect(received.has(id), `观战面拿到了第 ${String(player.id)} 席的「${id}」`).toBe(false);
    }
    const masked = (spectator.players[0] as unknown as { hand: unknown[] }).hand;
    expect(masked).toHaveLength(((state.players[0]!.hand ?? []) as unknown[]).length);
    expect(masked.every(entry => entry === HIDDEN_MARKER)).toBe(true);
  });
});

describe('乙 第四片 ㈤ 席位表、逐席清单与把关都接在进程真值上', () => {
  /** 绑好座 ⇒ 客人各自收到指名给自己那一份清单；退回与执行都落在进程那本账上。 */
  function serverWithGuests(playerCount: number) {
    const { host } = processOpening(playerCount);
    const holdable = host.engineState.players.filter(p => p.isAi !== true);
    const guests = holdable.slice(1).map(p => `g${p.id}`);
    const { envs, send } = captureSends();
    let rows: NetSeatRow[] = [];
    const auth = startProcessSeatAuthority({
      host,
      selfId: () => 'h1',
      peers: () => peersOf(guests),
      send,
      seatMapSink: r => { rows = r; },
    });
    auth.syncNow();
    return { host, guests, envs, auth, rows: () => rows, bound: () => guestSeats(rows) };
  }

  it('席位表由进程局面算出来，并抄一份给房主自己那屏', () => {
    const { host, guests, rows } = serverWithGuests(3);
    const table = rows();
    // 有几格＝进程那份读数里有几个能坐人的席位（AI 席一格也不进这张表）。
    expect(table).toHaveLength(host.engineState.players.filter(p => p.isAi !== true).length);
    expect(table.map(r => r.seat)).toEqual(
      host.engineState.players.filter(p => p.isAi !== true).map(p => p.id).sort((a, b) => a - b),
    );
    expect(table[0]!.peer).toBe('h1');
    expect(table.slice(1).map(r => r.peer).sort()).toEqual([...guests].sort());
    // 绑上的那一格写的是**这个人**的名字（客人自报、房主校验过的那份），没绑上的才退回席位标签。
    expect(table[1]!.name).toBe('客人1');
    expect(host.engineState.players.some(p => String(p.name) === table[1]!.name)).toBe(false);
  });

  it('清单指名发给每一位客人，内容＝进程那臂现算的合法集（动作本体一个字节也不上线）', () => {
    const { host, guests, envs, auth, bound } = serverWithGuests(2);
    const seat = seatBoundToGuest(host, bound(), () => { host.endTurn(); auth.syncNow(); });
    const moves = envs.filter(e => e.t === 'moves');
    expect(moves.length, '每一位客人都该收到指名给自己那一份').toBeGreaterThanOrEqual(guests.length);
    const last = moves[moves.length - 1];
    expect(last!.t, '最新那一份要发给现在行棋的那一席').toBe('moves');
    if (last!.t !== 'moves') throw new Error('不可能走到这里');
    const expected = capSeatMoves(buildSeatMoves(host.engineState, legalTableActions(host, seat)));
    expect(last!.items.length, '行棋席的清单不是空表（换成空探针这里就红）').toBeGreaterThan(0);
    expect(last!.items).toEqual(expected.sent);
    expect(last!.omitted).toBe(expected.omitted);
    expect(last!.to).toBe(guests[0]);
    // 线上这几类信封里不许有动作载荷（清单只跑编号与那句话）。
    for (const envelope of envs.filter(e => e.t === 'moves' || e.t === 'seatmap' || e.t === 'actno')) {
      expect(JSON.stringify(envelope), '编号之外不许把载荷带上线').not.toContain('payload');
    }
  });

  it('客人交回的编号在进程那臂执行；浏览器 store 一个字节都不动', () => {
    const { host, envs, auth, bound } = serverWithGuests(3);
    const seat = seatBoundToGuest(host, bound(), () => { host.endTurn(); auth.syncNow(); });
    const peer = bound().get(seat)!;

    const actions = legalTableActions(host, seat);
    expect(actions.length, '这一席现在总该有能走的一步').toBeGreaterThan(0);
    installBrowserArm(host.engineState);
    const storeAtHandover = readingOf(storeArm());
    const refusalCount = () => envs.filter(e => e.t === 'actno').length;

    // 探针枚举出来的那一批按顺序试：只要有一条真被收下称这一格成立（退回话一条也不许多出来）。
    // 全部试完还走不成就红——那说明清单与执行两边又分家了，正是本线一路在防的形状。
    const keys = buildSeatMoves(host.engineState, actions).map(m => m.key);
    let executed = false;
    for (const key of keys) {
      const before = readingOf(host.engineState);
      const actsBefore = refusalCount();
      auth.handleAction({ peer, seat, key });
      if (refusalCount() === actsBefore && readingOf(host.engineState) !== before) {
        executed = true;
        break;
      }
    }
    expect(executed, `清单里 ${String(keys.length)} 条一步也没在进程那臂走成（退回话多 ${String(refusalCount())} 条）`).toBe(true);
    expect(readingOf(storeArm()), '执行绝不落在浏览器 store 那本账上').toBe(storeAtHandover);
    // 牌桌一动，旧编号作废这件事要马上让人看见＝按新局面重发过清单。
    expect(envs.filter(e => e.t === 'moves').length).toBeGreaterThan(1);
  });

  it('对不上的编号：退回并说清为什么，而且那句退回真的上了线（拒不得静默）', () => {
    const { host, envs, auth, bound } = serverWithGuests(3);
    const seat = seatBoundToGuest(host, bound(), () => { host.endTurn(); auth.syncNow(); });
    const peer = bound().get(seat)!;
    const before = readingOf(host.engineState);
    const actsBefore = envs.filter(e => e.t === 'actno').length;

    auth.handleAction({ peer, seat, key: '999-END_TURN-00000000' });

    const refusals = envs.filter(e => e.t === 'actno');
    expect(refusals.length, '退回话必须真的发出去，不能让客人对着不动的清单干等').toBe(actsBefore + 1);
    expect(JSON.stringify(refusals[refusals.length - 1])).toContain(MOVE_REFUSAL.stale);
    expect(readingOf(host.engineState), '没让走＝进程那本账一个字也不许动').toBe(before);
  });

  it('客人想点房主那一席：退回并说"这一席绑的是别人"', () => {
    const { envs, auth, rows } = serverWithGuests(2);
    const hostSeat = rows().find(r => r.peer === 'h1')!.seat;
    const guest = rows().find(r => r.peer !== 'h1')!.peer as string;
    const before = envs.filter(e => e.t === 'actno').length;
    auth.handleAction({ peer: guest, seat: hostSeat, key: '0-END_TURN-00000000' });
    const refusals = envs.filter(e => e.t === 'actno');
    expect(refusals).toHaveLength(before + 1);
    expect(JSON.stringify(refusals[refusals.length - 1])).toContain(MOVE_REFUSAL.boundToOther);
  });
});

describe('乙 第四片 ㈥ 没搬的那格照实说：该问的技能在进程算给他的清单里', () => {
  /** 一席挂一枚"回合结束时可发动"的将＋一席空着，两席都是人（AI 席不进席位表）。 */
  function askWindowTable(): { host: TableHost; seat: number } {
    const skill = {
      id: 'sk_watch',
      name: '守夜',
      description: '回合结束时可发动',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    } as unknown as Skill;
    const general = {
      id: 'g_watch', instanceId: 'g_watch', name: '将g_watch', faction: '魏', hp: 3, type: '武将',
      meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [skill],
    } as unknown as General;
    const mk = (id: number, name: string, onField: boolean): EnginePlayer => ({
      id, name, hp: 4, hand: [], generalPool: [], graveyard: [],
      baseHp: 6, baseMaxHp: 6, isAlive: true, statuses: [], isAi: false,
      fieldGenerals: onField ? [{
        general, currentHp: 3, maxHp: 3, meleeAtk: 2, rangedAtk: 1, armor: 0,
        currentArmor: 0, armorCards: [], isArming: false, hasMoved: false,
        hasAttacked: false, hasSupplied: false, justDeployed: false, ownerId: id,
        position: { zone: 'front', slot: 0, areaOwnerId: id },
      }] : [],
    } as unknown as EnginePlayer);
    const state = {
      version: 1, phase: 'playing', timelinePhase: 'ACTION',
      currentPlayerId: 2, turn: 5, round: 3, isFirstTurn: false,
      rngState: { s: SEED >>> 0 },
      players: [mk(1, '客人那一席', false), mk(2, '守夜那一席', true)],
      deck: [{ id: 'deck_1', name: '粮草', type: '粮草' }],
      discardPile: [], drawState: null,
    } as unknown as EngineState;
    return { host: createTableHost(state), seat: 2 };
  }

  it('进程算给那一席的私有清单里有那枚技能（所以"玩家看不见这个选项"不成立）', () => {
    const { host, seat } = askWindowTable();
    const { envs, send } = captureSends();
    let rows: NetSeatRow[] = [];
    // 房主占第一个可坐席＝第 1 席，客人占第 2 席＝正是挂着守夜、现在行棋的那一席。
    const auth = startProcessSeatAuthority({
      host,
      selfId: () => 'h1',
      peers: () => peersOf(['g2']),
      send,
      seatMapSink: r => { rows = r; },
    });
    auth.syncNow();
    expect(rows.map(r => r.peer)).toEqual(['h1', 'g2']);

    const moves = envs.find(e => e.t === 'moves');
    expect(moves, '第 2 席是行棋席⇒清单要指名发给他').toBeTruthy();
    if (moves!.t !== 'moves') throw new Error('不可能走到这里');
    expect(moves!.seat).toBe(seat);
    expect(moves!.to).toBe('g2');
    const labels = moves!.items.map(item => item.label);
    expect(labels.some(label => label.includes('守夜')), `清单里该有那一枚可发动的技能，实际发的是：${labels.join(' / ')}`).toBe(true);
    expect(labels).toContain('⏭️结束回合');
    // 这一格钉的是"清单没有把该问的技能藏起来"；真缺的那一格（进程不为人类席停一拍）
    // 见 `seatViewCompute.ts` 文件头 ㈣。
    expect(applyTableAction(host, seat, { type: 'END_TURN', playerId: seat } as unknown as GameAction)).toBe(true);
    expect(host.engineState.turn, '进程那一臂没有那扇窗：这一拍直接迈出去了（没搬的就是这一拍）').toBe(6);
  });

  it('答＝客人交回那一格技能自己的编号：走已有的 act/actno 两个信封，协议一字未动', () => {
    const { host, seat } = askWindowTable();
    const { envs, send } = captureSends();
    const auth = startProcessSeatAuthority({
      host,
      selfId: () => 'h1',
      peers: () => peersOf(['g2']),
      send,
      seatMapSink: () => {},
    });
    auth.syncNow();

    // 正面凭证：这一格确实该问（候选判据＝与浏览器那扇窗同一份），否则下面"答完就空"扫的是空集。
    expect(listTurnEndSkillCandidates(host.engineState, seat).map(c => c.definition.id).length, '这一席此刻根本没有可发动的回合结束技').toBeGreaterThan(0);

    const moves = envs.find(e => e.t === 'moves');
    if (moves!.t !== 'moves') throw new Error('第 2 席是行棋席，清单必须发出去');
    const skillKey = moves!.items.find(item => item.label.includes('守夜'))?.key;
    expect(skillKey, `清单里没有那一格技能（发的是：${moves!.items.map(i => i.label).join(' / ')}）`).toBeTruthy();
    expect(NET_PROTOCOL_VERSION, '答这一格不需要新信封⇒协议版本不许动').toBe(1);

    // 编号↔技能号：按房主当下的局面重算一遍那一批（与发出去那份同序），拿到这一格动的是哪枚技能。
    const actions = legalTableActions(host, seat);
    const localKeys = buildSeatMoves(host.engineState, actions).map(m => m.key);
    const usedIndex = localKeys.indexOf(skillKey!);
    expect(usedIndex, '发出去的编号在现算的清单里查不到＝两份清单又分家了').toBeGreaterThanOrEqual(0);
    const usedSkillId = String((actions[usedIndex]!.payload as { skillId?: string } | undefined)?.skillId ?? '');
    expect(usedSkillId, '这一步不是一枚技能，这一格就没答到点上').toBeTruthy();

    const actsBefore = envs.filter(e => e.t === 'actno').length;
    const readingBefore = readingOf(host.engineState);
    auth.handleAction({ peer: 'g2', seat, key: skillKey! });

    expect(envs.filter(e => e.t === 'actno').length, '客人答的是房主自己发出去的编号，不该被退回').toBe(actsBefore);
    expect(readingOf(host.engineState), '答完必须真的在进程那本账上走了一步').not.toBe(readingBefore);
    expect(
      listTurnEndSkillCandidates(host.engineState, seat).map(c => c.definition.id),
      `发动完了＝「${usedSkillId}」这一格的额度已用掉，同一枚不能再答第二次`,
    ).not.toContain(usedSkillId);
    // 答完之后清单按新局面重发过（旧编号作废这件事要马上让那一席看见）。
    expect(envs.filter(e => e.t === 'moves').length).toBeGreaterThan(1);
  });
});
