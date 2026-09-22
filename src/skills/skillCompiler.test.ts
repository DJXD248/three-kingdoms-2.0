import { describe, it, expect } from 'vitest';
import { compileSkill, compileGeneralSkills, syncPlayerSkills } from './skillCompiler';
import { GameEngine } from '../core/GameEngine';
import { createInitialEngineState } from '../core/GameState';
import type { General, Skill } from '../data/generals';

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: '测试技能',
    effects: [
      {
        id: 'e1',
        trigger: { type: 'onDamageTaken' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      },
    ],
    ...overrides,
  };
}

function general(overrides: Partial<General> = {}): General {
  return {
    id: 'test_001',
    name: '测试将',
    faction: '魏',
    hp: 3,
    type: '文将',
    meleeAtk: 1,
    rangedAtk: 2,
    armor: 0,
    skills: [],
    ...overrides,
  };
}

describe('skillCompiler · compileSkill', () => {
  it('compiles a supported trigger with a structured runtime payload', () => {
    const { definitions, skipped } = compileSkill(general(), skill(), 'g1');
    expect(skipped).toHaveLength(0);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      id: 'g1:测试技能:e1',
      name: '测试技能',
      trigger: 'onDamageTaken',
      sourceGeneralId: 'g1',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
  });

  it('falls back to the skill-level trigger when the effect has none', () => {
    const { definitions } = compileSkill(
      general(),
      skill({
        trigger: { type: 'onTurnStart' },
        effects: [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
      }),
      'g1',
    );
    expect(definitions[0].trigger).toBe('onTurnStart');
  });

  it('skips descriptive built-in skills without runtime payloads', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      { name: '奸雄', description: '受到伤害后摸一张牌' },
      'g1',
    );
    expect(definitions).toHaveLength(0);
    expect(skipped[0].reason).toBe('NO_RUNTIME_PAYLOAD');
  });

  it('skips triggers that have no engine event backing', () => {
    for (const type of ['modifyAttack', 'modifyDefense', 'passive', 'activeSelf', 'untilExpire'] as const) {
      const { definitions, skipped } = compileSkill(
        general(),
        skill({ effects: [{ id: 'e1', trigger: { type }, runtime: { type: 'DRAW_CARD', value: 1 } }] }),
        'g1',
      );
      expect(definitions, type).toHaveLength(0);
      expect(skipped[0].reason, type).toBe('TRIGGER_UNSUPPORTED');
    }
  });

  it('skips onTurnStart otherTurn subtype (no event support yet)', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({
        effects: [{ id: 'e1', trigger: { type: 'onTurnStart', turnSubType: 'otherTurn' }, runtime: { type: 'DRAW_CARD', value: 1 } }],
      }),
      'g1',
    );
    expect(definitions).toHaveLength(0);
    expect(skipped[0].reason).toBe('TRIGGER_SUBTYPE_UNSUPPORTED');
  });

  it('maps damage subtypes to a damage-type filter', () => {
    const attack = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' }, runtime: { type: 'DRAW_CARD', value: 1 } }] }),
      'g1',
    );
    expect(attack.definitions[0].damageTypeFilter).toBe('attack');

    const fromSkill = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'skillDamage' }, runtime: { type: 'DRAW_CARD', value: 1 } }] }),
      'g1',
    );
    expect(fromSkill.definitions[0].damageTypeFilter).toBe('skill');

    const all = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'DRAW_CARD', value: 1 } }] }),
      'g1',
    );
    expect(all.definitions[0].damageTypeFilter).toBeUndefined();
  });

  it('skips killAlly subtype because the engine never emits ally DEATH events', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onKill', killSubType: 'killAlly' }, runtime: { type: 'DAMAGE', value: 1 } }] }),
      'g1',
    );
    expect(definitions).toHaveLength(0);
    expect(skipped[0].reason).toBe('TRIGGER_SUBTYPE_UNSUPPORTED');
  });

  it('skips HEAL/GAIN_ARMOR effects that have no state handler yet', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDeath' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } }] }),
      'g1',
    );
    expect(definitions).toHaveLength(0);
    expect(skipped[0].reason).toBe('EFFECT_TYPE_UNSUPPORTED');
  });

  it('skips choice-mode skills until the reaction window is wired', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({
        effectMode: 'choice',
        effects: [
          { id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1 } },
          { id: 'e2', trigger: { type: 'onTurnStart' }, runtime: { type: 'DAMAGE', value: 1 } },
        ],
      }),
      'g1',
    );
    expect(definitions).toHaveLength(0);
    expect(skipped.every(s => s.reason === 'CHOICE_MODE_UNSUPPORTED')).toBe(true);
  });

  it('compiles each independently-triggered effect into its own definition', () => {
    const { definitions } = compileSkill(
      general(),
      skill({
        effects: [
          { id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1 } },
          { id: 'e2', trigger: { type: 'onDamageTaken' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } },
        ],
      }),
      'g1',
    );
    expect(definitions).toHaveLength(2);
    expect(definitions.map(d => d.trigger)).toEqual(['onTurnStart', 'onDamageTaken']);
  });
});

describe('skillCompiler · compileGeneralSkills', () => {
  it('aggregates across all skills of a general', () => {
    const g = general({
      skills: [
        skill({ name: '技能甲' }),
        { name: '技能乙', description: '纯描述' },
      ],
    });
    const { definitions, skipped } = compileGeneralSkills(g, 'g9');
    expect(definitions).toHaveLength(1);
    expect(definitions[0].name).toBe('技能甲');
    expect(skipped.some(s => s.reason === 'NO_RUNTIME_PAYLOAD')).toBe(true);
  });
});

describe('skillCompiler · syncPlayerSkills', () => {
  it('registers compiled skills of field generals into a fresh engine', () => {
    const state = createInitialEngineState();
    state.players = [
      {
        id: 1,
        name: 'P1',
        fieldGenerals: [
          {
            general: general({ skills: [skill({ name: '奸雄' })] }),
            ownerId: 1,
          },
        ],
      },
      { id: 2, name: 'P2', fieldGenerals: [] },
    ];
    const engine = new GameEngine(state);
    const count = syncPlayerSkills(engine, state);

    expect(count).toBe(1);
    const triggers = engine.triggers.getByOwner(1);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].eventType).toBe('DAMAGE');
    expect(triggers[0].id).toBe('skill:1:test_001:奸雄:e1');
  });

  it('registers nothing for descriptive built-in skills', () => {
    const state = createInitialEngineState();
    state.players = [
      {
        id: 1,
        name: 'P1',
        fieldGenerals: [
          {
            general: general({ skills: [{ name: '观星', description: '纯文字描述' }] }),
            ownerId: 1,
          },
        ],
      },
    ];
    const engine = new GameEngine(state);
    expect(syncPlayerSkills(engine, state)).toBe(0);
  });
});
