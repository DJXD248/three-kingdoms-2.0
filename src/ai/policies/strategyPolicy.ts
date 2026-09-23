/**
 * Tiered strategy policies (phase 3 of the AI line, v2.2.7).
 *
 * Same contract as randomPolicy: a pure chooser over `engine.legalActions`,
 * so legality always stays with the engine's own judges — the tiers only
 * differ in HOW they value positions, never in what they think is allowed.
 *
 * Decision method — one-step lookahead through the real rules:
 *   every candidate action is replayed on a throwaway
 *   `new GameEngine(state, {recordHistory:false})` (dispatch is functional:
 *   EventProcessor returns new state objects, the caller's state is never
 *   mutated — same invariant legalActions' probe relies on), and the
 *   resulting state is scored by a static evaluator. The argmax wins;
 *   ties break on enumeration order, so a seeded match is reproducible
 *   without the policy consuming extra randomness.
 *
 * The draw window is the one case lookahead cannot see (DRAW adds cards to
 * the hand, which the evaluator deliberately ignores), so draw splits get a
 * dedicated linear score per tier.
 *
 * Known limitation, stated honestly: the throwaway engine has no skills
 * registered, so lookahead undervalues skill reactions (a defended general
 * with 回刺 may look slightly better to attack than it truly is). Core
 * material/position terms dominate; the arena soak is the guard.
 */
import type { GameAction } from '../../action/ActionTypes';
import { GameEngine } from '../../core/GameEngine';
import type { EngineState } from '../../core/GameState';
import { randomPolicy, type AiPolicy } from './randomPolicy';

export type AiTier = 'conservative' | 'balanced' | 'aggressive';

export interface TierProfile {
  tier: AiTier;
  /** Display label (Chinese) shared by CLI + dev-window UI. */
  label: string;
  weights: {
    ownBase: number;
    enemyBase: number;
    ownGeneral: number;
    enemyGeneral: number;
    /** Armor points on own field generals (defense tiers value these). */
    ownArmor: number;
    /** Enemy armor is subtracted from their threat at ownArmor weight. */
    enemyArmor: number;
    /** Zone-advance bonus per level (camp 0 → enemy camp 4). */
    position: number;
    /** Draw window: value per general-pool card / per resource card. */
    drawGeneral: number;
    drawCard: number;
  };
}

export const TIER_PROFILES: Record<AiTier, TierProfile> = {
  conservative: {
    tier: 'conservative',
    label: '保守',
    weights: {
      ownBase: 4, enemyBase: 1.5, ownGeneral: 1.6, enemyGeneral: 1.2,
      ownArmor: 0.9, enemyArmor: 0.4, position: 0.3,
      drawGeneral: 1.2, drawCard: 0.9,
    },
  },
  balanced: {
    tier: 'balanced',
    label: '均衡',
    weights: {
      ownBase: 3, enemyBase: 2.5, ownGeneral: 1.2, enemyGeneral: 1.2,
      ownArmor: 0.5, enemyArmor: 0.3, position: 0.8,
      drawGeneral: 1, drawCard: 1,
    },
  },
  aggressive: {
    tier: 'aggressive',
    label: '激进',
    weights: {
      ownBase: 3, enemyBase: 4, ownGeneral: 0.9, enemyGeneral: 1.4,
      ownArmor: 0.1, enemyArmor: 0.1, position: 1.6,
      drawGeneral: 1, drawCard: 1.4,
    },
  },
};

export const ALL_TIERS: AiTier[] = ['conservative', 'balanced', 'aggressive'];

export function parseTier(raw: unknown): AiTier | null {
  const text = String(raw ?? '').trim().toLowerCase();
  const byKey = ALL_TIERS.find(tier => tier === text);
  if (byKey) return byKey;
  const byLabel = ALL_TIERS.find(tier => TIER_PROFILES[tier].label === String(raw ?? '').trim());
  return byLabel ?? null;
}

function positionValue(fg: any): number {
  const pos = fg?.position as { zone?: string; areaOwnerId?: number | null } | undefined;
  if (!pos || !pos.zone) return 0;
  const owner = Number(fg?.ownerId);
  if (pos.zone === 'camp') {
    return pos.areaOwnerId == null || Number(pos.areaOwnerId) === owner ? 0 : 4;
  }
  if (pos.zone === 'front') {
    return Number(pos.areaOwnerId) === owner ? 1 : 3;
  }
  if (pos.zone === 'battle') return 2;
  return 0;
}

/** Static board evaluation from `me`'s perspective (zero-sum over living players). */
export function evaluateState(state: EngineState, me: number, w: TierProfile['weights']): number {
  let value = 0;
  for (const player of state.players) {
    const field = Array.isArray(player.fieldGenerals) ? (player.fieldGenerals as any[]) : [];
    let hpSum = 0;
    let armorSum = 0;
    let positionSum = 0;
    for (const fg of field) {
      if (Number(fg?.currentHp ?? 0) <= 0) continue;
      hpSum += Number(fg?.currentHp ?? 0);
      armorSum += Math.max(0, Number(fg?.currentArmor ?? 0)) + Math.max(0, Number(fg?.armor ?? 0));
      positionSum += positionValue(fg);
    }
    const baseHp = Number(player.baseHp ?? 0);
    if (player.id === me) {
      value += w.ownBase * baseHp + w.ownGeneral * hpSum + w.ownArmor * armorSum + w.position * positionSum;
    } else if (player.isAlive !== false) {
      value -= w.enemyBase * baseHp + w.enemyGeneral * hpSum + w.enemyArmor * armorSum + w.position * positionSum;
    }
  }
  // A pending base loss must be settled before anything else — clearing it
  // now is always worth more than any routine action.
  if (state.drawState?.baseLossPending === true && state.drawState.playerId === me) {
    value += 100;
  }
  return value;
}

interface ScoredAction {
  action: GameAction;
  score: number;
}

interface ScoreContext {
  /** Own field generals — 0 means the draw window must lean toward generals,
   * otherwise an all-cards profile starves: no general in hand ⇒ no deploy ⇒
   * no movers/attackers ever (found while tuning: pure fuel-draw never fights). */
  fieldCount: number;
  /** Resource cards already in hand — fuel beyond a few is dead weight. */
  resources: number;
}

function scoreDrawSplit(profile: TierProfile, action: GameAction, total: number, ctx: ScoreContext): number {
  const payload = action.payload as { fromGeneralPool?: number; fromCardPool?: number } | undefined;
  if (action.type === 'CONFIRM_DRAW') {
    // Nothing left to allocate → confirming must beat the no-op DRAW{0,0}
    // candidate (it enumerates first and would otherwise loop the window).
    return total <= 0 ? 1 : 0;
  }
  const generals = Math.max(0, Math.floor(payload?.fromGeneralPool ?? 0));
  const cards = Math.max(0, Math.floor(payload?.fromCardPool ?? Math.max(0, total - generals)));
  const w = profile.weights;
  const generalNeed = ctx.fieldCount === 0 ? 2 : 1;
  const fuelDecay = ctx.resources >= 4 ? 0.4 : 1;
  return w.drawGeneral * generalNeed * generals + w.drawCard * fuelDecay * cards;
}

/** Exported for tests: full scored view of the current decision. */
export function scoreLegalActions(engine: GameEngine, playerId: number, tier: AiTier): ScoredAction[] {
  const profile = TIER_PROFILES[tier];
  const legal = engine.legalActions(playerId);
  const state = engine.state;

  if (state.phase === 'drawing') {
    const total = Math.max(0, Math.floor(state.drawState?.totalCards ?? 0));
    const me = state.players.find(p => p.id === playerId);
    const ctx: ScoreContext = {
      fieldCount: Array.isArray(me?.fieldGenerals)
        ? (me!.fieldGenerals as any[]).filter(fg => Number(fg?.currentHp ?? 0) > 0).length
        : 0,
      resources: Array.isArray(me?.hand)
        ? (me!.hand as any[]).filter(card => {
            const type = String((card as any)?.type ?? '');
            return ['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT'].includes(type);
          }).length
        : 0,
    };
    return legal.map(action => ({ action, score: scoreDrawSplit(profile, action, total, ctx) }));
  }

  const baseline = evaluateState(state, playerId, profile.weights);
  return legal.map(action => {
    const probe = new GameEngine(state, { recordHistory: false });
    probe.dispatch(action);
    return { action, score: evaluateState(probe.state, playerId, profile.weights) - baseline };
  });
}

/**
 * Build one tier's policy. Picks the argmax (stable: earliest enumeration
 * index wins ties). Consumes no randomness → seeded matches stay comparable
 * across tiers with identical setups.
 *
 * Draw-window bookkeeping: a DRAW never closes the window (it stays 'drawing'
 * until CONFIRM_DRAW and totalCards does not decrement), so a purely stateless
 * argmax would repeat its best split forever — the random baseline only ever
 * escaped by stumbling onto CONFIRM_DRAW. The policy therefore keeps a tiny
 * per-closure record of windows it already drew in and confirms next there.
 * Sequential single-threaded use only (the runner is), and window keys are
 * deterministic, so replay parity is preserved.
 */
export function createStrategyPolicy(tier: AiTier): AiPolicy {
  const drawnWindows = new Map<string, true>();
  return (engine, playerId) => {
    const state = engine.state;
    if (state.phase === 'drawing' && state.drawState?.playerId === playerId) {
      const draw = state.drawState;
      const key = `${draw.reason}:${draw.playerId}:${state.turn}`;
      if (drawnWindows.get(key)) {
        const confirm = engine.legalActions(playerId).find(a => a.type === 'CONFIRM_DRAW');
        if (confirm) {
          drawnWindows.delete(key);
          return confirm;
        }
      }
      const scored = scoreLegalActions(engine, playerId, tier);
      if (scored.length === 0) return null;
      let best = scored[0];
      for (const candidate of scored) if (candidate.score > best.score) best = candidate;
      if (best.action.type === 'DRAW') {
        if (drawnWindows.size > 400) drawnWindows.clear();
        drawnWindows.set(key, true);
      }
      return best.action;
    }
    const scored = scoreLegalActions(engine, playerId, tier);
    if (scored.length === 0) return null;
    let best = scored[0];
    for (const candidate of scored) if (candidate.score > best.score) best = candidate;
    return best.action;
  };
}

export const strategyPolicies: Record<AiTier, AiPolicy> = {
  conservative: createStrategyPolicy('conservative'),
  balanced: createStrategyPolicy('balanced'),
  aggressive: createStrategyPolicy('aggressive'),
};

/** Policy by key: 'random' keeps the phase-2 baseline, tiers use the strategy. */
export function policyByName(name: string): AiPolicy | null {
  if (name.trim().toLowerCase() === 'random') return randomPolicy;
  const tier = parseTier(name);
  return tier ? strategyPolicies[tier] : null;
}
