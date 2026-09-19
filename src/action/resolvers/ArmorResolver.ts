import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';

export interface ArmorActionPayload {
  generalId: string;
  armorCards: unknown[];
}

const ARMOR_TYPES = new Set(['军备', 'ARMAMENT']);

export class ArmorResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'EQUIP_ARMOR';
  }

  resolve(state: EngineState, action: GameAction<ArmorActionPayload>): GameEvent[] {
    const player = state.players.find(p => p.id === action.playerId);
    const payload = action.payload;
    if (!player || !payload?.generalId || !Array.isArray(payload.armorCards)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_ARMOR_PAYLOAD' } }];
    }

    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const target = fieldGenerals.find(fg => getRuntimeCardId(fg?.general as any) === String(payload.generalId));
    if (!target) return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_NOT_ON_FIELD' } }];
    if (Number(target.ownerId) !== Number(action.playerId)) return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_NOT_CONTROLLED' } }];
    if (target.isArming) return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_ALREADY_ARMING' } }];
    if (Number(target.currentHp ?? 0) <= 0) return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_DEFEATED' } }];

    const hand = Array.isArray(player.hand) ? player.hand as any[] : [];
    const selected = payload.armorCards;
    if (selected.length === 0) return [{ type: 'ACTION_REJECTED', data: { action, reason: 'NO_ARMOR_SELECTED' } }];

    const ids = selected.map(card => getRuntimeCardId(card as any));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'DUPLICATE_OR_INVALID_ARMOR_CARD' } }];
    }
    if (selected.some(card => !ARMOR_TYPES.has(String((card as any)?.type ?? '')))) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'NON_ARMAMENT_CARD_SELECTED' } }];
    }

    const handById = new Map(hand.map(card => [getRuntimeCardId(card as any), card]));
    if (ids.some(id => !handById.has(id))) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'ARMOR_CARD_NOT_IN_HAND' } }];
    }

    const currentArmor = Math.max(0, Number(target.currentArmor ?? 0));
    const maxArmor = Math.max(0, Number(target.maxHp ?? target.general?.hp ?? 0));
    const capacity = Math.max(0, maxArmor - currentArmor);
    if (selected.length > capacity) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'ARMOR_CAPACITY_EXCEEDED', capacity } }];
    }

    const armorCards = ids.map(id => handById.get(id)!);
    return [{
      type: 'ARMOR_EQUIPPED',
      data: {
        playerId: action.playerId,
        generalId: payload.generalId,
        armorCards,
        armorAdded: armorCards.length,
        newArmor: currentArmor + armorCards.length,
        isArming: true,
      },
    }];
  }
}
