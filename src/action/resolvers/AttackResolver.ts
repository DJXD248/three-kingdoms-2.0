import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';
import { applyArmorDamage } from '../../core/armorDamage';
import { capDamageToBase } from '../../core/baseDamage';
import { resolveDamageTaken } from '../../core/damageTaken';
import { getAttackValue } from '../../core/attackValue';

interface Position {
  zone: 'camp' | 'front' | 'battle';
  slot: number;
  areaOwnerId: number | null;
}

interface AttackPayload {
  attackerId: string;
  targetId: string;
  ranged: boolean;
  consumeCard?: any | null;
}

function findFieldGeneral(state: EngineState, generalId: string) {
  for (const player of state.players) {
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const found = fieldGenerals.find(fg => getRuntimeCardId(fg?.general as any) === String(generalId));
    if (found) return { player, general: found as any };
  }
  return null;
}


function sameArea(a: Position, b: Position) {
  return a.zone === b.zone && a.areaOwnerId === b.areaOwnerId;
}

function isAttackInRange(attacker: any, target: any, ranged: boolean) {
  const a = attacker?.position as Position | undefined;
  const t = target?.position as Position | undefined;
  if (!a || !t) return false;

  if (ranged) {
    if (a.zone === 'camp') return t.zone === 'battle';
    if (a.zone === 'front') return t.zone === 'front' && t.areaOwnerId !== a.areaOwnerId;
    if (a.zone === 'battle') return t.zone === 'camp';
    return false;
  }

  if (sameArea(a, t)) return true;
  if (a.zone === 'camp' && t.zone === 'front' && t.areaOwnerId === a.areaOwnerId) return true;
  if (a.zone === 'front' && t.zone === 'battle') return true;
  if (a.zone === 'battle' && t.zone === 'front') return true;
  if (a.zone === 'front' && t.zone === 'camp' && t.areaOwnerId === a.areaOwnerId) return true;
  return false;
}

function canTargetBase(attacker: any, targetPlayerId: number, attackerPlayerId: number, ranged: boolean) {
  const p = attacker?.position as Position | undefined;
  if (!p || targetPlayerId === attackerPlayerId) return false;
  if (ranged) return p.zone === 'battle';
  // Melee can hit the enemy base from its front or its camp.
  return (p.zone === 'front' || p.zone === 'camp') && p.areaOwnerId === targetPlayerId;
}

// Both halves of the attack damage math now live in the core layer as the
// single canonical implementations, shared with skill damage settlement and
// the duel flow: applyArmorDamage (core/armorDamage.ts) and getAttackValue
// (core/attackValue.ts).

export class AttackResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'ATTACK';
  }

  resolve(state: EngineState, action: GameAction<AttackPayload>): GameEvent[] {
    const payload = action.payload;
    if (!payload?.attackerId || !payload.targetId || typeof payload.ranged !== 'boolean') {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_ATTACK_PAYLOAD' } }];
    }

    const attackerResult = findFieldGeneral(state, payload.attackerId);
    if (!attackerResult || attackerResult.player.id !== action.playerId) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'ATTACKER_NOT_CONTROLLED' } }];
    }

    const attacker = attackerResult.general;
    if (attacker.isArming) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_IS_ARMING' } }];
    }
    if (attacker.hasAttacked) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'GENERAL_ALREADY_ATTACKED' } }];
    }

    const hand = Array.isArray(attackerResult.player.hand) ? attackerResult.player.hand as any[] : [];
    if (!payload.consumeCard) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'ATTACK_REQUIRES_CARD_COST' } }];
    }
    const consumeId = getRuntimeCardId(payload.consumeCard as any);
    const consumedCard = hand.find(card => getRuntimeCardId(card as any) === consumeId);
    if (!consumeId || !consumedCard) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'ATTACK_COST_CARD_NOT_IN_HAND' } }];
    }

    const baseDamage = getAttackValue(attacker, payload.ranged, {
      ledger: state.statModifiers,
      target: { playerId: action.playerId, generalId: String(payload.attackerId) },
    });
    const targetBaseMatch = /^base_(\d+)$/.exec(String(payload.targetId));
    if (targetBaseMatch) {
      const targetPlayerId = Number(targetBaseMatch[1]);
      const targetPlayer = state.players.find(player => player.id === targetPlayerId);
      if (!targetPlayer || targetPlayer.isAlive === false || !canTargetBase(attacker, targetPlayerId, action.playerId, payload.ranged)) {
        return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_ATTACK_TARGET' } }];
      }

      // 本营单次最多 1 点＝发射点的规则常量（`core/baseDamage.ts`），技能伤害那条
      // 发射路（`SkillTriggerBridge`）取的是同一个数。
      const damage = capDamageToBase(baseDamage);
      return [
        {
          type: 'BEFORE_DAMAGE',
          data: {
            action,
            attackerId: payload.attackerId,
            targetId: payload.targetId,
            ranged: payload.ranged,
            baseDamage,
          },
        },
        {
          type: 'DAMAGE',
          data: {
            sourcePlayerId: action.playerId,
            sourceGeneralId: payload.attackerId,
            targetPlayerId,
            target: payload.targetId,
            targetId: payload.targetId,
            damageType: 'attack',
            value: damage,
            hpLost: damage,
            armorLost: 0,
            consumeCard: consumedCard,
            attackerId: payload.attackerId,
            ranged: payload.ranged,
            isBase: true,
          },
        },
        { type: 'ATTACK_RESOLVED', data: { action, attackerId: payload.attackerId, targetId: payload.targetId, ranged: payload.ranged, damage } },
        { type: 'AFTER_DAMAGE', data: { action, targetId: payload.targetId, value: damage } },
      ];
    }

    const targetResult = findFieldGeneral(state, payload.targetId);
    if (!targetResult || targetResult.player.id === action.playerId || targetResult.player.isAlive === false) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'INVALID_ATTACK_TARGET' } }];
    }
    if (getRuntimeCardId(targetResult.general?.general as any) === String(payload.attackerId)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'CANNOT_ATTACK_SELF' } }];
    }
    if (!isAttackInRange(attacker, targetResult.general, payload.ranged)) {
      return [{ type: 'ACTION_REJECTED', data: { action, reason: 'TARGET_OUT_OF_RANGE' } }];
    }

    // 2.8 刀5：护甲**之前**先过"受到的伤害"那一格（`core/damageTaken.ts`＝唯一算术）。
    // 账本为空时它逐字返回原数⇒今日所有对局的事件流与接线前逐字相同。
    const taken = resolveDamageTaken(
      state.statModifiers,
      { playerId: targetResult.player.id, generalId: String(payload.targetId) },
      baseDamage,
    );
    const armorResult = applyArmorDamage(
      Number(targetResult.general.currentHp ?? 0),
      Number(targetResult.general.currentArmor ?? 0),
      taken.damage,
    );
    const defeated = armorResult.hp <= 0;
    const attachedArmor = Array.isArray(targetResult.general.armorCards)
      ? targetResult.general.armorCards as any[]
      : [];
    const destroyedArmorCardIds = attachedArmor
      .slice(0, armorResult.armorLost)
      .map(card => getRuntimeCardId(card as any))
      .filter(Boolean);

    const events: GameEvent[] = [
      {
        type: 'BEFORE_DAMAGE',
        data: {
          action,
          attackerId: payload.attackerId,
          targetId: payload.targetId,
          ranged: payload.ranged,
          baseDamage,
          targetPlayerId: targetResult.player.id,
        },
      },
      {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: action.playerId,
          sourceGeneralId: payload.attackerId,
          targetPlayerId: targetResult.player.id,
          target: payload.targetId,
          targetId: payload.targetId,
          damageType: 'attack',
          value: baseDamage,
          // 护甲之前那一格的读数（账本为空时＝`value`）：显示层/探针用它，算术不回头读它。
          damageTaken: taken.damage,
          hpLost: armorResult.hpLost,
          armorLost: armorResult.armorLost,
          actualDamage: armorResult.actualDamage,
          newHp: armorResult.hp,
          newArmor: armorResult.armor,
          destroyedArmorCardIds,
          consumeCard: consumedCard,
          attackerId: payload.attackerId,
          ranged: payload.ranged,
          defeated,
        },
      },
    ];

    // 一次性「受到的伤害」账被这一刀用掉了⇒当场销账（canonical `STAT_MODIFY`，与在场
    // 落笔／生命周期收账同一个入口；DAMAGE 处理器自己不碰账本）。位置紧跟这一"刀"，
    // 因为决斗那一整块要逐轮线程同一本账——销账晚一轮＝同一笔账用两次。
    if (taken.consumedIds.length > 0) {
      events.push({
        type: 'STAT_MODIFY',
        data: { op: 'REMOVE', ids: taken.consumedIds, cause: 'DAMAGE_TAKEN' },
      });
    }

    if (defeated) {
      events.push({
        type: 'DEATH',
        data: {
          targetPlayerId: targetResult.player.id,
          targetId: payload.targetId,
          attackerPlayerId: action.playerId,
          attackerId: payload.attackerId,
        },
      });
    }

    events.push({ type: 'ATTACK_RESOLVED', data: { action, attackerId: payload.attackerId, targetId: payload.targetId, ranged: payload.ranged, damage: armorResult.hpLost + armorResult.armorLost, defeated } });
    events.push({ type: 'AFTER_DAMAGE', data: { action, targetId: payload.targetId, value: baseDamage } });
    return events;
  }
}
