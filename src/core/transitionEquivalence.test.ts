/**
 * TransitionCore reconciliation (decision D-1, v2.2.20):
 * the resident-engine path and the per-step rebuild path (store bridge,
 * ReplayPlayer) must produce IDENTICAL event streams and final state for
 * the same scripted match — including a skill kill that exercises the
 * bounded DEATH-reentry chain. This is the guard that lets the rebuild
 * path stay a valid reconciliation tool while the store migrates to a
 * long-lived engine.
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine';
import { cloneEngineState } from './GameState';
import type { EngineState, EnginePlayer } from './GameState';
import type { GameEvent } from './Event';
import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';
import type { General, Skill } from '../data/generals';
import { syncPlayerSkills } from '../skills/skillCompiler';
import { dispatchStoreAction } from '../store/engineExecutionBridge';
import { ReplayPlayer } from '../replay/ReplayPlayer';

function makeGeneral(id: string, hp: number, skills: Skill[]): General {
  return {
    id,
    name: '对账将' + id,
    faction: '魏',
    hp,
    type: '武将',
    meleeAtk: 2,
    rangedAtk: 1,
    armor: 0,
    skills,
  };
}

function makeFieldGeneral(general: General, ownerId: number, slot = 0) {
  return {
    general,
    currentHp: general.hp,
    maxHp: general.hp,
    meleeAtk: general.meleeAtk,
    rangedAtk: general.rangedAtk,
    armor: 0,
    currentArmor: 0,
    armorCards: [],
    isArming: false,
    hasMoved: false,
    hasAttacked: false,
    hasSupplied: false,
    justDeployed: false,
    ownerId,
    position: { zone: 'front' as const, slot, areaOwnerId: 1 },
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id,
    name: 'Player ' + id,
    hp: 4,
    hand: [],
    generalPool: [],
    fieldGenerals: [],
    graveyard: [],
    baseHp: 10,
    baseMaxHp: 10,
    isAlive: true,
    statuses: [],
    ...overrides,
  };
}

function makeState(players: EnginePlayer[]): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players,
    currentPlayerId: players[0]?.id ?? null,
    turn: 1,
    round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
      { id: 'deck_4', name: '粮草', type: '粮草' },
    ],
    discardPile: [],
    drawState: null,
  };
}

const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' };

/** EventBus.emit stamps id/timestamp in place — including events embedded
 * in TRIGGERED.data.sourceEvent and the time-derived rootEventId strings
 * built during expansion. The reconciliation compares the transition's
 * logical output, so all stamp-layer noise is normalized away (card/action
 * ids are untouched: they sit on objects without the event {type,data} shape). */
function isEventLike(value: Record<string, unknown>): boolean {
  return typeof value.type === 'string' && 'data' in value;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const eventLike = isEventLike(source);
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(source)) {
      if (key === 'rootEventId') continue;
      if (eventLike && (key === 'id' || key === 'timestamp')) continue;
      out[key] = normalize(nested);
    }
    return out;
  }
  return value;
}

function rawEvents(events: GameEvent[]): string[] {
  return events.map(event => JSON.stringify(normalize({ type: event.type, data: event.data })));
}

function buildInitial(): EngineState {
  // g1: 烈攻 kills g2 via the skill-damage follow-up → derived DEATH settles
  // inside process() and only fires 枭斩/遗志 through the bounded reentry loop.
  const killer = makeGeneral('g1', 4, [
    {
      name: '烈攻',
      effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' } }],
    },
    {
      name: '枭斩',
      effects: [{ id: 'e2', trigger: { type: 'onKill' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    },
  ]);
  const victim = makeGeneral('g2', 3, [
    {
      name: '遗志',
      effects: [{ id: 'e1', trigger: { type: 'onDeath' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    },
  ]);
  const survivor = makeGeneral('g3', 4, [
    {
      name: '奸雄',
      effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    },
  ]);
  return makeState([
    makePlayer(1, {
      fieldGenerals: [makeFieldGeneral(killer, 1)],
      hand: [ATTACK_COST],
    }),
    makePlayer(2, {
      fieldGenerals: [makeFieldGeneral(victim, 2), makeFieldGeneral(survivor, 2, 1)],
    }),
  ]);
}

const SCRIPT: GameAction[] = [
  createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
  createAction('END_TURN', 1), // blocked by the compensation draw window → rejected
  createAction('END_TURN', 1), // still blocked → rejected again
  createAction('END_TURN', 2),
];

function playResident(initial: EngineState): { steps: string[][]; final: EngineState; engine: GameEngine } {
  const engine = new GameEngine(cloneEngineState(initial));
  const steps: string[][] = [];
  for (const action of SCRIPT) {
    syncPlayerSkills(engine, engine.state);
    steps.push(rawEvents(engine.dispatch(action)));
  }
  return { steps, final: engine.state, engine };
}

function playRebuilt(initial: EngineState): { steps: string[][]; final: EngineState } {
  let state = cloneEngineState(initial);
  const steps: string[][] = [];
  for (const action of SCRIPT) {
    const result = dispatchStoreAction({ engineState: state }, action);
    state = result.engineState;
    steps.push(rawEvents(result.events));
  }
  return { steps, final: state };
}

describe('TransitionCore · 常驻 === 重建 (decision D-1)', () => {
  it('script guards: the match really contains a skill-kill reentry and a rejected action', () => {
    const { steps } = playResident(buildInitial());

    const killChain = steps[0].map(raw => JSON.parse(raw) as { type: string });
    expect(killChain.some(e => e.type === 'DEATH')).toBe(true);
    expect(killChain.some(e => e.type === 'TRIGGERED')).toBe(true);
    expect(steps[2]).toHaveLength(1);
    expect(JSON.parse(steps[2][0]).type).toBe('ACTION_REJECTED');
  });

  it('resident engine and per-step rebuilt bridge emit identical events and end in identical state', () => {
    const initial = buildInitial();
    const resident = playResident(initial);
    const rebuilt = playRebuilt(initial);

    expect(rebuilt.steps).toEqual(resident.steps);
    expect(JSON.stringify(rebuilt.final)).toBe(JSON.stringify(resident.final));
  });

  it('recorded replay plays back step-for-step identical to live (2.2.20 ReplayPlayer skill-registration fix)', () => {
    const initial = buildInitial();
    const resident = playResident(initial);

    const document = resident.engine.replay.getDocument();
    expect(document).not.toBeNull();

    const playback = new ReplayPlayer().play(document!);
    expect(playback.processed).toBe(SCRIPT.length);
    const playedSteps = playback.events.map(entry => rawEvents(entry.events));
    expect(playedSteps).toEqual(resident.steps);
    expect(JSON.stringify(playback.state)).toBe(JSON.stringify(resident.final));
  });
});
