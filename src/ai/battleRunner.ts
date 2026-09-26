/**
 * Local AI-vs-AI battle runner (fs-free so vitest can import it directly).
 *
 * Each step mirrors the production bridge path exactly:
 *   fresh `new GameEngine(state, { recordHistory: false })` +
 *   `syncPlayerSkills(engine, state)` + `engine.dispatch(action)`.
 * recordHistory:false is what lets thousands of games run without the
 * replay/snapshot deep-clone retention (O(n^2)) building up — the UI keeps
 * the default (true) and is untouched.
 *
 * Determinism (D-2 second cut, 2.2.19): every randomness source is an
 * explicit seeded stream derived from config.seed — assembly through
 * matchSetup's setup cursor, engine draws through state.rngState, and random
 * policy picks through the runner's policy cursor. The old global
 * Math.random patch (src/ai/rng.ts) is retired. Replay mode dispatches the
 * recorded actions directly without consulting any policy.
 */
import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';
import { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { createRngState, rngNext } from '../core/rng';
import { allFactions } from '../data/generals';
import { buildMatchState, defaultMatchConfig, type MatchConfig } from './matchSetup';
import { createLedgerSentinel, checkStateInvariants, type Violation } from './invariants';
import { randomPolicy, type AiPolicy } from './policies/randomPolicy';

export interface RecordedAction {
  type: GameAction['type'];
  playerId: number;
  payload?: unknown;
}

/**
 * Per-seat balance stats (2.2.8). Definitions (the "口径" documented in the
 * handoff): deployed = generals entering the field roster; deaths = leaving it
 * (all removals count, whatever killed them); attacks = successful ATTACK
 * actions; kills = other seats' roster removals on the same step as one of our
 * successful attacks (includes counter-kill victims and attack-triggered
 * skill deaths — an intentional broad 口径 for balance tuning).
 */
export interface SeatStats {
  seat: number;
  faction: string;
  deployed: number;
  deaths: number;
  kills: number;
  attacks: number;
  won: 0 | 1;
}

/** Batch-level per-faction roll-up (see battleReport for the 口径 docs). */
export interface FactionBalanceStat {
  faction: string;
  seats: number;
  wins: number;
  deployed: number;
  deaths: number;
  kills: number;
  attacks: number;
}

export function absorbSeatStats(
  byFaction: Map<string, FactionBalanceStat>,
  seatStats: SeatStats[] | undefined,
): void {
  for (const st of seatStats ?? []) {
    let f = byFaction.get(st.faction);
    if (!f) {
      f = { faction: st.faction, seats: 0, wins: 0, deployed: 0, deaths: 0, kills: 0, attacks: 0 };
      byFaction.set(st.faction, f);
    }
    f.seats += 1;
    f.wins += st.won;
    f.deployed += st.deployed;
    f.deaths += st.deaths;
    f.kills += st.kills;
    f.attacks += st.attacks;
  }
}

/** Stable faction row order: canonical 魏蜀吴群晋 first (by seats), then extras. */
export function sortFactionStats(byFaction: Map<string, FactionBalanceStat>): FactionBalanceStat[] {
  const canonical: string[] = allFactions;
  return [...byFaction.values()].sort((a, b) => {
    const ia = canonical.indexOf(a.faction);
    const ib = canonical.indexOf(b.faction);
    return (ia === -1 ? canonical.length : ia) - (ib === -1 ? canonical.length : ib) || b.seats - a.seats;
  });
}

export function aggregateFactionStats(results: { seatStats?: SeatStats[] }[]): FactionBalanceStat[] {
  const byFaction = new Map<string, FactionBalanceStat>();
  for (const r of results) absorbSeatStats(byFaction, r.seatStats);
  return sortFactionStats(byFaction);
}

/** roster key → owning player id, for before/after diffing one step. */
function snapshotFieldRoster(state: EngineState): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of state.players ?? []) {
    const list = Array.isArray(p.fieldGenerals) ? (p.fieldGenerals as unknown[]) : [];
    for (const raw of list) {
      const entry = raw as Record<string, any> | null;
      const general = (entry?.general ?? entry) as Record<string, any> | null;
      const key = String(entry?.instanceId ?? general?.instanceId ?? general?.id ?? entry?.id ?? '');
      if (key) map.set(key, p.id);
    }
  }
  return map;
}

export interface MatchResult {
  config: MatchConfig;
  status: 'won' | 'stepsExhausted' | 'violation' | 'replay-diverged';
  winnerId: number | null;
  steps: number;
  durationMs: number;
  actions: RecordedAction[];
  violations: Violation[];
  finalPhase: string;
  /** Per-seat balance stats; absent only for hand-built legacy fixtures. */
  seatStats?: SeatStats[];
  /** Per-skill trigger counts (将领模板id:技能名 → 次数, see skillTriggerKey);
   * present only when the run was started with `trackSkillTriggers`
   * (v2.4.3 content audit, keying upgraded to per-general in v2.7.0). */
  skillTriggers?: Record<string, number>;
}

export interface BatchSummary {
  games: number;
  won: number;
  violated: number;
  exhausted: number;
  winnerCounts: Record<string, number>;
  totalMs: number;
  avgMs: number;
  slowestMs: number;
  violations: { seed: number; step: number; code: string; detail: string }[];
  failedMatches: MatchResult[];
  factionStats: FactionBalanceStat[];
  /** Batch roll-up of per-skill effect counts; absent unless tracking was on. */
  skillTriggerCounts?: Record<string, number>;
}

function countAlive(state: EngineState): number {
  return (state.players ?? []).filter(p => p.isAlive !== false).length;
}

function winnerOf(state: EngineState): number | null {
  const raw = (state.metadata as Record<string, unknown> | undefined)?.winnerId;
  return typeof raw === 'number' ? raw : null;
}

interface RunOptions {
  policy?: AiPolicy;
  /** Per-seat overrides (index = playerId − 1) — the arena feeds different
   * tiers per seat; seats beyond the array (or absent) fall back to `policy`. */
  seatPolicies?: AiPolicy[];
  maxSteps?: number;
  /** Replay mode: dispatch these actions (after the opening BEGIN_DRAW) instead of policy picks. */
  recorded?: RecordedAction[];
  /** v2.4.3 content audit: count skill-produced effect events per skill.
   * Off by default so the B4 baseline path stays byte-identical. */
  trackSkillTriggers?: boolean;
}

/**
 * Events a compiled skill effect can materialize as (SkillTriggerBridge).
 * The v2.5.3 GIVE sync missed this observation-only set (GIVE had no payload
 * then; EQUIP_STRIP joins in 2.6.0). Tool surface only — trackSkillTriggers
 * is default off, gameplay untouched.
 */
const SKILL_EFFECT_EVENT_TYPES = new Set(['DRAW', 'DAMAGE', 'HEAL', 'GAIN_ARMOR', 'DISCARD', 'GIVE', 'EQUIP_STRIP']);

/**
 * Batch-stable join key = `模板id:技能名` (v2.7.0 report-keying cut).
 * The compiled skillId's owner segment is whatever `syncPlayerSkills` keyed
 * the general by at registration time — a per-assembly runtime instance id
 * (`ai712_c3` from matchSetup) or a seat-suffixed copy id (`jin_004_p2`),
 * neither stable across batch runs. `aliases` (accumulated per match by
 * `collectTemplateAliases`) maps either form back to the general TEMPLATE id;
 * unresolvable owners keep their raw segment (surfaces as an off-list row,
 * disclosed rather than silently dropped). Name-collision rows are separated
 * by design: 屯田 (魏邓艾 / 晋邓艾) counts into two ledger lines — the
 * observation precondition for the same-faction-same-name content policy.
 */
export function skillTriggerKey(skillId: string, aliases?: Map<string, string>): string {
  const parts = skillId.split(':');
  if (parts.length < 2) return parts[0];
  const owner = aliases?.get(parts[0]) ?? parts[0];
  return `${owner}:${parts[1]}`;
}

/** Seat-suffixed copy ids (`jin_004_p2`) carry their template id as a prefix. */
function templateOfCopyId(id: string): string {
  return id.replace(/_p\d+$/, '');
}

/**
 * Accumulate owner-id → template-id aliases for the trigger report: every
 * general seen in a pool or on a field, keyed by BOTH its copy id and its
 * runtime instance id (whichever the skill was registered under), valued by
 * the template id. Cumulative because a registration can outlive the roster
 * entry it came from (death-chain effects).
 */
function collectTemplateAliases(state: EngineState, acc: Map<string, string>): void {
  for (const p of state.players ?? []) {
    for (const rawList of [p.generalPool, p.fieldGenerals]) {
      const list = Array.isArray(rawList) ? (rawList as unknown[]) : [];
      for (const raw of list) {
        const entry = raw as Record<string, any> | null;
        const general = (entry?.general ?? entry) as Record<string, any> | null;
        const copyId = String(general?.id ?? entry?.id ?? '');
        if (!copyId) continue;
        const templateId = templateOfCopyId(copyId);
        const instanceId = entry?.instanceId ?? general?.instanceId;
        if (instanceId) acc.set(String(instanceId), templateId);
        acc.set(copyId, templateId);
      }
    }
  }
}

/**
 * Core loop shared by generation and replay. The opening action is always an
 * explicit BEGIN_DRAW(initial) — the engine's draw lifecycle then chains the
 * remaining players' initial draws itself.
 */
export function runMatch(config: MatchConfig, options: RunOptions = {}): MatchResult {
  const defaultPolicy = options.policy ?? randomPolicy;
  const policyFor = (playerId: number): AiPolicy =>
    options.seatPolicies?.[playerId - 1] ?? defaultPolicy;
  const maxSteps = options.maxSteps ?? 3000;
  const recorded = options.recorded ?? null;
  // Third explicit seeded stream: policy tie-break entropy, salted apart from
  // the setup cursor (matchSetup) and the in-play cursor (state.rngState).
  const policyRng = createRngState((config.seed ^ 0x85ebca6b) >>> 0);
  const randomForPolicy = () => rngNext(policyRng);

  const run = (): MatchResult => {
    const startedAt = Date.now();
    let state = buildMatchState(config);
    const actions: RecordedAction[] = [];
    const violations: Violation[] = [];
    const ledger = createLedgerSentinel();
    let status: MatchResult['status'] = 'stepsExhausted';

    const seatStats: SeatStats[] = (state.players ?? []).map(p => ({
      seat: p.id,
      faction: String(p.faction ?? '?'),
      deployed: 0,
      deaths: 0,
      kills: 0,
      attacks: 0,
      won: 0 as 0 | 1,
    }));
    const statsOf = (playerId: number): SeatStats | undefined => seatStats[playerId - 1];
    const skillTriggers: Record<string, number> | undefined = options.trackSkillTriggers ? {} : undefined;
    const templateAliases = skillTriggers ? new Map<string, string>() : undefined;
    if (templateAliases) collectTemplateAliases(state, templateAliases);

    const firstPlayerId = state.currentPlayerId ?? 1;

    const dispatchStep = (action: GameAction, index: number, prepared?: GameEngine): boolean => {
      const engine = prepared ?? new GameEngine(state, { recordHistory: false });
      const aliveBefore = countAlive(state);
      const rosterBefore = snapshotFieldRoster(state);
      if (templateAliases) collectTemplateAliases(state, templateAliases);
      const events = engine.dispatch(action);
      state = engine.state;
      const rejected = events.filter(ev => ev.type === 'ACTION_REJECTED');
      if (rejected.length > 0) {
        violations.push({
          code: recorded ? 'REPLAY_ACTION_REJECTED' : 'ENUMERATED_REJECTED',
          step: index,
          detail: `${action.type} by player ${action.playerId} rejected: ${JSON.stringify(rejected[0]?.data ?? null)}`,
        });
        return false;
      }
      actions.push({ type: action.type, playerId: action.playerId, payload: action.payload });
      const died = aliveBefore - countAlive(state) > 0;
      const found = checkStateInvariants(state, index).concat(ledger.check(state, index, died));
      if (found.length > 0) {
        violations.push(...found);
        return false;
      }
      // Balance bookkeeping only on fully accepted steps (violation steps end
      // the match anyway, and their diff would be noise).
      const rosterAfter = snapshotFieldRoster(state);
      for (const [key, owner] of rosterAfter) {
        if (!rosterBefore.has(key)) {
          const s = statsOf(owner);
          if (s) s.deployed += 1;
        }
      }
      const removedOwners: number[] = [];
      for (const [key, owner] of rosterBefore) {
        if (!rosterAfter.has(key)) {
          const s = statsOf(owner);
          if (s) s.deaths += 1;
          removedOwners.push(owner);
        }
      }
      if (action.type === 'ATTACK') {
        const actorStats = statsOf(action.playerId);
        if (actorStats) {
          actorStats.attacks += 1;
          actorStats.kills += removedOwners.filter(owner => owner !== action.playerId).length;
        }
      }
      if (skillTriggers) {
        for (const ev of events) {
          if (!SKILL_EFFECT_EVENT_TYPES.has(ev.type)) continue;
          const skillId = (ev.data as Record<string, unknown> | undefined)?.skillId;
          if (typeof skillId !== 'string' || !skillId) continue;
          const key = skillTriggerKey(skillId, templateAliases);
          skillTriggers[key] = (skillTriggers[key] ?? 0) + 1;
        }
      }
      return true;
    };

    // Step 0: open the initial draw window explicitly (runner-owned setup,
    // BEGIN_DRAW is intentionally never policy-enumerated).
    const begin = createAction('BEGIN_DRAW', firstPlayerId, {
      reason: 'initial',
      playerId: firstPlayerId,
      totalCards: 5,
    });
    if (!dispatchStep(begin, 0)) {
      status = recorded ? 'replay-diverged' : 'violation';
    } else {
      for (let index = 1; index <= maxSteps; index += 1) {
        if (state.phase === 'gameOver') {
          status = 'won';
          break;
        }
        const actor =
          state.pendingChoice
            // Frozen world (2.6.3): an outstanding offer routes the step to
            // its debtor before the draw-window owner does.
            ? state.pendingChoice.playerId
            : state.phase === 'drawing' && state.drawState
              ? state.drawState.playerId
              : state.currentPlayerId ?? firstPlayerId;
        const engine = new GameEngine(state, { recordHistory: false });
        syncPlayerSkills(engine, state);
        let next: GameAction | null;
        if (recorded) {
          // actions[0] is always the runner-owned BEGIN_DRAW (both modes),
          // so the recording for loop step `index` sits at recorded[index].
          // Replay never consults a policy — recorded actions are re-minted
          // verbatim (createAction's id is a pure counter since 2.2.19).
          const rec = recorded[index];
          if (!rec) {
            status = state.phase === 'gameOver' ? 'won' : 'stepsExhausted';
            break;
          }
          next = createAction(rec.type, rec.playerId, rec.payload);
        } else {
          next = policyFor(actor)(engine, actor, randomForPolicy);
        }
        if (!next) {
          violations.push({
            code: 'NO_LEGAL_ACTION',
            step: index,
            detail: `policy found nothing legal for player ${actor} in ${state.phase}/${state.timelinePhase}`,
          });
          status = 'violation';
          break;
        }
        if (!dispatchStep(next, index, engine)) {
          status = recorded ? 'replay-diverged' : 'violation';
          break;
        }
      }
      if (status === 'stepsExhausted' && state.phase === 'gameOver') status = 'won';
    }

    const winnerId = winnerOf(state);
    if (status === 'won' && winnerId != null) {
      const winnerStats = statsOf(winnerId);
      if (winnerStats) winnerStats.won = 1;
    }

    return {
      config,
      status,
      winnerId,
      steps: actions.length,
      durationMs: Date.now() - startedAt,
      actions,
      violations,
      finalPhase: String(state.phase),
      seatStats,
      ...(skillTriggers ? { skillTriggers } : {}),
    };
  };
  return run();
}

export interface BatchOptions extends RunOptions {
  games: number;
  seed: number;
  configOverrides?: Partial<MatchConfig>;
}

/** Run `games` seeded matches (seed, seed+1, …) and aggregate the results. */
export function runBatch(options: BatchOptions): BatchSummary {
  const summary: BatchSummary = {
    games: 0,
    won: 0,
    violated: 0,
    exhausted: 0,
    winnerCounts: {},
    totalMs: 0,
    avgMs: 0,
    slowestMs: 0,
    violations: [],
    failedMatches: [],
    factionStats: [],
  };
  const factionMap = new Map<string, FactionBalanceStat>();
  const skillMap: Record<string, number> = {};
  for (let i = 0; i < options.games; i += 1) {
    const seed = options.seed + i;
    const config = defaultMatchConfig(seed, options.configOverrides);
    const result = runMatch(config, {
      policy: options.policy,
      seatPolicies: options.seatPolicies,
      maxSteps: options.maxSteps,
      trackSkillTriggers: options.trackSkillTriggers,
    });
    absorbSeatStats(factionMap, result.seatStats);
    if (options.trackSkillTriggers) {
      for (const [key, n] of Object.entries(result.skillTriggers ?? {})) {
        skillMap[key] = (skillMap[key] ?? 0) + n;
      }
    }
    summary.games += 1;
    summary.totalMs += result.durationMs;
    summary.slowestMs = Math.max(summary.slowestMs, result.durationMs);
    if (result.status === 'won') {
      summary.won += 1;
      const key = String(result.winnerId ?? 'none');
      summary.winnerCounts[key] = (summary.winnerCounts[key] ?? 0) + 1;
    } else if (result.status === 'stepsExhausted') {
      summary.exhausted += 1;
    } else {
      summary.violated += 1;
      summary.failedMatches.push(result);
      for (const v of result.violations) {
        summary.violations.push({ seed, step: v.step, code: v.code, detail: v.detail });
      }
    }
  }
  summary.avgMs = summary.games > 0 ? Math.round(summary.totalMs / summary.games) : 0;
  summary.factionStats = sortFactionStats(factionMap);
  if (options.trackSkillTriggers) {
    const sorted: Record<string, number> = {};
    for (const key of Object.keys(skillMap).sort()) sorted[key] = skillMap[key];
    summary.skillTriggerCounts = sorted;
  }
  return summary;
}
