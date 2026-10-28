import type { ConsumedSkill, EngineState } from '../GameState';
import type { GameEvent, SkillActivationEventData } from '../Event';

/**
 * SKILL_ACTIVATED settlement (2.3.1): the once-per-turn bookkeeping of an
 * explicitly activated skill is an A-class game fact, so it lives HERE (the
 * only state-mutation entry) and in EngineState — never in a container
 * field. The ledger is append-only keyed by `<turn>:<skillId>`, which makes
 * it correct under resident/rebuild/replay alike with no TURN_START reset:
 * tomorrow's turn number is tomorrow's key.
 *
 * v2.8.32：带「一局一次」额度的定义同时把 `limitKey` 落进同一笔账——这一列才是
 * 额度唯一的依据（跨回合查同一枚技能用没用过）。不带额度的定义不带这一键，
 * 于是既有账本的每一条逐字不变。
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
    ...(data.limitKey ? { limitKey: data.limitKey } : {}),
    // 限次刀：每回合额度的那一笔同样只增不删——键里带窗口戳，所以"下一回合还回次数"
    // 是新键生效、旧键自然不再被数到（全库没有任何回退入口＝裁决③"被无效不退"
    // 与裁决④"没发动成功不消耗"在这一版结构上同时成立）。不带这一键的既有每一笔逐字不变。
    ...(data.turnQuotaKey ? { turnQuotaKey: data.turnQuotaKey } : {}),
  };
  return { ...state, consumedSkills: [...existing, entry] };
}
