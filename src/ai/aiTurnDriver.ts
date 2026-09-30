/**
 * v2.2.9 (AI-line phase 4) — in-game human-vs-AI turn driver.
 *
 * `runAiStep` is called on a fixed cadence by <AiDirector/> with the *current
 * Zustand snapshot*. It inspects the phase, and when the seat that owns the
 * current interaction is an AI seat, it performs exactly ONE store action and
 * returns true. Everything goes through the production store pipeline
 * (executeDraw/deployGeneral/… → dispatchStoreAction), so AI games obey the
 * same rule truth, replay recording and writebacks as human games.
 *
 * The brain is reused verbatim from 2.2.7: `new GameEngine(engineState,
 * {recordHistory:false})` + `syncPlayerSkills` + the tier policy. Policy
 * instances are cached per (seat, tier) for the whole match because the
 * strategy policy keeps draw-window bookkeeping in its closure (a fresh
 * instance per step would re-DRAW forever). `resetAiControllers()` is called
 * whenever a new match starts.
 *
 * Stagnation guard: the strategy policies are zero-random, so if a mapped
 * store call silently fails (engine rejects what the probe thought was legal)
 * the *same* action would be re-picked from an equivalent state forever. The
 * guard remembers the last choice signature; on an immediate repeat it forces
 * the fallback (confirm draw / end turn), which is always legal.
 */
import type { GameAction } from '../action/ActionTypes';
import { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { getReactionAsk, type ReactionAsk } from '../skills/reactionChain';
import { createStrategyPolicy, parseTier } from './policies/strategyPolicy';
import { randomPolicy, type AiPolicy } from './policies/randomPolicy';
import type { AiSeatTier } from '../setup/runtimeSetup';
import type { GameState, Player } from '../store/gameStore';

/** Minimal store surface the driver touches (GameState satisfies it). */
export type AiDriverState = GameState;

let seatPolicies = new Map<string, AiPolicy>();
let lastChoiceKey = '';

/** New match boundary: drop per-seat closures and the stagnation guard. */
export function resetAiControllers(): void {
  seatPolicies = new Map();
  lastChoiceKey = '';
}

function policyFor(playerId: number, tier: AiSeatTier): AiPolicy {
  if (tier === 'random') return randomPolicy;
  const key = `${playerId}:${tier}`;
  let policy = seatPolicies.get(key);
  if (!policy) {
    policy = createStrategyPolicy(parseTier(tier) ?? 'balanced');
    seatPolicies.set(key, policy);
  }
  return policy;
}

function aiSeatOf(state: GameState, playerId: number | null | undefined): Player | null {
  if (playerId == null) return null;
  const player = state.players.find(p => p.id === playerId);
  return player?.isAi ? player : null;
}

function allSeatsAi(state: GameState): boolean {
  return state.players.length > 0 && state.players.every(p => p.isAi === true);
}

/**
 * v2.8.22 响应链执法刀 (#71)：此刻状态里有没有待答的响应问句。
 * 先做便宜的槽位闸再算问句——司机每一拍都走这里，不能每次都把候选枚举一遍；
 * 而"队列非空"与"有问句"等价（结算后扫描会把问完的格一律收掉）。
 */
function liveReactionAsk(state: GameState): ReactionAsk | null {
  const engineState = state.engineState as EngineState;
  const queue = engineState?.pendingReaction;
  if (!queue || queue.nodes.length === 0) return null;
  return getReactionAsk(engineState);
}

/** Ask the seat's policy what it would do, with the repeat guard applied. */
function pickPolicyAction(state: GameState, playerId: number, tier: AiSeatTier): GameAction | null {
  const engine = new GameEngine(state.engineState as EngineState, { recordHistory: false });
  syncPlayerSkills(engine, state.engineState as EngineState);
  const picked = policyFor(playerId, tier)(engine, playerId);
  if (!picked) {
    lastChoiceKey = '';
    return null;
  }
  const key = `${playerId}|${state.engineState.turn}|${picked.type}|${JSON.stringify(picked.payload ?? null)}`;
  if (key === lastChoiceKey) {
    // Same state, same zero-random pick, previous attempt changed nothing →
    // hand over to the caller's guaranteed-legal fallback.
    lastChoiceKey = '';
    return null;
  }
  lastChoiceKey = key;
  return picked;
}

interface DrawPayload { fromGeneralPool?: number; fromCardPool?: number }

/** Translate one engine GameAction chosen by the policy into a store call. */
function applyPolicyAction(state: GameState, playerId: number, action: GameAction): boolean {
  const p = action.payload as Record<string, any> | undefined;
  switch (action.type) {
    case 'DRAW': {
      const d = (p ?? {}) as DrawPayload;
      const ok = state.executeDraw(Number(d.fromGeneralPool) || 0, Number(d.fromCardPool) || 0);
      if (!ok) state.confirmDraw();
      return true;
    }
    case 'CONFIRM_DRAW': state.confirmDraw(); return true;
    case 'RESOLVE_BASE_LOSS': state.resolvePendingDrawLoss(); return true;
    case 'DEPLOY_GENERAL': return state.deployGeneral(p?.general, Number(p?.slot) || 0, p?.consumeCards ?? []);
    case 'MOVE_GENERAL': state.moveGeneral(p?.generalId, p?.target, p?.consumeCard); return true;
    case 'ATTACK': state.attackTarget(p?.attackerId, p?.targetId, p?.ranged === true, p?.consumeCard); return true;
    case 'SUPPLY': state.supplyGeneral(p?.generalId, p?.consumeCards ?? []); return true;
    case 'EQUIP_ARMOR': return state.armGeneral(p?.generalId, p?.armorCards ?? []);
    // 2.3.1: AI seats activate turn-end skills exactly like humans decide in
    // the ask window — one canonical ACTIVATE_SKILL action, no direct state
    // edits. Consumption drops the candidate from the next legalActions, so
    // the stagnation guard cannot loop on it.
    case 'ACTIVATE_SKILL': {
      const ask = liveReactionAsk(state);
      // #71：响应问句挂着时，策略挑到的这一枚就是那一格的选项，走响应出口；
      // 没有问句才是回合结束询问那条路。两条路各自都只认一条 canonical 动作。
      if (ask) return state.activateReactionSkill(String(p?.skillId ?? ''), String(p?.generalId ?? ''));
      return state.activateTurnEndSkill(String(p?.skillId ?? ''), String(p?.generalId ?? ''));
    }
    // #71 的另一个出口：跳过＝SKIP_REACTION，出口恒常存在，永不失败到锁死队列。
    case 'SKIP_REACTION': return state.skipReaction();
    // 2.6.3: the frozen world leaves the debtor's policy exactly the recorded
    // options to pick from — the choice arrives as a canonical CHOOSE_OPTION.
    case 'CHOOSE_OPTION': return state.chooseOption(Number(p?.optionIndex) || 0);
    case 'END_TURN': state.endTurn(); return true;
    case 'SURRENDER': state.surrender(playerId); return true;
    default: return false;
  }
}

function stepDrawing(state: GameState): boolean {
  const draw = state.engineState.drawState;
  if (!draw) return false; // UnifiedDraw owns the (rare) empty-window confirm
  const seat = aiSeatOf(state, draw.playerId);
  if (!seat) return false;
  const tier: AiSeatTier = seat.aiTier ?? 'balanced';
  if (draw.baseLossPending) {
    state.resolvePendingDrawLoss();
    return true;
  }
  const action = pickPolicyAction(state, draw.playerId, tier);
  if (action) {
    if (applyPolicyAction(state, draw.playerId, action)) return true;
  }
  // Nothing (legal|safe) to draw with → close the window (always legal).
  state.confirmDraw();
  return true;
}

function stepPlaying(state: GameState): boolean {
  const seat = state.players[state.currentPlayerIndex];
  if (!seat?.isAi) return false;
  if (state.engineState.currentPlayerId !== seat.id) {
    // Store index and engine disagree — never dispatch for the wrong seat.
    console.warn('[aiTurnDriver] currentPlayerIndex/engine currentPlayerId mismatch', {
      index: state.currentPlayerIndex, seatId: seat.id,
      engineId: state.engineState.currentPlayerId,
    });
    return false;
  }
  const tier: AiSeatTier = seat.aiTier ?? 'balanced';
  const action = pickPolicyAction(state, seat.id, tier);
  if (action && applyPolicyAction(state, seat.id, action)) return true;
  state.endTurn(); // END_TURN is always legal for the active seat
  return true;
}

/**
 * Drive one AI interaction. Returns true when an AI store action was made
 * (one per call), false when it is a human's turn or nothing is drivable.
 */
export function runAiStep(state: GameState): boolean {
  // Frozen world (2.6.3): an outstanding offer outranks the phase switch —
  // only the debtor may act, so the driver must play for THAT seat, not for
  // the turn owner. A human debtor is the choice HUD's job (return false).
  const pending = state.engineState?.pendingChoice;
  if (pending && (state.phase === 'playing' || state.phase === 'drawing')) {
    const seat = aiSeatOf(state, pending.playerId);
    if (!seat) return false;
    const tier: AiSeatTier = seat.aiTier ?? 'balanced';
    const action = pickPolicyAction(state, pending.playerId, tier);
    if (action?.type === 'CHOOSE_OPTION' && applyPolicyAction(state, pending.playerId, action)) return true;
    // 刀2 (v2.8.11)：兜底不再固定取 0——门槛可以把 0 号置灰，硬点灰项会被
    // 解析器拒绝，这一步就成了死循环。取记录顺序上的第一个可选项；一个都
    // 没有⇒不动作（桥接层根本不造这种全灰窗，出现即状态异常）。
    const firstEnabled = pending.options.findIndex(option => option.enabled !== false);
    if (firstEnabled < 0) return false;
    state.chooseOption(firstEnabled);
    return true;
  }
  // v2.8.22 (#71)：响应链问答是同一句冻结世界的道理——此刻全场只认"该答的那一
  // 席"。AI 席按自己的策略立刻答，挑的仍是 `legalActions` 里那两条 canonical
  // 动作，与人类点按钮同一条路（基础游戏规则不区分人和 AI＝用户 2026-09-30 口径）；
  // 人席返回 false，交给问窗 HUD。
  const reactionAsk = liveReactionAsk(state);
  if (reactionAsk && (state.phase === 'playing' || state.phase === 'drawing')) {
    const seat = aiSeatOf(state, reactionAsk.playerId);
    if (!seat) return false;
    const tier: AiSeatTier = seat.aiTier ?? 'balanced';
    const action = pickPolicyAction(state, reactionAsk.playerId, tier);
    if (action && applyPolicyAction(state, reactionAsk.playerId, action)) return true;
    // 兜底＝跳过：那一格永远有这个出口（§12-61），队列不会卡在一席沉默上。
    return state.skipReaction();
  }
  switch (state.phase) {
    case 'lobby':
      if (!allSeatsAi(state)) return false;
      state.startGame();
      return true;
    case 'diceRoll':
      if (!allSeatsAi(state)) return false;
      // Skip the dice animation: roll for real (seat order matters), then
      // assignFactions() chains distributeDraftGenerals after its 1.5s beat.
      state.rollDice();
      state.setPhase('factionAssign');
      state.assignFactions();
      return true;
    case 'generalDraft': {
      const seat = state.players[state.draftPlayerIndex];
      if (!seat?.isAi) return false;
      state.aiAutoDraft();
      return true;
    }
    case 'drawing': return stepDrawing(state);
    case 'playing': return stepPlaying(state);
    default: return false;
  }
}
