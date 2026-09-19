import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';

export interface DeployGeneralActionPayload {
  general: {
    id: string;
    name: string;
    faction: string;
    hp: number;
    meleeAtk?: number;
    rangedAtk?: number;
    armor?: number;
    skills?: string[];
    [key: string]: unknown;
  };
  slot: number;
  consumeCards: unknown[];
}

/**
 * Resolves deployment into a canonical GENERAL_DEPLOYED event.
 * The EventProcessor owns all state mutation.
 */
export class DeployGeneralResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'DEPLOY_GENERAL';
  }

  resolve(state: EngineState, action: GameAction<DeployGeneralActionPayload>): GameEvent[] {
    const player = state.players.find(p => p.id === action.playerId);
    const payload = action.payload;
    if (!player || !payload?.general || !Array.isArray(payload.consumeCards)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_DEPLOY_PAYLOAD' } }];
    }

    const general = payload.general;
    const consumeCards = payload.consumeCards;
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals : [];
    const hand = Array.isArray(player.hand) ? player.hand : [];
    const pool = Array.isArray(player.generalPool) ? player.generalPool : [];

    const handIds = new Set(hand.map(card => getRuntimeCardId(card as any)));
    const poolIds = new Set(pool.map(card => getRuntimeCardId(card as any)));
    const selectedGeneralRuntimeId = getRuntimeCardId(general as any);
    const consumedIds = consumeCards.map(card => getRuntimeCardId(card as any));

    if (!handIds.has(selectedGeneralRuntimeId)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_NOT_IN_HAND' } }];
    }
    if (poolIds.has(selectedGeneralRuntimeId)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_ALREADY_IN_POOL' } }];
    }
    if (fieldGenerals.some((fg: any) => getRuntimeCardId(fg?.general) === selectedGeneralRuntimeId)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_ALREADY_DEPLOYED' } }];
    }
    if (!Number.isInteger(payload.slot) || payload.slot < 0 || payload.slot > 2) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_CAMP_SLOT' } }];
    }
    if (fieldGenerals.some((fg: any) => fg?.position?.zone === 'camp' && fg?.position?.areaOwnerId === action.playerId && fg?.position?.slot === payload.slot)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'CAMP_SLOT_OCCUPIED' } }];
    }
    if (consumeCards.length < 1 || consumeCards.length > Number(general.hp)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_DEPLOY_COST' } }];
    }
    const duplicateConsumedIds = consumedIds.filter((id, i) => id && consumedIds.indexOf(id) !== i);
    if (duplicateConsumedIds.length > 0) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'DUPLICATE_CONSUMED_CARD' } }];
    }
    if (consumeCards.some(card => {
      const id = getRuntimeCardId(card as any);
      return !handIds.has(id);
    })) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'CONSUMED_CARD_NOT_IN_HAND' } }];
    }
    if (consumedIds.includes(selectedGeneralRuntimeId)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_CANNOT_CONSUME_SELF' } }];
    }

    return [{
      type: 'GENERAL_DEPLOYED',
      data: {
        playerId: action.playerId,
        general,
        slot: payload.slot,
        consumeCards,
      },
    }];
  }
}
