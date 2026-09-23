/**
 * Match assembly for AI-vs-AI battles.
 *
 * Builds a playable EngineState directly (same fixture style the engine test
 * suite uses — the engine has no "menu" bootstrap to reuse headlessly):
 * real general definitions from data/generals.ts, real card names from
 * data/cards.ts, seeded sampling, and optional editor-style `runtime` skill
 * payloads so the compiler → trigger → effect pipeline is exercised in every
 * batch (production built-in generals are description-only otherwise).
 */
import type { EngineState, EnginePlayer } from '../core/GameState';
import { allGenerals, type General, type Skill } from '../data/generals';
import { createCardDeck, type CardType } from '../data/cards';
import { cloneWithRuntimeInstance } from '../utils/runtimeIdentity';

export interface MatchConfig {
  seed: number;
  playerCount: number;
  poolPerPlayer: number;
  deckSize: number;
  /** 0..1 — probability a pool general carries an executable practice skill. */
  skillInjection: number;
  baseHp: number;
}

export function defaultMatchConfig(seed: number, overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed,
    playerCount: 2,
    poolPerPlayer: 8,
    deckSize: 60,
    skillInjection: 0.35,
    baseHp: 6,
    ...overrides,
  };
}

/** Executable skill templates using only compiler-settled triggers/effects (2.1.0 scope). */
const PRACTICE_SKILLS: Skill[] = [
  {
    name: '演練・勤学',
    description: 'AI 演練注入：回合开始时摸一张牌',
    effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  },
  {
    name: '演練・敛权',
    description: 'AI 演練注入：受到伤害后摸一张牌',
    effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  },
  {
    name: '演練・回刺',
    description: 'AI 演練注入：成为攻击目标时反弹 1 点伤害',
    effects: [{ id: 'e1', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } }],
  },
];

function takeRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length) % items.length];
}

function sampleGenerals(count: number): General[] {
  // Fisher-Yates on a shallow index array; wrap-around clone if demand exceeds supply.
  const pool = [...allGenerals];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: General[] = [];
  for (let i = 0; i < count; i += 1) out.push(pool[i % pool.length]);
  return out;
}

export function buildMatchState(config: MatchConfig): EngineState {
  const sampled = sampleGenerals(config.playerCount * config.poolPerPlayer);
  const players: EnginePlayer[] = [];
  // Deterministic instance ids: cloneWithRuntimeInstance embeds Date.now() +
  // a module counter, which would make a replayed match mint DIFFERENT card
  // identities than the recorded run. Overstamping with seed-derived ids
  // keeps `--replay` byte-comparable.
  let serial = 0;
  const stamp = (card: { id: string }) => {
    (card as { instanceId?: string }).instanceId = `ai${config.seed}_c${serial}`;
    serial += 1;
    return card;
  };

  for (let index = 0; index < config.playerCount; index += 1) {
    const id = index + 1;
    const generalPool: General[] = [];
    for (const source of sampled.slice(index * config.poolPerPlayer, (index + 1) * config.poolPerPlayer)) {
      const copy = cloneWithRuntimeInstance(source) as General;
      copy.id = `${source.id}_p${id}`;
      stamp(copy);
      if (Math.random() < config.skillInjection) {
        const skill = cloneWithRuntimeInstance({ ...takeRandom(PRACTICE_SKILLS) } as never) as unknown as Skill;
        skill.effects = (skill.effects ?? []).map((effect, i) => ({ ...effect, id: `e${i + 1}` }));
        copy.skills = [...(copy.skills ?? []), skill];
      }
      generalPool.push(copy);
    }
    players.push({
      id,
      name: `AI-${id}`,
      hand: [],
      generalPool,
      fieldGenerals: [],
      graveyard: [],
      baseHp: config.baseHp,
      baseMaxHp: config.baseHp,
      isAlive: true,
      statuses: [],
    });
  }

  // Shared card pile from the real card list (createCardDeck shuffles via the
  // seeded Math.random patch), topped up with clones if deckSize exceeds it.
  const deckTemplate = createCardDeck();
  const types: CardType[] = ['粮草', '材料', '军备'];
  const deck: unknown[] = [];
  for (let i = 0; i < config.deckSize; i += 1) {
    const base = i < deckTemplate.length
      ? deckTemplate[i]
      : { id: `refill_${i}`, name: types[i % types.length], type: types[i % types.length] };
    const copy = cloneWithRuntimeInstance(base as never) as { id: string };
    copy.id = `${copy.id}_d${i}`;
    stamp(copy);
    deck.push(copy);
  }

  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0].id,
    turn: 0,
    round: 1,
    deck,
    discardPile: [],
    metadata: { roomId: `ai-battle-${config.seed}` },
    drawState: null,
  };
}
