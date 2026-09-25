/**
 * Human-readable battle reports for the in-app AI battle window.
 *
 * Pure string/JSON builders over MatchResult[] (no DOM, no fs) so both the
 * background window UI and vitest can consume them. Error annotation rule:
 * every step that violated an invariant (or was rejected) gets a ❌ line with
 * the violation code + detail, and the match header counts them up.
 */
import type { FactionBalanceStat, MatchResult, RecordedAction } from './battleRunner';
import { aggregateFactionStats } from './battleRunner';
import type { General } from '../data/generals';
import { allGenerals } from '../data/generals';
import type { Violation } from './invariants';

export type { FactionBalanceStat };

/**
 * Faction balance 口径 (2.2.8, per-seat accounting — the stat rows and the
 * aggregated FactionBalanceStat live in battleRunner):
 * - seats = times the faction occupied a seat in the batch (mirrors count twice)
 * - 胜率 = wins / seats · 死亡率 = deaths / deployed · 击杀率 = kills / attacks
 *   (deaths = field-roster removals of any cause; kills credited to successful
 *   ATTACK steps that removed another seat's general the same step)
 */
export interface BattleSummary {
  games: number;
  won: number;
  exhausted: number;
  violated: number;
  winnerCounts: Record<string, number>;
  totalMs: number;
  avgMs: number;
  slowestMs: number;
  violationTotal: number;
  /** Empty when every result predates seat stats (legacy fixtures/replays). */
  factionStats: FactionBalanceStat[];
}

function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return '-';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Balance rows: one line per faction, canonical order then extras. */
export function formatFactionStats(stats: FactionBalanceStat[]): string[] {
  return stats.map(
    f =>
      `  ${f.faction}：出场${f.seats}席 胜${f.wins}（胜率 ${rate(f.wins, f.seats)}） · ` +
      `登场${f.deployed} 阵亡${f.deaths}（死亡率 ${rate(f.deaths, f.deployed)}） · ` +
      `攻击${f.attacks} 击杀${f.kills}（击杀率 ${rate(f.kills, f.attacks)}）`,
  );
}

/**
 * Per-skill trigger frequency 口径 (2.4.3 content audit): one count per
 * skill-tagged EFFECT EVENT, keyed by the skill NAME segment of the compiled
 * skillId (see battleRunner's skillTriggerKey) — dual-effect skills like
 * 苦肉 credit each fired effect separately into the same row. Expected rows =
 * every generals.ts skill with at least one `effects[].runtime` payload (the
 * compiled set); configured-but-zero rows are surfaced for the §G
 * content-quality notes. Extra keys present only in the counts (e.g.
 * practice-injection 演練・ skills) are listed too, uncounted.
 */
export interface ExpectedSkillRow {
  key: string;
  label: string;
}

/** Built-in skills that carry a runtime payload → expected report rows. */
export function configuredSkillRows(generals: General[] = allGenerals): ExpectedSkillRow[] {
  const rows: ExpectedSkillRow[] = [];
  for (const g of generals) {
    for (const s of g.skills ?? []) {
      if (s.effects?.some(e => e.runtime)) rows.push({ key: s.name, label: `${g.name}·${s.name}` });
    }
  }
  return rows;
}

export function formatSkillTriggerStats(
  counts: Record<string, number>,
  expected: ExpectedSkillRow[],
): string[] {
  const labelOf = new Map(expected.map(r => [r.key, r.label]));
  const keys = new Set([...expected.map(r => r.key), ...Object.keys(counts)]);
  const rows = [...keys].map(key => ({
    key,
    label: labelOf.get(key) ?? key,
    count: counts[key] ?? 0,
    expected: labelOf.has(key),
  }));
  rows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-CN'));
  const fired = rows.filter(r => r.expected && r.count > 0).length;
  const zero = rows.filter(r => r.expected && r.count === 0).length;
  const out: string[] = [
    `  配置技能 ${new Set(expected.map(r => r.key)).size} 条 · 触发过 ${fired} 条 · 零触发 ${zero} 条` +
      (rows.some(r => !r.expected) ? '（另有名单外触发项，见下）' : ''),
  ];
  for (const r of rows) {
    out.push(`  ${r.label.padEnd(14, '　')} ${String(r.count).padStart(5)}${r.expected && r.count === 0 ? '  ← 零触发' : ''}`);
  }
  return out;
}

export function summarizeMatches(results: MatchResult[]): BattleSummary {
  const summary: BattleSummary = {
    games: results.length,
    won: 0,
    exhausted: 0,
    violated: 0,
    winnerCounts: {},
    totalMs: 0,
    avgMs: 0,
    slowestMs: 0,
    violationTotal: 0,
    factionStats: [],
  };
  for (const r of results) {
    if (r.status === 'won') {
      summary.won += 1;
      const key = String(r.winnerId ?? 'none');
      summary.winnerCounts[key] = (summary.winnerCounts[key] ?? 0) + 1;
    } else if (r.status === 'stepsExhausted') {
      summary.exhausted += 1;
    } else {
      summary.violated += 1;
    }
    summary.totalMs += r.durationMs;
    summary.slowestMs = Math.max(summary.slowestMs, r.durationMs);
    summary.violationTotal += r.violations.length;
  }
  summary.avgMs = summary.games > 0 ? Math.round(summary.totalMs / summary.games) : 0;
  summary.factionStats = aggregateFactionStats(results);
  return summary;
}

function shortCard(card: unknown): string {
  const c = card as Record<string, any> | null | undefined;
  if (!c) return '?';
  const name = String(c.name ?? '');
  const rid = String(c.instanceId ?? c.id ?? '?');
  return name ? `${name}(${rid})` : rid;
}

/** One-line Chinese summary of a recorded action for the log. */
export function formatActionLine(step: number, action: RecordedAction): string {
  const p = (action.payload ?? {}) as Record<string, any>;
  let detail: string;
  switch (action.type) {
    case 'DEPLOY_GENERAL':
      detail = `登场 ${shortCard(p.general)} → 营地槽${p.slot}，消耗${(p.consumeCards ?? []).length}张`;
      break;
    case 'MOVE_GENERAL':
      detail = `移动 ${p.generalId ?? '?'} → ${p.target?.zone ?? '?'}${p.target?.areaOwnerId != null ? `(属${p.target.areaOwnerId})` : ''}槽${p.target?.slot ?? '?'}${p.consumeCard ? `，耗${shortCard(p.consumeCard)}` : ''}`;
      break;
    case 'ATTACK':
      detail = `攻击 ${p.attackerId ?? '?'} → ${p.targetId ?? '?'} ${p.ranged ? '远程' : '近战'}${p.consumeCard ? `，耗${shortCard(p.consumeCard)}` : ''}`;
      break;
    case 'SUPPLY':
      detail = `补给 ${p.generalId ?? '?'}，用卡${(p.consumeCards ?? []).length}张`;
      break;
    case 'EQUIP_ARMOR':
      detail = `装备护甲 ${p.generalId ?? '?'}，${(p.armorCards ?? []).length}张`;
      break;
    case 'DRAW':
      detail = `抽牌 将${p.fromGeneralPool ?? 0}/牌${p.fromCardPool ?? 0}`;
      break;
    case 'BEGIN_DRAW':
      detail = `开抽牌窗(${p.reason ?? '?'}) 玩家${p.playerId ?? '?'} 共${p.totalCards ?? '?'}张`;
      break;
    case 'CONFIRM_DRAW':
      detail = '确认抽牌';
      break;
    case 'END_TURN':
      detail = '结束回合';
      break;
    case 'RESOLVE_BASE_LOSS':
      detail = '结算本营扣血';
      break;
    case 'SURRENDER':
      detail = '投降';
      break;
    default:
      detail = JSON.stringify(p).slice(0, 80);
  }
  return `  step ${String(step).padStart(4)} P${action.playerId} ${action.type.padEnd(17)} ${detail}`;
}

function violationSteps(violations: Violation[]): Map<number, Violation[]> {
  const byStep = new Map<number, Violation[]>();
  for (const v of violations) {
    const list = byStep.get(v.step) ?? [];
    list.push(v);
    byStep.set(v.step, list);
  }
  return byStep;
}

/** Full operation log: one text block per match, ❌-annotated error steps. */
export function buildOperationLog(results: MatchResult[]): string {
  const out: string[] = [];
  const summary = summarizeMatches(results);
  out.push('═══ AI 自动对局操作日志 ═══');
  out.push(
    `总局数 ${summary.games} · 分出胜负 ${summary.won} · 步数耗尽 ${summary.exhausted} · ` +
      `违例局 ${summary.violated} · 违例条目 ${summary.violationTotal} · 总耗时 ${summary.totalMs}ms（均值 ${summary.avgMs}ms/局）`,
  );
  if (summary.factionStats.length > 0) {
    out.push('── 势力平衡统计（胜率=胜席/出场席 · 死亡率=阵亡/登场 · 击杀率=击杀/攻击） ──');
    out.push(...formatFactionStats(summary.factionStats));
  }
  out.push('');
  results.forEach((r, index) => {
    const byStep = violationSteps(r.violations);
    const rejectedAt = new Set(
      r.violations.filter(v => v.code === 'ENUMERATED_REJECTED' || v.code === 'REPLAY_ACTION_REJECTED').map(v => v.step),
    );
    out.push(
      `── 第${index + 1}局 seed=${r.config.seed} ${r.config.playerCount}人 ` +
        `状态=${r.status} 胜者=${r.winnerId ?? '-'} 步数=${r.steps} 耗时=${r.durationMs}ms ──`,
    );
    r.actions.forEach((a, step) => {
      const marks = byStep.get(step);
      const line = formatActionLine(step, a);
      if (marks && marks.length > 0) {
        for (const m of marks) out.push(`❌ ${line} [${m.code}] ${m.detail}`);
      } else if (rejectedAt.has(step)) {
        out.push(`❌${line} [被引擎拒绝]`);
      } else {
        out.push(line);
      }
    });
    // Violations pointing past the action list (e.g. NO_LEGAL_ACTION) get their own lines.
    for (const v of r.violations) {
      if (v.step >= r.actions.length) out.push(`❌ 步 ${v.step}（无对应动作行） [${v.code}] ${v.detail}`);
    }
    if (r.violations.length === 0) out.push('  ✔ 全程未触发任何不变量违例');
    out.push('');
  });
  return out.join('\n');
}

/** Replay bundle: every match as a CLI-compatible record ({config, actions,...}). */
export function buildReplayBundle(results: MatchResult[]): string {
  return JSON.stringify(
    results.map(r => ({
      kind: 'ai-battle-record',
      config: r.config,
      status: r.status,
      winnerId: r.winnerId,
      steps: r.steps,
      finalPhase: r.finalPhase,
      violations: r.violations,
      actions: r.actions,
    })),
    null,
    2,
  );
}

/** Per-failure bundles in the exact `ai-battle-failures/match-<seed>.json` schema. */
export function buildFailureFiles(results: MatchResult[]): { name: string; content: string }[] {
  return results
    .filter(r => r.status !== 'won' && r.status !== 'stepsExhausted')
    .map(r => ({
      name: `match-${r.config.seed}.json`,
      content: JSON.stringify(
        {
          kind: 'ai-battle-failure',
          config: r.config,
          status: r.status,
          winnerId: r.winnerId,
          steps: r.steps,
          finalPhase: r.finalPhase,
          violations: r.violations,
          actions: r.actions,
        },
        null,
        2,
      ),
    }));
}
