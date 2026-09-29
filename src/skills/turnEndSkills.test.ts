/**
 * 2.3.1 — turn-end skill derivation (turnEndSkills) and its compiler gate.
 * The ask window, legalActions and the resolver all read THIS module, so
 * these tests pin the single-source-of-truth shape: pure (EngineState →
 * candidates), ledger-subtractive, once-per-turn keyed, never state-mutating.
 */
import { describe, it, expect } from 'vitest';
import {
  listAllTurnEndDefinitions,
  listTurnEndAskItems,
  listTurnEndSkillCandidates,
  findTurnEndSkillCandidate,
  isCurrentTurnOwner,
} from './turnEndSkills';
import { compileSkill } from './skillCompiler';
import { createInitialEngineState } from '../core/GameState';
import type { ConsumedSkill, EngineState } from '../core/GameState';
import type { General, Skill } from '../data/generals';

function turnEndSkill(name = '守夜', runtime: NonNullable<Skill['effects']>[number]['runtime'] = { type: 'DRAW_CARD', value: 1, target: 'SELF' }): Skill {
  return {
    name,
    description: '回合结束时可发动',
    effects: [{ id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime }],
  };
}

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id, instanceId: id, name: '将' + id, faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
  } as unknown as General;
}

function stateWithField(playerId: number, generals: General[]): EngineState {
  const state = createInitialEngineState();
  state.players = [
    { id: playerId, name: 'P' + playerId, fieldGenerals: generals.map(g => ({ general: g, ownerId: playerId })) } as any,
    { id: playerId === 1 ? 2 : 1, name: 'P-other', fieldGenerals: [] } as any,
  ];
  state.currentPlayerId = playerId;
  return state;
}

describe('turnEndSkills · candidate derivation (2.3.1)', () => {
  it('derives the onTurnEnd definition of a field general from EngineState alone (no engine, no registry)', () => {
    const state = stateWithField(1, [makeGeneral('g_watch', [turnEndSkill()])]);
    const candidates = listTurnEndSkillCandidates(state, 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      playerId: 1,
      generalId: 'g_watch',
      generalName: '将g_watch',
    });
    expect(candidates[0].definition).toMatchObject({
      id: 'g_watch:守夜:e1',
      trigger: 'onTurnEnd',
      turnSubType: 'selfTurn',
      effectId: 'e1',
    });
  });

  it('otherTurn definitions never become candidates (and never compile)', () => {
    const state = stateWithField(1, [makeGeneral('g_other', [{
      name: '守界',
      effects: [{ id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'otherTurn' }, runtime: { type: 'DRAW_CARD', value: 1 } }],
    }])]);
    expect(listAllTurnEndDefinitions(state, 1)).toHaveLength(0);
    expect(listTurnEndSkillCandidates(state, 1)).toHaveLength(0);
  });

  it('the consumedSkills ledger subtracts only the SAME turn + player keys', () => {
    const state = stateWithField(1, [makeGeneral('g_watch', [turnEndSkill()])]);
    state.turn = 7;
    const defId = 'g_watch:守夜:e1';
    const consumedOtherPlayer: ConsumedSkill = { stableId: `7:${defId}`, skillId: defId, turn: 7, playerId: 2 };
    const consumedPrevTurn: ConsumedSkill = { stableId: `6:${defId}`, skillId: defId, turn: 6, playerId: 1 };
    state.consumedSkills = [consumedOtherPlayer, consumedPrevTurn];
    expect(listTurnEndSkillCandidates(state, 1)).toHaveLength(1);

    state.consumedSkills = [{ stableId: `7:${defId}`, skillId: defId, turn: 7, playerId: 1 }];
    expect(listTurnEndSkillCandidates(state, 1)).toHaveLength(0);
    // Unfiltered view stays honest: the definition exists, it is spent.
    expect(listAllTurnEndDefinitions(state, 1)).toHaveLength(1);
  });

  it('generals off the field (hand/graveyard) are never candidates — recompile per query', () => {
    const state = createInitialEngineState();
    state.players = [
      { id: 1, name: 'P1', fieldGenerals: [], hand: [makeGeneral('g_watch', [turnEndSkill()])] } as any,
      { id: 2, name: 'P2', fieldGenerals: [] } as any,
    ];
    expect(listTurnEndSkillCandidates(state, 1)).toHaveLength(0);
  });

  it('findTurnEndSkillCandidate addresses by skillId + generalId; isCurrentTurnOwner gates the seat', () => {
    const state = stateWithField(1, [makeGeneral('g_watch', [turnEndSkill()])]);
    expect(findTurnEndSkillCandidate(state, 1, 'g_watch:守夜:e1', 'g_watch')).not.toBeNull();
    expect(findTurnEndSkillCandidate(state, 1, 'g_watch:守夜:e9', 'g_watch')).toBeNull();
    expect(findTurnEndSkillCandidate(state, 1, 'g_watch:守夜:e1', 'other')).toBeNull();
    expect(isCurrentTurnOwner(state, 1)).toBe(true);
    expect(isCurrentTurnOwner(state, 2)).toBe(false);
  });
});

describe('turnEndSkills · ask-item status (2.8.17 #42 两档提示)', () => {
  /** 带门槛的回合结束技能：自身体力≥99 在测试场上永远不成立。 */
  function gatedGeneral(id: string): General {
    return makeGeneral(id, [{
      name: '蓄锐',
      description: '体力充沛时补充手牌',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
        conditions: [{ metric: 'GENERAL_HP', op: 'GTE', value: 99 }],
      }],
    }]);
  }

  it('完整视图把不满足门槛的技能也列出：activatable=false ＋ 大白话原因', () => {
    const state = stateWithField(1, [gatedGeneral('g_gate')]);
    const items = listTurnEndAskItems(state, 1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      generalId: 'g_gate',
      activatable: false,
      disabledReason: '不满足发动门槛：体力≥99',
    });
    // 合法集合一位未放宽：置灰项绝不混进 candidates。
    expect(listTurnEndSkillCandidates(state, 1)).toHaveLength(0);
  });

  it('没有门槛的技能＝可发动，且没有原因文本', () => {
    const state = stateWithField(1, [makeGeneral('g_watch', [turnEndSkill()])]);
    const items = listTurnEndAskItems(state, 1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ activatable: true, disabledReason: null });
  });

  it('本回合已用过的优先说「本回合已发动过」——账本是不可逆事实，门槛只是此刻战场', () => {
    const state = stateWithField(1, [gatedGeneral('g_gate')]);
    state.turn = 5;
    state.consumedSkills = [{
      stableId: '5:g_gate:蓄锐:e1', skillId: 'g_gate:蓄锐:e1', turn: 5, playerId: 1,
    }];
    const items = listTurnEndAskItems(state, 1);
    expect(items[0].disabledReason).toBe('本回合已发动过');
  });

  it('单一事实源：candidates 恒等于 items 的 activatable 子集（同序同键）', () => {
    const state = stateWithField(1, [
      makeGeneral('g_watch', [turnEndSkill()]),
      gatedGeneral('g_gate'),
    ]);
    const items = listTurnEndAskItems(state, 1);
    expect(items.map(i => i.definition.id)).toEqual([
      'g_watch:守夜:e1',
      'g_gate:蓄锐:e1',
    ]);
    expect(listTurnEndSkillCandidates(state, 1)).toEqual(
      items.filter(i => i.activatable).map(({ playerId, generalId, generalName, definition }) => ({
        playerId, generalId, generalName, definition,
      })),
    );
  });

  it('otherTurn 在两档里都不可见（编译层诚实跳过，不是靠过滤遮丑）', () => {
    const state = stateWithField(1, [makeGeneral('g_other', [{
      name: '守界',
      effects: [{ id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'otherTurn' }, runtime: { type: 'DRAW_CARD', value: 1 } }],
    }])]);
    expect(listTurnEndAskItems(state, 1)).toHaveLength(0);
  });
});

describe('skillCompiler · onTurnEnd gate (2.3.1)', () => {
  it('compiles onTurnEnd with effectId + turnSubType retained for ACTIVATE_SKILL addressing', () => {
    const { definitions, skipped } = compileSkill(
      { id: 'g1', name: '甲' },
      turnEndSkill(),
      'g1',
    );
    expect(skipped).toHaveLength(0);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      trigger: 'onTurnEnd',
      effectId: 'e1',
      turnSubType: 'selfTurn',
    });
  });

  it('skips onTurnEnd otherTurn — the ask window only belongs to the current turn owner', () => {
    const { definitions, skipped } = compileSkill(
      { id: 'g1', name: '甲' },
      {
        name: '守界',
        effects: [{ id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'otherTurn' }, runtime: { type: 'DRAW_CARD', value: 1 } }],
      },
      'g1',
    );
    expect(definitions).toHaveLength(0);
    expect(skipped[0].reason).toBe('TRIGGER_SUBTYPE_UNSUPPORTED');
  });
});
