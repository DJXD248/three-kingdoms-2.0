import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';

export interface SupplyActionPayload {
  generalId: string;
  consumeCards: any[];
}


export class SupplyResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'SUPPLY';
  }

  resolve(state: EngineState, action: GameAction<SupplyActionPayload>): GameEvent[] {
    const payload = action.payload;
    const player = state.players.find(p => p.id === action.playerId);
    if (!player || !payload?.generalId || !Array.isArray(payload.consumeCards)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_SUPPLY_PAYLOAD' } }];
    }

    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const target = fieldGenerals.find(fg => getRuntimeCardId(fg?.general as any) === String(payload.generalId));
    if (!target) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'SUPPLY_TARGET_NOT_FOUND' } }];
    }
    if (Number(target?.ownerId ?? player.id) !== action.playerId) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'SUPPLY_TARGET_NOT_CONTROLLED' } }];
    }
    if (target?.alive === false) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'SUPPLY_TARGET_DEAD' } }];
    }
    if (target?.hasSupplied === true) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_ALREADY_SUPPLIED' } }];
    }

    const currentHp = Number(target?.currentHp ?? 0);
    const maxHp = Number(target?.maxHp ?? target?.general?.hp ?? 0);
    const missingHp = Math.max(0, maxHp - currentHp);
    if (missingHp <= 0) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_ALREADY_FULL_HP' } }];
    }

    const hand = Array.isArray(player.hand) ? player.hand as any[] : [];
    const handIds = new Set(hand.map(card => getRuntimeCardId(card as any)));
    const consumeIds = payload.consumeCards.map(card => getRuntimeCardId(card as any));

    if (payload.consumeCards.length === 0) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'SUPPLY_REQUIRES_CARD_COST' } }];
    }
    if (consumeIds.some(id => !id || !handIds.has(id))) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'SUPPLY_COST_CARD_NOT_IN_HAND' } }];
    }
    if (new Set(consumeIds).size !== consumeIds.length) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'DUPLICATE_CONSUMED_CARD' } }];
    }

    const inEnemyTerritory = target?.position?.zone !== 'battle'
      && target?.position?.areaOwnerId !== null
      && target?.position?.areaOwnerId !== undefined
      && Number(target.position.areaOwnerId) !== action.playerId;
    const extraCost = inEnemyTerritory ? 1 : 0;
    const requestedCount = payload.consumeCards.length;
    const healAmount = Math.min(Math.max(0, requestedCount - extraCost), missingHp);
    if (healAmount <= 0) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INSUFFICIENT_SUPPLY_COST' } }];
    }

    // Never consume cards beyond what can actually restore HP, while preserving
    // the extra enemy-territory cost when applicable.
    const consumeCount = Math.min(requestedCount, healAmount + extraCost);
    const consumedCards = payload.consumeCards.slice(0, consumeCount);

    return [{
      type: 'SUPPLY_RESOLVED',
      data: {
        action,
        playerId: action.playerId,
        generalId: payload.generalId,
        healAmount,
        extraCost,
        consumedCards,
        inEnemyTerritory,
      },
    }];
  }
}
