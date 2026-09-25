/**
 * Pure-builder tests for the in-app battle reports (v2.2.5):
 * summary counting, ❌ annotation rules in the operation log,
 * replay-bundle / failure-file shapes, and the battle-window hash parser.
 * No DOM involved — the same builders the background window and the dock
 * feed their exports.
 */
import { describe, expect, it } from 'vitest';
import type { MatchResult, RecordedAction, SeatStats } from './battleRunner';
import { defaultMatchConfig } from './matchSetup';
import {
  buildFailureFiles,
  buildOperationLog,
  buildReplayBundle,
  formatActionLine,
  formatFactionStats,
  formatSkillTriggerStats,
  configuredSkillRows,
  summarizeMatches,
} from './battleReport';
import { encodeSeats, parseAiBattleHash, type AiBattleSeat } from './battleHash';

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

  it('aggregates per-faction balance rows from seat stats (mirrors counted per seat)', () => {
    const seat = (over: Partial<SeatStats>): SeatStats => ({
      seat: 1, faction: '魏', deployed: 4, deaths: 2, kills: 1, attacks: 3, won: 0, ...over,
    });
    const s = summarizeMatches([
      match({ seatStats: [seat({ won: 1 }), seat({ seat: 2, faction: '魏' })] }), // 魏 double mirror, one won
      match({ seatStats: [seat({ seat: 1, faction: '蜀', deployed: 5, deaths: 5, kills: 2, attacks: 2 }), seat({ seat: 2, faction: '吴', won: 1 })] }),
      match({}), // legacy fixture without seatStats must not break aggregation
    ]);
    expect(s.factionStats).toEqual([
      { faction: '魏', seats: 2, wins: 1, deployed: 8, deaths: 4, kills: 2, attacks: 6 },
      { faction: '蜀', seats: 1, wins: 0, deployed: 5, deaths: 5, kills: 2, attacks: 2 },
      { faction: '吴', seats: 1, wins: 1, deployed: 4, deaths: 2, kills: 1, attacks: 3 },
    ]);
    const rows = formatFactionStats(s.factionStats);
    expect(rows[0]).toContain('出场2席');
    expect(rows[0]).toContain('胜率 50.0%');
    expect(rows[0]).toContain('死亡率 50.0%');
    expect(rows[0]).toContain('击杀率 33.3%');
    expect(formatFactionStats([{ faction: '群', seats: 1, wins: 0, deployed: 0, deaths: 0, kills: 0, attacks: 0 }])[0])
      .toContain('死亡率 -'); // zero denominators render as '-'
  });

  it('operation log header carries the faction balance block when stats exist', () => {
    const withStats = match({ seatStats: [{ seat: 1, faction: '晋', deployed: 2, deaths: 1, kills: 0, attacks: 1, won: 1 }] });
    const log = buildOperationLog([withStats]);
    expect(log).toContain('势力平衡统计');
    expect(log).toContain('晋：出场1席');
    expect(buildOperationLog([match()])).not.toContain('势力平衡统计');
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

describe('skill trigger report (2.4.3)', () => {
  it('configuredSkillRows covers exactly the runtime-bearing built-in skills', () => {
    const rows = configuredSkillRows();
    // 批一 9 + 批二 21 + 批三 2 + v2.5.2 onDeploy 转正 3（苦肉双效果仍是一行）
    expect(rows).toHaveLength(35);
    const keys = rows.map(r => r.key);
    // join key = 技能名（屯田 魏/晋 重名共两行 = 34 个唯一键）
    expect(new Set(keys).size).toBe(34);
    expect(keys.filter(k => k === '屯田')).toHaveLength(2);
    expect(rows.some(r => r.key === '奸雄' && r.label === '曹操·奸雄')).toBe(true);
    expect(rows.some(r => r.key === '苦肉' && r.label === '黄盖·苦肉')).toBe(true);
    expect(rows.some(r => r.key === '反馈' && r.label === '司马懿·反馈')).toBe(true);
    expect(rows.some(r => r.key === '断肠' && r.label === '蔡文姬·断肠')).toBe(true);
    expect(rows.some(r => r.key === '英慧' && r.label === '王元姬·英慧')).toBe(true);
    expect(rows.some(r => r.key === '拓略' && r.label === '杜预·拓略')).toBe(true);
    expect(rows.some(r => r.key === '奋勇' && r.label === '文鸯·奋勇')).toBe(true);
    // pure-description skills (no runtime payload) must stay out of the set
    expect(keys).not.toContain('观星');
  });

  it('formatter zero-fills expected rows, sorts desc by count, flags zeros', () => {
    const expected = [
      { key: '奸雄', label: '曹操·奸雄' },
      { key: '苦肉', label: '黄盖·苦肉' },
      { key: '龙吟', label: '关平·龙吟' },
    ];
    const lines = formatSkillTriggerStats({ '奸雄': 9, '苦肉': 3 }, expected);
    expect(lines[0]).toContain('配置技能 3 条 · 触发过 2 条 · 零触发 1 条');
    expect(lines[1]).toContain('曹操·奸雄');
    expect(lines[1]).toMatch(/\s9$/);
    expect(lines[2]).toContain('黄盖·苦肉');
    expect(lines[3]).toContain('关平·龙吟');
    expect(lines[3]).toContain('← 零触发');
  });

  it('counts outside the expected set still print (practice skills), flagged in header', () => {
    const lines = formatSkillTriggerStats({ '演練・守夜': 4 }, []);
    expect(lines[0]).toContain('配置技能 0 条 · 触发过 0 条 · 零触发 0 条');
    expect(lines[0]).toContain('名单外触发项');
    expect(lines[1]).toContain('演練・守夜');
  });
});

describe('parseAiBattleHash', () => {
  it('accepts only #ai-battle? hashes and clamps params into range', () => {
    expect(parseAiBattleHash('#playing')).toBeNull();
    expect(parseAiBattleHash('')).toBeNull();
    const p = parseAiBattleHash('#ai-battle?games=99999&seed=abc&players=9&pool=1&deck=1&skill=2&maxSteps=1');
    expect(p).toEqual({
      games: 5000, seed: 1, players: 4, pool: 1, deck: 10, skill: 1, maxSteps: 50,
      policies: ['random', 'random', 'random', 'random'],
      seats: [0, 1, 2, 3].map(() => ({ faction: '', generals: [] })),
    });
  });

  it('parses seats: faction labels, general id lists, padding to player count', () => {
    const p = parseAiBattleHash('#ai-battle?players=3&seats=%E9%AD%8F:wei_001,wei_001|%E8%9C%80||');
    expect(p?.seats).toEqual([
      { faction: '魏', generals: ['wei_001', 'wei_001'] }, // duplicates preserved
      { faction: '蜀', generals: [] },
      { faction: '', generals: [] },
    ]);
    const junk = parseAiBattleHash('#ai-battle?players=2&seats=汉:x_not_a_gen');
    expect(junk?.seats).toEqual([
      { faction: '', generals: ['x_not_a_gen'] }, // unknown faction blanked; ids pass through (matchSetup filters)
      { faction: '', generals: [] },
    ]);
    const tooMany = parseAiBattleHash('#ai-battle?players=2&seats=%E9%AD%8F|%E8%9C%80|%E5%90%B4');
    expect(tooMany?.seats).toEqual([
      { faction: '魏', generals: [] },
      { faction: '蜀', generals: [] },
    ]);
  });

  it('encodeSeats round-trips through parseAiBattleHash', () => {
    const seats: AiBattleSeat[] = [
      { faction: '吴', generals: ['wu_001', 'wu_002'] },
      { faction: '', generals: [] },
    ];
    const hash = `#ai-battle?players=2&seats=${encodeURIComponent(encodeSeats(seats))}`;
    expect(parseAiBattleHash(hash)?.seats).toEqual(seats);
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
      policies: ['random', 'random'],
      seats: [
        { faction: '', generals: [] },
        { faction: '', generals: [] },
      ],
    });
  });

  it('parses per-seat policy keys: trims, drops unknowns, pads to player count', () => {
    const p = parseAiBattleHash('#ai-battle?players=3&policies=aggressive%2Cnope%2C%20balanced%20%2Cconservative');
    expect(p?.policies).toEqual(['aggressive', 'balanced', 'conservative']);
    const short = parseAiBattleHash('#ai-battle?players=2&policies=balanced');
    expect(short?.policies).toEqual(['balanced', 'random']);
  });
});
