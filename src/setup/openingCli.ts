/**
 * `npm run opening-compute` entry point — 乙 线第一片的**进程面**。
 *
 * 为什么要单独一个入口：第 0 步那条判据（ARCH_MAP 第 11 条 ㈢）说"Node 那侧读不到本机那六格
 * 存档"，而这一片要证的是**反过来那半句**＝开局那几步在纯 Node 里跑得动、且读数与浏览器一致。
 * esbuild 打成 `--platform=node` 的 CJS（跟 `ai-battle` 同一条路），所以 Node 的全局在这里
 * 局部声明，不往 app 的 tsconfig 里塞 `@types/node`。
 *
 * Usage:
 *   npm run opening-compute -- --seed 12345 --players 4
 *   npm run opening-compute -- --seed 1 --players 4 --ai-seats 2,3,4
 *   npm run opening-compute -- --seed 1 --players 3 --roster-file roster.json
 *   npm run opening-compute -- --seed 7 --players 2 --ai-seats 1,2 --play
 *   npm run opening-compute -- --seed 7 --players 4 --ai-seats 2,3,4 --play --views
 *
 * 名册交料（乙 线第二片）走 `--roster-file`：文件形态只认一种＝
 * `{ "format": 1, "pool": [ ...将的效力面... ], "disabledIds": [ ...被关掉的编号... ] }`，
 * 由 `rosterHandover.acceptRosterSubmissionText` 那道**原子闸**收——要么整份收下、
 * 要么明说没收下并逐条点名；没收下时**不开局**（绝不留半份名册继续算牌）。
 * ⚠️ 今天唯一真走得通的交料路＝这个文件口子；**跨机器那一路还没接**——握手第四格
 * `content`（两边那份效力名单不一样就别开这一局）已由第三片㈁ 落进生产，剩下没接的是
 * "客人那一份怎么送到房主手里"那根线（逐席私有视图由进程算＝第四片已落地，见下面 `--views`）。
 * 不给 `--roster-file` 时退回**仓库账本**，那是一块占位板，不代表已经交过料。
 *
 * `--play`＝第三片㈂：开局那五步之后，这一局继续在**浏览器外面**打下去。它不是一套新规则——
 * 每一步都过 `store/engineSteps.ts` 那批函数（玩家浏览器里 `gameStore` 那 14 个入口调的就是它们），
 * 差别只在该哪一席动手怎么解（进程按引擎真值，见 `setup/tableCompute.ts` 文件头）。
 *
 * `--views`＝第四片㈃：`--play` 跑完之后，进程**按每一席各算一份**要发给他的局面。遮蔽那把尺
 * 不在这里重抄——就叫 `network/snapshotView.buildBroadcastView`（房主浏览器里发快照时调的同一个函数），
 * 这一句只把算出来的字节数、以及"自己那两格亮出几张／别人的位置剩几个"报回命令行。
 */
import { allGenerals, type General } from '../data/generals';
import { readFileSync } from 'node:fs';
import {
  OPENING_DRAFT_TOTAL,
  describeOpeningSeat,
  openRoom,
  rollOpeningDice,
  assignOpeningFactions,
  dealOpeningSeat,
  settleOpeningAiSeats,
  confirmOpeningSeat,
  type OpeningRequest,
  type OpeningRoster,
  type OpeningState,
} from './openingCompute';
import {
  ROSTER_SUBMISSION_FORMAT,
  acceptRosterSubmissionText,
  rosterContentFingerprint,
  type RosterReceipt,
} from './rosterHandover';
import {
  createTableHost,
  openingToEngineState,
  playTable,
  type TableHost,
} from './tableCompute';
import { processSeatView } from './seatViewCompute';
import { isHiddenEntry } from '../network/snapshotView';
import { beginInitialDraw } from '../store/engineSteps';
import { GameEngine } from '../core/GameEngine';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { createStrategyPolicy, parseTier } from '../ai/policies/strategyPolicy';
import type { GameAction } from '../action/ActionTypes';
import type { AiSeatMode, AiSeatTier } from './runtimeSetup';

declare const process: { argv: string[]; exitCode: number };
declare const console: { log(...args: unknown[]): void };

interface CliArgs {
  seed: number | null;
  players: number;
  aiSeats: Set<number>;
  tier: AiSeatTier;
  roomName: string;
  rosterFile: string | null;
  /** ㈂：开局账收口之后，这一局在进程里继续打下去（`--play`）。 */
  play: boolean;
  /** ㈃（第四片）：这一局跑完之后，由进程把逐席私有视图各算一份、报出字节数（`--views`）。 */
  views: boolean;
  maxSteps: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    seed: null,
    players: 4,
    aiSeats: new Set<number>(),
    tier: 'balanced',
    roomName: '进程开局',
    rosterFile: null,
    play: false,
    views: false,
    maxSteps: 3000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--play') { args.play = true; continue; }
    if (flag === '--views') { args.views = true; continue; }
    if (flag === '--max-steps' && value !== undefined) { args.maxSteps = Math.max(1, Number(value) || 1); i += 1; continue; }
    if (flag === '--seed' && value !== undefined) { args.seed = Number(value); i += 1; continue; }
    if (flag === '--players' && value !== undefined) { args.players = Number(value); i += 1; continue; }
    if (flag === '--ai-seats' && value !== undefined) {
      args.aiSeats = new Set(value.split(',').map(part => Number(part.trim())).filter(n => Number.isFinite(n)));
      i += 1;
      continue;
    }
    if (flag === '--tier' && value !== undefined) { args.tier = value as AiSeatTier; i += 1; continue; }
    if (flag === '--room' && value !== undefined) { args.roomName = value; i += 1; continue; }
    if (flag === '--roster-file' && value !== undefined) { args.rosterFile = value; i += 1; continue; }
  }
  return args;
}

/** 交料的最小路：把文件原文交给那道原子闸，回执说了才算数。 */
function handOver(file: string): RosterReceipt {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      accepted: false,
      reason: `读不到这份名册文件（${detail}），一张也没收。`,
      problems: [],
      content: null,
      roster: null,
    };
  }
  return acceptRosterSubmissionText(text);
}

function seatModes(args: CliArgs): AiSeatMode[] {
  return Array.from({ length: args.players }, (_unused, index) => ({
    isAi: args.aiSeats.has(index + 1),
    tier: args.tier,
  }));
}

function ledgerLine(state: OpeningState): string {
  return `游标 ${String(state.seed)} → ${String(state.rng)}｜阶段 ${state.stage}｜牌堆 ${String(state.deck.length)} 张｜桌上已发 ${String(state.distributed.length)} 颗`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.seed === null || !Number.isFinite(args.seed)) {
    console.log('用法：npm run opening-compute -- --seed <整数> [--players 4] [--ai-seats 2,3,4] [--tier balanced] [--roster-file 名册.json] [--play] [--views]');
    console.log('（种子必须显式给：浏览器那侧今天的开局游标来自页面加载时的随机数，不随代码走、也不可复现）');
    console.log(`（名册文件要的是 {"format":${String(ROSTER_SUBMISSION_FORMAT)},"pool":[...],"disabledIds":[...]}＝交上来的那份"效力名册"；不给就用仓库账本那块占位板）`);
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(args.players) || args.players < 1) {
    console.log('--players 要是一个正整数。');
    process.exitCode = 1;
    return;
  }
  const useLedger = args.rosterFile === null;
  const ledgerPool = allGenerals as General[];
  const receipt: RosterReceipt = useLedger
    ? {
        accepted: true,
        roster: { pool: ledgerPool, disabledIds: new Set<string>() },
        // 占位板也算一枚真指纹：这样"交上来的那份"与"这台机器自带的账本"能不能对上，
        // 命令行上当场可读（对不上＝两边账本不是同一份，正是握手那一格要说的那句话）。
        content: rosterContentFingerprint(ledgerPool, []),
        poolCount: ledgerPool.length,
        disabledCount: 0,
        notes: ['这一趟用的是程序自带的账本当名册＝占位板，不代表谁交过料（真交料走 --roster-file）。'],
      }
    : handOver(args.rosterFile as string);

  if (!receipt.accepted) {
    console.log(receipt.reason);
    receipt.problems.forEach(problem => console.log(`   · ${problem}`));
    console.log('既然没收下名册，这一局就不开——不留半份名册继续算牌（乙 线第 12 条那句原子闸）。');
    process.exitCode = 1;
    return;
  }

  const roster: OpeningRoster = receipt.roster;
  const request: OpeningRequest = {
    seed: args.seed,
    playerCount: args.players,
    seatModes: seatModes(args),
    roomName: args.roomName,
  };

  console.log(`名册来源：${useLedger ? '仓库账本（占位板＝没交料）' : `交上来的那一份（${args.rosterFile}）`}｜将 ${String(receipt.poolCount)} 张｜关掉 ${String(receipt.disabledCount)} 张｜按效力的指纹 ${receipt.content}`);
  receipt.notes.forEach(note => console.log(`   说明：${note}`));
  const lobby = openRoom(request);
  console.log(`① 开房（发头像＋洗牌堆）→ ${ledgerLine(lobby)}`);
  const rolled = rollOpeningDice(lobby);
  console.log(`② 掷骰定座次 → ${ledgerLine(rolled)}`);
  const factored = assignOpeningFactions(rolled);
  console.log(`③ 分势力 → ${ledgerLine(factored)}`);
  let state = settleOpeningAiSeats(dealOpeningSeat(factored, roster), roster);
  console.log(`④ 逐席发料（AI 席自动凑满）→ ${ledgerLine(state)}`);
  state.seats.forEach(seat => console.log(`   ${describeOpeningSeat(seat)}`));

  // 人类席位还空着：这里按座位规则演示一次点选（本势力最多留一颗给群），
  // 好让"进程算、外部动手"这条路在命令行上也是走得通的（真界面的回执在后面的片子）。
  while (state.stage === 'draft') {
    const seat = state.seats[state.draftSeatIndex];
    if (!seat) break;
    const mainIds = seat.main.slice(0, OPENING_DRAFT_TOTAL - 1).map(general => general.id);
    const qunIds = seat.qun.map(general => general.id).slice(0, OPENING_DRAFT_TOTAL - mainIds.length);
    const ids = [...mainIds, ...qunIds];
    const verdict = confirmOpeningSeat(state, state.draftSeatIndex, ids, roster);
    if (verdict.rejected !== null) {
      console.log(`   第 ${String(state.draftSeatIndex + 1)} 席那份点选被退回：${verdict.rejected}`);
      break;
    }
    state = verdict.state;
  }
  console.log(`⑤ 开局账收口 → ${ledgerLine(state)}`);

  // ㈂（乙 线第三片）＝开局之后那一整段"改引擎的账"也搬到进程里跑。
  // 判据不是第二套：这一句之后每一步都过 `engineSteps` 那批函数（与玩家浏览器里
  // `gameStore` 那 14 个入口调的是同一批），只是"该哪一席动手"按引擎真值解。
  if (!args.play) {
    console.log('（没给 --play＝只算开局那几步。加 --play 让这一局在进程里继续打到收口。`--views` 跟在 --play 后面，视图是在跑起来的那份账上算的。）');
    return;
  }
  const played = openingToEngineState(state);
  const host = createTableHost(played);
  const firstSeat = played.players[0];
  if (!firstSeat) {
    console.log('⑥ 一席也没有——这一局不打。');
    process.exitCode = 1;
    return;
  }
  const begin = beginInitialDraw(host, firstSeat.id);
  console.log(`⑥ 进程里挂上开局抽牌 → ${begin.ok ? '挂上了' : '没挂上'}｜待发 ${String(host.engineState.drawState?.totalCards ?? 0)} 张｜游标 ${String(host.engineState.rngState?.s)}`);
  const policy = createStrategyPolicy(parseTier(args.tier) ?? 'balanced');
  const pick = (arm: TableHost, playerId: number): GameAction | null => {
    // 只读探针：拿"这一席能走哪些步"给策略挑，绝不在探针引擎上推进对局。
    const probe = new GameEngine(arm.engineState, { recordHistory: false });
    syncPlayerSkills(probe, arm.engineState);
    return policy(probe, playerId);
  };
  const result = playTable(host, { maxSteps: args.maxSteps, pick });
  console.log(`⑦ 进程里这一局跑到 → 阶段 ${result.phase}｜步数 ${String(result.steps)}｜回合 ${String(host.engineState.round)}｜胜者 ${result.winnerId === null ? '（没打出唯一活口）' : String(result.winnerId)}`);
  host.engineState.players.forEach(player => {
    console.log(`   ${String(player.id)}·${player.name}｜势力 ${player.faction ?? '-'}｜营地 ${String(player.baseHp ?? 0)}/${String(player.baseMaxHp ?? 0)}｜手牌 ${String((player.hand ?? []).length)} 张｜场上 ${String((player.fieldGenerals ?? []).length)} 颗｜池 ${String((player.generalPool ?? []).length)} 张｜${player.isAlive === false ? '已淘汰' : '在场'}`);
  });
  console.log(`   牌堆剩 ${String(host.engineState.deck.length)} 张｜弃堆 ${String(host.engineState.discardPile.length)} 张｜${host.engineState.phase === 'gameOver' ? '这一局在浏览器外面跑到了收口' : `跑满 ${String(args.maxSteps)} 步上限，还没收口`}`);

  // ㈃（乙 线第四片）＝**发出去的那一份**也由进程算。每一席各拿他自己那一份：
  // 自己手里与征召池里的牌照发内容，别人那两格只剩张数（遮蔽那把尺住在 `network/snapshotView`，
  // 这一句只是把它算出来的字节报回命令行，不在这里重抄判据）。
  if (!args.views) {
    console.log('（没给 --views＝不发视图。加 --views 让进程把逐席私有视图各算一份并报出字节数。）');
    return;
  }
  console.log('⑧ 进程逐席发私有视图（遮蔽那把尺＝与房主浏览器里发快照时调的同一个函数）');
  for (const player of host.engineState.players) {
    const bytes = JSON.stringify(processSeatView(host, player.id));
    const view = JSON.parse(bytes) as { players: { id: number; hand?: unknown[]; generalPool?: unknown[] }[] };
    const list = (value: unknown[] | undefined) => (Array.isArray(value) ? value : []);
    const revealed = (value: unknown[] | undefined) => list(value).filter(item => !isHiddenEntry(item)).length;
    const masked = (value: unknown[] | undefined) => list(value).filter(item => isHiddenEntry(item)).length;
    const mine = view.players.find(row => row.id === player.id);
    const maskedElsewhere = view.players
      .filter(row => row.id !== player.id)
      .reduce((sum, row) => sum + masked(row.hand) + masked(row.generalPool), 0);
    console.log(`   第 ${String(player.id)} 席 ${player.name}｜这一份 ${String(bytes.length)} 字节｜自己那两格按牌面发＝手牌 ${String(revealed(mine?.hand))} 张、征召池 ${String(revealed(mine?.generalPool))} 员｜别人那两格按位置计数发＝${String(maskedElsewhere)} 个位置`);
  }
  const spectator = JSON.stringify(processSeatView(host, null));
  const spectatorView = JSON.parse(spectator) as { players: { hand?: unknown[]; generalPool?: unknown[] }[] };
  const maskedAll = spectatorView.players
    .reduce((sum, row) => sum + (Array.isArray(row.hand) ? row.hand.length : 0) + (Array.isArray(row.generalPool) ? row.generalPool.length : 0), 0);
  console.log(`   观战面（没绑席位那一格）｜${String(spectator.length)} 字节｜谁的这两格都按位置计数发＝${String(maskedAll)} 个位置`);
}

main();
