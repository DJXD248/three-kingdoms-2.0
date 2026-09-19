import type { GameCard } from '../data/cards';
import { createCardDeck } from '../data/cards';
import { allGenerals, getGeneralsByFaction } from '../data/generals';
import type { General } from '../data/generals';
import { cloneWithRuntimeInstance, getRuntimeCardId } from '../utils/runtimeIdentity';
import type { GameState, Player } from './gameStore';

export type TestArenaActions = Pick<
  GameState,
  | 'startTestArena'
  | 'testDrawCards'
  | 'testDrawSpecificGeneral'
  | 'testDiscardCard'
  | 'testAddPlayer'
  | 'testRemovePlayer'
  | 'testSetGeneralHp'
  | 'testSetGeneralMaxHp'
  | 'testDamageGeneral'
  | 'testHealGeneral'
  | 'testSetBaseHp'
  | 'testDamageBase'
  | 'testHealBase'
  | 'testResetActions'
>;

type SetState = (partial: Partial<GameState>) => void;
type GetState = () => GameState;

const playableFactions = ['魏', '蜀', '吴', '晋'] as const;

type Shuffle = <T>(items: T[]) => T[];

export function buildTestArenaActions(get: GetState, set: SetState, shuffle: Shuffle): TestArenaActions {
  return {
    startTestArena: () => {
      const factions = shuffle([...playableFactions]);
      const avatars = shuffle(allGenerals);
      const deck = createCardDeck();
      const players: Player[] = [];

      for (let i = 0; i < 4; i++) {
        const faction = factions[i % factions.length];
        const pool = shuffle([
          ...getGeneralsByFaction(faction),
          ...shuffle(getGeneralsByFaction('群')).slice(0, 3),
        ]);
        const hand: (General | GameCard)[] = [];

        for (let c = 0; c < 2 && pool.length > 0; c++) {
          const general = pool.shift();
          if (general) hand.push(cloneWithRuntimeInstance(general));
        }

        const runtimePool = pool.map(general => cloneWithRuntimeInstance(general));
        for (let c = 0; c < 3 && deck.length > 0; c++) {
          const card = deck.shift();
          if (card) hand.push(card);
        }

        players.push({
          id: i + 1,
          name: `玩家${i + 1}`,
          faction,
          seatOrder: i,
          diceRoll: Math.floor(Math.random() * 12) + 1,
          generalPool: runtimePool,
          hand,
          fieldGenerals: [],
          baseHp: 6,
          baseMaxHp: 6,
          isAlive: true,
          isSpectating: false,
          avatarGeneral: avatars[i] || avatars[0],
          graveyard: [],
        });
      }

      set({
        phase: 'testArena',
        players,
        playerCount: 4,
        roomName: '⚗️ 测试场',
        currentPlayerIndex: 0,
        currentRound: 1,
        cardDeck: deck,
        discardPile: [],
        battlefieldSlots: 4,
        turnPhase: 'main',
        winnerId: null,
        gameOverBanner: null,
        defeatEvent: null,
        pendingTurnTransition: null,
        isFirstTurn: false,
        isTestMode: true,
        testActionCounts: {},
        skillActivations: [],
      });
    },

    testDrawCards: (playerId, count) => {
      const { players, cardDeck, discardPile } = get();
      const nextPlayers = [...players];
      let nextDeck = [...cardDeck];
      let nextDiscard = [...discardPile];
      const playerIndex = nextPlayers.findIndex(player => player.id === playerId);
      if (playerIndex === -1) return;

      const player = { ...nextPlayers[playerIndex] };
      const hand = [...player.hand];
      for (let i = 0; i < count; i++) {
        if (nextDeck.length === 0 && nextDiscard.length > 0) {
          nextDeck = shuffle(nextDiscard);
          nextDiscard = [];
        }
        if (nextDeck.length === 0) break;
        const card = nextDeck.shift();
        if (card) hand.push(card);
      }
      nextPlayers[playerIndex] = { ...player, hand };
      set({ players: nextPlayers, cardDeck: nextDeck, discardPile: nextDiscard });
    },

    testDrawSpecificGeneral: (playerId, generalId) => {
      const { players } = get();
      const nextPlayers = [...players];
      const playerIndex = nextPlayers.findIndex(player => player.id === playerId);
      if (playerIndex === -1) return;

      const player = { ...nextPlayers[playerIndex] };
      const general = allGenerals.find(item => item.id === generalId);
      if (!general) return;

      nextPlayers[playerIndex] = {
        ...player,
        hand: [...player.hand, cloneWithRuntimeInstance(general)],
        generalPool: (() => {
          const index = player.generalPool.findIndex(item => item.id === generalId);
          if (index < 0) return player.generalPool;
          return [...player.generalPool.slice(0, index), ...player.generalPool.slice(index + 1)];
        })(),
      };
      set({ players: nextPlayers });
    },

    testDiscardCard: (playerId, cardId) => {
      const { players, discardPile } = get();
      const nextPlayers = [...players];
      const nextDiscard = [...discardPile];
      const playerIndex = nextPlayers.findIndex(player => player.id === playerId);
      if (playerIndex === -1) return;

      const player = { ...nextPlayers[playerIndex] };
      const card = player.hand.find(item => getRuntimeCardId(item) === String(cardId) || String(item.id) === String(cardId));
      if (!card) return;

      const selectedRuntimeId = getRuntimeCardId(card);
      player.hand = player.hand.filter(item => getRuntimeCardId(item) !== selectedRuntimeId);
      if ('skills' in card) player.generalPool = [...player.generalPool, card as General];
      else nextDiscard.push(card as GameCard);
      nextPlayers[playerIndex] = player;
      set({ players: nextPlayers, discardPile: nextDiscard });
    },

    testAddPlayer: () => {
      const { players, cardDeck } = get();
      if (players.length >= 4) return;

      const newId = Math.max(0, ...players.map(player => player.id)) + 1;
      const faction = shuffle([...playableFactions])[0];
      const avatar = shuffle(allGenerals)[0];
      const pool = shuffle([
        ...getGeneralsByFaction(faction),
        ...shuffle(getGeneralsByFaction('群')).slice(0, 3),
      ]);
      const deck = [...cardDeck];
      const hand: (General | GameCard)[] = [];

      for (let c = 0; c < 2 && pool.length > 0; c++) {
        const general = pool.shift();
        if (general) hand.push(cloneWithRuntimeInstance(general));
      }
      const runtimePool = pool.map(general => cloneWithRuntimeInstance(general));
      for (let c = 0; c < 3 && deck.length > 0; c++) {
        const card = deck.shift();
        if (card) hand.push(card);
      }

      const player: Player = {
        id: newId,
        name: `玩家${newId}`,
        faction,
        seatOrder: players.length,
        diceRoll: 0,
        generalPool: runtimePool,
        hand,
        fieldGenerals: [],
        baseHp: 6,
        baseMaxHp: 6,
        isAlive: true,
        isSpectating: false,
        avatarGeneral: avatar,
        graveyard: [],
      };

      set({
        players: [...players, player],
        playerCount: players.length + 1,
        battlefieldSlots: players.length + 1,
        cardDeck: deck,
      });
    },

    testRemovePlayer: playerId => {
      const { players, currentPlayerIndex } = get();
      if (players.length <= 2) return;
      const nextPlayers = players
        .filter(player => player.id !== playerId)
        .map((player, index) => ({ ...player, seatOrder: index }));
      set({
        players: nextPlayers,
        playerCount: nextPlayers.length,
        battlefieldSlots: nextPlayers.length,
        currentPlayerIndex: currentPlayerIndex >= nextPlayers.length ? 0 : currentPlayerIndex,
      });
    },

    testSetGeneralHp: (generalId, hp) => {
      const { players } = get();
      const nextPlayers = [...players];
      for (let i = 0; i < nextPlayers.length; i++) {
        const fieldIndex = nextPlayers[i].fieldGenerals.findIndex(field => getRuntimeCardId(field.general as any) === String(generalId));
        if (fieldIndex === -1) continue;

        const fieldGenerals = [...nextPlayers[i].fieldGenerals];
        const current = {
          ...fieldGenerals[fieldIndex],
          currentHp: Math.max(0, Math.min(hp, fieldGenerals[fieldIndex].maxHp)),
        };

        if (current.currentHp <= 0) {
          nextPlayers[i] = {
            ...nextPlayers[i],
            fieldGenerals: fieldGenerals.filter((_, index) => index !== fieldIndex),
            graveyard: [...nextPlayers[i].graveyard, current.general],
          };
        } else {
          fieldGenerals[fieldIndex] = current;
          nextPlayers[i] = { ...nextPlayers[i], fieldGenerals };
        }
        break;
      }
      set({ players: nextPlayers });
    },

    testSetGeneralMaxHp: (generalId, maxHp) => {
      const { players } = get();
      const nextPlayers = [...players];
      for (let i = 0; i < nextPlayers.length; i++) {
        const fieldIndex = nextPlayers[i].fieldGenerals.findIndex(field => getRuntimeCardId(field.general as any) === String(generalId));
        if (fieldIndex === -1) continue;

        const fieldGenerals = [...nextPlayers[i].fieldGenerals];
        const newMax = Math.max(1, maxHp);
        fieldGenerals[fieldIndex] = {
          ...fieldGenerals[fieldIndex],
          maxHp: newMax,
          currentHp: Math.min(fieldGenerals[fieldIndex].currentHp, newMax),
          currentArmor: Math.min(fieldGenerals[fieldIndex].currentArmor, newMax),
        };
        nextPlayers[i] = { ...nextPlayers[i], fieldGenerals };
        break;
      }
      set({ players: nextPlayers });
    },

    testDamageGeneral: (generalId, amount) => {
      const { players } = get();
      const nextPlayers = [...players];
      for (let i = 0; i < nextPlayers.length; i++) {
        const fieldIndex = nextPlayers[i].fieldGenerals.findIndex(field => getRuntimeCardId(field.general as any) === String(generalId));
        if (fieldIndex === -1) continue;

        const fieldGenerals = [...nextPlayers[i].fieldGenerals];
        const target = { ...fieldGenerals[fieldIndex] };
        let remaining = Math.max(0, amount);
        let armor = Number(target.currentArmor ?? 0);

        while (remaining > 0 && armor >= 2) {
          armor -= 2;
          remaining -= 1;
        }
        target.currentArmor = armor;
        target.currentHp = Math.max(0, target.currentHp - remaining);

        if (target.currentHp <= 0) {
          nextPlayers[i] = {
            ...nextPlayers[i],
            fieldGenerals: fieldGenerals.filter((_, index) => index !== fieldIndex),
            graveyard: [...nextPlayers[i].graveyard, target.general],
          };
        } else {
          fieldGenerals[fieldIndex] = target;
          nextPlayers[i] = { ...nextPlayers[i], fieldGenerals };
        }
        break;
      }
      set({ players: nextPlayers });
    },

    testHealGeneral: (generalId, amount) => {
      const { players } = get();
      const nextPlayers = [...players];
      for (let i = 0; i < nextPlayers.length; i++) {
        const fieldIndex = nextPlayers[i].fieldGenerals.findIndex(field => getRuntimeCardId(field.general as any) === String(generalId));
        if (fieldIndex === -1) continue;
        const fieldGenerals = [...nextPlayers[i].fieldGenerals];
        fieldGenerals[fieldIndex] = {
          ...fieldGenerals[fieldIndex],
          currentHp: Math.min(fieldGenerals[fieldIndex].maxHp, fieldGenerals[fieldIndex].currentHp + amount),
        };
        nextPlayers[i] = { ...nextPlayers[i], fieldGenerals };
        break;
      }
      set({ players: nextPlayers });
    },

    testSetBaseHp: (playerId, hp) => {
      const { players } = get();
      const nextPlayers = players.map(player => player.id === playerId
        ? { ...player, baseHp: Math.max(0, Math.min(hp, player.baseMaxHp)), isAlive: hp > 0, isSpectating: hp <= 0 ? true : player.isSpectating }
        : player
      );
      set({ players: nextPlayers });
    },

    testDamageBase: (playerId, amount, _type) => {
      const { players } = get();
      const damage = Math.max(0, amount);
      const nextPlayers = players.map(player => {
        if (player.id !== playerId) return player;
        const nextHp = Math.max(0, player.baseHp - damage);
        return { ...player, baseHp: nextHp, isAlive: nextHp > 0, isSpectating: nextHp <= 0 ? true : player.isSpectating };
      });
      set({ players: nextPlayers });
    },

    testHealBase: (playerId, amount) => {
      const { players } = get();
      const heal = Math.max(0, amount);
      const nextPlayers = players.map(player => player.id === playerId
        ? { ...player, baseHp: Math.min(player.baseMaxHp, player.baseHp + heal), isAlive: true, isSpectating: false }
        : player
      );
      set({ players: nextPlayers });
    },

    testResetActions: generalId => {
      const { players } = get();
      const nextPlayers = [...players];
      for (let i = 0; i < nextPlayers.length; i++) {
        const fieldIndex = nextPlayers[i].fieldGenerals.findIndex(field => getRuntimeCardId(field.general as any) === String(generalId));
        if (fieldIndex === -1) continue;
        const fieldGenerals = [...nextPlayers[i].fieldGenerals];
        fieldGenerals[fieldIndex] = {
          ...fieldGenerals[fieldIndex],
          hasMoved: false,
          hasAttacked: false,
          hasSupplied: false,
          justDeployed: false,
        };
        nextPlayers[i] = { ...nextPlayers[i], fieldGenerals };
        break;
      }
      set({ players: nextPlayers });
    },
  };
}
