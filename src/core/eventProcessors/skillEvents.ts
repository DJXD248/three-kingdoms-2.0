import type { ConsumedSkill, EngineState } from '../GameState';
import type { GameEvent, SkillActivationEventData } from '../Event';

/**
 * SKILL_ACTIVATED settlement (2.3.1): the once-per-turn bookkeeping of an
 * explicitly activated skill is an A-class game fact, so it lives HERE (the
 * only state-mutation entry) and in EngineState — never in a container
 * field. The ledger is append-only keyed by `<turn>:<skillId>`, which makes
 * it correct under resident/rebuild/replay alike with no TURN_START reset:
 * tomorrow's turn number is tomorrow's key.
 */
export function applySkillActivatedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as SkillActivationEventData | undefined;
  const stableId = data?.stableId;
  if (!stableId || !data?.skillId) return state;
  const existing = state.consumedSkills ?? [];
  if (existing.some(entry => entry.stableId === stableId)) return state;
  const turn = Number(stableId.split(':')[0]);
  const entry: ConsumedSkill = {
    stableId,
    skillId: data.skillId,
    turn: Number.isFinite(turn) ? turn : state.turn,
    playerId: Number(data.playerId),
  };
  return { ...state, consumedSkills: [...existing, entry] };
}
