/**
 * `npm run ai-battle` entry point.
 *
 * Bundled to plain CJS by esbuild (platform=node), so Node globals are
 * declared locally instead of pulling @types/node into the app tsconfig.
 * The heavy lifting lives in the fs-free battleRunner; this file only parses
 * argv, prints a summary, and dumps reproducible failure bundles.
 *
 * Usage:
 *   npm run ai-battle                                  # 10 games, seed 1
 *   npm run ai-battle -- --games 500 --seed 7          # batch soak
 *   npm run ai-battle -- --players 3 --pool 6 --skill 0.5
 *   npm run ai-battle -- --skill 0 --skill-stats --games 500   # 真实池内容审计
 *   npm run ai-battle -- --replay ai-battle-failures/match-7.json
 */
import { runMatch, runBatch, type RecordedAction, type MatchResult } from './battleRunner';
import { formatFactionStats, formatSkillTriggerStats, configuredSkillRows } from './battleReport';
import type { MatchConfig } from './matchSetup';

declare const process: {
  argv: string[];
  exitCode: number;
  cwd(): string;
};
declare const require: (id: string) => any;
declare const console: { log(...args: unknown[]): void };

interface CliArgs {
  games: number;
  seed: number;
  players: number;
  pool: number;
  deck: number;
  skill: number;
  maxSteps: number;
  replay: string | null;
  out: string | null;
  skillStats: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    games: 10,
    seed: 1,
    players: 2,
    pool: 8,
    deck: 60,
    skill: 0.35,
    maxSteps: 3000,
    replay: null,
    out: null,
    skillStats: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'skill-stats') {
      args.skillStats = true;
      continue;
    }
    if (name === 'replay') {
      args.replay = String(value);
      i += 1;
      continue;
    }
    if (value === undefined) continue;
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    if (name === 'games') args.games = Math.max(1, Math.floor(num));
    if (name === 'seed') args.seed = Math.floor(num);
    if (name === 'players') args.players = Math.max(2, Math.min(4, Math.floor(num)));
    if (name === 'pool') args.pool = Math.max(1, Math.floor(num));
    if (name === 'deck') args.deck = Math.max(10, Math.floor(num));
    if (name === 'skill') args.skill = Math.max(0, Math.min(1, num));
    if (name === 'max-steps') args.maxSteps = Math.max(10, Math.floor(num));
    if (name === 'out') {
      args.out = String(value);
      i += 1;
    }
  }
  return args;
}

function dumpFailure(result: MatchResult, dir: string): string {
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `match-${result.config.seed}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        kind: 'ai-battle-failure',
        config: result.config,
        status: result.status,
        winnerId: result.winnerId,
        steps: result.steps,
        finalPhase: result.finalPhase,
        violations: result.violations,
        actions: result.actions,
      },
      null,
      2,
    ),
  );
  return file;
}

function runReplayFile(file: string): number {
  const fs = require('fs');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config: MatchConfig = raw.config;
  const actions: RecordedAction[] = raw.actions ?? [];
  const originalSteps = Number(raw.steps ?? actions.length);

  const result = runMatch(config, { recorded: actions, maxSteps: actions.length + 5 });

  console.log(`[ai-battle] replay ${file}`);
  console.log(`  original: status=${raw.status} steps=${originalSteps} winner=${raw.winnerId ?? '-'}`);
  console.log(`  replay:   status=${result.status} steps=${result.steps} winner=${result.winnerId ?? '-'} phase=${result.finalPhase}`);
  const sameLength = result.steps === originalSteps;
  const sameWinner = result.winnerId === (raw.winnerId ?? null);
  if (result.violations.length > 0) {
    console.log(`  divergences/violations (first 5):`);
    for (const v of result.violations.slice(0, 5)) {
      console.log(`    step ${v.step}: [${v.code}] ${v.detail}`);
    }
    return 1;
  }
  console.log(`  reproducible: ${sameLength && sameWinner ? 'YES (exact same outcome)' : 'NO (same legality, different length/winner)'}`);
  return sameLength && sameWinner ? 0 : 1;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.replay) {
    process.exitCode = runReplayFile(args.replay);
    return;
  }

  const startedAt = Date.now();
  const summary = runBatch({
    games: args.games,
    seed: args.seed,
    maxSteps: args.maxSteps,
    trackSkillTriggers: args.skillStats,
    configOverrides: {
      playerCount: args.players,
      poolPerPlayer: args.pool,
      deckSize: args.deck,
      skillInjection: args.skill,
    },
  });

  console.log(
    `[ai-battle] ${summary.games} games · seed ${args.seed}..${args.seed + summary.games - 1} · ` +
      `${args.players}p · pool ${args.pool} · deck ${args.deck} · skill ${args.skill}`,
  );
  console.log(
    `  won=${summary.won}  exhausted=${summary.exhausted}  VIOLATIONS=${summary.violated}  ` +
      `avg=${summary.avgMs}ms  slowest=${summary.slowestMs}ms  wall=${Date.now() - startedAt}ms`,
  );
  console.log(`  winner distribution: ${JSON.stringify(summary.winnerCounts)}`);
  if (summary.factionStats.length > 0) {
    console.log('  势力平衡（胜率=胜席/出场席 · 死亡率=阵亡/登场 · 击杀率=击杀/攻击）:');
    for (const line of formatFactionStats(summary.factionStats)) console.log(line);
  }
  if (args.skillStats) {
    console.log('  逐技能触发频次（计数=带技能标记的效果事件，双效果技能分计两次）:');
    for (const line of formatSkillTriggerStats(summary.skillTriggerCounts ?? {}, configuredSkillRows())) {
      console.log(line);
    }
  }

  if (summary.violations.length > 0) {
    console.log(`  first violations (max 20):`);
    for (const v of summary.violations.slice(0, 20)) {
      console.log(`    seed ${v.seed} step ${v.step}: [${v.code}] ${v.detail}`);
    }
    const dir = 'ai-battle-failures';
    for (const failed of summary.failedMatches.slice(0, 20)) {
      const file = dumpFailure(failed, dir);
      console.log(`  failure bundle: ${file}`);
    }
  }

  if (args.out) {
    const fs = require('fs');
    const payload = {
      ...summary,
      failedMatches: summary.failedMatches.map(m => ({
        seed: m.config.seed,
        status: m.status,
        winnerId: m.winnerId,
        steps: m.steps,
        violations: m.violations,
      })),
    };
    fs.writeFileSync(args.out, JSON.stringify(payload, null, 2));
    console.log(`  summary written: ${args.out}`);
  }

  process.exitCode = summary.violated > 0 ? 1 : 0;
}

main();
