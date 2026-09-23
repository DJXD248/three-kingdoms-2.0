/**
 * Pure-builder tests for the in-app battle reports (v2.2.5):
 * summary counting, ❌ annotation rules in the operation log,
 * replay-bundle / failure-file shapes, and the battle-window hash parser.
 * No DOM involved — the same builders the background window and the dock
 * feed their exports.
 */
import { describe, expect, it } from 'vitest';
import type { MatchResult, RecordedAction } from './battleRunner';
import { defaultMatchConfig } from './matchSetup';
import {
  buildFailureFiles,
  buildOperationLog,
  buildReplayBundle,
  formatActionLine,
  summarizeMatches,
} from './battleReport';
import { parseAiBattleHash } from './battleHash';

function match(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    config: defaultMatchConfig(101),
    status: 'won',
    winnerId: 0,
    steps: 2,
    durationMs: 50,
    actions: [
      { type: 'BEGIN_DRAW', playerId: 0, payload: { reason: 'initial', playerId: 0, totalCards: 5 } },
      { type: 'END_TURN', playerId: 0 },
    ],
    violations: [],
    finalPhase: 'gameOver',
    ...overrides,
  };
}

const rejected: RecordedAction = { type: 'DEPLOY_GENERAL', playerId: 1, payload: { slot: 0, consumeCards: [] } };

describe('battleReport', () => {
  it('summarizeMatches counts statuses, winners and violation entries', () => {
    const s = summarizeMatches([
      match({ durationMs: 100 }),
      match({ durationMs: 40, winnerId: 1 }),
      match({ status: 'stepsExhausted', winnerId: null, durationMs: 10 }),
      match({
        status: 'violation',
        winnerId: null,
        durationMs: 600,
        violations: [
          { code: 'CARD_VANISHED', step: 3, detail: 'x' },
          { code: 'BASE_HP_NEGATIVE', step: 4, detail: 'y' },
        ],
      }),
    ]);
    expect(s).toMatchObject({ games: 4, won: 2, exhausted: 1, violated: 1, violationTotal: 2, totalMs: 750, slowestMs: 600 });
    expect(s.avgMs).toBe(188);
    expect(s.winnerCounts).toEqual({ '0': 1, '1': 1 });
  });

  it('operation log marks violation steps, rejected steps, and past-the-end steps with cross', () => {
    const log = buildOperationLog([
      match({
        actions: [
          { type: 'END_TURN', playerId: 0 },
          rejected,
          { type: 'END_TURN', playerId: 1 },
        ],
        violations: [
          { code: 'ENUMERATED_REJECTED', step: 1, detail: 'ACTION_REJECTED' },
          { code: 'CARD_VANISHED', step: 2, detail: 'gone' },
          { code: 'MISSING_GAME_OVER', step: 9, detail: 'no gameOver' },
        ],
      }),
    ]);
    const lines = log.split('\n');
    expect(lines.some(l => l.startsWith('❌') && l.includes('ENUMERATED_REJECTED') && l.includes('DEPLOY_GENERAL'))).toBe(true);
    expect(lines.some(l => l.startsWith('❌') && l.includes('CARD_VANISHED'))).toBe(true);
    expect(lines.some(l => l.startsWith('❌') && l.includes('步 9（无对应动作行）'))).toBe(true);
    expect(log).not.toContain('✔ 全程未触发');
  });

  it('clean matches keep the log free of error marks and carry the ok line', () => {
    const log = buildOperationLog([match()]);
    expect(log).not.toContain('❌');
    expect(log).toContain('✔ 全程未触发任何不变量违例');
    expect(formatActionLine(5, { type: 'DRAW', playerId: 2, payload: { fromGeneralPool: 1, fromCardPool: 2 } })).toContain('抽牌 将1/牌2');
    expect(formatActionLine(6, rejected)).toContain('营地槽0');
  });

  it('replay bundle is CLI-shaped JSON; failure files only for error statuses', () => {
    const bundle = JSON.parse(buildReplayBundle([match({ actions: [rejected] })]));
    expect(bundle[0]).toMatchObject({ kind: 'ai-battle-record', status: 'won', steps: 2 });
    expect(bundle[0].actions[0].type).toBe('DEPLOY_GENERAL');

    const files = buildFailureFiles([
      match(),
      match({ status: 'stepsExhausted' }),
      match({ config: defaultMatchConfig(7), status: 'violation', violations: [{ code: 'X', step: 0, detail: '' }] }),
      match({ config: defaultMatchConfig(8), status: 'replay-diverged' }),
    ]);
    expect(files.map(f => f.name)).toEqual(['match-7.json', 'match-8.json']);
    expect(JSON.parse(files[0].content).kind).toBe('ai-battle-failure');
  });
});

describe('parseAiBattleHash', () => {
  it('accepts only #ai-battle? hashes and clamps params into range', () => {
    expect(parseAiBattleHash('#playing')).toBeNull();
    expect(parseAiBattleHash('')).toBeNull();
    const p = parseAiBattleHash('#ai-battle?games=99999&seed=abc&players=9&pool=1&deck=1&skill=2&maxSteps=1');
    expect(p).toEqual({ games: 5000, seed: 1, players: 4, pool: 1, deck: 10, skill: 1, maxSteps: 50 });
  });

  it('falls back to defaults for missing keys', () => {
    expect(parseAiBattleHash('#ai-battle?')).toEqual({
      games: 10,
      seed: 1,
      players: 2,
      pool: 8,
      deck: 60,
      skill: 0.35,
      maxSteps: 3000,
    });
  });
});
