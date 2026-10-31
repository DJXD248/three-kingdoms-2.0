/**
 * 乙 线第一片（2026-10-31）＝**把开局那几步搬进一个不算任何一位玩家的进程**。
 *
 * 契约落点＝`PROJECT_ARCH_MAP.md` §G 第 12 条：部署档位已裁＝**档二**（算牌那台机器不参与打牌），
 * 名册来源已裁＝**甲**（开房间那位玩家把名单交给算牌机器）。这一片只走第一条排期腿
 * 「算牌进程能跑开局四步」，两件事按裁定的字面写死：
 *
 * ㈠ **名册走入参**（＝甲）：这一份账自己**不读**本机存档、不 import store，也不假设仓库账本
 *    就是桌上那一份——`OpeningRoster.pool` 要的是**编辑合并之后的"效力"**（store 那侧对应
 *    `poolGenerals()` 的输出＋`effectiveDisabledGenerals()`），不是 localStorage 的原始字节；
 *    §H3 第③层会让同一份存档在两台上**不一样地生效**，所以按字节交料一定是假绿。
 * ㈡ **随机游标也走入参**：浏览器那条路的开局游标今天来自页面加载时的一个随机数
 *    （`store/gameStateAdapter.ts` 的 `seedRngState`：没有既有游标时取 `Date.now() ^ Math.random()`），
 *    它既不随代码走、也不可复现⇒进程这一侧必须由调用方**显式给一枚种子**，否则"同一局"根本无从谈起。
 *
 * 与浏览器 store 的关系＝**同一条路，不是一个第二判据**：下面每一步调的都是 store 开局那几步
 * 本来就在调的那几个函数（`runtimeSetup` 的 `createLobbyPlayers`／`rollAndSortPlayers`／
 * `assignFactions`／`buildDraftCandidates`／`pickAiDraftPicks`），**消费随机的次序也照 store 排**
 * （开房＝先把座位面洗一遍、再洗牌堆；掷骰；分势力；逐席发料）。所以同一枚种子＋同一份料
 * ⇒ 进程算出来的开局与浏览器算出来的开局应当**逐字同读数**，这条由
 * `openingCompute.test.ts` 拿真 store 走一遍来钉，不靠注释声称。
 *
 * 还没搬的（照实说，不许提前认领）：名册**怎么**交上来（那是第二片＝交料，含"要么整份收下、
 * 要么明说没收下"那道原子闸）、开局之后的引擎转移、逐席私有视图由进程发、界面与措辞。
 * 本片区 `EngineState` **零新键**，也不碰任何界面。
 */
import type { Faction, General } from '../data/generals';
import { createCardDeck, type GameCard } from '../data/cards';
import { rngNext, type RngState } from '../core/rng';
import { DRAFT_QUN_MAX, draftQuotaBlockFor } from '../domain/draftQuota';
import { cloneWithRuntimeInstance } from '../utils/runtimeIdentity';
import {
  assignFactions,
  buildDraftCandidates,
  createLobbyPlayers,
  pickAiDraftPicks,
  rollAndSortPlayers,
  type AiSeatMode,
  type AiSeatTier,
  type SetupPlayerSeed,
} from './runtimeSetup';

/**
 * 一席该勾几名。这个 10 今天长在三个调用方各传一次的地方（热座面板 `GeneralDraft.tsx`
 * 那颗钮、`netDraftList` 帧里的 `frame.total`、以及 `runtimeSetup.pickAiDraftPicks` 内部那句
 * "凑不满 10 颗就交回人类"）；本片刻意把它做成**显式入参的默认值**，收口那一片如果 store
 * 侧已经有了单一真值，就换成那一份，绝不在这文件里再抄一条规则出来。
 */
export const OPENING_DRAFT_TOTAL = 10;

/** 桌上那一份名册＝交料之后算牌机器手里拿着的东西。 */
export interface OpeningRoster {
  /** 编辑合并后的效力面（store 那侧＝`poolGenerals()` 的输出）。 */
  pool: readonly General[];
  /** 被关掉的将（store 那侧＝`effectiveDisabledGenerals()`）。 */
  disabledIds: ReadonlySet<string>;
}

export type OpeningStage = 'lobby' | 'dice' | 'factions' | 'draft' | 'ready';

/** 一席的开局面账：骰子、势力、这一席收到的两份候选面、以及落定的那 10 张实体卡。 */
export interface OpeningSeat {
  playerId: number;
  seatOrder: number;
  name: string;
  isAi: boolean;
  aiTier: AiSeatTier;
  faction: Faction | null;
  /** 本势力候选面（10 张；池子不够时可能更少——与浏览器同一条判据）。 */
  main: General[];
  /** 群候选面（最多 5 张）。 */
  qun: General[];
  /** 已落定的这一席＝运行时实体卡（与 store 的 `generalPool` 同一形态：每张一个 instanceId）。 */
  picks: General[];
  settled: boolean;
}

export interface OpeningState {
  /** 外部递进来的游标初值（＝这一局的种子）。 */
  seed: number;
  /** 单份串行游标的当前值；开局每一步消费它，次序与浏览器一致。 */
  rng: number;
  stage: OpeningStage;
  roomName: string;
  playerCount: number;
  draftTotal: number;
  /** 掷骰之后的座位面（数组次序就是 `seatOrder`，与 store 的 `players` 同一条）。 */
  players: SetupPlayerSeed[];
  /** 洗好的牌堆。**这一片只住在进程账上，没有搬进引擎、也不上线**＝它就是那件"玩家读不到"的东西本体。 */
  deck: GameCard[];
  seats: OpeningSeat[];
  /** 正待发料／待确认的那一席（＝store 的 `draftPlayerIndex`）。 */
  draftSeatIndex: number;
  /** 已经发到桌上的那几批（＝store 的 `draftDistributed`）：分发即锁的账本，沉没也算发过。 */
  distributed: General[];
}

export interface OpeningRequest {
  /** 种子必须显式给（见文件头㈡）。 */
  seed: number;
  playerCount: number;
  seatModes?: readonly AiSeatMode[];
  roomName?: string;
  /** 一席几名，默认 `OPENING_DRAFT_TOTAL`。 */
  draftTotal?: number;
}

export type OpeningVerdict = { state: OpeningState; rejected: string | null };

/** 席位面（掷骰前后都要按当次的 `players` 重建，`seatOrder` 与数组次序始终同一条）。 */
function seatsOf(players: readonly SetupPlayerSeed[]): OpeningSeat[] {
  return players.map((player, index) => ({
    playerId: player.id,
    seatOrder: index,
    name: player.name,
    isAi: player.isAi === true,
    aiTier: player.aiTier ?? 'balanced',
    faction: player.faction,
    main: [],
    qun: [],
    picks: [],
    settled: false,
  }));
}

/** 把一席的候选面/落定面写回席位面（不可变：返回新数组）。 */
function withSeat(
  seats: readonly OpeningSeat[],
  index: number,
  patch: Partial<OpeningSeat>,
): OpeningSeat[] {
  return seats.map((seat, i) => (i === index ? { ...seat, ...patch } : seat));
}

/**
 * 开房＝浏览器那条路 `createRoom` 的那两行：**先洗座位面（发头像），再洗牌堆**。
 * 这两步都从同一枚游标取数，次序不许换——换了就不是同一局（掷骰会落在不同的随机数位置上）。
 */
export function openRoom(request: OpeningRequest): OpeningState {
  const rng: RngState = { s: request.seed >>> 0 };
  const random = () => rngNext(rng);
  const seatModes = request.seatModes ?? [];
  const players = createLobbyPlayers(request.playerCount, seatModes, random);
  const deck = createCardDeck(random);
  return {
    seed: request.seed >>> 0,
    rng: rng.s >>> 0,
    stage: 'lobby',
    roomName: request.roomName ?? '',
    playerCount: request.playerCount,
    draftTotal: request.draftTotal ?? OPENING_DRAFT_TOTAL,
    players,
    deck,
    seats: seatsOf(players),
    draftSeatIndex: 0,
    distributed: [],
  };
}

/** 掷骰定座次（1～12 取大者先，重排 `seatOrder`）。 */
export function rollOpeningDice(state: OpeningState): OpeningState {
  const rng: RngState = { s: state.rng >>> 0 };
  const players = rollAndSortPlayers(state.players, () => rngNext(rng));
  return { ...state, rng: rng.s >>> 0, stage: 'dice', players, seats: seatsOf(players) };
}

/** 分势力（魏蜀吴晋四张签洗完按座位发）。 */
export function assignOpeningFactions(state: OpeningState): OpeningState {
  const rng: RngState = { s: state.rng >>> 0 };
  const players = assignFactions(state.players, () => rngNext(rng));
  const seats = seatsOf(players).map((seat, index) => ({ ...seat, faction: players[index].faction }));
  return { ...state, rng: rng.s >>> 0, stage: 'factions', players, seats };
}

/**
 * 给 `draftSeatIndex` 那一席发料（＝store 的 `distributeDraftGenerals` 与 `confirmDraft`
 * 里"下一席"那两处共用的同一行）。
 *
 * 身份锁的账本传的是**已经发到桌上的全部**（`distributed`），不是"上一席勾走的那几颗"
 * ⇒ 发过没勾也算沉没（分发即锁）。锁过滤排在每一次洗牌**前面**、自身不吃随机数，
 * 所以换名册只换候选面、不换游标消费次序这一条性质仍然成立。
 */
export function dealOpeningSeat(state: OpeningState, roster: OpeningRoster): OpeningState {
  if (state.stage !== 'factions' && state.stage !== 'draft') return state;
  const player = state.players[state.draftSeatIndex];
  if (!player?.faction) return state;
  const rng: RngState = { s: state.rng >>> 0 };
  const candidates = buildDraftCandidates(
    player.faction,
    roster.disabledIds,
    state.distributed,
    () => rngNext(rng),
    roster.pool,
  );
  const seats = withSeat(state.seats, state.draftSeatIndex, {
    main: candidates.main,
    qun: candidates.qun,
    faction: player.faction,
  });
  return {
    ...state,
    rng: rng.s >>> 0,
    stage: 'draft',
    seats,
    distributed: [...state.distributed, ...candidates.main, ...candidates.qun],
  };
}

/** 这一席的整份候选面（主＋群），确认那一步按它查号。 */
function surfaceOf(seat: OpeningSeat): General[] {
  return [...seat.main, ...seat.qun];
}

/**
 * 人类席位确认这一格（AI 席不走这里，走 `settleAiSeat`）。
 *
 * 判据一条都不自己发明：数量那一档叫的是热座与客人帧共用的那把尺
 * `domain/draftQuota.draftQuotaBlockFor`（按点选次序逐颗过，与热座面板点得动/点不动同一个函数），
 * 号不在本席候选面上的、重复的、不是当前那一席的，一律**给一句人话拒绝**——拒不得静默。
 */
export function confirmOpeningSeat(
  state: OpeningState,
  seatIndex: number,
  pickedIds: readonly string[],
  roster: OpeningRoster,
): OpeningVerdict {
  if (state.stage !== 'draft') {
    return { state, rejected: '现在还没有在征召，这一条不认。' };
  }
  if (seatIndex !== state.draftSeatIndex) {
    return { state, rejected: '动手的不是当前那一席（当前轮到第 ' + String(state.draftSeatIndex + 1) + ' 席）。' };
  }
  const seat = state.seats[seatIndex];
  if (!seat) return { state, rejected: '查不到这一席。' };
  const surface = surfaceOf(seat);
  const byId = new Map(surface.map(general => [general.id, general]));

  const picks: General[] = [];
  const qunIds = new Set(seat.qun.map(general => general.id));
  for (const id of pickedIds) {
    if (picks.some(picked => picked.id === id)) {
      return { state, rejected: '这一颗已经勾过了：' + id };
    }
    const general = byId.get(id);
    if (!general) {
      return { state, rejected: '这一颗在我的名单上查不到：' + id };
    }
    const isQun = qunIds.has(id);
    const block = draftQuotaBlockFor(
      {
        total: state.draftTotal,
        totalCount: picks.length,
        qunCount: picks.filter(picked => qunIds.has(picked.id)).length,
        mainCount: picks.filter(picked => !qunIds.has(picked.id)).length,
      },
      isQun,
    );
    if (block === 'qunFull') return { state, rejected: `群势力最多 ${String(DRAFT_QUN_MAX)} 名。` };
    if (block === 'totalFull') return { state, rejected: `这一席最多 ${String(state.draftTotal)} 名。` };
    if (block === 'mainNeedsQun') {
      return { state, rejected: `本势力最多 ${String(state.draftTotal - 1)} 名，得给群势力留一颗。` };
    }
    picks.push(general);
  }
  if (picks.length !== state.draftTotal) {
    return { state, rejected: `这一席要凑满 ${String(state.draftTotal)} 名（现在 ${String(picks.length)} 名）。` };
  }

  // 与 store 同一行：每颗候选定义落成一张**独立实体卡**（各自一个 instanceId），
  // 定义 id 永远不能当运行时身份。
  const draftedPool = picks.map(general => cloneWithRuntimeInstance(general) as General);
  const players = state.players.map((player, index) =>
    (index === seatIndex ? { ...player, generalPool: draftedPool } : player));
  const settledSeats = withSeat(state.seats, seatIndex, { picks: draftedPool, settled: true });
  const nextIndex = seatIndex + 1;
  if (nextIndex >= state.players.length) {
    return {
      state: { ...state, players, seats: settledSeats, stage: 'ready', draftSeatIndex: nextIndex },
      rejected: null,
    };
  }
  const advanced: OpeningState = { ...state, players, seats: settledSeats, draftSeatIndex: nextIndex };
  return { state: dealOpeningSeat(advanced, roster), rejected: null };
}

/** AI 席按座位规则自动凑满（最多 3 颗群牌）；凑不满就把这一格交回人类，与 store 同一条判据。 */
function settleAiSeat(state: OpeningState, roster: OpeningRoster): OpeningState {
  const seat = state.seats[state.draftSeatIndex];
  if (!seat?.isAi || seat.settled) return state;
  const picks = pickAiDraftPicks(seat.main, seat.qun);
  if (picks.length !== state.draftTotal) return state;
  const draftedPool = picks.map(general => cloneWithRuntimeInstance(general) as General);
  const players = state.players.map((player, index) =>
    (index === state.draftSeatIndex ? { ...player, generalPool: draftedPool } : player));
  const seats = withSeat(state.seats, state.draftSeatIndex, { picks: draftedPool, settled: true });
  const nextIndex = state.draftSeatIndex + 1;
  if (nextIndex >= state.players.length) {
    return { ...state, players, seats, stage: 'ready', draftSeatIndex: nextIndex };
  }
  return dealOpeningSeat({ ...state, players, seats, draftSeatIndex: nextIndex }, roster);
}

/** 连续把 AI 席凑完，停在第一个需要人类点选的那一席（或全桌落定）。 */
export function settleOpeningAiSeats(state: OpeningState, roster: OpeningRoster): OpeningState {
  let next = state;
  for (let guard = 0; guard < next.players.length + 1; guard += 1) {
    if (next.stage !== 'draft') return next;
    const seat = next.seats[next.draftSeatIndex];
    if (!seat?.isAi || seat.settled) return next;
    const advanced = settleAiSeat(next, roster);
    if (advanced === next) return next;
    next = advanced;
  }
  return next;
}

/**
 * 开局四步一次跑完（开房→掷骰→分势力→逐席发料，AI 席自动凑完），停在第一个人类席位上。
 * 这一句就是"算牌进程在浏览器外面把开局那几步跑出来"的那条腿。
 */
export function runOpeningToDraft(request: OpeningRequest, roster: OpeningRoster): OpeningState {
  const lobby = openRoom(request);
  const rolled = rollOpeningDice(lobby);
  const factored = assignOpeningFactions(rolled);
  const dealt = dealOpeningSeat(factored, roster);
  return settleOpeningAiSeats(dealt, roster);
}

/** 白话一行，给进程日志与证人用（界面不在这一片）。 */
export function describeOpeningSeat(seat: OpeningSeat): string {
  const dealt = seat.main.length + seat.qun.length;
  const status = seat.settled
    ? `已落定 ${String(seat.picks.length)} 名`
    : dealt === 0
      ? '还没发到料'
      : '待点选';
  // AI 席那几位的名字里已经带着档位（`createLobbyPlayers` 写的是「AI·均衡」），这里不再重复一遍。
  return `第 ${String(seat.seatOrder + 1)} 席 ${seat.name} ${seat.faction ?? '未分'}：候选 ${String(seat.main.length)}＋${String(seat.qun.length)}，${status}`;
}
