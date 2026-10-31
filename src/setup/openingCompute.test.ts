/**
 * 乙 线第一片的证人（2026-10-31）。
 *
 * 这一片要成立的是两句，各有一枚证人，都不许拿注释交差：
 * ㈠ **进程面是干净的**＝`openingCompute.ts` 不读本机存档、不 import store（名册与种子都由外面递进来）；
 * ㈡ **搬到进程外面，开局那几步一个字都不变**＝拿真 store 把 `createRoom → rollDice → assignFactions →
 *    distributeDraftGenerals` 走一遍，与进程那一侧从**同一枚种子、同一份效力面**走出来的读数逐字段对账，
 *    连最后那枚游标的值也要对上（对上了才叫"同一条路"，只对候选面叫"像同一条路"）。
 *
 * 另外三条是这条线后面几片的地板，先钉住：名册真的按入参取料（不是仓库账本自己冒出来）、
 * 分发即锁跨席成立（沉没的也算发过）、AI 席自动凑满而人类席停在待点选那一格。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGenerals, type General } from '../data/generals';
import { lockKeyOf } from '../domain/identity';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { useGameStore } from '../store/gameStore';
import { defaultSeatModes, type AiSeatMode } from './runtimeSetup';
import {
  OPENING_DRAFT_TOTAL,
  assignOpeningFactions,
  confirmOpeningSeat,
  dealOpeningSeat,
  openRoom,
  rollOpeningDice,
  runOpeningToDraft,
  settleOpeningAiSeats,
  type OpeningRequest,
  type OpeningRoster,
  type OpeningState,
} from './openingCompute';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = 20261031;

const ledgerRoster = (): OpeningRoster => ({ pool: allGenerals, disabledIds: new Set<string>() });

function request(overrides: Partial<OpeningRequest> = {}): OpeningRequest {
  return {
    seed: SEED,
    playerCount: 4,
    seatModes: defaultSeatModes(4),
    roomName: '进程开局',
    ...overrides,
  };
}

/** 走到"逐席发料、AI 席自动凑完"那一步，人类席停在待点选。 */
function openingAllHuman(playerCount = 4, roster = ledgerRoster()): OpeningState {
  return runOpeningToDraft(request({ playerCount, seatModes: defaultSeatModes(playerCount) }), roster);
}

const generalIds = (generals: readonly General[]): string[] => generals.map(general => general.id);

/**
 * 按座位规则点满一席（本势力 9 颗＋群 1 颗，还差就再补群/补本势力）。
 * 候选面本身供不出合法的 10 颗时返回 null——那时这一格该被挡，测试要看的正是"被挡且给一句人话"。
 */
function tenSeatIds(seat: OpeningState['seats'][number]): string[] | null {
  const ids = [...seat.main.slice(0, OPENING_DRAFT_TOTAL - 1).map(general => general.id)];
  const surface = [...seat.qun, ...seat.main.slice(OPENING_DRAFT_TOTAL - 1)];
  for (const general of surface) {
    if (ids.length >= OPENING_DRAFT_TOTAL) break;
    if (!ids.includes(general.id)) ids.push(general.id);
  }
  return ids.length === OPENING_DRAFT_TOTAL ? ids : null;
}

describe('乙 第一片 ㈠ 进程面是干净的（名册与种子都从外面递进来）', () => {
  const code = readFileSync(path.join(here, 'openingCompute.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('不读本机存档、不碰浏览器、不 import store', () => {
    for (const banned of ['localStorage', 'sessionStorage', 'document.', 'window.', 'gameStore', 'node:fs', 'readFileSync']) {
      expect(code, `进程面不该出现「${banned}」`).not.toContain(banned);
    }
  });

  it('开局那几步调的还是浏览器本来就在调的那几个函数，不是第二套判据', () => {
    expect(code).toContain('createLobbyPlayers');
    expect(code).toContain('rollAndSortPlayers');
    expect(code).toContain('assignFactions');
    expect(code).toContain('buildDraftCandidates');
    expect(code).toContain('pickAiDraftPicks');
    expect(code).toContain('createCardDeck');
    expect(code).toContain('draftQuotaBlockFor');
  });

  it('牌堆留在进程账上，没有偷偷上线，也没有给 EngineState 添新键', () => {
    const state = openRoom(request());
    expect(state.deck).toHaveLength(52);
    expect(state).not.toHaveProperty('engineState');
  });
});

describe('乙 第一片 ㈡ 与浏览器那条路逐字同读数', () => {
  const seatModes = defaultSeatModes(4);

  beforeEach(() => {
    vi.useFakeTimers();
    useGameStore.setState({
      developerMode: false,
      skillEdits: {},
      generalEdits: {},
      disabledGenerals: new Set<string>(),
      authoredGenerals: [],
      identityRegistry: [],
      lockedGeneralIds: new Set<string>(),
      playerCount: 4,
      seatModes,
      roomName: '进程开局',
      engineState: { ...useGameStore.getState().engineState, rngState: { s: SEED >>> 0 } },
    } as unknown as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('开房→掷骰→分势力→发料：座位面、牌堆、候选面、游标四个都对得上', () => {
    const store = useGameStore.getState();
    store.createRoom();
    useGameStore.getState().rollDice();
    useGameStore.getState().assignFactions();
    useGameStore.getState().distributeDraftGenerals();
    const after = useGameStore.getState();

    // 名册＝store 自己那一格的效力输出（甲的取料口径：交的是合并后的效力，不是存档字节）。
    const roster: OpeningRoster = {
      pool: after.poolGenerals(),
      disabledIds: after.effectiveDisabledGenerals(),
    };
    const lobby = openRoom({ seed: SEED, playerCount: 4, seatModes, roomName: '进程开局' });
    const rolled = rollOpeningDice(lobby);
    const factored = assignOpeningFactions(rolled);
    const dealt = settleOpeningAiSeats(dealOpeningSeat(factored, roster), roster);

    // ① 座位面：谁坐第几席、摇到几点、分到哪一营、头像那颗是谁。
    expect(after.players.map(player => [player.id, player.seatOrder, player.diceRoll, player.faction]))
      .toEqual(dealt.players.map(player => [player.id, player.seatOrder, player.diceRoll, player.faction]));
    expect(after.players.map(player => player.diceRoll)).toEqual(rolled.players.map(player => player.diceRoll));
    expect(after.players.map(player => player.avatarGeneral?.id ?? null))
      .toEqual(dealt.players.map(player => player.avatarGeneral?.id ?? null));

    // ② 牌堆：洗出来的 52 张一张一张对。
    expect(after.cardDeck.map(card => card.id)).toEqual(lobby.deck.map(card => card.id));

    // ③ 第一席的候选面：主面与群面逐个号对。
    expect(after.draftGenerals.map(general => general.id)).toEqual(dealt.seats[0].main.map(general => general.id));
    expect(after.draftQunGenerals.map(general => general.id)).toEqual(dealt.seats[0].qun.map(general => general.id));

    // ④ 游标：消费完之后两边落在同一个数上＝真的同一条串行路，不是"长得像"。
    expect(after.engineState?.rngState?.s).toBe(dealt.rng);
  });
});

describe('乙 第一片 ㈢ 名册真的按入参取料', () => {
  it('递进去的池子有多小，候选面就有多大；账本里那些册外的将一张也不会冒出来', () => {
    const wei = allGenerals.filter(general => general.faction === '魏').slice(0, 6);
    const qun = allGenerals.filter(general => general.faction === '群').slice(0, 2);
    const roster: OpeningRoster = { pool: [...wei, ...qun], disabledIds: new Set<string>() };
    const state = runOpeningToDraft(request({ seatModes: defaultSeatModes(1), playerCount: 1 }), roster);
    const seat = state.seats[0];
    const allowed = new Set(generalIds(roster.pool));
    expect(seat.main.length + seat.qun.length).toBeGreaterThan(0);
    for (const general of [...seat.main, ...seat.qun]) {
      expect(allowed.has(general.id), `${general.name} 不在递进来的池子里`).toBe(true);
    }
    // 池子只有 6＋2 张，主面自然凑不满 10 张——这是与浏览器同一条判据，不是本进程自己造的规则。
    expect(seat.main.length).toBeLessThanOrEqual(6);
  });

  it('名册里被关掉的那一颗发不出来：同一枚种子，关之前在这一席、关之后不在', () => {
    // 正面凭据先立住：这一颗**本来发得出来**，否则"没发出来"什么都不是（空跑蒙绿那一族）。
    const open = runOpeningToDraft(request({ playerCount: 1 }), ledgerRoster());
    const openSurface = [...open.seats[0].main, ...open.seats[0].qun].map(general => general.id);
    const mainTarget = open.seats[0].main[0];
    const qunTarget = open.seats[0].qun[0];
    expect(openSurface).toContain(mainTarget.id);
    if (qunTarget !== undefined) expect(openSurface).toContain(qunTarget.id);

    const disabledIds = new Set<string>(qunTarget === undefined ? [mainTarget.id] : [mainTarget.id, qunTarget.id]);
    const shut = runOpeningToDraft(
      request({ playerCount: 1 }),
      { pool: allGenerals, disabledIds },
    );
    const shutSurface = [...shut.seats[0].main, ...shut.seats[0].qun].map(general => general.id);
    expect(shutSurface).not.toContain(mainTarget.id);
    if (qunTarget !== undefined) expect(shutSurface).not.toContain(qunTarget.id);
    // 关掉不等于不发料：主面照样凑满 10 颗（账本大得很，一颗被关不该让这一席空着）。
    expect(shut.seats[0].main).toHaveLength(OPENING_DRAFT_TOTAL);
  });

  it('换一个种子就是另一局（种子不是摆设）', () => {
    const a = openingAllHuman();
    const b = runOpeningToDraft(request({ seed: SEED + 1 }), ledgerRoster());
    expect(a.deck.map(card => card.id)).not.toEqual(b.deck.map(card => card.id));
    expect(a.seats[0].main.map(general => general.id)).not.toEqual(b.seats[0].main.map(general => general.id));
  });

  it('同一枚种子＋同一份料，跑两遍逐字同账', () => {
    const a = openingAllHuman();
    const b = openingAllHuman();
    const projection = (state: OpeningState) => JSON.stringify({
      rng: state.rng,
      deck: state.deck.map(card => card.id),
      seats: state.seats.map(seat => ({
        faction: seat.faction,
        main: generalIds(seat.main),
        qun: generalIds(seat.qun),
        picks: generalIds(seat.picks),
        settled: seat.settled,
      })),
    });
    expect(projection(a)).toBe(projection(b));
  });
});

describe('乙 第一片 ㈣ 分发即锁与逐席点选', () => {
  it('跨席的锁键与号都不重复：发过没勾的那一颗（沉没）也不再发给后面那席', () => {
    const roster = ledgerRoster();
    let state = openingAllHuman(4, roster);
    const keys = new Set<string>();
    const idsOnTable = new Set<string>();
    const surfaces: General[][] = [];
    for (let index = 0; index < 4; index += 1) {
      expect(state.draftSeatIndex).toBe(index);
      const seat = state.seats[index];
      const surface = [...seat.main, ...seat.qun];
      surfaces.push(surface);
      for (const general of surface) {
        expect(idsOnTable.has(general.id), `${general.name} 被发到两席`).toBe(false);
        idsOnTable.add(general.id);
        const key = lockKeyOf(general);
        if (key === null) continue;
        expect(keys.has(key), `${general.name}·${general.faction} 同锁键被发到两席`).toBe(false);
        keys.add(key);
      }
      const ids = tenSeatIds(seat);
      expect(ids, `第 ${String(index + 1)} 席的候选面供不出合法的 10 颗`).not.toBeNull();
      const verdict = confirmOpeningSeat(state, index, ids ?? [], roster);
      expect(verdict.rejected).toBeNull();
      state = verdict.state;
    }
    expect(state.stage).toBe('ready');
    // 桌上已发的总数＝各席候选面之和＝勾走的加沉没的都在账上（挡住"只按勾走的算锁"那种写法）。
    const dealtTotal = surfaces.reduce((sum, surface) => sum + surface.length, 0);
    expect(state.distributed).toHaveLength(dealtTotal);
    // 每一席确实有沉没的颗（不然这一账本只是走过场）。
    const sunkCount = dealtTotal - state.seats.reduce((sum, seat) => sum + seat.picks.length, 0);
    expect(sunkCount).toBeGreaterThan(0);
  });

  it('AI 席自动凑满 10 名且群牌不超过 3 名，人类席停在待点选那一格', () => {
    const modes: AiSeatMode[] = [
      { isAi: true, tier: 'balanced' },
      { isAi: false, tier: 'balanced' },
      { isAi: true, tier: 'aggressive' },
      { isAi: true, tier: 'conservative' },
    ];
    const state = runOpeningToDraft(request({ seatModes: modes }), ledgerRoster());
    // 掷骰会重排座次，所以"哪几席是 AI"要看掷骰之后的那一排：落定的必须正好是排在第一个
    // 人类席之前的那一串 AI 席——多一席少一席都算这条判据没过（不许按创建次序想当然）。
    const firstHuman = state.seats.findIndex(seat => !seat.isAi);
    expect(firstHuman).toBeGreaterThan(-1);
    expect(state.stage).toBe('draft');
    expect(state.draftSeatIndex).toBe(firstHuman);
    expect(state.seats[firstHuman].settled).toBe(false);
    state.seats.forEach((seat, index) => {
      if (index >= firstHuman) {
        expect(seat.settled).toBe(false);
        return;
      }
      expect(seat.isAi).toBe(true);
      expect(seat.settled).toBe(true);
      expect(seat.picks).toHaveLength(OPENING_DRAFT_TOTAL);
      const qunIds = new Set(seat.qun.map(general => general.id));
      const qunCount = seat.picks.filter(general => qunIds.has(general.id)).length;
      // 座位规则那一句是"群牌最多 3 名"，AI 那一侧今天取的是它的上限。
      expect(qunCount).toBe(Math.min(3, seat.qun.length));
      expect(qunCount).toBeLessThanOrEqual(3);
    });
  });

  it('全桌都是 AI 时开局一次跑完，直接落到 ready', () => {
    const modes: AiSeatMode[] = defaultSeatModes(4).map(mode => ({ ...mode, isAi: true }));
    const state = runOpeningToDraft(request({ seatModes: modes }), ledgerRoster());
    expect(state.stage).toBe('ready');
    expect(state.seats.every(seat => seat.settled && seat.picks.length === OPENING_DRAFT_TOTAL)).toBe(true);
    expect(state.players.every(player => player.generalPool.length === OPENING_DRAFT_TOTAL)).toBe(true);
  });

  it('一桌只有人类时，进程只发料、绝不替人点', () => {
    const state = runOpeningToDraft(request({ playerCount: 1, seatModes: defaultSeatModes(1) }), ledgerRoster());
    expect(state.stage).toBe('draft');
    expect(state.draftSeatIndex).toBe(0);
    expect(state.seats[0].settled).toBe(false);
    expect(state.seats[0].picks).toHaveLength(0);
    expect(state.players[0].generalPool).toHaveLength(0);
  });

  it('人类席点满 10 名（本势力 9＋群 1）就落定，每颗都是独立实体卡', () => {
    const roster = ledgerRoster();
    const state = openingAllHuman(4, roster);
    const seat = state.seats[0];
    const qunIds = new Set(seat.qun.map(general => general.id));
    const ids = tenSeatIds(seat);
    expect(ids).not.toBeNull();
    const verdict = confirmOpeningSeat(state, 0, ids ?? [], roster);
    expect(verdict.rejected).toBeNull();
    const settledSeat = verdict.state.seats[0];
    expect(settledSeat.settled).toBe(true);
    expect(settledSeat.picks).toHaveLength(OPENING_DRAFT_TOTAL);
    // 群牌真的进来了（不是"9＋1 颗本势力"这种热座点不出来的形状）。
    expect(settledSeat.picks.filter(general => qunIds.has(general.id)).length).toBeGreaterThan(0);
    // 定义 id 不能当运行时身份：同名牌各自一张，运行时号互不相同。
    const instances = settledSeat.picks.map(general => getRuntimeCardId(general));
    expect(new Set(instances).size).toBe(OPENING_DRAFT_TOTAL);
    expect(settledSeat.picks.every(general => (general as { instanceId?: string }).instanceId !== undefined)).toBe(true);
    // 落定之后轮到下一席，且下一席已经拿到自己的候选面。
    expect(verdict.state.draftSeatIndex).toBe(1);
    expect(verdict.state.seats[1].main.length).toBeGreaterThan(0);
  });

  it('五种不该认的点法各有一句人话，绝不静默', () => {
    const roster = ledgerRoster();
    const state = openingAllHuman(4, roster);
    const seat = state.seats[0];
    const valid = seat.main[0].id;
    const tenMain = seat.main.slice(0, OPENING_DRAFT_TOTAL).map(general => general.id);

    expect(confirmOpeningSeat(state, 1, [valid], roster).rejected).toContain('不是当前那一席');
    expect(confirmOpeningSeat(state, 0, ['不在名单上的号'], roster).rejected).toContain('查不到');
    expect(confirmOpeningSeat(state, 0, [valid, valid], roster).rejected).toContain('已经勾过');
    // 全点本势力：热座点不出这个形状，进程这一侧同样得挡（同一把尺 draftQuota）。
    expect(confirmOpeningSeat(state, 0, tenMain, roster).rejected).toContain('群势力');
    // 点不满：确认这一档要凑满，绝不留"半份池子"落进席位。
    const half = [
      ...seat.main.slice(0, 4).map(general => general.id),
      ...seat.qun.slice(0, 1).map(general => general.id),
    ];
    expect(confirmOpeningSeat(state, 0, half, roster).rejected).toContain('凑满');
  });

  it('全桌点满才叫 ready，最后一席点完不再生料', () => {
    const roster = ledgerRoster();
    let state = openingAllHuman(2, roster);
    for (let index = 0; index < 2; index += 1) {
      const ids = tenSeatIds(state.seats[index]);
      expect(ids).not.toBeNull();
      const verdict = confirmOpeningSeat(state, index, ids ?? [], roster);
      expect(verdict.rejected).toBeNull();
      state = verdict.state;
    }
    expect(state.stage).toBe('ready');
    expect(state.players.every(player => player.generalPool.length === OPENING_DRAFT_TOTAL)).toBe(true);
    // ready 之后再叫发料，账不变（不是一句"没反应"，而是这一格确实不该再发）。
    const before = state.rng;
    expect(dealOpeningSeat(state, roster).rng).toBe(before);
  });
});
