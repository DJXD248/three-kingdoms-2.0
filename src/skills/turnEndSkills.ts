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
import type { DataSkillDefinition } from './dataTypes';

export interface TurnEndSkillCandidate {
  playerId: number;
  /** Runtime card-instance id of the owning general (ACTIVATE_SKILL payload). */
  generalId: string;
  generalName: string;
  /** Compiled definition — id doubles as the ACTIVATE_SKILL payload.skillId. */
  definition: DataSkillDefinition;
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
 * All un-consumed onTurnEnd definitions on `playerId`'s field. The ask window
 * additionally restricts to the current turn owner; candidates themselves are
 * owner-derived so other consumers (tests, editor previews) can query freely.
 */
export function listTurnEndSkillCandidates(
  state: EngineState,
  playerId: number,
): TurnEndSkillCandidate[] {
  const { player, list } = fieldGeneralsOf(state, playerId);
  if (!player) return [];
  const turn = state.turn ?? 0;
  const consumed = new Set(
    (state.consumedSkills ?? [])
      .filter(c => c.turn === turn && c.playerId === playerId)
      .map(c => c.stableId),
  );
  const candidates: TurnEndSkillCandidate[] = [];
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
    if (consumed.has(`${turn}:${definition.id}`)) continue;
    const generalId = String(definition.sourceGeneralId ?? '');
    candidates.push({
      playerId,
      generalId,
      generalName: nameByRuntimeId.get(generalId) ?? generalId,
      definition,
    });
  }
  return candidates;
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
