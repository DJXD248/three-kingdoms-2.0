/**
 * Canonical action types for the game engine.
 * All local, AI, hotseat and future network inputs use this model.
 */
export type ActionType =
  | 'DRAW'
  | 'DEPLOY_GENERAL'
  | 'MOVE_GENERAL'
  | 'ATTACK'
  | 'SUPPLY'
  | 'EQUIP_ARMOR'
  | 'END_TURN'
  | 'CONFIRM_DRAW'
  | 'BEGIN_DRAW'
  | 'RESOLVE_BASE_LOSS'
  | 'ACTIVATE_SKILL'
  | 'CHOOSE_OPTION'
  // v2.8.22 响应链执法刀（#71）：响应链问答的"这一格我不响应"。§12-75① 的口径
  // 是"一个也不做的正身能由既有动作代记就绝不另立 ActionType"——回合结束那格
  // 由那次 END_TURN 代记，响应链这一格没有任何既有动作能代记，所以必须自己一条。
  | 'SKIP_REACTION'
  | 'SURRENDER';

export interface ChooseOptionPayload {
  choiceKey: string;
  optionIndex: number;
}

/** SKIP_REACTION 的载荷：只点名"哪一格的表态我交了白卷"，表态单位（哪一员将
 *  领）由当前问句从状态里现算，绝不从载荷里信它。 */
export interface SkipReactionPayload {
  nodeKey: string;
}

export interface GameAction<T = unknown> {
  id: string;
  type: ActionType;
  playerId: number;
  payload?: T;
}

// D-2 second cut (2.2.19): action.id only has to be unique within the process
// (SnapshotRecord.actionId association, network packet ids — nothing looks
// actions up by id), so it is a plain counter. No clock, no entropy: creating
// an action can never perturb a seeded stream or make a replay diverge.
let actionSerial = 0;

export function createAction<T = unknown>(
  type: ActionType,
  playerId: number,
  payload?: T,
): GameAction<T> {
  actionSerial += 1;
  return {
    id: `action_${actionSerial}`,
    type,
    playerId,
    ...(payload === undefined ? {} : { payload }),
  };
}
