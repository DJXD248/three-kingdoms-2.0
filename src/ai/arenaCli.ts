/**
 * `npm run ai-arena` entry point — tier-vs-tier win-rate arena.
 *
 * Bundled to CJS by esbuild (platform=node) like battleCli; all game logic
 * stays in the shared runner. Exit code 1 when ANY game produced a
 * violation — the arena doubles as a strategy-path rules soak.
 *
 * Usage:
 *   npm run ai-arena                                        # round robin: 3 tiers + random, 100 games per pair
 *   npm run ai-arena -- --duel aggressive,balanced --games 200
 *   npm run ai-arena -- --ffa conservative,balanced,aggressive,random --games 100
 *   npm run ai-arena -- --games 50 --seed 1000 --out .ai-battle/arena.json
 */
import { runDuelSeries, runFreeForAll, runRoundRobin, formatArenaSummary, type ArenaSummary } from './arena';
import { policyByName } from './policies/strategyPolicy';

declare const process: { argv: string[]; exitCode: number };
declare const require: (id: string) => any;
declare const console: { log(...args: unknown[]): void };

interface CliArgs {
  mode: 'roundrobin' | 'duel' | 'ffa';
  keys: string[];
  games: number;
  seed: number;
  maxSteps: number;
  out: string | null;
}

const DEFAULT_KEYS = ['aggressive', 'balanced', 'conservative', 'random'];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { mode: 'roundrobin', keys: DEFAULT_KEYS, games: 100, seed: 1, maxSteps: 3000, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'duel' || name === 'ffa') {
      args.mode = name as CliArgs['mode'];
      if (value) {
        const keys = String(value).split(',').map(s => s.trim()).filter(Boolean);
        if (keys.every(k => policyByName(k) !== null)) args.keys = keys;
      }
      i += 1;
      continue;
    }
    if (value === undefined) continue;
    if (name === 'out') {
      args.out = String(value);
      i += 1;
      continue;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    if (name === 'games') args.games = Math.max(1, Math.min(2000, Math.floor(num)));
    if (name === 'seed') args.seed = Math.floor(num);
    if (name === 'max-steps') args.maxSteps = Math.max(50, Math.floor(num));
  }
  return args;
}

function summarizeViolationTotal(s: ArenaSummary): number {
  return s.violations_detail.length;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const flat: { title: string; summary: ArenaSummary }[] = [];

  if (args.mode === 'duel') {
    if (args.keys.length !== 2) {
      console.log('[ai-arena] --duel needs exactly two policy keys (e.g. --duel aggressive,balanced)');
      process.exitCode = 1;
      return;
    }
    flat.push({
      title: `${args.keys[0]} vs ${args.keys[1]}`,
      summary: runDuelSeries(args.keys[0], args.keys[1], {
        games: args.games,
        seed: args.seed,
        maxSteps: args.maxSteps,
      }),
    });
  } else if (args.mode === 'ffa') {
    flat.push({
      title: `混战 ${args.keys.slice(0, 4).join('/')}`,
      summary: runFreeForAll(args.keys.slice(0, 4), {
        games: args.games,
        seed: args.seed,
        maxSteps: args.maxSteps,
      }),
    });
  } else {
    for (const [title, summary] of Object.entries(runRoundRobin(args.keys, {
      games: args.games,
      seed: args.seed,
      maxSteps: args.maxSteps,
    }))) {
      flat.push({ title, summary });
    }
  }

  let violated = 0;
  for (const { title, summary } of flat) {
    console.log(formatArenaSummary(title, summary));
    violated += summary.violated;
  }
  const totalViol = flat.reduce((n, s) => n + summarizeViolationTotal(s.summary), 0);
  console.log(`\n[ai-arena] wall ${Date.now() - startedAt}ms · 违例局 ${violated} · 违例条目 ${totalViol}`);

  if (args.out) {
    const fs = require('fs');
    const results: Record<string, ArenaSummary> = {};
    for (const { title, summary } of flat) results[title] = summary;
    fs.writeFileSync(args.out, JSON.stringify({ args, results }, null, 2));
    console.log(`  summary written: ${args.out}`);
  }
  process.exitCode = violated > 0 ? 1 : 0;
}

main();
