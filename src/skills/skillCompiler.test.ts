import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  compileSkill,
  compileGeneralSkills,
  syncPlayerSkills,
  getCompileDiagnostics,
  __resetCompileWarnDedup,
} from './skillCompiler';
import { GameEngine } from '../core/GameEngine';
import { createInitialEngineState } from '../core/GameState';
import type { EngineState } from '../core/GameState';
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

  it('compiles HEAL/GAIN_ARMOR effects now that EventProcessor settles them', () => {
    const heal = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'HEAL', value: 2, target: 'SELF' } }] }),
      'g1',
    );
    expect(heal.definitions).toHaveLength(1);
    expect(heal.skipped).toHaveLength(0);
    expect(heal.definitions[0].effects[0]).toMatchObject({ type: 'HEAL', value: 2, target: 'SELF' });

    const armor = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'GAIN_ARMOR', value: 2 } }] }),
      'g1',
    );
    expect(armor.definitions).toHaveLength(1);
    expect(armor.definitions[0].effects[0]).toMatchObject({ type: 'GAIN_ARMOR', value: 2 });
  });

  it('compiles DISCARD effects — 2.5.0 fifth primitive (value 0 is the whole-hand sentinel)', () => {
    const one = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'DISCARD', value: 1, target: 'ATTACKER' } }] }),
      'g1',
    );
    expect(one.definitions).toHaveLength(1);
    expect(one.skipped).toHaveLength(0);
    expect(one.definitions[0].effects[0]).toMatchObject({ type: 'DISCARD', value: 1, target: 'ATTACKER' });

    const all = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDeath' }, runtime: { type: 'DISCARD', value: 0, target: 'ATTACKER' } }] }),
      'g1',
    );
    expect(all.definitions[0].effects[0]).toMatchObject({ type: 'DISCARD', value: 0, target: 'ATTACKER' });
  });

  it('compiles GIVE effects and onCardLost/onCardGained triggers — 2.5.3 wiring (non-content cut)', () => {
    const give = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'GIVE', value: 2, target: 'TARGET' } }] }),
      'g1',
    );
    expect(give.definitions).toHaveLength(1);
    expect(give.skipped).toHaveLength(0);
    expect(give.definitions[0].effects[0]).toMatchObject({ type: 'GIVE', value: 2, target: 'TARGET' });

    const lost = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onCardLost' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] }),
      'g1',
    );
    expect(lost.definitions).toHaveLength(1);
    expect(lost.definitions[0].trigger).toBe('onCardLost');

    const gained = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onCardGained' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] }),
      'g1',
    );
    expect(gained.definitions).toHaveLength(1);
    expect(gained.definitions[0].trigger).toBe('onCardGained');
  });

  it('compiles card predicates to cardFilter and skips contradictory combos — v2.6.2 事件源扩面', () => {
    const lost3 = (sub: string) => compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onCardLost', cardSubType: sub } as never, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] }),
      'g1',
    );
    expect(lost3('equipmentLost').definitions[0].cardFilter).toBe('equipment');
    expect(lost3('lastHandLost').definitions[0].cardFilter).toBe('lastHand');
    expect(lost3('handLost').definitions[0].cardFilter).toBe('hand');
    expect(lost3('anyLost').definitions[0].cardFilter).toBeUndefined();
    // 未设定细分 = 扩面前宽松口径
    expect(lost3('').definitions[0].cardFilter).toBeUndefined();

    // 方向矛盾诚实跳过：获得触发配失去谓词 / 失去触发配获得谓词
    const crossed = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onCardGained', cardSubType: 'lastHandLost' } as never, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] }),
      'g1',
    );
    expect(crossed.definitions).toHaveLength(0);
    expect(crossed.skipped[0]?.reason).toBe('TRIGGER_SUBTYPE_UNSUPPORTED');
    const crossed2 = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onCardLost', cardSubType: 'anyGained' } as never, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] }),
      'g1',
    );
    expect(crossed2.definitions).toHaveLength(0);
    expect(crossed2.skipped[0]?.reason).toBe('TRIGGER_SUBTYPE_UNSUPPORTED');

    // 获得侧谓词无事件源（本刀仅 anyGained 宽松口径可用）
    const gainedLoose = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onCardGained', cardSubType: 'anyGained' } as never, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }] }),
      'g1',
    );
    expect(gainedLoose.definitions).toHaveLength(1);
    expect(gainedLoose.definitions[0].cardFilter).toBeUndefined();
  });

  it('compiles REVEAL/DECK_PLACE effects and forwards dest — 2.6.1 牌堆顶能力层（非内容刀）', () => {
    const reveal = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'REVEAL', value: 2, target: 'SELF' } }] }),
      'g1',
    );
    expect(reveal.definitions).toHaveLength(1);
    expect(reveal.skipped).toHaveLength(0);
    expect(reveal.definitions[0].effects[0]).toMatchObject({ type: 'REVEAL', value: 2, target: 'SELF' });

    const bottom = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onTurnEnd' }, runtime: { type: 'DECK_PLACE', value: 1, target: 'SELF' } }] }),
      'g1',
    );
    expect(bottom.definitions).toHaveLength(1);
    expect(bottom.definitions[0].effects[0]).toMatchObject({ type: 'DECK_PLACE', value: 1, target: 'SELF' });
    expect(bottom.definitions[0].effects[0].dest).toBeUndefined(); // 缺省即牌堆底

    const top = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onTurnEnd' }, runtime: { type: 'DECK_PLACE', value: 0, target: 'SELF', dest: 'TOP' } }] }),
      'g1',
    );
    expect(top.definitions[0].effects[0]).toMatchObject({ type: 'DECK_PLACE', value: 0, dest: 'TOP' });
  });

  it('compiles a DUEL effect with no value — 2.8 刀9 决斗原语（第 10 个可结算类型，轮数归规则）', () => {
    const duel = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDamageDealt' }, runtime: { type: 'DUEL', target: 'TARGET' } }] }),
      'g1',
    );
    expect(duel.definitions).toHaveLength(1);
    expect(duel.skipped).toHaveLength(0);
    expect(duel.definitions[0].effects[0]).toMatchObject({ type: 'DUEL', target: 'TARGET' });
    expect(duel.definitions[0].effects[0].value).toBeUndefined(); // 无数量可填≠偷偷塞一个 1
  });

  it('choice 模式（2.6.3）：同触发两个带 runtime 效果 → 一张 choiceMode 定义（多 effects 一触发）', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({
        effectMode: 'choice',
        effects: [
          { id: 'e1', description: '摸一张牌', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1 } },
          { id: 'e2', description: '造成1点伤害', trigger: { type: 'onTurnStart' }, runtime: { type: 'DAMAGE', value: 1 } },
        ],
      }),
      'g1',
    );
    expect(skipped).toHaveLength(0);
    expect(definitions).toHaveLength(1);
    const def = definitions[0];
    expect(def.choiceMode).toBe(true);
    expect(def.id).toBe('g1:测试技能:choice');
    expect(def.trigger).toBe('onTurnStart');
    expect(def.effectId).toBeUndefined();
    // 选项 label = 效果描述透传（缺省回退技能描述），数据序=枚举序
    expect(def.effects.map(e => e.description)).toEqual(['摸一张牌', '造成1点伤害']);
    expect(def.effects.map(e => e.type)).toEqual(['DRAW_CARD', 'DAMAGE']);
  });

  it('choice 模式（2.6.3）：孤立效果照常独立定义（id 形态与今日一致），不支持项照常诚实 skip', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({
        effectMode: 'choice',
        effects: [
          { id: 'e1', trigger: { type: 'onTurnStart' }, runtime: { type: 'DRAW_CARD', value: 1 } },
          { id: 'e2', trigger: { type: 'onDamageTaken' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } },
          { id: 'e3', trigger: { type: 'onTurnStart' } }, // 无 runtime → 诚实 skip
          { id: 'e4', trigger: { type: 'modifyStat' } as never, runtime: { type: 'DRAW_CARD', value: 1 } }, // 触发不支持
        ],
      }),
      'g1',
    );
    expect(definitions).toHaveLength(2);
    expect(definitions.every(d => !d.choiceMode)).toBe(true);
    expect(definitions.map(d => d.id)).toEqual(['g1:测试技能:e1', 'g1:测试技能:e2']);
    expect(skipped.map(s => s.reason)).toEqual(['NO_RUNTIME_PAYLOAD', 'TRIGGER_UNSUPPORTED']);
  });

  it('choice 模式撞同触发但 damageTypeFilter 不同 → 不同签名不合并（触发时点不同即无可择）', () => {
    const { definitions } = compileSkill(
      general(),
      skill({
        effectMode: 'choice',
        effects: [
          { id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' } as never, runtime: { type: 'DRAW_CARD', value: 1 } },
          { id: 'e2', trigger: { type: 'onDamageTaken', damageSubType: 'skillDamage' } as never, runtime: { type: 'DRAW_CARD', value: 1 } },
        ],
      }),
      'g1',
    );
    expect(definitions).toHaveLength(2);
    expect(definitions.every(d => !d.choiceMode)).toBe(true);
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

  it('compiles onBecomingTarget — 2.3.0 mapped it onto the existing BEFORE_DAMAGE event', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({
        effects: [{ id: 'e1', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } }],
      }),
      'g1',
    );
    expect(skipped).toHaveLength(0);
    expect(definitions).toHaveLength(1);
    expect(definitions[0].trigger).toBe('onBecomingTarget');
    expect(definitions[0].effects[0]).toMatchObject({ type: 'DAMAGE', target: 'ATTACKER' });
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

function stateWithGenerals(generals: General[]): EngineState {
  const state = createInitialEngineState();
  state.players = [
    { id: 1, name: 'P1', fieldGenerals: generals.map(g => ({ general: g, ownerId: 1 })) },
    { id: 2, name: 'P2', fieldGenerals: [] },
  ];
  return state;
}

describe('skillCompiler · compile-skip diagnostics (2.3.0, D-9 class C)', () => {
  beforeEach(() => {
    __resetCompileWarnDedup();
  });

  it('skipped entries land in the out-of-band channel with their reason', () => {
    const state = stateWithGenerals([
      general({ id: 'diag_001', skills: [{ name: '诊断甲', description: '纯描述' }] }),
    ]);
    const engine = new GameEngine(state);
    syncPlayerSkills(engine, state);

    const diagnostics = getCompileDiagnostics(engine);
    expect(diagnostics).not.toBeNull();
    expect(diagnostics!.skips).toHaveLength(1);
    expect(diagnostics!.skips[0]).toMatchObject({ skillName: '诊断甲', reason: 'NO_RUNTIME_PAYLOAD' });
  });

  it('the same skipped entry warns exactly once, not once per resync', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state = stateWithGenerals([
        general({ id: 'warn_001', skills: [{ name: '聚合甲', description: '纯描述' }] }),
      ]);
      const engine = new GameEngine(state);
      syncPlayerSkills(engine, state);
      syncPlayerSkills(engine, state); // the resident path resyncs before every dispatch

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('聚合甲');
      expect(String(warn.mock.calls[0][0])).toContain('NO_RUNTIME_PAYLOAD');
    } finally {
      warn.mockRestore();
    }
  });

  it('a newly deployed skipped skill earns one more warn; old entries never repeat', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state = stateWithGenerals([
        general({ id: 'sig_001', skills: [{ name: '签名单甲', description: '纯描述' }] }),
      ]);
      const engine = new GameEngine(state);
      syncPlayerSkills(engine, state);

      state.players[0].fieldGenerals = [
        ...(state.players[0].fieldGenerals as any[]),
        {
          general: general({ id: 'sig_002', skills: [{ name: '签名新乙', description: '纯描述' }] }),
          ownerId: 1,
        },
      ];
      syncPlayerSkills(engine, state);
      syncPlayerSkills(engine, state);

      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1][0])).toContain('签名新乙');
      expect(String(warn.mock.calls[1][0])).not.toContain('签名单甲');
    } finally {
      warn.mockRestore();
    }
  });

  it('an assembly without skips reports nothing and never warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state = stateWithGenerals([
        general({
          id: 'clean_001',
          skills: [{
            name: '合规技',
            effects: [{ id: 'e1', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } }],
          }],
        }),
      ]);
      const engine = new GameEngine(state);
      expect(syncPlayerSkills(engine, state)).toBe(1);

      expect(getCompileDiagnostics(engine)).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// ── v2.8.3 刀 B：门槛（per-effect conditions）只透传，不在编译期求值 ──
describe('skillCompiler · 发动门槛透传', () => {
  it('passes an effect-level gate through onto the compiled definition', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({
        effects: [{
          id: 'e1',
          trigger: { type: 'onTurnEnd' },
          runtime: { type: 'HEAL', value: 1, target: 'SELF' },
          conditions: [{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }],
        }],
      }),
      'g1',
    );
    expect(skipped).toHaveLength(0);
    expect(definitions[0].conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }]);
  });

  it('an effect without a gate compiles with no conditions key set', () => {
    const { definitions } = compileSkill(general(), skill(), 'g1');
    expect(definitions[0].conditions).toBeUndefined();
  });

  it('an empty conditions array is treated as "no gate"', () => {
    const { definitions } = compileSkill(
      general(),
      skill({ effects: [{ id: 'e1', trigger: { type: 'onDamageTaken' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' }, conditions: [] }] }),
      'g1',
    );
    expect(definitions[0].conditions).toBeUndefined();
  });

  it('v2.8.11 刀2：选择其一带逐项门槛照常编译，门槛骑在各自效果上', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({
        effectMode: 'choice',
        effects: [
          { id: 'a', trigger: { type: 'onTurnEnd' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
          { id: 'b', trigger: { type: 'onTurnEnd' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' }, conditions: [{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }] },
        ],
      }),
      'g1',
    );
    expect(skipped).toHaveLength(0);
    expect(definitions).toHaveLength(1);
    const [def] = definitions;
    expect(def.choiceMode).toBe(true);
    // 逐项门槛：只挂在那一条效果上，另一条一字未动（无 conditions 键）。
    expect(def.effects[0]).toEqual({ type: 'HEAL', value: 1, target: 'SELF' });
    expect(def.effects[1]!.conditions).toEqual([{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }]);
    // 没写整组门槛⇒定义级槽仍空（整组不拦）。
    expect(def.conditions).toBeUndefined();
  });

  it('v2.8.11 刀2：整组门槛落在选择定义的 conditions 槽，与逐项门槛分两级', () => {
    const { definitions } = compileSkill(
      general(),
      skill({
        effectMode: 'choice',
        conditions: [{ metric: 'GENERAL_HP', op: 'LTE', value: 1 }],
        effects: [
          { id: 'a', trigger: { type: 'onTurnEnd' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
          { id: 'b', trigger: { type: 'onTurnEnd' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' }, conditions: [{ metric: 'HAND_COUNT', op: 'EQ', value: 0 }] },
        ],
      }),
      'g1',
    );
    expect(definitions[0].conditions).toEqual([{ metric: 'GENERAL_HP', op: 'LTE', value: 1 }]);
    expect(definitions[0].effects[1]!.conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 0 }]);
    expect(definitions[0].effects[0]!.conditions).toBeUndefined();
  });

  it('v2.8.11 刀2：单效果定义把两级门槛并成一槽，整组在前（AND 语义）', () => {
    const { definitions } = compileSkill(
      general(),
      skill({
        conditions: [{ metric: 'GENERAL_HP', op: 'LTE', value: 1 }],
        effects: [{
          id: 'e1',
          trigger: { type: 'onDamageTaken' },
          runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
          conditions: [{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }],
        }],
      }),
      'g1',
    );
    expect(definitions[0].conditions).toEqual([
      { metric: 'GENERAL_HP', op: 'LTE', value: 1 },
      { metric: 'HAND_COUNT', op: 'EQ', value: 1 },
    ]);
  });

  it('无门槛的选择组形状与 v2.8.10 逐字一致（不多不少一个键）', () => {
    const { definitions } = compileSkill(
      general(),
      skill({
        effectMode: 'choice',
        effects: [
          { id: 'a', trigger: { type: 'onTurnEnd' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' } },
          { id: 'b', trigger: { type: 'onTurnEnd' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        ],
      }),
      'g1',
    );
    expect(definitions[0].effects).toEqual([
      { type: 'HEAL', value: 1, target: 'SELF' },
      { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    ]);
    expect(definitions[0].conditions).toBeUndefined();
  });

  it('a gated option that stands alone still compiles (no choice group formed)', () => {
    const { definitions, skipped } = compileSkill(
      general(),
      skill({
        effectMode: 'choice',
        effects: [
          { id: 'a', trigger: { type: 'onTurnEnd' }, runtime: { type: 'HEAL', value: 1, target: 'SELF' }, conditions: [{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }] },
          { id: 'b', trigger: { type: 'onDamageTaken' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
        ],
      }),
      'g1',
    );
    expect(skipped).toHaveLength(0);
    expect(definitions).toHaveLength(2);
    expect(definitions.find(d => d.id.endsWith(':a'))!.conditions).toHaveLength(1);
  });
});
