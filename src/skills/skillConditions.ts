/**
 * Skill gate conditions (v2.7.3, §G proposal item 4 — twelve-cell contract
 * table in PROJECT_ARCH_MAP §F). A condition is neither an event nor state: it
 * is a pure predicate over ALREADY-RECORDED facts, answering only "should this
 * listener ring at all". It emits zero events, writes zero state, consumes
 * zero RNG — so the single transition path stays untouched.
 *
 * Fail-closed by design: any metric that cannot be resolved (subject seat
 * gone, general left the field, event carries no value, unknown metric/operator)
 * makes the whole gate UNSATISFIED = the skill does not fire. Refusing to fire
 * is honest; firing on an unverifiable premise would invent gameplay.
 *
 * This module is the ONLY implementation; both consumers call it:
 *   - SkillTriggerBridge.buildCondition (auto-trigger path, all 10 keys)
 *   - turnEndSkills / TurnEndSkillResolver (ACTIVATE_SKILL decision path)
 */
import type { EnginePlayer, EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type {
  SkillCondition,
  SkillConditionMetric,
  SkillConditionOperator,
  SkillConditionSubject,
} from './dataTypes';
import { getRuntimeCardId } from '../utils/runtimeIdentity';

export interface SkillConditionFacts {
  state: EngineState;
  /** Seat id of the skill owner. */
  ownerId: number | string;
  /** Runtime card id of the owning general — the SELF axis for general metrics. */
  sourceGeneralId?: string;
  /** The triggering event; absent on the ACTIVATE_SKILL path. */
  event?: GameEvent;
}

interface ResolvedSubject {
  player?: EnginePlayer;
  general?: Record<string, unknown>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function playerById(state: EngineState, id: unknown): EnginePlayer | undefined {
  if (id === undefined || id === null) return undefined;
  return state.players.find(p => String(p.id) === String(id));
}

/** Locate a field general by its runtime id, together with its owning seat. */
function findFieldGeneral(state: EngineState, runtimeId?: string): ResolvedSubject {
  if (!runtimeId) return {};
  for (const player of state.players) {
    const general = asArray<Record<string, unknown>>(player.fieldGenerals)
      .find(fg => getRuntimeCardId(fg?.general as never) === String(runtimeId));
    if (general) return { player, general };
  }
  return {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== '') return String(value);
  }
  return undefined;
}

function resolveSubject(facts: SkillConditionFacts, subject: SkillConditionSubject): ResolvedSubject {
  const { state, ownerId, sourceGeneralId, event } = facts;
  const data = asRecord(event?.data);
  if (subject === 'SELF') {
    const player = playerById(state, ownerId);
    if (!sourceGeneralId) return { player };
    const general = asArray<Record<string, unknown>>(player?.fieldGenerals)
      .find(fg => getRuntimeCardId(fg?.general as never) === String(sourceGeneralId));
    return { player, general };
  }
  if (subject === 'TARGET') {
    const byId = findFieldGeneral(state, firstString(data.targetId, data.target, data.victimId));
    const player = byId.player ?? playerById(state, data.targetPlayerId);
    return { player, general: byId.general };
  }
  const action = asRecord(data.action);
  const payload = asRecord(action.payload);
  const byId = findFieldGeneral(
    state,
    firstString(data.sourceGeneralId, data.attackerId, payload.attackerId, action.attackerId),
  );
  const player = byId.player ?? playerById(state, data.sourcePlayerId ?? action.playerId);
  return { player, general: byId.general };
}

/**
 * 拥有者**自己踩的那片区域＋战场**这两片里，同席位还站着几员别的将（不含本体）。
 * 「单骑」那句「所在区域及战场区域内没有其他己方角色」＝这一格 =0。
 *
 * 数的是**此刻**的在场状态：击杀那一刻这一声已经被记进事件流、死者也已经离场，
 * 所以死者天然不占位置；"己方"按席位口径（§H9 第七轮②），不是按势力。
 * 本体认不出（座次没了、将已离场、编译定义没钉将领实例）＝null＝失败即闭。
 */
function alliesNearOwnerOrInBattle(state: EngineState, ownerId: number | string, sourceGeneralId?: string): number | null {
  const player = playerById(state, ownerId);
  if (!player) return null;
  const field = asArray<Record<string, unknown>>(player.fieldGenerals);
  const self = sourceGeneralId
    ? field.find(fg => getRuntimeCardId(fg?.general as never) === String(sourceGeneralId))
    : undefined;
  const ownZone = (self?.position as { zone?: string } | undefined)?.zone;
  if (!ownZone) return null;
  return field.filter(fg => {
    if (getRuntimeCardId(fg?.general as never) === String(sourceGeneralId)) return false;
    const zone = (fg?.position as { zone?: string } | undefined)?.zone;
    return zone === ownZone || zone === 'battle';
  }).length;
}

/** Read one recorded fact; null = unresolvable (the gate then fails closed). */
function readMetric(
  facts: SkillConditionFacts,
  metric: SkillConditionMetric,
  subject: SkillConditionSubject,
): number | null {
  const { state, event } = facts;
  if (metric === 'DECK_COUNT') {
    return Array.isArray(state.deck) ? state.deck.length : null;
  }
  if (metric === 'EVENT_VALUE') {
    const data = asRecord(event?.data);
    const value = data.value ?? data.count;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  // 2.9.3 刀C 前两格：只读击杀那一声**当场记下**的两格（近战/远程＝`core/attackBlow.ts`
  // 那一刀自己的钥匙；站在哪片区域＝三个 DEATH 发射点都记的那一格）。缺键＝这一声压根
  // 不是攻击打死的（技能伤害与决斗由 `chainedConsequences` 派生、体力归零之死没有出手
  // 的人）⇒失败即闭，「近战击杀」在那些路上结构上永远不成立，而不是"再判断一次算不算"。
  if (metric === 'KILL_BY_MELEE' || metric === 'VICTIM_IN_BATTLE_AREA') {
    const data = asRecord(event?.data);
    if (metric === 'KILL_BY_MELEE') {
      return typeof data.ranged === 'boolean' ? (data.ranged ? 0 : 1) : null;
    }
    const zone = data.targetZone;
    if (zone === 'battle') return 1;
    return zone === 'camp' || zone === 'front' ? 0 : null;
  }
  if (metric === 'ALLY_NEAR_OR_BATTLE_COUNT') {
    return alliesNearOwnerOrInBattle(state, facts.ownerId, facts.sourceGeneralId);
  }
  const resolved = resolveSubject(facts, subject);
  switch (metric) {
    case 'HAND_COUNT':
      return resolved.player && Array.isArray(resolved.player.hand)
        ? resolved.player.hand.length
        : null;
    case 'FIELD_GENERAL_COUNT':
      return resolved.player ? asArray(resolved.player.fieldGenerals).length : null;
    case 'GENERAL_HP':
      return resolved.general && typeof resolved.general.currentHp === 'number'
        ? resolved.general.currentHp
        : null;
    case 'ARMOR_POINTS':
      return resolved.general && typeof resolved.general.currentArmor === 'number'
        ? resolved.general.currentArmor
        : null;
    default:
      return null;
  }
}

function compare(left: number, op: SkillConditionOperator, right: number): boolean {
  switch (op) {
    case 'LT': return left < right;
    case 'LTE': return left <= right;
    case 'EQ': return left === right;
    case 'GTE': return left >= right;
    case 'GT': return left > right;
    default: return false;
  }
}

export function evaluateSkillCondition(
  condition: SkillCondition,
  facts: SkillConditionFacts,
): boolean {
  const subject: SkillConditionSubject = condition.subject ?? 'SELF';
  const left = readMetric(facts, condition.metric, subject);
  if (left === null) return false;
  if (condition.compareTo) {
    const right = readMetric(
      facts,
      condition.compareTo.metric,
      condition.compareTo.subject ?? subject,
    );
    if (right === null) return false;
    return compare(left, condition.op, right);
  }
  if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) return false;
  return compare(left, condition.op, condition.value);
}

/** AND over the whole gate list; undefined/empty = no gate (behaviour unchanged). */
export function evaluateSkillConditions(
  conditions: SkillCondition[] | undefined,
  facts: SkillConditionFacts,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(condition => evaluateSkillCondition(condition, facts));
}
