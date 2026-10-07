import type { FieldGeneral, Player, Position } from '../store/gameStore';
import type { StatModifier } from '../core/statModifiers';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { basePosition, canReach, effectiveAttackRange, reachReference } from '../core/attackReach';

function allGeneralsAt(players: Player[], zone: Position['zone'], areaOwnerId: number | null) {
  return players.flatMap(player => player.fieldGenerals)
    .filter(fg => fg.position.zone === zone && fg.position.areaOwnerId === areaOwnerId);
}

function frontController(players: Player[], areaOwnerId: number): number | null {
  const generals = allGeneralsAt(players, 'front', areaOwnerId);
  return generals.length > 0 ? generals[0].ownerId : null;
}

export function findAvailableSlot(
  zone: Position['zone'],
  areaOwnerId: number | null,
  preferSlot: number,
  players: Player[],
): number | null {
  const occupied = new Set(allGeneralsAt(players, zone, areaOwnerId).map(fg => fg.position.slot));
  if (zone === 'battle') {
    const total = players.length;
    if (preferSlot < total && !occupied.has(preferSlot)) return preferSlot;
    for (let slot = 0; slot < total; slot += 1) {
      if (!occupied.has(slot)) return slot;
    }
    return null;
  }

  const candidates = zone === 'camp' ? [0, 2] : [0, 1, 2];
  if (candidates.includes(preferSlot) && !occupied.has(preferSlot)) return preferSlot;
  for (const slot of candidates) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

export function getMoveTargets(fg: FieldGeneral, players: Player[]): Position[] {
  const { ownerId, position } = fg;

  if (position.zone === 'camp') {
    const areaId = position.areaOwnerId ?? ownerId;
    const controller = frontController(players, areaId);
    if (controller !== null && controller !== ownerId) return [];
    const slot = findAvailableSlot('front', areaId, position.slot, players);
    return slot !== null ? [{ zone: 'front', slot, areaOwnerId: areaId }] : [];
  }

  if (position.zone === 'front') {
    if (position.areaOwnerId === ownerId) {
      const slot = findAvailableSlot('battle', null, position.slot, players);
      return slot !== null ? [{ zone: 'battle', slot, areaOwnerId: null }] : [];
    }

    const areaId = position.areaOwnerId;
    if (areaId === null) return [];
    const slot = findAvailableSlot('camp', areaId, position.slot, players);
    return slot !== null ? [{ zone: 'camp', slot, areaOwnerId: areaId }] : [];
  }

  if (position.zone === 'battle') {
    const results: Position[] = [];
    for (const player of players) {
      if (player.id === ownerId || !player.isAlive) continue;
      const controller = frontController(players, player.id);
      if (controller !== null && controller !== ownerId) continue;
      const slot = findAvailableSlot('front', player.id, position.slot, players);
      if (slot !== null) results.push({ zone: 'front', slot, areaOwnerId: player.id });
    }
    return results;
  }

  return [];
}

export function canFieldGeneralMove(fg: FieldGeneral, players: Player[]): boolean {
  return getMoveTargets(fg, players).length > 0;
}

export function getAutoMoveTarget(fg: FieldGeneral, players: Player[]): Position | null {
  return getMoveTargets(fg, players)[0] ?? null;
}

export function hasFreeCampSlot(playerId: number, players: Player[]): boolean {
  const occupied = allGeneralsAt(players, 'camp', playerId).map(fg => fg.position.slot);
  return ![0, 2].every(slot => occupied.includes(slot));
}

export function isInEnemyTerritory(fg: FieldGeneral): boolean {
  const { ownerId, position } = fg;
  if (position.zone === 'battle') return false;
  return position.areaOwnerId !== null && position.areaOwnerId !== ownerId;
}

export interface AttackTarget {
  type: 'general' | 'base';
  id: string;
  playerId: number;
}

/**
 * 界面上那份"能打谁"的名单（v2.9.0 射程刀＝它不再是第二张距离表）。
 *
 * 两条硬边界，都是这一格出过的事故：
 *  ① **够不够得着一律问 `core/attackReach.ts`**，连同射程读数。这一档原先自己抄了
 *    一份"谁够得着谁"的表，与引擎那份同果但**没有测试规定它们必须同果**；射程一可变，
 *    界面就会列出引擎注定拒的目标（v2.8.40 判据 §12-111⑩ 的反方向实例）。
 *  ② **自家席位一员都不列**。旧写法只排除"出手的这一员自己"，于是同队的队友照样进名单，
 *    点上去就是一笔被引擎当场拒掉的攻击（界面还把她们标成黄色＝"能打的自己人"）。
 *    引擎那一侧一直拒着同席目标（`INVALID_ATTACK_TARGET`），所以这次是**名单向引擎对齐**，
 *    不是新增一条规则。
 *
 * 名单不再收 `attackerPlayerId` 参数：出手者的席位只能从这一员将自己身上读
 * （`ownerId`）。查看敌方将领详情时旧调用点传的是"看的人"，那算出来的射程是错的。
 */
export function getValidTargets(
  attacker: FieldGeneral,
  players: Player[],
  ranged: boolean,
  ledger?: readonly StatModifier[],
): AttackTarget[] {
  const targets: AttackTarget[] = [];
  const seat = attacker.ownerId;
  const reference = reachReference(attacker);
  const maxRange = effectiveAttackRange(ledger, {
    playerId: seat,
    generalId: String(getRuntimeCardId(attacker.general as any) ?? ''),
  });

  for (const player of players) {
    if (!player.isAlive || player.id === seat) continue;

    for (const fieldGeneral of player.fieldGenerals) {
      if (getRuntimeCardId(fieldGeneral.general as any) === getRuntimeCardId(attacker.general as any)) continue;
      if (canReach(reference, attacker.position, fieldGeneral.position, ranged, maxRange)) {
        targets.push({ type: 'general', id: getRuntimeCardId(fieldGeneral.general as any), playerId: player.id });
      }
    }

    if (canReach(reference, attacker.position, basePosition(player.id), ranged, maxRange)) {
      targets.push({ type: 'base', id: `base_${player.id}`, playerId: player.id });
    }
  }

  return targets;
}
