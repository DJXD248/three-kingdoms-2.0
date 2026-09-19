import type { FieldGeneral, Player, Position } from '../store/gameStore';
import { getRuntimeCardId } from '../utils/runtimeIdentity';

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

export function getValidTargets(
  attacker: FieldGeneral,
  attackerPlayerId: number,
  players: Player[],
  ranged: boolean,
): AttackTarget[] {
  const targets: AttackTarget[] = [];
  const { zone, areaOwnerId } = attacker.position;

  for (const player of players) {
    if (!player.isAlive) continue;

    for (const fieldGeneral of player.fieldGenerals) {
      if (getRuntimeCardId(fieldGeneral.general as any) === getRuntimeCardId(attacker.general as any)) continue;

      const targetZone = fieldGeneral.position.zone;
      const targetAreaOwnerId = fieldGeneral.position.areaOwnerId;
      let valid = false;

      if (ranged) {
        if (zone === 'camp' && targetZone === 'battle') valid = true;
        if (zone === 'front' && targetZone === 'front' && targetAreaOwnerId !== areaOwnerId) valid = true;
        if (zone === 'battle' && targetZone === 'camp') valid = true;
      } else {
        if (zone === targetZone && targetAreaOwnerId === areaOwnerId) valid = true;
        if (zone === 'camp' && targetZone === 'front' && targetAreaOwnerId === areaOwnerId) valid = true;
        if (zone === 'front' && targetZone === 'battle') valid = true;
        if (zone === 'battle' && targetZone === 'front') valid = true;
        if (zone === 'front' && targetZone === 'camp' && targetAreaOwnerId === areaOwnerId) valid = true;
      }

      if (valid) {
        targets.push({ type: 'general', id: getRuntimeCardId(fieldGeneral.general as any), playerId: player.id });
      }
    }

    if (player.id === attackerPlayerId) continue;
    if (ranged) {
      if (zone === 'battle') targets.push({ type: 'base', id: `base_${player.id}`, playerId: player.id });
    } else if (
      (zone === 'front' || zone === 'camp') &&
      areaOwnerId === player.id
    ) {
      // Melee can hit the enemy base from its front or its camp.
      targets.push({ type: 'base', id: `base_${player.id}`, playerId: player.id });
    }
  }

  return targets;
}
