/**
 * Turn-end skill candidates (2.3.1) — the SINGLE pure derivation of "which
 * onTurnEnd skills may this player still activate this turn", computed from
 * EngineState alone (compile → filter → subtract the consumedSkills ledger).
 *
 * Everything downstream (legalActions enumeration, the store's ask-window
 * decision, the AI driver, TurnEndSkillResolver's own gate) asks THIS module,
 * so live play, the resident/rebuild paths and replay can never disagree
 * about what is legal — legality is state-derived, never container-derived.
 *
 * Derivation discipline mirrors syncPlayerSkills (2.2.21): field generals are
 * recompiled per query, so a general that left the field is never a candidate.
 */
import type { General } from '../data/generals';
import type { EngineState } from '../core/GameState';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { compileGeneralSkills } from './skillCompiler';
import { evaluateSkillConditions } from './skillConditions';
import { gateConditionsToText } from './skillGateText';
import { LIMIT_EXHAUSTED_TEXT, limitedQuotaAvailable } from './skillQuota';
import type { DataSkillDefinition } from './dataTypes';

export interface TurnEndSkillCandidate {
  playerId: number;
  /** Runtime card-instance id of the owning general (ACTIVATE_SKILL payload). */
  generalId: string;
  generalName: string;
  /** Compiled definition — id doubles as the ACTIVATE_SKILL payload.skillId. */
  definition: DataSkillDefinition;
}

/**
 * 2.8.17 (#42) — the ask window's full view: every selfTurn onTurnEnd skill on
 * the field, each carrying whether it can be activated RIGHT NOW and, when it
 * cannot, the plain-language reason. `listTurnEndSkillCandidates` below is this
 * same list filtered, so 完整模式's greyed entries can never be mistaken for a
 * second, looser legality source: activatable === membership in the legal set.
 */
export interface TurnEndAskItem {
  playerId: number;
  generalId: string;
  generalName: string;
  definition: DataSkillDefinition;
  activatable: boolean;
  /** null when activatable; otherwise the reason shown on the greyed entry. */
  disabledReason: string | null;
}

function fieldGeneralsOf(state: EngineState, playerId: number) {
  const player = state.players.find(p => p.id === playerId);
  const list = Array.isArray(player?.fieldGenerals)
    ? (player!.fieldGenerals as Array<Record<string, unknown>>)
    : [];
  return { player, list };
}

/**
 * Every onTurnEnd definition on `playerId`'s field, consumed or not — the
 * honest-rejection view TurnEndSkillResolver uses to tell "not there" from
 * "already used this turn". Exported so the compile-derivation lives ONCE.
 */
export function listAllTurnEndDefinitions(
  state: EngineState,
  playerId: number,
): DataSkillDefinition[] {
  const { list } = fieldGeneralsOf(state, playerId);
  const defs: DataSkillDefinition[] = [];
  for (const fg of list) {
    const general = fg?.general as General | undefined;
    if (!general || !Array.isArray(general.skills) || general.skills.length === 0) continue;
    const runtimeId = getRuntimeCardId(general as never) || general.id;
    const { definitions } = compileGeneralSkills(general, runtimeId);
    defs.push(...definitions.filter(d => d.trigger === 'onTurnEnd'));
  }
  return defs;
}

/**
 * Every selfTurn onTurnEnd definition on `playerId`'s field, each annotated
 * with its current status. Consumed-by-ledger (本回合用过／v2.8.32 限定技本局用尽)
 * and gate-failing entries stay visible here (greyed) because 完整模式 shows the
 * whole picture; the legal set is exactly the `activatable` subset.
 */
export function listTurnEndAskItems(
  state: EngineState,
  playerId: number,
): TurnEndAskItem[] {
  const { player, list } = fieldGeneralsOf(state, playerId);
  if (!player) return [];
  const turn = state.turn ?? 0;
  const consumed = new Set(
    (state.consumedSkills ?? [])
      .filter(c => c.turn === turn && c.playerId === playerId)
      .map(c => c.stableId),
  );
  const items: TurnEndAskItem[] = [];
  const nameByRuntimeId = new Map<string, string>();
  for (const fg of list) {
    const general = fg?.general as General | undefined;
    if (!general) continue;
    const runtimeId = getRuntimeCardId(general as never) || general.id;
    nameByRuntimeId.set(runtimeId, String(general.name ?? runtimeId));
  }
  for (const definition of listAllTurnEndDefinitions(state, playerId)) {
    // otherTurn subtypes never compile (skillCompiler skips them
    // honestly); selfTurn-or-unspecified is the askable shape.
    if (definition.turnSubType === 'otherTurn') continue;
    const generalId = String(definition.sourceGeneralId ?? '');
    const alreadyUsed = consumed.has(`${turn}:${definition.id}`);
    // v2.8.32 限定技额度：同一句判据（`skillQuota.limitedQuotaAvailable`），界面
    // 与合法集合读的是同一份事实——置灰项永远不等于可发动项。
    const exhausted = !limitedQuotaAvailable(state, definition);
    // v2.7.3 threshold gate — the SAME pure predicate the trigger path calls.
    const conditionsMet = evaluateSkillConditions(definition.conditions, {
      state,
      ownerId: playerId,
      sourceGeneralId: definition.sourceGeneralId,
    });
    const activatable = !alreadyUsed && !exhausted && conditionsMet;
    items.push({
      playerId,
      generalId,
      generalName: nameByRuntimeId.get(generalId) ?? generalId,
      definition,
      activatable,
      disabledReason: disabledReasonOf(alreadyUsed, exhausted, conditionsMet, definition.conditions),
    });
  }
  return items;
}

function disabledReasonOf(
  alreadyUsed: boolean,
  exhausted: boolean,
  conditionsMet: boolean,
  conditions: DataSkillDefinition['conditions'],
): string | null {
  if (!alreadyUsed && !exhausted && conditionsMet) return null;
  // 账本优先：门槛文本描述的是"此刻战场"，而"本回合已经用过""本局已用尽"是不可逆
  // 的事实。两句按不可逆程度排：**额度先于回合**——一枚限定技刚用掉时两句话都真，
  // 说轻的那一句会把"到终局都没有"讲成"下一回合还有"（闸③复算抓到、2026-10-04 更正）。
  if (exhausted) return LIMIT_EXHAUSTED_TEXT;
  if (alreadyUsed) return '本回合已发动过';
  return `不满足发动门槛：${gateConditionsToText(conditions)}`;
}

/**
 * All activatable onTurnEnd definitions on `playerId`'s field. The ask window
 * additionally restricts to the current turn owner; candidates themselves are
 * owner-derived so other consumers (tests, editor previews) can query freely.
 * This IS the legal set — legality is state-derived, never container-derived.
 */
export function listTurnEndSkillCandidates(
  state: EngineState,
  playerId: number,
): TurnEndSkillCandidate[] {
  return listTurnEndAskItems(state, playerId)
    .filter(item => item.activatable)
    .map(({ playerId: owner, generalId, generalName, definition }) => ({
      playerId: owner,
      generalId,
      generalName,
      definition,
    }));
}

/** Resolve an ACTIVATE_SKILL payload back to a live candidate (or null). */
export function findTurnEndSkillCandidate(
  state: EngineState,
  playerId: number,
  skillId: string,
  generalId: string,
): TurnEndSkillCandidate | null {
  return listTurnEndSkillCandidates(state, playerId).find(
    c => c.definition.id === skillId && c.generalId === String(generalId),
  ) ?? null;
}

/** Is `playerId` the owner of the turn currently being played? */
export function isCurrentTurnOwner(state: EngineState, playerId: number): boolean {
  return state.currentPlayerId === playerId;
}
