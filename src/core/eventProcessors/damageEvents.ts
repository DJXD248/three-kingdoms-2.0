import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';
import { applyArmorDamage } from '../armorDamage';
import { resolveDamageTaken } from '../damageTaken';

export function applyBaseDamageEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as { playerId?: number; amount?: number } | undefined;
  if (typeof data?.playerId !== 'number') return state;
  const amount = Math.max(0, Number(data.amount ?? 0));
  if (amount <= 0) return state;
  const players = state.players.map(player => {
    if (player.id !== data.playerId || player.isAlive === false) return player;
    const nextBaseHp = Math.max(0, Number(player.baseHp ?? 0) - amount);
    if (nextBaseHp > 0) return { ...player, baseHp: nextBaseHp };
    return {
      ...player,
      baseHp: 0,
      isAlive: false,
      isSpectating: true,
      hand: [],
      fieldGenerals: [],
    };
  });

  const target = players.find(player => player.id === data.playerId);
  const nextPhase = target?.isAlive === false ? 'turn' : state.phase;
  const nextDrawState = target?.isAlive === false ? null : state.drawState
    ? { ...state.drawState, baseLossPending: false }
    : state.drawState;
  return {
    ...state,
    players,
    phase: nextPhase,
    drawState: nextDrawState,
  };
}

export function applyDamageEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as any;
  const consumeId = data?.consumeCard ? getRuntimeCardId(data.consumeCard as any) : '';
  const resourceTypes = ['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT'];

  let consumedCard: any = null;
  const playersAfterCost = state.players.map(player => {
    if (player.id !== data?.sourcePlayerId) return player;
    const hand = Array.isArray(player.hand) ? player.hand : [];
    if (!consumeId) return player;
    consumedCard = hand.find(card => getRuntimeCardId(card as any) === consumeId) ?? null;
    if (!consumedCard) return player;
    const nextHand = hand.filter(card => getRuntimeCardId(card as any) !== consumeId);
    const isGeneralCard = !resourceTypes.includes(String((consumedCard as any)?.type ?? ''));
    return {
      ...player,
      hand: nextHand,
      generalPool: isGeneralCard
        ? [...(Array.isArray(player.generalPool) ? player.generalPool : []), consumedCard]
        : player.generalPool,
      fieldGenerals: Array.isArray(player.fieldGenerals)
        ? (player.fieldGenerals as any[]).map((fg: any) =>
            getRuntimeCardId(fg?.general as any) === String(data?.sourceGeneralId ?? '')
              ? { ...fg, hasAttacked: true }
              : fg,
          )
        : player.fieldGenerals,
    };
  });

  const targetPlayerId = typeof data?.targetPlayerId === 'number' ? data.targetPlayerId : null;
  const targetId = data?.targetId ?? data?.target;
  const baseTarget = typeof targetId === 'string' && targetId.startsWith('base_');

  if (baseTarget && targetPlayerId !== null) {
    const players = playersAfterCost.map(player => {
      if (player.id !== targetPlayerId) return player;
      const currentHp = typeof player.baseHp === 'number' ? player.baseHp : 0;
      // 本营**不吃**「受到的伤害」那格修正（用户 2026-10-03 裁"问二＝不吃"）：那一格
      // 的钥匙键在（座次＋将领实例）上，本营根本不是任何一员将⇒账本里压根没有它那一笔。
      // 「本营单次最多 1 点」那条规则事实由**发射点**钉死（`AttackResolver` 的
      // `Math.min(1, baseDamage)`）；这一侧照卡面数值结算，绝不偷偷改写技能打本营的
      // 伤害（那是另一刀的量，已记进待裁）。
      const amount = Math.max(0, Number(data?.hpLost ?? data?.value ?? 0));
      const newHp = Math.max(0, currentHp - amount);
      return {
        ...player,
        baseHp: newHp,
        isAlive: newHp > 0,
        ...(newHp <= 0 ? { isSpectating: true, hand: [], fieldGenerals: [] } : {}),
      };
    });
    return {
      ...state,
      players,
      discardPile: consumedCard && resourceTypes.includes(String(consumedCard?.type ?? ''))
        ? [...state.discardPile, consumedCard]
        : state.discardPile,
    };
  }

  let destroyedArmorCardsForDiscard: any[] = [];
  const players = playersAfterCost.map(player => {
    if (player.id !== targetPlayerId) return player;
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const index = fieldGenerals.findIndex(fg => getRuntimeCardId(fg?.general as any) === String(targetId));
    if (index < 0) return player;

    const target = { ...fieldGenerals[index] };
    const destroyedArmorIds = Array.isArray(data?.destroyedArmorCardIds)
      ? new Set(data.destroyedArmorCardIds.map((id: unknown) => String(id)))
      : new Set<string>();
    const attachedArmor = Array.isArray(target.armorCards) ? target.armorCards as any[] : [];
    const destroyedArmorCards = destroyedArmorIds.size > 0
      ? attachedArmor.filter((card: any) => destroyedArmorIds.has(getRuntimeCardId(card as any)))
      : [];

    target.armorCards = destroyedArmorIds.size > 0
      ? attachedArmor.filter((card: any) => !destroyedArmorIds.has(getRuntimeCardId(card as any)))
      : attachedArmor;
    // Attack resolvers pre-compute newHp/newArmor. Skill-triggered DAMAGE
    // events (damageType: 'skill') only carry a value, so settle the hit
    // here with the same canonical armor rule attacks use — 先把"受到的伤害"
    // 那一格过完（护甲**之前**，`core/damageTaken.ts`），再交给护甲出口。
    // 这一路为什么在结算时读而不是发射时预解：同一技能连发两笔伤害时，第二笔必须
    // 看见第一笔之后的血量。被用掉的一次性账不在这里销——它由派生点发一条
    // canonical `STAT_MODIFY{REMOVE}`（读的是同一本账、同一个原始数⇒同一个清单）。
    if (data?.newHp === undefined && data?.damageType === 'skill') {
      const taken = resolveDamageTaken(
        state.statModifiers,
        { playerId: Number(player.id), generalId: String(targetId) },
        Number(data?.value ?? 0),
      );
      const skillHit = applyArmorDamage(
        Number(target.currentHp ?? 0),
        Number(target.currentArmor ?? 0),
        taken.damage,
      );
      target.currentHp = skillHit.hp;
      target.currentArmor = skillHit.armor;
    } else {
      target.currentHp = Number(data?.newHp ?? target.currentHp);
      target.currentArmor = Number(data?.newArmor ?? target.currentArmor);
    }
    destroyedArmorCardsForDiscard = destroyedArmorCards;

    if (data?.defeated === true || target.currentHp <= 0) {
      const survivorArmor = Array.isArray(target.armorCards) ? target.armorCards : [];
      destroyedArmorCardsForDiscard = [...destroyedArmorCards, ...survivorArmor];
      target.armorCards = [];
      target.currentArmor = 0;
      target.isArming = false;
      return {
        ...player,
        fieldGenerals: fieldGenerals.filter((_, i) => i !== index),
        graveyard: [...(Array.isArray(player.graveyard) ? player.graveyard : []), target.general],
      };
    }

    return {
      ...player,
      fieldGenerals: fieldGenerals.map((fg, i) => i === index ? target : fg),
    };
  });

  const damagedArmorCards = Number(data?.armorLost ?? 0);
  // Point-based armor (GAIN_ARMOR, 2.2.17) has no card instances attached, so
  // destroyed points legitimately land here without real cards. Placeholders
  // keep the `legacy_armor_destroyed` prefix ai/invariants.ts excludes from
  // the card ledger, but the id is positional (D-2 determinism: the old
  // Date.now() stamp made discard contents irreproducible across replays).
  const consumedToDiscard =
    consumedCard && resourceTypes.includes(String(consumedCard?.type ?? '')) ? 1 : 0;
  const fallbackBaseIndex = state.discardPile.length + consumedToDiscard;
  const fallbackDestroyedArmor = damagedArmorCards > 0 && destroyedArmorCardsForDiscard.length === 0
    ? Array.from({ length: damagedArmorCards }, (_, i) => ({
        id: `legacy_armor_destroyed_${fallbackBaseIndex + i}`,
        name: '已损毁护甲',
        type: '军备',
        description: '被攻击损毁的护甲',
      }))
    : [];

  return {
    ...state,
    players,
    discardPile: [
      ...state.discardPile,
      ...(consumedCard && resourceTypes.includes(String(consumedCard?.type ?? '')) ? [consumedCard] : []),
      ...destroyedArmorCardsForDiscard,
      ...fallbackDestroyedArmor,
    ],
  };
}
