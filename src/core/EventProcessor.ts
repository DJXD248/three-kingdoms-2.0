import type { EngineState } from './GameState';
import type { GameEvent } from './Event';
import { cloneEngineState } from './GameState';
import { getTurnStartDrawCount } from './turnRules';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { applyArmorDamage } from './armorDamage';

const RESOURCE_TYPES = new Set(['粮草', '材料', '军备', 'SUPPLY', 'MATERIAL', 'ARMAMENT']);

/**
 * Applies emitted events to engine state.
 * Resolver decides WHAT happened.
 * Processor decides HOW state changes.
 */
export class EventProcessor {
  process(state: EngineState, events: GameEvent[]): EngineState {
    let next = cloneEngineState(state);
    const queue = [...events];

    // Some domain outcomes (player defeat, game over, compensation draw) are
    // deterministic consequences of a primary event. Keep those consequences
    // inside the canonical event-processing layer so Resolver code only states
    // what happened.
    while (queue.length > 0) {
      const event = queue.shift()!;
      const before = next;
      next = this.apply(next, event);

      if (event.type === 'DAMAGE') {
        const data = event.data as any;
        const targetPlayerId = typeof data?.targetPlayerId === 'number' ? data.targetPlayerId : null;
        const isBase = data?.isBase === true || (typeof data?.targetId === 'string' && data.targetId.startsWith('base_'));
        if (isBase && targetPlayerId !== null) {
          const beforePlayer = before.players.find(p => p.id === targetPlayerId);
          const afterPlayer = next.players.find(p => p.id === targetPlayerId);
          if (beforePlayer?.isAlive !== false && afterPlayer?.isAlive === false) {
            queue.push({
              type: 'PLAYER_DEFEATED',
              data: {
                playerId: targetPlayerId,
                sourcePlayerId: data?.sourcePlayerId,
                reason: 'BASE_HP_ZERO',
              },
            });
          }
        }
      }

      if (event.type === 'DEATH') {
        const data = event.data as any;
        const targetPlayerId = typeof data?.targetPlayerId === 'number' ? data.targetPlayerId : null;
        if (targetPlayerId !== null) {
          // A general being defeated grants its owner exactly one compensation
          // draw. The actual card selection remains an explicit DRAW Action.
          queue.push({
            type: 'DRAW_REQUIRED',
            data: {
              reason: 'compensation',
              playerId: targetPlayerId,
              totalCards: 1,
              baseLossPending: false,
              resumePhase: before.timelinePhase ?? (before.phase === 'playing' ? 'ACTION' : before.phase),
              resumePlayerId: before.currentPlayerId,
              cause: 'GENERAL_DEFEATED',
            },
          });
        }
      }

      if (event.type === 'BASE_DAMAGE') {
        const data = event.data as any;
        const playerId = typeof data?.playerId === 'number' ? data.playerId : null;
        const beforePlayer = playerId === null ? undefined : before.players.find(player => player.id === playerId);
        const afterPlayer = playerId === null ? undefined : next.players.find(player => player.id === playerId);
        if (beforePlayer?.isAlive !== false && afterPlayer?.isAlive === false && playerId !== null) {
          queue.push({
            type: 'PLAYER_DEFEATED',
            data: { playerId, reason: 'BASE_HP_ZERO', sourcePlayerId: null, resumeTurnStart: before.timelinePhase === 'DRAW' && before.currentPlayerId === playerId },
          });
        }
      }

      if (event.type === 'PLAYER_DEFEATED') {
        const data = event.data as any;
        const defeatedId = typeof data?.playerId === 'number' ? data.playerId : null;
        if (defeatedId !== null) {
          const survivors = next.players.filter(player => player.id !== defeatedId && player.isAlive !== false);
          if (survivors.length <= 1) {
            queue.push({
              type: 'GAME_OVER',
              data: {
                winnerId: survivors.length === 1 ? survivors[0].id : null,
                defeatedPlayerId: defeatedId,
              },
            });
          } else if (before.currentPlayerId === defeatedId && (before.timelinePhase !== 'DRAW' || data?.resumeTurnStart === true)) {
            // A surrender/defeat by the active player immediately ends their turn.
            const defeatedIndex = before.players.findIndex(player => player.id === defeatedId);
            let nextIndex = defeatedIndex < 0 ? 0 : (defeatedIndex + 1) % before.players.length;
            let guard = 0;
            while (guard < before.players.length && next.players[nextIndex]?.isAlive === false) {
              nextIndex = (nextIndex + 1) % before.players.length;
              guard += 1;
            }
            const nextPlayer = next.players[nextIndex];
            if (nextPlayer && nextPlayer.isAlive !== false) {
              const nextRound = nextIndex <= Math.max(0, defeatedIndex) ? before.round + 1 : before.round;
              queue.push({ type: 'TURN_END', data: { playerId: defeatedId, fromIndex: defeatedIndex, toIndex: nextIndex, nextPlayerId: nextPlayer.id, nextRound } });
              queue.push({ type: 'TURN_START', data: { playerId: nextPlayer.id, nextRound } });
              queue.push({ type: 'TURN_ACTIONS_RESET', data: { playerId: nextPlayer.id } });
              queue.push({
                type: 'DRAW_REQUIRED',
                data: {
                  reason: 'turnStart',
                  playerId: nextPlayer.id,
                  totalCards: getTurnStartDrawCount({ ...next, round: nextRound }, nextIndex),
                  baseLossPending: (nextPlayer.generalPool?.length ?? 0) === 0,
                },
              });
            }
          }
        }
      }
    }

    return next;
  }

  private apply(state: EngineState, event: GameEvent): EngineState {
    switch (event.type) {
      case 'BASE_DAMAGE': {
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

      case 'DRAW_REQUIRED': {
        const data = event.data as {
          reason?: 'initial' | 'turnStart' | 'compensation';
          playerId?: number;
          totalCards?: number;
          baseLossPending?: boolean;
          resumePhase?: string;
          resumePlayerId?: number | null;
        } | undefined;
        if (typeof data?.playerId !== 'number') return state;
        const player = state.players.find(p => p.id === data.playerId);
        if (!player || player.isAlive === false) return state;
        return {
          ...state,
          phase: 'drawing',
          timelinePhase: 'DRAW',
          currentPlayerId: player.id,
          metadata: {
            ...(state.metadata ?? {}),
            drawPlayerId: player.id,
            drawReason: data.reason ?? 'turnStart',
            drawTotalCards: typeof data.totalCards === 'number' ? data.totalCards : 5,
          },
          drawState: {
            reason: data.reason ?? 'turnStart',
            playerId: player.id,
            totalCards: typeof data.totalCards === 'number' ? data.totalCards : 5,
            baseLossPending: data.baseLossPending === true,
            resumePhase: typeof data.resumePhase === 'string' ? data.resumePhase : undefined,
            resumePlayerId: typeof data.resumePlayerId === 'number' ? data.resumePlayerId : null,
          },
        };
      }

      case 'DRAW': {
        const data = event.data as {
          playerId?: number;
          generalCards?: unknown[];
          cardCards?: unknown[];
          reshuffledCardCards?: unknown[];
          count?: number;
          value?: number;
        } | undefined;
        if (typeof data?.playerId !== 'number') return state;

        const generalCards = Array.isArray(data.generalCards) ? data.generalCards : [];
        let cardCards = Array.isArray(data.cardCards) ? data.cardCards : [];
        let reshuffledCardCards = Array.isArray(data.reshuffledCardCards) ? data.reshuffledCardCards : [];

        // Skill-triggered draws (DRAW_CARD effects) arrive as a bare count.
        // Select concrete card instances at apply time from the shared deck
        // (reshuffling the discard pile when it runs low) so chained draws
        // can never duplicate card instances the way pre-selected slices could.
        if (!Array.isArray(data.generalCards) && !Array.isArray(data.cardCards)) {
          const requested = Math.max(0, Math.floor(Number(data.count ?? data.value ?? 0)));
          if (requested === 0) return state;
          const deckCards = Array.isArray(state.deck) ? state.deck : [];
          const discardCards = Array.isArray(state.discardPile) ? state.discardPile : [];
          cardCards = deckCards.slice(0, Math.min(requested, deckCards.length));
          if (cardCards.length < requested && discardCards.length > 0) {
            reshuffledCardCards = [...discardCards]
              .sort(() => Math.random() - 0.5)
              .slice(0, Math.min(requested - cardCards.length, discardCards.length));
            cardCards = [...cardCards, ...reshuffledCardCards];
          }
        }

        const drawn = [...generalCards, ...cardCards];

        const remainingReshuffledIds = new Set(reshuffledCardCards.map(card => {
          if (card && typeof card === 'object' && 'id' in card) return String((card as any).id);
          return JSON.stringify(card);
        }));

        const nextDiscard = reshuffledCardCards.length === 0
          ? state.discardPile
          : state.discardPile.filter(card => {
              const key = card && typeof card === 'object' && 'id' in card
                ? String((card as any).id)
                : JSON.stringify(card);
              if (remainingReshuffledIds.has(key)) {
                remainingReshuffledIds.delete(key);
                return false;
              }
              return true;
            });

        const players = state.players.map(player => {
          if (player.id !== data.playerId) return player;
          const currentHand = Array.isArray(player.hand) ? player.hand : [];
          const currentPool = Array.isArray(player.generalPool) ? player.generalPool : [];

          // IMPORTANT: DrawResolver selects physical general instances after
          // shuffling a copy of the pool. Never remove the first N entries
          // from the original pool here, because that can leave the actually
          // drawn general behind and make it drawable again. Remove the exact
          // runtime instances emitted by the DRAW event instead.
          const selectedGeneralIds = new Map<string, number>();
          for (const card of generalCards) {
            const id = getRuntimeCardId(card as any);
            if (id) selectedGeneralIds.set(id, (selectedGeneralIds.get(id) ?? 0) + 1);
          }
          const remainingGeneralPool = currentPool.filter(card => {
            const id = getRuntimeCardId(card as any);
            const count = selectedGeneralIds.get(id) ?? 0;
            if (count <= 0) return true;
            if (count === 1) selectedGeneralIds.delete(id);
            else selectedGeneralIds.set(id, count - 1);
            return false;
          });

          return {
            ...player,
            hand: [...currentHand, ...drawn],
            generalPool: remainingGeneralPool,
          };
        });

        return {
          ...state,
          players,
          deck: state.deck.slice(Math.min(cardCards.length - reshuffledCardCards.length, state.deck.length)),
          discardPile: nextDiscard,
        };
      }


      case 'GENERAL_DEPLOYED': {
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


      case 'GENERAL_MOVED': {
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

      case 'SUPPLY_RESOLVED': {
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

      case 'ARMOR_EQUIPPED': {
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

      case 'DAMAGE': {
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
            const newHp = Math.max(0, currentHp - Number(data?.hpLost ?? data?.value ?? 0));
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
          // here with the same canonical armor rule attacks use.
          if (data?.newHp === undefined && data?.damageType === 'skill') {
            const skillHit = applyArmorDamage(
              Number(target.currentHp ?? 0),
              Number(target.currentArmor ?? 0),
              Number(data?.value ?? 0),
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
        const fallbackDestroyedArmor = damagedArmorCards > 0 && destroyedArmorCardsForDiscard.length === 0
          ? Array.from({ length: damagedArmorCards }, (_, i) => ({
              id: `legacy_armor_destroyed_${Date.now()}_${i}`,
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

      case 'PLAYER_DEFEATED': {
        const data = event.data as { playerId?: number } | undefined;
        const defeatedId = typeof data?.playerId === 'number' ? data.playerId : null;
        if (defeatedId === null) return state;

        const players = state.players.map(player => {
          if (player.id !== defeatedId) return player;
          return {
            ...player,
            baseHp: 0,
            isAlive: false,
            isSpectating: true,
            hand: [],
            fieldGenerals: [],
          };
        });

        const survivors = players.filter(player => player.id !== defeatedId && player.isAlive !== false);
        if (survivors.length <= 1) {
          return {
            ...state,
            players,
            phase: 'gameOver',
            timelinePhase: 'GAME_OVER',
            currentPlayerId: survivors.length === 1 ? survivors[0].id : null,
            drawState: null,
            metadata: { ...(state.metadata ?? {}), winnerId: survivors.length === 1 ? survivors[0].id : null },
          };
        }

        if (state.timelinePhase === 'DRAW' && state.currentPlayerId === defeatedId) {
          const defeatedIndex = state.players.findIndex(player => player.id === defeatedId);
          let nextIndex = defeatedIndex < 0 ? 0 : (defeatedIndex + 1) % state.players.length;
          let guard = 0;
          while (guard < state.players.length && players[nextIndex]?.isAlive === false) {
            nextIndex = (nextIndex + 1) % state.players.length;
            guard += 1;
          }
          const nextPlayer = players[nextIndex];
          if (nextPlayer && nextPlayer.isAlive !== false) {
            const nextRound = nextIndex <= Math.max(0, defeatedIndex) ? state.round + 1 : state.round;
            return {
              ...state,
              players,
              phase: 'drawing',
              timelinePhase: 'DRAW',
              currentPlayerId: nextPlayer.id,
              drawState: {
                reason: 'turnStart',
                playerId: nextPlayer.id,
                totalCards: getTurnStartDrawCount({ ...state, round: nextRound }, nextIndex),
                baseLossPending: (nextPlayer.generalPool?.length ?? 0) === 0,
              },
            };
          }
        }

        return { ...state, players };
      }

      case 'GAME_OVER': {
        const data = event.data as { winnerId?: number | null } | undefined;
        return {
          ...state,
          phase: 'gameOver',
          timelinePhase: 'GAME_OVER',
          metadata: {
            ...(state.metadata ?? {}),
            winnerId: data?.winnerId ?? null,
          },
          drawState: null,
        };
      }

      case 'DRAW_CONFIRMED': {
        const data = event.data as {
          reason?: string;
          completed?: boolean;
          nextPlayerId?: number | null;
          nextPlayerIndex?: number;
          resumePhase?: string;
          resumePlayerId?: number | null;
        } | undefined;
        const completed = data?.completed === true;
        if (!completed && data?.nextPlayerId !== undefined && data?.nextPlayerId !== null) {
          const nextPlayer = state.players.find(player => player.id === data.nextPlayerId);
          return {
            ...state,
            currentPlayerId: data.nextPlayerId,
            drawState: nextPlayer ? {
              reason: 'initial',
              playerId: nextPlayer.id,
              totalCards: 5,
              baseLossPending: false,
            } : state.drawState,
            phase: 'drawing',
            timelinePhase: 'DRAW',
          };
        }

        // Secondary/compensation draws must resume the exact state that was
        // active before the temporary draw window opened. Returning to the
        // previous actor/phase prevents a compensation draw from leaving the
        // match in a dangling DRAW phase.
        if (completed && data?.reason === 'compensation') {
          const resumePhase = data.resumePhase ?? state.drawState?.resumePhase ?? 'ACTION';
          const resumePlayerId = data.resumePlayerId ?? state.drawState?.resumePlayerId ?? state.currentPlayerId;
          const isAction = resumePhase === 'ACTION' || resumePhase === 'playing';
          return {
            ...state,
            currentPlayerId: typeof resumePlayerId === 'number' ? resumePlayerId : state.currentPlayerId,
            phase: isAction ? 'playing' : resumePhase.toLowerCase(),
            timelinePhase: resumePhase,
            drawState: null,
          };
        }

        return {
          ...state,
          drawState: null,
        };
      }

      case 'TURN_END': {
        const data = event.data as {
          fromIndex?: number;
          toIndex?: number;
          nextRound?: number;
        } | undefined;
        return {
          ...state,
          turn: state.turn + 1,
          round: typeof data?.nextRound === 'number' ? data.nextRound : state.round,
        };
      }

      case 'TURN_ACTIONS_RESET': {
        const data = event.data as { playerId?: number } | undefined;
        if (typeof data?.playerId !== 'number') return state;
        const players = state.players.map(player => {
          if (player.id !== data.playerId) return player;
          const fieldGenerals = Array.isArray(player.fieldGenerals)
            ? player.fieldGenerals as any[]
            : [];
          return {
            ...player,
            fieldGenerals: fieldGenerals.map(fg => ({
              ...fg,
              hasMoved: false,
              hasAttacked: false,
              hasSupplied: false,
              justDeployed: false,
              isArming: false,
            })),
          };
        });
        return { ...state, players };
      }

      case 'TURN_START': {
        const data = event.data as any;
        const nextPlayerId = typeof data?.playerId === 'number' ? data.playerId : state.currentPlayerId;
        const nextPlayer = state.players.find(player => player.id === nextPlayerId);
        return {
          ...state,
          phase: nextPlayerId === null || nextPlayerId === undefined ? state.phase : 'drawing',
          timelinePhase: nextPlayerId === null || nextPlayerId === undefined ? 'TURN_START' : 'DRAW',
          currentPlayerId: nextPlayerId,
          drawState: nextPlayerId === null || nextPlayerId === undefined || !nextPlayer
            ? null
            : {
                reason: 'turnStart',
                playerId: nextPlayer.id,
                totalCards: getTurnStartDrawCount(state, state.players.findIndex(player => player.id === nextPlayer.id)),
                baseLossPending: false,
              },
        };
      }

      case 'PHASE_CHANGED': {
        const data = event.data as any;
        const to = typeof data?.to === 'string' ? data.to : undefined;
        const nextPlayerId = typeof data?.playerId === 'number' ? data.playerId : state.currentPlayerId;
        if (to === 'ACTION') {
          return {
            ...state,
            phase: 'playing',
            timelinePhase: 'ACTION',
            currentPlayerId: nextPlayerId,
            drawState: null,
          };
        }
        if (to === 'DRAW') {
          const player = state.players.find(p => p.id === nextPlayerId);
          return {
            ...state,
            phase: 'drawing',
            timelinePhase: 'DRAW',
            currentPlayerId: nextPlayerId,
            drawState: player ? (state.drawState ?? {
              reason: data?.drawReason === 'initial' ? 'initial' : 'turnStart',
              playerId: player.id,
              totalCards: data?.totalCards ?? 5,
              baseLossPending: false,
            }) : state.drawState,
          };
        }
        return {
          ...state,
          phase: to ? to.toLowerCase() : state.phase,
          timelinePhase: to ?? state.timelinePhase,
          currentPlayerId: nextPlayerId,
        };
      }

      case 'STATE_CHANGED':
      default:
        return state;
    }
  }
}
