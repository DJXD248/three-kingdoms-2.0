/**
 * Human-readable battle reports for the in-app AI battle window.
 *
 * Pure string/JSON builders over MatchResult[] (no DOM, no fs) so both the
 * background window UI and vitest can consume them. Error annotation rule:
 * every step that violated an invariant (or was rejected) gets a ❌ line with
 * the violation code + detail, and the match header counts them up.
 */
import type { MatchResult, RecordedAction } from './battleRunner';
import type { Violation } from './invariants';

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
