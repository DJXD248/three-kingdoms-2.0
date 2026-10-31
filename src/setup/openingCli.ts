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
 *
 * ⚠️ 名册**怎么**交上来还没做（那是第二片＝交料，含"要么整份收下、要么明说没收下"那道原子闸）。
 * 这里 `--roster-file` 只是把"料从外面进来"这件事摆成命令行上看得见的一个口子：
 * 文件形态＝`{ "pool": General[], "disabledIds": string[] }`（也可以是 `[{...General}]` 整份名单）；
 * 不给这个参数时退回**仓库账本**当名册，那只是一块占位板，不代表已经交过料。
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
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    seed: null,
    players: 4,
    aiSeats: new Set<number>(),
    tier: 'balanced',
    roomName: '进程开局',
    rosterFile: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
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

/** 交料的最小形态：读一份外部文件，读不懂就整份退回、绝不半收。 */
function rosterFrom(file: string): OpeningRoster {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as { pool?: unknown }).pool;
  if (!Array.isArray(list)) throw new Error('名册文件读不懂：要的是 [{...将}] 或 {"pool":[{...将}],"disabledIds":[...]}');
  const pool = list as General[];
  const disabledIds = Array.isArray(raw)
    ? []
    : ((raw as { disabledIds?: unknown }).disabledIds ?? []) as string[];
  return { pool, disabledIds: new Set(disabledIds) };
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
    console.log('用法：npm run opening-compute -- --seed <整数> [--players 4] [--ai-seats 2,3,4] [--tier balanced] [--roster-file 名册.json]');
    console.log('（种子必须显式给：浏览器那侧今天的开局游标来自页面加载时的随机数，不随代码走、也不可复现）');
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(args.players) || args.players < 1) {
    console.log('--players 要是一个正整数。');
    process.exitCode = 1;
    return;
  }
  const roster: OpeningRoster = args.rosterFile
    ? rosterFrom(args.rosterFile)
    : { pool: allGenerals, disabledIds: new Set<string>() };

  const request: OpeningRequest = {
    seed: args.seed,
    playerCount: args.players,
    seatModes: seatModes(args),
    roomName: args.roomName,
  };

  console.log(`名册来源：${args.rosterFile ?? '仓库账本（占位板＝这一片还没做交料）'}｜将 ${String(roster.pool.length)} 张｜禁用 ${String(roster.disabledIds.size)} 张`);
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
}

main();
