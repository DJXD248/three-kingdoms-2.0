import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';

const RESOURCE_TYPES = new Set(['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT']);

export function applyGeneralDeployedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    playerId?: number;
    general?: any;
    slot?: number;
    consumeCards?: unknown[];
  } | undefined;
  if (typeof data?.playerId !== 'number' || !data.general || !Array.isArray(data.consumeCards)) return state;
  const consumeCards = data.consumeCards;

  const consumeIds = new Set(consumeCards.map(card => getRuntimeCardId(card as any)));
  const deployedGeneralRuntimeId = getRuntimeCardId(data.general);

  const players = state.players.map(player => {
    if (player.id !== data.playerId) return player;
    const hand = Array.isArray(player.hand) ? player.hand : [];
    const generalPool = Array.isArray(player.generalPool) ? player.generalPool : [];
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals : [];

    const remainingHand = hand.filter(card => {
      const id = getRuntimeCardId(card as any);
      return id !== deployedGeneralRuntimeId && !consumeIds.has(id);
    });

    const consumedGenerals = consumeCards.filter(card => {
      const type = card && typeof card === 'object' && 'type' in card ? String((card as any).type) : '';
      return !['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT'].includes(type);
    });

    const nextGeneralPool = [...generalPool, ...consumedGenerals];
    const general = data.general;
    const currentHp = consumeCards.length;
    const fieldGeneral = {
      general,
      currentHp,
      maxHp: Number(general.hp),
      meleeAtk: Number(general.meleeAtk ?? (Number(general.hp) >= 4 ? 2 : 1)),
      rangedAtk: Number(general.rangedAtk ?? (Number(general.hp) >= 4 ? 1 : 2)),
      armor: Number(general.armor ?? 0),
      currentArmor: 0,
      armorCards: [],
      isArming: false,
      hasMoved: false,
      hasAttacked: false,
      hasSupplied: false,
      justDeployed: true,
      ownerId: player.id,
      position: { zone: 'camp', slot: Number(data.slot), areaOwnerId: player.id },
    };

    return {
      ...player,
      hand: remainingHand,
      generalPool: nextGeneralPool,
      fieldGenerals: [...fieldGenerals, fieldGeneral],
    };
  });

  const consumedResourceCards = consumeCards.filter(card => {
    const type = card && typeof card === 'object' && 'type' in card ? String((card as any).type) : '';
    return ['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT'].includes(type);
  });

  return {
    ...state,
    players,
    discardPile: [...state.discardPile, ...consumedResourceCards],
  };
}

export function applyGeneralMovedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    playerId?: number;
    generalId?: string;
    target?: { zone: 'camp' | 'front' | 'battle'; slot: number; areaOwnerId: number | null };
    consumeCard?: any | null;
  } | undefined;
  if (typeof data?.playerId !== 'number' || !data.generalId || !data.target) return state;

  const consumeId = data.consumeCard && typeof data.consumeCard === 'object'
    ? getRuntimeCardId(data.consumeCard as any)
    : null;

  let consumedCard: any = null;
  const players = state.players.map(player => {
    if (player.id !== data.playerId) return player;
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals : [];
    const hand = Array.isArray(player.hand) ? player.hand : [];
    const generalPool = Array.isArray(player.generalPool) ? player.generalPool : [];

    const nextField = fieldGenerals.map((fg: any) =>
      getRuntimeCardId(fg?.general as any) === String(data.generalId)
        ? { ...fg, hasMoved: true, position: data.target }
        : fg,
    );

    if (!consumeId) return { ...player, fieldGenerals: nextField };
    consumedCard = hand.find((card: any) => getRuntimeCardId(card as any) === consumeId) ?? null;
    if (!consumedCard) return { ...player, fieldGenerals: nextField };

    const nextHand = hand.filter((card: any) => getRuntimeCardId(card as any) !== consumeId);
    const isGeneralCard = !['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT'].includes(String(consumedCard?.type ?? ''));
    return {
      ...player,
      hand: nextHand,
      generalPool: isGeneralCard ? [...generalPool, consumedCard] : generalPool,
      fieldGenerals: nextField,
    };
  });

  const isResourceCard = consumedCard
    ? ['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT'].includes(String(consumedCard?.type ?? ''))
    : false;

  return {
    ...state,
    players,
    discardPile: consumedCard && isResourceCard
      ? [...state.discardPile, consumedCard]
      : state.discardPile,
  };
}

export function applySupplyResolvedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    playerId?: number;
    generalId?: string;
    healAmount?: number;
    consumedCards?: unknown[];
  } | undefined;
  if (typeof data?.playerId !== 'number' || !data.generalId || !Array.isArray(data.consumedCards)) return state;

  const consumeIds = new Set(data.consumedCards.map(card => getRuntimeCardId(card as any)));
  const healAmount = Math.max(0, Number(data.healAmount ?? 0));
  let actualConsumed: any[] = [];

  const players = state.players.map(player => {
    if (player.id !== data.playerId) return player;
    const hand = Array.isArray(player.hand) ? player.hand as any[] : [];
    const generalPool = Array.isArray(player.generalPool) ? player.generalPool as any[] : [];
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const targetIndex = fieldGenerals.findIndex(fg => getRuntimeCardId(fg?.general as any) === String(data.generalId));
    if (targetIndex < 0) return player;

    actualConsumed = hand.filter(card => consumeIds.has(getRuntimeCardId(card as any)));
    if (actualConsumed.length !== consumeIds.size) return player;

    const nextHand = hand.filter(card => !consumeIds.has(getRuntimeCardId(card as any)));
    const consumedGenerals = actualConsumed.filter(card => !RESOURCE_TYPES.has(String(card?.type ?? '')));
    const target = fieldGenerals[targetIndex];
    const currentHp = Number(target?.currentHp ?? 0);
    const maxHp = Number(target?.maxHp ?? target?.general?.hp ?? currentHp);
    const nextHp = Math.min(maxHp, currentHp + healAmount);
    const nextField = fieldGenerals.map((fg, index) => index === targetIndex
      ? { ...fg, currentHp: nextHp, hasSupplied: true }
      : fg);

    return {
      ...player,
      hand: nextHand,
      generalPool: [...generalPool, ...consumedGenerals],
      fieldGenerals: nextField,
    };
  });

  const consumedResources = actualConsumed.filter(card => RESOURCE_TYPES.has(String(card?.type ?? '')));
  return {
    ...state,
    players,
    discardPile: [...state.discardPile, ...consumedResources],
  };
}

/**
 * Skill HEAL effect settlement (Phase 5 Stage C): restores HP to a field
 * general, capped at maxHp. A general that is no longer on the field
 * (e.g. healed by its own onDeath skill) is an honest no-op.
 */
export function applyHealEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as { targetPlayerId?: number; targetId?: string; value?: number } | undefined;
  const amount = Math.max(0, Number(data?.value ?? 0));
  if (typeof data?.targetPlayerId !== 'number' || !data.targetId || amount <= 0) return state;

  const players = state.players.map(player => {
    if (player.id !== data.targetPlayerId) return player;
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const index = fieldGenerals.findIndex(fg => getRuntimeCardId(fg?.general as any) === String(data.targetId));
    if (index < 0) return player;
    const target = fieldGenerals[index];
    const currentHp = Number(target.currentHp ?? 0);
    const maxHp = Number(target.maxHp ?? target.general?.hp ?? currentHp);
    const nextField = fieldGenerals.map((fg, i) => i === index
      ? { ...fg, currentHp: Math.min(maxHp, currentHp + amount) }
      : fg);
    return { ...player, fieldGenerals: nextField };
  });

  return { ...state, players };
}

/**
 * Skill GAIN_ARMOR effect settlement: grants armor *points* (the 2-armor-
 * absorbs-1-damage currency from core/armorDamage), not physical armor cards.
 */
export function applyGainArmorEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as { targetPlayerId?: number; targetId?: string; value?: number } | undefined;
  const amount = Math.max(0, Number(data?.value ?? 0));
  if (typeof data?.targetPlayerId !== 'number' || !data.targetId || amount <= 0) return state;

  const players = state.players.map(player => {
    if (player.id !== data.targetPlayerId) return player;
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const index = fieldGenerals.findIndex(fg => getRuntimeCardId(fg?.general as any) === String(data.targetId));
    if (index < 0) return player;
    const nextField = fieldGenerals.map((fg, i) => i === index
      ? { ...fg, currentArmor: Number(fg.currentArmor ?? 0) + amount }
      : fg);
    return { ...player, fieldGenerals: nextField };
  });

  return { ...state, players };
}

export function applyArmorEquippedEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as {
    playerId?: number;
    generalId?: string;
    armorCards?: unknown[];
    armorAdded?: number;
    newArmor?: number;
    isArming?: boolean;
  } | undefined;
  if (typeof data?.playerId !== 'number' || !data.generalId || !Array.isArray(data.armorCards)) return state;

  const selectedIds = new Set(data.armorCards.map(card => getRuntimeCardId(card as any)));
  if (selectedIds.size !== data.armorCards.length || [...selectedIds].some(id => !id)) return state;

  const players = state.players.map(player => {
    if (player.id !== data.playerId) return player;
    const hand = Array.isArray(player.hand) ? player.hand as any[] : [];
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const targetIndex = fieldGenerals.findIndex(fg => getRuntimeCardId(fg?.general as any) === String(data.generalId));
    if (targetIndex < 0) return player;
    const selectedCards = hand.filter(card => selectedIds.has(getRuntimeCardId(card as any)));
    if (selectedCards.length !== selectedIds.size) return player;
    const nextHand = hand.filter(card => !selectedIds.has(getRuntimeCardId(card as any)));
    const nextField = fieldGenerals.map((fg, index) => {
      if (index !== targetIndex) return fg;
      const attached = Array.isArray(fg?.armorCards) ? fg.armorCards as any[] : [];
      const added = Number(data.armorAdded ?? selectedCards.length);
      const newArmor = Number(data.newArmor ?? (Number(fg.currentArmor ?? 0) + added));
      return { ...fg, armorCards: [...attached, ...selectedCards], currentArmor: newArmor, isArming: data.isArming !== false };
    });
    return { ...player, hand: nextHand, fieldGenerals: nextField };
  });

  return { ...state, players };
}
