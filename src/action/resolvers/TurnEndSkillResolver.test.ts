/**
 * 2.3.1 — ACTIVATE_SKILL end-to-end through the canonical chain:
 * legalActions offers it, TurnEndSkillResolver decides it, EventProcessor
 * settles SKILL_ACTIVATED into the consumedSkills ledger, and TURN_END itself
 * never auto-fires (single-activation-path / double-fire ban). Also locks the
 * stale metadata.drawPlayerId deadlock fix (validator reads the window).
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../core/GameEngine';
import { createInitialEngineState } from '../../core/GameState';
import type { EngineState } from '../../core/GameState';
import { createAction } from '../ActionTypes';
import { syncPlayerSkills } from '../../skills/skillCompiler';
import type { General, Skill } from '../../data/generals';

const WATCH_SKILL: Skill = {
  name: '演練・守夜',
  description: '回合结束时：摸一张牌',
  effects: [{ id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
};

function watchGeneral(id = 'g_watch'): General {
  return {
    id, instanceId: id, name: '守夜将', faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [WATCH_SKILL],
  } as unknown as General;
}

function fieldOf(general: General, ownerId: number) {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [], isArming: false,
    hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone: 'camp', slot: 0, areaOwnerId: ownerId },
  };
}

function makeState(overrides: Partial<EngineState> = {}): EngineState {
  const state = createInitialEngineState();
  state.players = [
    { id: 1, name: 'P1', fieldGenerals: [fieldOf(watchGeneral(), 1)] } as any,
    { id: 2, name: 'P2', fieldGenerals: [] } as any,
  ];
  state.currentPlayerId = 1;
  state.phase = 'playing';
  state.timelinePhase = 'ACTION';
  state.turn = 5;
  state.deck = [
    { id: 'd1', name: '粮草', type: '粮草' },
    { id: 'd2', name: '材料', type: '材料' },
    { id: 'd3', name: '军备', type: '军备' },
  ];
  return { ...state, ...overrides };
}

function freshEngine(state: EngineState): GameEngine {
  const engine = new GameEngine(state, { recordHistory: false });
  syncPlayerSkills(engine, state);
  return engine;
}

const SKILL_ID = 'g_watch:演練・守夜:e1';

describe('ACTIVATE_SKILL · resolver verdicts (2.3.1)', () => {
  it('happy path: SKILL_ACTIVATED + DRAW effect event, ledger entry after settle', () => {
    const engine = freshEngine(makeState());
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: SKILL_ID, generalId: 'g_watch' }));
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
    const activation = events.find(e => e.type === 'SKILL_ACTIVATED');
    expect(activation?.data).toMatchObject({
      skillId: SKILL_ID,
      skillName: '演練・守夜',
      effectId: 'e1',
      generalId: 'g_watch',
      playerId: 1,
      stableId: `5:${SKILL_ID}`,
    });
    expect(events.some(e => e.type === 'DRAW' && (e.data as any).playerId === 1)).toBe(true);
    // A-class fact settled by EventProcessor — the ledger is state, not a container field.
    expect(engine.state.consumedSkills).toEqual([
      { stableId: `5:${SKILL_ID}`, skillId: SKILL_ID, turn: 5, playerId: 1 },
    ]);
    expect(engine.state.players[0].hand).toHaveLength(1); // the DRAW effect landed
  });

  it('rejections stay honest per gate, never a silent drop', () => {
    const rejectReason = (state: EngineState, skillId: unknown, generalId: unknown, playerId = 1): string => {
      const engine = freshEngine(state);
      const events = engine.dispatch(createAction('ACTIVATE_SKILL', playerId, { skillId, generalId }));
      return String((events.find(e => e.type === 'ACTION_REJECTED')?.data as any)?.reason ?? '');
    };
    const base = makeState();
    expect(rejectReason(base, '', 'g_watch')).toContain('INVALID_ACTIVATE_SKILL_PAYLOAD');
    expect(rejectReason(base, undefined, undefined)).toContain('INVALID_ACTIVATE_SKILL_PAYLOAD');
    expect(rejectReason(base, SKILL_ID, 'g_watch', 2)).toContain('NOT_CURRENT_PLAYER');
    // player 99: validator passes (players[0] is current), the resolver says PLAYER_NOT_FOUND
    const ghost = makeState({ currentPlayerId: 99 as any });
    expect(rejectReason(ghost, SKILL_ID, 'g_watch', 99)).toContain('PLAYER_NOT_FOUND');
    expect(rejectReason(base, 'no-such:skill:e1', 'g_watch')).toContain('TURN_END_SKILL_NOT_FOUND');
    expect(rejectReason(base, SKILL_ID, 'wrong_general')).toContain('GENERAL_NOT_CONTROLLED');
    const spent = makeState({ consumedSkills: [{ stableId: `5:${SKILL_ID}`, skillId: SKILL_ID, turn: 5, playerId: 1 }] });
    // "already used this turn" must be distinguishable from "not there"
    expect(rejectReason(spent, SKILL_ID, 'g_watch')).toContain('SKILL_ALREADY_ACTIVATED');
  });

  it('once-per-turn: second activation in the same turn is rejected; next turn it is legal again', () => {
    const engine = freshEngine(makeState());
    const act = () => engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: SKILL_ID, generalId: 'g_watch' }));
    expect(act().some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    const before = structuredClone(engine.state);
    expect(act().some(e => e.type === 'ACTION_REJECTED')).toBe(true);
    expect(engine.state.consumedSkills).toEqual(before.consumedSkills); // append-only, no double entry

    engine.state.turn += 1; // (real matches advance this via TURN_END)
    expect(act().some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    expect(engine.state.consumedSkills).toHaveLength(2);
  });

  it('TURN_END never auto-fires onTurnEnd (no TRIGGER_EVENTS entry — double-fire ban)', () => {
    const engine = freshEngine(makeState());
    const events = engine.dispatch(createAction('END_TURN', 1));
    expect(events.some(e => e.type === 'TURN_END')).toBe(true);
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(false);
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);
  });
});

describe('ACTIVATE_SKILL · legalActions enumeration (2.3.1)', () => {
  it('offered to the current player in the action window, absent once consumed, absent for others', () => {
    const state = makeState();
    const engine = freshEngine(state);
    const offers = engine.legalActions(1).filter(a => a.type === 'ACTIVATE_SKILL');
    expect(offers).toHaveLength(1);
    expect(offers[0].payload).toMatchObject({ skillId: SKILL_ID, generalId: 'g_watch' });
    expect(engine.legalActions(2).some(a => a.type === 'ACTIVATE_SKILL')).toBe(false);

    const spent = makeState({ consumedSkills: [{ stableId: `5:${SKILL_ID}`, skillId: SKILL_ID, turn: 5, playerId: 1 }] });
    expect(freshEngine(spent).legalActions(1).some(a => a.type === 'ACTIVATE_SKILL')).toBe(false);
  });

  it('never enumerated inside a draw window (phases stay exclusive)', () => {
    const drawing = makeState({
      phase: 'drawing',
      timelinePhase: 'DRAW',
      drawState: { reason: 'turnStart', playerId: 1, totalCards: 2, baseLossPending: false },
    });
    const actions = freshEngine(drawing).legalActions(1);
    expect(actions.every(a => a.type === 'DRAW' || a.type === 'CONFIRM_DRAW')).toBe(true);
  });

  it('enumerated ⇒ dispatchable: every offer including ACTIVATE_SKILL is accepted for real', () => {
    const state = makeState();
    const enumerator = freshEngine(structuredClone(state));
    for (const action of enumerator.legalActions(1)) {
      const probe = freshEngine(structuredClone(state));
      const events = probe.dispatch(action);
      expect(
        events.some(e => e.type === 'ACTION_REJECTED'),
        `${action.type} 枚举出却被拒绝: ${JSON.stringify(events.find(e => e.type === 'ACTION_REJECTED')?.data ?? {})}`,
      ).toBe(false);
    }
  });
});

describe('draw window authority (2.3.1 soak fix)', () => {
  it('a stale metadata.drawPlayerId mirror cannot lock the real window player out', () => {
    // The 2.3.1 seed-246 soak deadlocked exactly here: a compensation-resumed
    // window left metadata at the previous drawer while drawState moved on.
    const state = makeState({
      phase: 'drawing',
      timelinePhase: 'DRAW',
      currentPlayerId: 1,
      drawState: { reason: 'turnStart', playerId: 1, totalCards: 1, baseLossPending: false },
      metadata: { drawPlayerId: 2, drawReason: 'compensation' },
    });
    const engine = freshEngine(state);
    expect(engine.legalActions(1).length).toBeGreaterThan(0);
    expect(engine.legalActions(2)).toHaveLength(0);
    const events = engine.dispatch(createAction('CONFIRM_DRAW', 1));
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
  });
});
