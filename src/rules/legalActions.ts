/**
 * Legal-action enumeration for AI players (and any consumer that needs
 * "what can this player legally do right now?").
 *
 * Design invariant — SINGLE SOURCE OF TRUTH:
 *   This module NEVER re-implements rule gating. It only generates
 *   *candidate* actions from the current state (hand cards, field generals,
 *   zones, slots) and then asks the engine's own judges to decide legality:
 *     1. `RuleEngine.validateAction(state, action)`  (turn/phase/payload gates)
 *   2. `resolver.resolve(state, action)`             (deep rules)
 *   An action is legal iff validation passes and the resolver returns events
 *   without any ACTION_REJECTED.
 *
 * Purity note: every resolver in `src/action/resolvers` is a pure function of
 * (state, action) — EventProcessor is the only state mutator (verified by
 * legalActions.test.ts "probing never mutates state"). Therefore probing
 * against the live state is safe and allocation-cheap. If a future resolver
 * ever mutates state during resolve(), the guard test will fail loudly.
 *
 * BEGIN_DRAW is intentionally NOT enumerated by default: the draw lifecycle is
 * engine-driven (initial draws are begun by the room/game setup, turn-start
 * draws arrive inline via TURN_START → DRAW_REQUIRED, compensation draws are
 * queued by EventProcessor). Exposing BEGIN_DRAW to policies would let an AI
 * re-open draw windows in a loop. The match runner starts initial draws
 * explicitly instead.
 */
import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';
import type { GameEngine } from '../core/GameEngine';
import type { EngineState } from '../core/GameState';
import { effectiveMaxHp } from '../core/statModifiers';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { listTurnEndSkillCandidates } from '../skills/turnEndSkills';
import { getReactionAsk } from '../skills/reactionChain';

const RESOURCE_TYPES = new Set(['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT']);

function isGeneralCard(card: unknown): boolean {
  const c = card as any;
  return !!c && typeof c === 'object' && typeof c.hp === 'number' && !RESOURCE_TYPES.has(String(c.type));
}

function isResourceCard(card: unknown): boolean {
  return RESOURCE_TYPES.has(String((card as any)?.type));
}

function runtimeId(card: unknown): string {
  const c = card as any;
  return String(c?.instanceId ?? c?.id ?? '');
}

function handOf(state: EngineState, playerId: number): any[] {
  const player = state.players.find(p => p.id === playerId);
  return Array.isArray(player?.hand) ? player.hand : [];
}

function fieldOf(state: EngineState, playerId: number): any[] {
  const player = state.players.find(p => p.id === playerId);
  return Array.isArray(player?.fieldGenerals) ? player.fieldGenerals : [];
}

/**
 * Candidate action enumeration for `playerId` (contract: CANDIDATES, not an
 * exhaustive identity-level action space — see PROJECT_ARCH_MAP.md D-5).
 * Legality authority stays with RuleEngine.validateAction + resolvers below.
 * Equivalent resource cards are collapsed to a canonical representative
 * (validator checks type/count, never runtimeId); if a future action needs
 * "discard THIS specific card", gate it behind a per-action CardSelectionPolicy
 * (INSTANCE_REQUIRED) instead of making every enumeration identity-explicit.
 */
export function getLegalActions(engine: GameEngine, playerId: number): GameAction[] {
  const state = engine.state;
  const out: GameAction[] = [];

  const isLegal = (action: GameAction): boolean => {
    const validation = engine.rules.validateAction(state, action);
    if (!validation.valid) return false;
    const resolver = engine.resolvers.getResolver(action);
    if (!resolver) return false;
    const events = resolver.resolve(state, action as any);
    return (
      Array.isArray(events) &&
      events.length > 0 &&
      !events.some(event => event.type === 'ACTION_REJECTED')
    );
  };

  const tryPush = (type: GameAction['type'], payload?: unknown) => {
    const action = createAction(type as any, playerId, payload as any);
    if (isLegal(action)) out.push(action);
  };

  // ── Terminal / non-interactive states ──
  if (state.phase === 'gameOver' || state.phase === 'menu') return [];

  // ── Frozen world (2.6.3): an outstanding offer owns the action space.
  // Options are enumerated in recorded order, so a zero-random policy breaks
  // ties deterministically; the probe (validator + resolver) is still the
  // final authority. ──
  const pending = state.pendingChoice;
  if (pending) {
    if (pending.playerId === playerId) {
      pending.options.forEach((option, index) => {
        // 刀2 (v2.8.11)：不过逐项门槛的分支在 UI 上置灰可见，但**不是合法
        // 动作**——合法性只从 EngineState 一处推导，probe/司机/校验器同视图。
        if (option.enabled === false) return;
        tryPush('CHOOSE_OPTION', { choiceKey: pending.key, optionIndex: index });
      });
    }
    return out;
  }

  // ── Frozen world, second cell (v2.8.22 响应链执法刀＝#71): an outstanding
  // reaction ask owns the action space, and its answer set is enumerated from
  // the ONE derivation point — 「发动A」「发动B」「跳过」, in comparator order.
  // Not the debtor's seat ⇒ nothing at all, same as the offer branch above. ──
  const reactionAsk = getReactionAsk(state);
  if (reactionAsk) {
    if (reactionAsk.playerId === playerId) {
      for (const option of reactionAsk.options) {
        tryPush('ACTIVATE_SKILL', { skillId: option.skillId, generalId: reactionAsk.generalId });
      }
      // §12-61：问窗必须有出口，而且出口恒常存在——跳过永远合法，绝不把对局
      // 锁死在一格问答上。
      tryPush('SKIP_REACTION', { nodeKey: reactionAsk.nodeKey });
    }
    return out;
  }

  // ── Draw window (only the designated draw player may act) ──
  const draw = state.drawState;
  if (state.phase === 'drawing' && draw && draw.playerId === playerId) {
    const total = Math.max(0, Math.floor(draw.totalCards ?? 0));
    for (let generals = 0; generals <= total; generals += 1) {
      tryPush('DRAW', { fromGeneralPool: generals, fromCardPool: total - generals });
    }
    tryPush('CONFIRM_DRAW');
    return out;
  }
  if (state.phase === 'drawing') return out; // not my draw window

  // ── Action window ──
  const me = state.players.find(p => p.id === playerId);
  if (!me || me.isAlive === false) {
    tryPush('SURRENDER'); // defeated players cannot even surrender — probe decides
    return out;
  }

  const hand = handOf(state, playerId);
  const resourceCards = hand.filter(isResourceCard);
  const generalCards = hand.filter(isGeneralCard);
  const myField = fieldOf(state, playerId);

  // RESOLVE_BASE_LOSS: pending base-loss settlement (validator decides ownership).
  tryPush('RESOLVE_BASE_LOSS');

  // DEPLOY_GENERAL: hand general × own camp slots [0, 2] × first (hp) other hand cards.
  // Slot 1 = base/backline cell (渲染层固定显示"营地") — not a deployable camp slot.
  for (const generalCard of generalCards) {
    const costCount = Math.max(1, Math.min(Number(generalCard.hp) || 1, Math.max(0, hand.length - 1)));
    const consumeCards = hand.filter(card => runtimeId(card) !== runtimeId(generalCard)).slice(0, costCount);
    for (const slot of [0, 2]) {
      tryPush('DEPLOY_GENERAL', { general: generalCard, slot, consumeCards });
    }
  }

  // MOVE_GENERAL: every idle general × every plausible destination × cost-or-not.
  // Destination legality (routes, contested areas, occupancy) is entirely the
  // resolver's verdict — we only enumerate the geometry.
  const moveTargets: Array<{ zone: 'camp' | 'front' | 'battle'; slot: number; areaOwnerId: number | null }> = [];
  const areaOwners: Array<number | null> = [null, ...state.players.map(p => p.id)];
  for (const areaOwnerId of areaOwners) {
    if (areaOwnerId === null) {
      for (let slot = 0; slot < state.players.length; slot += 1) moveTargets.push({ zone: 'battle', slot, areaOwnerId: null });
      continue;
    }
    for (const slot of [0, 1, 2]) moveTargets.push({ zone: 'front', slot, areaOwnerId });
    for (const slot of [0, 2]) moveTargets.push({ zone: 'camp', slot, areaOwnerId });
  }
  for (const fg of myField) {
    if (fg?.hasMoved === true) continue;
    const generalId = runtimeId(fg?.general);
    if (!generalId) continue;
    const isScholar = fg?.general?.type === '文将' || fg?.general?.generalType === 'SCHOLAR';
    for (const target of moveTargets) {
      if (isScholar) {
        for (const cost of resourceCards.slice(0, 1)) {
          tryPush('MOVE_GENERAL', { generalId, target, consumeCard: cost });
        }
      } else {
        tryPush('MOVE_GENERAL', { generalId, target });
      }
    }
  }

  // ATTACK: idle attacker × (enemy field general | enemy base) × {melee, ranged}.
  const attackTargets: string[] = [];
  for (const other of state.players) {
    if (other.id === playerId) continue;
    for (const fg of fieldOf(state, other.id)) attackTargets.push(runtimeId(fg?.general));
    attackTargets.push(`base_${other.id}`);
  }
  for (const fg of myField) {
    if (fg?.hasAttacked === true || fg?.isArming === true) continue;
    const attackerId = runtimeId(fg?.general);
    if (!attackerId) continue;
    for (const cost of resourceCards.slice(0, 1)) {
      for (const targetId of attackTargets) {
        if (!targetId || targetId === attackerId) continue;
        for (const ranged of [false, true]) {
          tryPush('ATTACK', { attackerId, targetId, ranged, consumeCard: cost });
        }
      }
    }
  }

  // SUPPLY: own wounded unsupplied general × one or two resource cards.
  for (const fg of myField) {
    if (fg?.hasSupplied === true) continue;
    const generalId = runtimeId(fg?.general);
    // 上限读数走账本（刀4）：键与结算侧同一个 getRuntimeCardId，不用本文件的本地简写，
    // 免得"AI 以为还能补、结算说已满"这种两侧各算各的分叉。
    const missingHp = effectiveMaxHp(state.statModifiers, { playerId, generalId: getRuntimeCardId(fg?.general as never) }, { maxHp: fg?.maxHp })
      - Number(fg?.currentHp ?? 0);
    if (!generalId || missingHp <= 0) continue;
    for (let count = 1; count <= Math.min(2, resourceCards.length); count += 1) {
      tryPush('SUPPLY', { generalId, consumeCards: resourceCards.slice(0, count) });
    }
  }

  // EQUIP_ARMOR: own general × first one or two 军备 cards in hand.
  const armorCards = hand.filter(card => String((card as any)?.type) === '军备' || String((card as any)?.type) === 'ARMAMENT');
  for (const fg of myField) {
    const generalId = runtimeId(fg?.general);
    if (!generalId) continue;
    for (let count = 1; count <= Math.min(2, armorCards.length); count += 1) {
      tryPush('EQUIP_ARMOR', { generalId, armorCards: armorCards.slice(0, count) });
    }
  }

  // ACTIVATE_SKILL (2.3.1): turn-end skills offered by the ask window are
  // ordinary legal actions — candidates derive from EngineState (compile +
  // consumed ledger), the probe (validator + resolver) gives the final verdict.
  for (const candidate of listTurnEndSkillCandidates(state, playerId)) {
    tryPush('ACTIVATE_SKILL', { skillId: candidate.definition.id, generalId: candidate.generalId });
  }

  // Always-considered window actions.
  tryPush('END_TURN');
  tryPush('SURRENDER');

  return out;
}
