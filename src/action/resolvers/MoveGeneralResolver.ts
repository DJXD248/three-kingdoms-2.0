import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';

interface LegacyPosition {
  zone: 'camp' | 'front' | 'battle';
  slot: number;
  areaOwnerId: number | null;
}

interface MovePayload {
  generalId: string;
  target: LegacyPosition;
  consumeCard?: any;
}

function allFieldGenerals(state: EngineState) {
  return state.players.flatMap(player =>
    (Array.isArray(player.fieldGenerals) ? player.fieldGenerals : []) as any[],
  );
}

function fieldGeneralsAt(state: EngineState, zone: LegacyPosition['zone'], areaOwnerId: number | null) {
  return allFieldGenerals(state).filter(fg =>
    fg?.position?.zone === zone && fg?.position?.areaOwnerId === areaOwnerId,
  );
}

function frontController(state: EngineState, areaOwnerId: number): number | null {
  const front = fieldGeneralsAt(state, 'front', areaOwnerId);
  return front.length > 0 ? Number(front[0]?.ownerId) : null;
}

function findAvailableSlot(
  state: EngineState,
  zone: LegacyPosition['zone'],
  areaOwnerId: number | null,
  preferredSlot: number,
): number | null {
  const occupied = new Set(
    fieldGeneralsAt(state, zone, areaOwnerId).map(fg => Number(fg?.position?.slot)),
  );

  if (zone === 'battle') {
    const capacity = state.players.length;
    if (preferredSlot >= 0 && preferredSlot < capacity && !occupied.has(preferredSlot)) return preferredSlot;
    for (let slot = 0; slot < capacity; slot += 1) {
      if (!occupied.has(slot)) return slot;
    }
    return null;
  }

  const candidates = zone === 'camp' ? [0, 2] : [0, 1, 2];
  if (candidates.includes(preferredSlot) && !occupied.has(preferredSlot)) return preferredSlot;
  for (const slot of candidates) if (!occupied.has(slot)) return slot;
  return null;
}

function getMoveTargets(state: EngineState, fg: any, ownerId: number): LegacyPosition[] {
  const position = fg?.position as LegacyPosition | undefined;
  if (!position) return [];

  if (position.zone === 'camp') {
    const areaId = position.areaOwnerId ?? ownerId;
    const controller = frontController(state, areaId);
    if (controller !== null && controller !== ownerId) return [];
    const slot = findAvailableSlot(state, 'front', areaId, position.slot);
    return slot === null ? [] : [{ zone: 'front', slot, areaOwnerId: areaId }];
  }

  if (position.zone === 'front') {
    if (position.areaOwnerId === ownerId) {
      const slot = findAvailableSlot(state, 'battle', null, position.slot);
      return slot === null ? [] : [{ zone: 'battle', slot, areaOwnerId: null }];
    }

    const areaId = position.areaOwnerId;
    if (areaId === null) return [];
    const slot = findAvailableSlot(state, 'camp', areaId, position.slot);
    return slot === null ? [] : [{ zone: 'camp', slot, areaOwnerId: areaId }];
  }

  if (position.zone === 'battle') {
    const results: LegacyPosition[] = [];
    for (const player of state.players) {
      if (player.id === ownerId || player.isAlive === false) continue;
      const controller = frontController(state, player.id);
      if (controller !== null && controller !== ownerId) continue;
      const slot = findAvailableSlot(state, 'front', player.id, position.slot);
      if (slot !== null) results.push({ zone: 'front', slot, areaOwnerId: player.id });
    }
    return results;
  }

  return [];
}

function samePosition(a: LegacyPosition, b: LegacyPosition) {
  return a.zone === b.zone && a.slot === b.slot && a.areaOwnerId === b.areaOwnerId;
}

function isScholar(general: any) {
  return general?.type === '文将' || general?.generalType === 'SCHOLAR';
}

export class MoveGeneralResolver implements ActionResolver {
  canResolve(action: GameAction): boolean { return action.type === 'MOVE_GENERAL'; }

  resolve(state: EngineState, action: GameAction<MovePayload>): GameEvent[] {
    const player = state.players.find(p => p.id === action.playerId);
    const payload = action.payload;

    if (!player || !payload?.generalId || !payload.target) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_MOVE_PAYLOAD' } }];
    }

    const fieldGenerals = (Array.isArray(player.fieldGenerals) ? player.fieldGenerals : []) as any[];
    const general = fieldGenerals.find(fg => getRuntimeCardId(fg?.general as any) === String(payload.generalId));
    if (!general) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_NOT_ON_FIELD' } }];
    }

    // 整备＝本回合不能移动也不能攻击（v2.8.40 把这把闸补到引擎侧：此前只有界面拦住，
    // 直发一条 MOVE_GENERAL 就能带着整备走一格）。拒因复用既有词表 `GENERAL_IS_ARMING`
    // （`core/attackBlow.ts` 攻击那一路用的是同一个词）。判定位置排在"本回合已移动"之前＝
    // 与界面 `movReason` 的优先级逐字同序（GameBoard.tsx:741 先读整备、再读已移动）。
    if (general.isArming) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_IS_ARMING' } }];
    }

    if (general.hasMoved) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_ALREADY_MOVED' } }];
    }

    const targets = getMoveTargets(state, general, action.playerId);
    if (!targets.some(target => samePosition(target, payload.target))) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_MOVE_TARGET' } }];
    }

    const consumeCard = payload.consumeCard;
    const requiresCost = isScholar(general.general);
    const hand = Array.isArray(player.hand) ? player.hand as any[] : [];

    if (requiresCost && !consumeCard) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'SCHOLAR_REQUIRES_MOVE_COST' } }];
    }

    if (!requiresCost && consumeCard) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'WARRIOR_MOVE_HAS_NO_COST' } }];
    }

    if (consumeCard) {
      const consumeId = getRuntimeCardId(consumeCard as any);
      if (!consumeId || !hand.some(card => getRuntimeCardId(card as any) === consumeId)) {
        return [{ type: 'ACTION_REJECTED', data: { action, reason: 'MOVE_COST_CARD_NOT_IN_HAND' } }];
      }
    }

    return [{
      type: 'GENERAL_MOVED',
      data: {
        playerId: action.playerId,
        generalId: payload.generalId,
        target: payload.target,
        consumeCard: consumeCard ?? null,
      },
    }];
  }
}
