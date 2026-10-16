/**
 * 修正器账本的端到端结算测试（2.8 刀4＝#25，§H5-2/3/4/7 ＋ 用户 2026-10-02 裁决）。
 *
 * 与 src/core/statModifiers.test.ts 的分工：那一档钉纯函数（读哪一笔），这一档钉
 * **真链路**——技能编译 ⇒ 事件 ⇒ 账本 ⇒ 下一个动作的算术。它能抓住纯函数抓不到的那类
 * 事故：账记对了但没人读、读了但读的是打印值、登场落了笔而离场没收。
 *
 * 每条用例都成对写"有账/没账"：没账那一半逐字等于刀前行为，这正是两锚 B13/B14
 * 不换名的理由（空账本⇒零新事件）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { General, Skill } from '../data/generals';
import { allGenerals } from '../data/generals';
import type { DamageDealtOccasionType } from '../data/generals';
import { standaloneSkills } from '../data/standaloneSkills';
import { DIY_FIXTURE_GENERALS } from '../ai/fixtures/diyGeneralFixture';
import { predictAttack } from '../core/attackPreview';
import { syncPlayerSkills } from './skillCompiler';
import { getReactionAsk } from './reactionChain';
import type { StatModifier } from '../core/statModifiers';
import { getAttackValue } from '../core/attackValue';

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id, name: '测试将' + id, faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
  };
}

function makeFieldGeneral(general: General, ownerId: number, slot = 0, zone: 'camp' | 'front' | 'battle' = 'front') {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [],
    isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone, slot, areaOwnerId: 1 },
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  } as EnginePlayer;
}

function makeState(players: EnginePlayer[], ledger?: StatModifier[]): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
    ],
    discardPile: [], drawState: null,
    ...(ledger ? { statModifiers: ledger } : {}),
  } as EngineState;
}

function buildEngine(players: EnginePlayer[], ledger?: StatModifier[]): GameEngine {
  const state = makeState(players, ledger);
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  return engine;
}

const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' };
const ATTACK_COST_2 = { id: 'cost_2', name: '粮草', type: '粮草' };
const ATTACK_COST_3 = { id: 'cost_3', name: '粮草', type: '粮草' };

function statSkill(name: string, runtime: NonNullable<Skill['effects']>[number]['runtime'], extra: Partial<Skill> = {}): Skill {
  return {
    name, trigger: { type: 'passive' },
    effects: [{ id: 'e1', trigger: { type: 'passive' }, runtime }],
    ...extra,
  };
}

function hpOf(engine: GameEngine, playerId: number, generalId: string): number | undefined {
  const player = engine.state.players.find(p => p.id === playerId);
  const fg = (player?.fieldGenerals as any[] | undefined)?.find(f => f?.general?.id === generalId);
  return fg?.currentHp;
}

describe('stat modifier ledger · 登场落笔（在场即生效）', () => {
  it('登场即落一笔，且这一笔不经过任何问窗、不产生 TRIGGERED', () => {
    const general = makeGeneral('g1', [
      statSkill('刚毅', { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' }, { tags: ['锁定技'] }),
    ]);
    const engine = buildEngine([
      makePlayer(1, { hand: [general, ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);

    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, {
      general, slot: 0, consumeCards: [ATTACK_COST],
    }));

    expect(events.filter(e => e.type === 'STAT_MODIFY').length).toBe(1);
    expect(events.some(e => e.type === 'TRIGGERED')).toBe(false);
    const ledger = engine.state.statModifiers ?? [];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      key: 'MELEE_ATK', mode: 'delta', value: 1, passive: true, locked: true,
      targetPlayerId: 1, targetId: 'g1', ownerPlayerId: 1, ownerGeneralId: 'g1',
    });
    expect(ledger[0].id).toBe('sm:1');
  });

  it('没有在场技的将登场＝事件流一字不多（两锚逐字的结构保证）', () => {
    const plain = makeGeneral('g1', []);
    const engine = buildEngine([makePlayer(1, { hand: [plain, ATTACK_COST] }), makePlayer(2)]);
    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: plain, slot: 0, consumeCards: [ATTACK_COST] }));
    expect(events.some(e => e.type === 'STAT_MODIFY')).toBe(false);
    expect(engine.state.statModifiers).toBeUndefined();
  });
});

describe('stat modifier ledger · 攻击算术真的读了账', () => {
  /** 真链路：登场落笔（编译⇒账）⇒下一刀的攻击算术读那笔账。攻击方从手里登场（营地），
   *  受方是踩进同一片区域的敌将（前线＝近战够得着，见 `battlefieldRules.ts:126`）。 */
  function attackWith(skills: Skill[]) {
    const attacker = makeGeneral('g1', skills);
    const victim = makeGeneral('g2', []);
    const engine = buildEngine([
      makePlayer(1, { hand: [attacker, ATTACK_COST, ATTACK_COST_2] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: attacker, slot: 0, consumeCards: [ATTACK_COST] }));
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST_2 }));
    return hpOf(engine, 2, 'g2');
  }

  it('卡面 2 点的近战，账本 +1 ⇒ 一刀掉 3 点（没账时掉 2 点）', () => {
    expect(attackWith([])).toBe(2);
    expect(attackWith([
      statSkill('刚毅', { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' }),
    ])).toBe(1);
  });

  it('固定压过增减：+5 的增减遇"固定为 1"⇒ 这一刀只掉 1 点', () => {
    expect(attackWith([
      statSkill('暴怒', { type: 'MODIFY_STAT', value: 5, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' }),
      statSkill('磐石', { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'set' }),
    ])).toBe(3);
  });

  it('远程那把钥匙独立：只加近战时远程仍按卡面 1 点', () => {
    const attacker = makeGeneral('g1', [
      statSkill('刚毅', { type: 'MODIFY_STAT', value: 2, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' }),
    ]);
    expect(getAttackValue(attacker, false, {
      ledger: [{ ...(makeLedgerEntry('MELEE_ATK', 'delta', 2)) }], target: { playerId: 1, generalId: 'g1' },
    })).toBe(4);
    expect(getAttackValue(attacker, true, {
      ledger: [{ ...(makeLedgerEntry('MELEE_ATK', 'delta', 2)) }], target: { playerId: 1, generalId: 'g1' },
    })).toBe(1);
  });
});

function makeLedgerEntry(key: 'MELEE_ATK' | 'RANGED_ATK' | 'MAX_HP', mode: 'delta' | 'set', value: number) {
  return {
    id: 'sm:1', seq: 1, key, mode, value,
    targetPlayerId: 1, targetId: 'g1', ownerPlayerId: 1, ownerGeneralId: 'g1',
    ownerSkillId: 's1', locked: false, passive: true,
  };
}

/** 「受到伤害后」改数（非强制⇒走问窗）的那一员将＋一个能打死它邻居的攻击方。 */
function buildDamageStatEngine(): GameEngine {
  const victim = makeGeneral('g2', [{
    name: '蓄锐', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
    effects: [{
      id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' },
    }],
  }]);
  return buildEngine([
    makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
  ]);
}

describe('stat modifier ledger · 体力上限那一笔会当场回落', () => {
  it('上限被改小⇒当前体力当场截回来，且不记成伤害、不记成失去体力', () => {
    const general = makeGeneral('g1', [
      statSkill('折寿', { type: 'MODIFY_STAT', value: -2, target: 'SELF', stat: 'MAX_HP', modifyMode: 'delta' }),
    ]);
    // 登场的规矩是"烧几张牌上场就带几点血"（`generalEvents.ts:40`），卡面上限 4⇒这里
    // 烧 3 张＝残血 3 上场，现上限被这一笔压到 2⇒高出的那 1 点当场截回来。
    const cost = [ATTACK_COST, ATTACK_COST_2, ATTACK_COST_3];
    const engine = buildEngine([makePlayer(1, { hand: [general, ...cost] }), makePlayer(2)]);
    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general, slot: 0, consumeCards: cost }));

    expect(hpOf(engine, 1, 'g1')).toBe(2);
    // 截断不是伤害也不是失去体力⇒受击／受伤两声都不响（裁决第 11 条）。
    expect(events.some(e => e.type === 'DAMAGE')).toBe(false);
    expect(events.some(e => e.type === 'BEFORE_DAMAGE')).toBe(false);
    expect(engine.state.statModifiers?.[0]).toMatchObject({ key: 'MAX_HP', mode: 'delta', value: -2 });
  });

  it('上限被固定成 0⇒这一员将不许存活，收尸路与伤害致死同一条', () => {
    const general = makeGeneral('g1', [
      statSkill('湮灭', { type: 'MODIFY_STAT', value: 0, target: 'SELF', stat: 'MAX_HP', modifyMode: 'set' }, { tags: ['锁定技'] }),
    ]);
    const engine = buildEngine([makePlayer(1, { hand: [general, ATTACK_COST] }), makePlayer(2)]);
    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general, slot: 0, consumeCards: [ATTACK_COST] }));

    const player = engine.state.players.find(p => p.id === 1)!;
    expect((player.fieldGenerals as any[]).length).toBe(0);
    expect((player.graveyard as any[]).map(c => c.id)).toContain('g1');
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    // 人没了⇒他名下的账当场断（裁决第 2 条），锁定技也拦不住生命周期收账（第 12 条的后半）。
    expect(engine.state.statModifiers ?? []).toHaveLength(0);
  });

  it('归零之死身上那一叠军备随人下葬：不分牌面类型、一律进弃牌堆，料堆一格不收', () => {
    // 这一条钉的是"收尸路与伤害致死同一条"这半句里**唯一还没被实测过**的那格：
    // 挂在身上的护甲卡在非致死收场时该回哪——既有致死路把那一叠全数倾进弃牌堆，
    // 归零之死不许分岔（把某一类算成"回料堆"就等于发明第三种离场，§F 装备三路裁决
    // 里"随主阵阵亡"是刻意沉默的那两路之一，连 CARD_LOST 都不派生）。
    const ARMOR_RESOURCE = { id: 'sm_armor_resource', name: '军备', type: '军备' };
    const ARMOR_EQUIPMENT = { id: 'sm_armor_equipment', name: '甲', type: '装备' };
    const victim = makeGeneral('g2', [{
      name: '湮灭', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      effects: [{
        id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
        runtime: { type: 'MODIFY_STAT', value: 0, target: 'SELF', stat: 'MAX_HP', modifyMode: 'set' },
      }],
    }]);
    const armedVictim = {
      ...makeFieldGeneral(victim, 2),
      armorCards: [ARMOR_RESOURCE, ARMOR_EQUIPMENT],
      currentArmor: 2,
      isArming: true,
    };
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [armedVictim], generalPool: [{ id: 'p2_pool', name: '池中将', type: '武将' }] as any }),
    ]);
    const attackEvents = engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    const ask = getReactionAsk(engine.state)!;
    const activateEvents = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    const flat = [...attackEvents, ...activateEvents];

    const player2 = engine.state.players.find(p => p.id === 2)!;
    expect((player2.fieldGenerals as any[]).length).toBe(0);
    expect((player2.graveyard as any[]).map(c => c.id)).toContain('g2');
    // 两枚都在弃牌堆，一枚也没回料堆。
    expect((engine.state.discardPile as any[]).map(c => c.id)).toEqual(
      expect.arrayContaining([ARMOR_RESOURCE.id, ARMOR_EQUIPMENT.id]),
    );
    expect((player2.generalPool as any[]).map(c => c.id)).toEqual(['p2_pool']);
        // 装备三路裁决：阵亡那一二路刻意沉默⇒这条链不派生 CARD_*。
    expect(flat.filter(e => e.type === 'CARD_LOST' || e.type === 'CARD_GAINED')).toHaveLength(0);
    expect(flat.some(e => e.type === 'DEATH' && (e.data as any)?.deathCause === 'MAX_HP_ZERO')).toBe(true);
  });

  it('归零之死的死因分流：不记击杀、不响遗言，自家补抽照旧（裁决第 11 条）', () => {
    // 契约表 Death chain 那一格说"四个消费者各读各的"，这里钉其中三格：
    // 记击杀（onKill）与响遗言（onDeath）**只认被击破**⇒归零之死两声都不许响；
    // 击破补偿抽与「阵亡」列**不分死因**⇒自家那一抽照给。
    const general = makeGeneral('g1', [
      statSkill('湮灭', { type: 'MODIFY_STAT', value: 0, target: 'SELF', stat: 'MAX_HP', modifyMode: 'set' }),
      {
        name: '遗志',
        effects: [{ id: 'e2', trigger: { type: 'onDeath' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
      },
    ]);
    const killer = makeGeneral('g2', [{
      name: '枭斩',
      effects: [{ id: 'e1', trigger: { type: 'onKill' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    }]);
    const engine = buildEngine([
      makePlayer(1, { hand: [general, ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(killer, 2)] }),
    ]);
    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general, slot: 0, consumeCards: [ATTACK_COST] }));

    const deaths = events.filter(e => e.type === 'DEATH');
    expect(deaths).toHaveLength(1);
    expect(deaths[0].data).toMatchObject({ targetPlayerId: 1, targetId: 'g1', deathCause: 'MAX_HP_ZERO' });
    // 遗言与击杀两声都不响：没有任何一条带这两枚技能名的响应／摸牌。
    const heard = events.filter(e => e.type === 'TRIGGERED' || e.type === 'SKILL_ACTIVATED' || e.type === 'DRAW');
    expect(heard.filter(e => String(`${(e.data as any)?.skillName ?? ''}${(e.data as any)?.skillId ?? ''}`).match(/遗志|枭斩/))).toHaveLength(0);
    // 补偿抽不分死因⇒自家那一抽照旧（`DRAW_REQUIRED` 本体不内联回显，落的是 `drawState`，
    // 与决斗那格的既有形状同一口径）。
    expect(engine.state.drawState).toMatchObject({ reason: 'compensation', playerId: 1, totalCards: 1 });
  });

  it('反例（死因分流的那一半）：被击破之死仍然响遗言、记击杀', () => {
    // 上一条钉的是"归零之死两声都不响"，这一条钉"拒响是**按死因**拒的，不是把
    // onDeath/onKill 整条链路关掉"——同一副卡、同一枚遗言技，换成挨打死⇒照响。
    const martyr = { ...makeGeneral('g2', [{
      name: '遗志',
      effects: [{ id: 'e1', trigger: { type: 'onDeath' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
    }]), currentHp: 1 };
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [{ ...makeFieldGeneral(martyr as any, 2), currentHp: 1 }] }),
    ]);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));

    const deaths = events.filter(e => e.type === 'DEATH');
    expect(deaths).toHaveLength(1);
    expect(deaths[0].data).toMatchObject({ targetPlayerId: 2, attackerPlayerId: 1 });
    expect((deaths[0].data as any)?.deathCause).toBeUndefined();
    const draws = events.filter(e => e.type === 'DRAW');
    expect(draws.filter(e => String((e.data as any)?.skillId ?? '').includes('遗志:e1'))).toHaveLength(1);
  });

  it('补给的封顶读的是现算上限，不是卡面打印值（显示与生效不分叉）', () => {
    const general = makeGeneral('g1', [
      statSkill('折寿', { type: 'MODIFY_STAT', value: -2, target: 'SELF', stat: 'MAX_HP', modifyMode: 'delta' }),
    ]);
    // 登场烧 2 张＝带 2 点血上场，现上限同样被这一笔压到 2⇒人不残、但已经"满"。
    const deployCost = [ATTACK_COST, ATTACK_COST_2];
    const engine = buildEngine([makePlayer(1, { hand: [general, ...deployCost] }), makePlayer(2)]);
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general, slot: 0, consumeCards: deployCost }));
    expect(hpOf(engine, 1, 'g1')).toBe(2);

    // 卡面写着 4，现上限 2、人也正好 2 血⇒补给该被拒。旧代码读打印值会放行这一手，
    // 那一刀就落在"上限被改了但某处还读打印值"这种分叉上。
    const events = engine.dispatch(createAction('SUPPLY', 1, { generalId: 'g1', consumeCards: [ATTACK_COST_3] }));
    const rejected = events.find(e => e.type === 'ACTION_REJECTED');
    expect((rejected?.data as any)?.reason).toBe('GENERAL_ALREADY_FULL_HP');
    expect(hpOf(engine, 1, 'g1')).toBe(2);
  });
});

/** 账本上落「受到的伤害」那一格的笔（形状与刀4 那几条同源：键在座次＋将领实例上）。 */
function dtEntry(
  key: 'DAMAGE_TAKEN' | 'DAMAGE_DEALT' | 'MELEE_ATK', mode: 'delta' | 'set', value: number,
  seat: number = 2, generalId: string = 'g2',
) {
  return {
    id: 'sm:1', seq: 1, key, mode, value,
    targetPlayerId: seat, targetId: generalId, ownerPlayerId: seat, ownerGeneralId: generalId,
    ownerSkillId: `${generalId}:磐壁:e1`, locked: false, passive: true,
  } as StatModifier;
}

/** 受方 g2 身上种一笔账，两个攻击方一手一刀——用来钉"一次性只挡一刀"。 */
function damageTakenEngine(ledger: StatModifier[]): GameEngine {
  return buildEngine([
    makePlayer(1, {
      fieldGenerals: [
        makeFieldGeneral(makeGeneral('g1a', []), 1),
        makeFieldGeneral(makeGeneral('g1b', []), 1),
      ],
      hand: [ATTACK_COST, ATTACK_COST_2],
    }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', []), 2)] }),
  ], ledger);
}

function armorOf(engine: GameEngine, playerId: number, generalId: string): number | undefined {
  const fg = (engine.state.players.find(p => p.id === playerId)?.fieldGenerals as any[] | undefined)
    ?.find(f => f?.general?.id === generalId);
  return fg?.currentArmor;
}

/** 挨打的那一员带「受到伤害后」的听众（可选再加一枚「成为目标时」的受击技）。 */
function hurtListener(skills: Skill[]): General {
  return makeGeneral('g2', skills);
}

const HURT_DRAW = (name: string): Skill => ({
  name, trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
  effects: [{
    id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
});

const BECOME_TARGET_HEAL = (): Skill => ({
  name: '先觉', trigger: { type: 'onBecomingTarget', targetSubType: 'attackTarget' },
  effects: [{
    id: 'e1', trigger: { type: 'onBecomingTarget', targetSubType: 'attackTarget' },
    runtime: { type: 'HEAL', value: 1, target: 'SELF' },
  }],
});

describe('受到伤害那一格 · 真链路（2.8 刀5＝#26）', () => {
  it('两笔一次性同时在场＝只挡一刀，第二刀才轮到第二笔（用户 2026-10-03 裁决 7）', () => {
    const first = { ...dtEntry('DAMAGE_TAKEN', 'delta', -1, 2, 'g2'), id: 'sm:1', seq: 1, expire: 'thisDamage' as const };
    const second = { ...dtEntry('DAMAGE_TAKEN', 'delta', -1, 2, 'g2'), id: 'sm:2', seq: 2, expire: 'thisDamage' as const };
    const engine = damageTakenEngine([first, second]);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1a', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    expect(hpOf(engine, 2, 'g2')).toBe(3);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1b', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST_2 }));
    expect(hpOf(engine, 2, 'g2')).toBe(2);
    expect(engine.state.statModifiers ?? []).toHaveLength(0);
  });

  it('决斗逐轮各用一笔一次性（2 次算两轮），每一轮各留一条销账留痕', () => {
    // 三笔一次性在场：普攻那一刀先吃掉最早的一笔（它是独立的一"次"受到伤害），
    // 决斗第一轮、第三轮再各吃掉一笔——第四轮（还是 gD 挨打）没得挡＝满 2 点。
    const entries = ['sm:1', 'sm:2', 'sm:3'].map((id, i) => ({
      ...dtEntry('DAMAGE_TAKEN', 'delta', -1, 2, 'gD'), id, seq: i + 1, expire: 'thisDamage' as const,
    }));
    const challenger = makeGeneral('gC', [{
      name: '搦战', trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
      effects: [{
        id: 'e1', trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
        runtime: { type: 'DUEL', target: 'TARGET' },
      }],
    }]);
    // 双方都够硬：六轮打满，gD 在第 1/3/5 轮各挨一刀。
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral({ ...challenger, hp: 12 } as any, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral({ ...makeGeneral('gD', []), hp: 12 } as any, 2)] }),
    ], entries);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'gC', targetId: 'gD', ranged: false, consumeCard: ATTACK_COST,
    }));
    const rounds = events.filter(e => e.type === 'DAMAGE' && typeof (e.data as any)?.duelRound === 'number');
    expect(rounds.map(e => (e.data as any)?.duelRound)).toEqual([1, 2, 3, 4, 5, 6]);
    // gD 挨打的那几轮（第 1、3、5 轮）：一轮一笔，第三笔用完就没有第四笔。
    expect(rounds.filter(e => (e.data as any)?.targetId === 'gD').map(e => (e.data as any)?.damageTaken)).toEqual([1, 1, 2]);
    expect(rounds.filter(e => (e.data as any)?.targetId === 'gC').map(e => (e.data as any)?.damageTaken)).toEqual([2, 2, 2]);
    // 三笔账＝三条销账留痕，逐笔各归各的那一轮（普攻一条＋决斗两条）。
    expect(events.filter(e => e.type === 'STAT_MODIFY'
      && (e.data as { cause?: string }).cause === 'DAMAGE_TAKEN').map(e => (e.data as { ids: string[] }).ids))
      .toEqual([['sm:1'], ['sm:2'], ['sm:3']]);
    // 逐轮那几声不派生受伤声（§H9 第七轮：累计只在收官立一笔）⇒全程不开问窗。
    expect(events.filter(e => e.type === 'INJURY' && (e.data as any)?.duelStage === 'injury')
      .map(e => [(e.data as any)?.targetId, (e.data as any)?.value])).toEqual([['gD', 4], ['gC', 6]]);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(engine.state.statModifiers ?? []).toHaveLength(0);
  });

  it('固定压在护甲之前那一格上：「受到的伤害固定为 1」×近战 5 ⇒ 护甲照旧吃掉那 1 点', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral({ ...makeGeneral('g1', []), meleeAtk: 5 } as any, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [{ ...makeFieldGeneral(makeGeneral('g2', []), 2), currentArmor: 3 }] }),
    ], [dtEntry('DAMAGE_TAKEN', 'set', 1)]);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    // 近战 5 被摁成 1 之后才进护甲算术：1 点伤害按"2 甲抵 1 伤"吃掉 2 点护甲、体力不动。
    expect(hpOf(engine, 2, 'g2')).toBe(4);
    expect(armorOf(engine, 2, 'g2')).toBe(1);
  });

  it('营地那一格压根不吃修正：「受到的伤害固定为 0」压不到营地，普攻照旧封顶 1 点', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral({ ...makeGeneral('g1', []), meleeAtk: 7 } as any, 1, 0, 'front')], hand: [ATTACK_COST] }),
      // 守方场上无人（前线空了才够得着营地），账却记在"该席位上那员不在场的将"身上：
      // 营地不是任何一员将，那一格永远轮不到它——这正是"问二＝不吃"的结构写法。
      makePlayer(2, { fieldGenerals: [] }),
    ], [dtEntry('DAMAGE_TAKEN', 'set', 0)]);
    // 攻方踩进守方那片区域才够得着营地（`canTargetBase`：front/camp 且 areaOwnerId＝守方座次）。
    const attacker = (engine.state.players[0].fieldGenerals as any[])[0];
    attacker.position = { zone: 'front', slot: 0, areaOwnerId: 2 };
    const events = engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }));
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
    const base = engine.state.players.find(p => p.id === 2)!;
    expect(base.baseHp).toBe(9);
    expect(engine.state.statModifiers ?? []).toHaveLength(1);
    // 营地掉血也照样派生一声（那一席位的「受到伤害后」听众走席位层，不是将领层）。
    expect(events.filter(e => e.type === 'INJURY').map(e => [(e.data as any)?.targetId, (e.data as any)?.value, (e.data as any)?.isBase]))
      .toEqual([['base_2', 1, true]]);
  });

  it('一次性那一笔只挡一刀：第二刀读的是已经销过的那本账', () => {
    const oneshot = { ...dtEntry('DAMAGE_TAKEN', 'delta', -1), expire: 'thisDamage' as const };
    const engine = damageTakenEngine([oneshot]);
    const first = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1a', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    expect(hpOf(engine, 2, 'g2')).toBe(3);          // 2 点近战被那一笔挡掉 1 点
    expect(first.filter(e => e.type === 'INJURY').map(e => (e.data as any)?.value)).toEqual([1]);
    expect(first.some(e => e.type === 'STAT_MODIFY'
      && (e.data as { ids?: string[] }).ids?.includes(oneshot.id))).toBe(true);
    expect(engine.state.statModifiers ?? []).toHaveLength(0);

    engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1b', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST_2,
    }));
    expect(hpOf(engine, 2, 'g2')).toBe(1);          // 没人再替它挡：满 2 点
  });

  it('护甲吃满那一刀＝这一声不存在：不掉血⇒「受到伤害后」压根不响', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(hurtListener([HURT_DRAW('忍创')]), 2)] }),
    ]);
    const armed = (engine.state.players[1].fieldGenerals as any[])[0];
    armed.currentArmor = 5;
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    expect(hpOf(engine, 2, 'g2')).toBe(4);
    expect(armorOf(engine, 2, 'g2')).toBe(1);
    // 护甲掉了 4 点（2 甲抵 1 伤）、体力一格没掉⇒按用户 2026-10-03 的重裁，这一刀不算"受到了伤害"。
    expect(events.filter(e => e.type === 'INJURY')).toHaveLength(0);
    expect(getReactionAsk(engine.state)).toBeNull();
  });

  it('伤害被摁到 0＝这一声同样不存在，而"成为攻击目标"那一侧照旧问', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(hurtListener([HURT_DRAW('忍创'), BECOME_TARGET_HEAL()]), 2)] }),
    ], [dtEntry('DAMAGE_TAKEN', 'set', 0)]);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    expect(events.filter(e => e.type === 'INJURY')).toHaveLength(0);
    expect(hpOf(engine, 2, 'g2')).toBe(4);
    // 受击那一侧听的是"被点名"，与伤害数字无关⇒那一格照常开（本轮没重裁它）。
    const ask = getReactionAsk(engine.state)!;
    expect(ask.options.map(o => o.skillName)).toEqual(['先觉']);
    expect(events.some(e => e.type === 'BEFORE_DAMAGE')).toBe(true);
  });

  it('同一受方身上"固定为 3"压住 −1：近战 2 也按 3 算，−1 那笔留在账上等着', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1a', []), 1), makeFieldGeneral(makeGeneral('g1b', []), 1)],
        hand: [ATTACK_COST, ATTACK_COST_2],
      }),
      // 挨打的那一位血量够扛两刀：这一档要验的是"账一直在、只是不被读"，不是它死不死。
      makePlayer(2, { fieldGenerals: [makeFieldGeneral({ ...hurtListener([]), hp: 8 } as any, 2)] }),
    ], [
      dtEntry('DAMAGE_TAKEN', 'set', 3),
      { ...dtEntry('DAMAGE_TAKEN', 'delta', -1, 2, 'g2'), id: 'sm:2', seq: 2, passive: false },
    ]);
    // 近战本是 2、固定是 3：这一刀的数只能由固定那笔说了算（增减若参与只会把它压回 2）。
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1a', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    expect(hpOf(engine, 2, 'g2')).toBe(5);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1b', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST_2 }));
    expect(hpOf(engine, 2, 'g2')).toBe(2);
    // 两笔都还在账上：固定那笔是常驻、−1 那笔是"没被读到所以不销"（用户 2026-10-02 裁）。
    const ledger = engine.state.statModifiers ?? [];
    expect(ledger.map(m => [m.id, m.mode])).toEqual([['sm:1', 'set'], ['sm:2', 'delta']]);
  });

  it('固定为 1 只落在被点名的那一席：隔壁席位上那笔"固定为 0"串不过去', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', []), 2)] }),
      makePlayer(3, { fieldGenerals: [makeFieldGeneral(makeGeneral('g3', []), 3)] }),
    ], [
      dtEntry('DAMAGE_TAKEN', 'set', 0, 3, 'g3'),
      { ...dtEntry('DAMAGE_TAKEN', 'set', 1, 2, 'g2'), id: 'sm:2', seq: 2 },
    ]);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    expect(hpOf(engine, 2, 'g2')).toBe(3);
    expect((engine.state.players.find(p => p.id === 3)!.fieldGenerals as any[])[0].currentHp).toBe(4);
  });

  it('两把没接线的钥匙开不出读数点：造方"固定为 0"与受方"受到的伤害固定为 3"各归各格', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', []), 2)] }),
    ], [
      // 同一把钥匙（近战攻击力）的固定笔当然生效——那是刀4 已接的那一格。
      { ...dtEntry('MELEE_ATK', 'set', 0, 1, 'g1'), id: 'sm:1', seq: 1 },
      // 而"受到的伤害"这一格的固定为 3 压不到造方那一侧：两个数各住各的账。
      { ...dtEntry('DAMAGE_TAKEN', 'set', 3, 1, 'g1'), id: 'sm:2', seq: 2 },
    ]);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    expect(hpOf(engine, 2, 'g2')).toBe(4);
    expect(events.filter(e => e.type === 'DAMAGE').map(e => (e.data as any)?.value)).toEqual([0]);
    expect(events.filter(e => e.type === 'INJURY')).toHaveLength(0);
  });

  it('营地那一格压根不吃修正，也不吃结算：普攻封顶 1 点，账本逐字不动', () => {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral({ ...makeGeneral('g1', []), meleeAtk: 7 } as any, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [] }),
    ], [dtEntry('DAMAGE_TAKEN', 'set', 1, 2, 'offfield_g2')]);
    (engine.state.players[0].fieldGenerals as any[])[0].position = { zone: 'front', slot: 0, areaOwnerId: 2 };
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }));
    expect(engine.state.players.find(p => p.id === 2)!.baseHp).toBe(9);
    expect(engine.state.statModifiers ?? []).toHaveLength(1);
    expect(engine.state.statModifiers?.[0].id).toBe('sm:1');
  });

  it('技能伤害那一路也读同一格（问窗答"反击"打出去的那 2 点，被攻方身上的一次性账挡掉 1 点）', () => {
    const counter: Skill = {
      name: '反击', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      effects: [{
        id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
        runtime: { type: 'DAMAGE', value: 2, target: 'ATTACKER' },
      }],
    };
    const oneshot = { ...dtEntry('DAMAGE_TAKEN', 'delta', -1, 1, 'g1a'), expire: 'thisDamage' as const };
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1a', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(hurtListener([counter]), 2)] }),
    ], [oneshot]);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1a', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    const ask = getReactionAsk(engine.state)!;
    expect(ask.options.map(o => o.skillName)).toEqual(['反击']);
    const answered = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(hpOf(engine, 1, 'g1a')).toBe(3);        // 2 点技能伤害挡掉 1 点
    expect(answered.some(e => e.type === 'STAT_MODIFY'
      && (e.data as { ids?: string[] }).ids?.includes(oneshot.id))).toBe(true);
    expect(engine.state.statModifiers ?? []).toHaveLength(0);
    // 攻方这一刀真掉了 1 点血⇒它那一侧的"受到伤害"成立，一声记在流里。
    expect(answered.filter(e => e.type === 'INJURY').map(e => [(e.data as any)?.targetId, (e.data as any)?.value])).toEqual([['g1a', 1]]);
  });
});

describe('造成伤害那一格 · 真链路（2.9.4 刀＝#54，用户 2026-10-14「第4条，扣护甲前算」）', () => {
  /** 怒斩的两条腿（用户 2026-10-14 裁「允许」它们挂在「在场即生效」的被动上）：
   *  一枚被动、两条各带一个场合的账，读数点当场对表。 */
  const furyLegs = (): Skill[] => (['duel', 'meleeVsArmored'] as DamageDealtOccasionType[]).map(occasion => ({
    name: '怒斩·' + occasion, trigger: { type: 'passive' },
    effects: [{
      id: 'e1', trigger: { type: 'passive' },
      runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'DAMAGE_DEALT', modifyMode: 'delta', occasion },
    }],
  }));

  function dealtEntry(
    partial: Partial<StatModifier> = {}, id = 'sm:1', seq = 1,
  ): StatModifier {
    return {
      ...dtEntry('DAMAGE_DEALT', 'delta', 1, 1, 'g1'), id, seq, ...partial,
    } as StatModifier;
  }

  /** 攻方 g1 从手里登场（带着怒斩那两枚在场技＝账走真编译），受方护甲现场摆。 */
  function meleeScene(skills: Skill[], armor: number) {
    const attacker = makeGeneral('g1', skills);
    const engine = buildEngine([
      makePlayer(1, { hand: [attacker, ATTACK_COST, ATTACK_COST_2] }),
      makePlayer(2, { fieldGenerals: [{ ...makeFieldGeneral(makeGeneral('g2', []), 2), currentArmor: armor }] }),
    ]);
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: attacker, slot: 0, consumeCards: [ATTACK_COST] }));
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST_2 }));
    return { engine, hp: hpOf(engine, 2, 'g2'), armorLeft: armorOf(engine, 2, 'g2') };
  }

  it('登场落笔＝场合逐字进账；没填场合的笔压根不出现这个键（两锚比的是字节，不是"意思一样"）', () => {
    const withOccasion = buildEngine([
      makePlayer(1, { hand: [makeGeneral('g1', furyLegs()), ATTACK_COST, ATTACK_COST_2] }),
      makePlayer(2),
    ]);
    withOccasion.dispatch(createAction('DEPLOY_GENERAL', 1, {
      general: (withOccasion.state.players[0].hand as any[])[0], slot: 0, consumeCards: [ATTACK_COST],
    }));
    const ledger = withOccasion.state.statModifiers ?? [];
    expect(ledger.map(e => [e.key, e.occasion, e.passive])).toEqual([
      ['DAMAGE_DEALT', 'duel', true],
      ['DAMAGE_DEALT', 'meleeVsArmored', true],
    ]);

    // 不带场合的那一笔：键**不存在**，不是 `undefined`。整条搬运链（编译⇒桥⇒账）都只在
    // 真填了时才落这个键，空账本之外的一切读数与上一版逐字相同。
    const plain = makeGeneral('g3', [
      statSkill('刚毅', { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'DAMAGE_DEALT', modifyMode: 'delta' }),
    ]);
    const plainEngine = buildEngine([makePlayer(1, { hand: [plain, ATTACK_COST] }), makePlayer(2)]);
    plainEngine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: plain, slot: 0, consumeCards: [ATTACK_COST] }));
    const plainLedger = plainEngine.state.statModifiers ?? [];
    expect(plainLedger).toHaveLength(1);
    expect('occasion' in plainLedger[0]).toBe(false);
  });

  it('近战那条腿只在"对面有护甲"时给这 +1，而 +1 落在进护甲**之前**那一格', () => {
    // 护甲 1：1 点甲抵不了 1 点伤（`armorDamage`：2 甲抵 1 伤），所以那一刀 whole 落在体力上。
    expect(meleeScene(furyLegs(), 1)).toMatchObject({ hp: 1, armorLeft: 1 });
    // 护甲 0＝场合不成立⇒卡面 2 点原样，与没带技能的将逐字同数。
    expect(meleeScene(furyLegs(), 0).hp).toBe(2);
    expect(meleeScene([], 1).hp).toBe(2);
  });

  it('决斗里吃的是决斗那条腿，近战那条腿一律不算⇒逐轮 +1、永不相加成 +2', () => {
    const challenger = makeGeneral('gC', [{
      name: '搦战', trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
      effects: [{
        id: 'e1', trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
        runtime: { type: 'DUEL', target: 'TARGET' },
      }],
    }]);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral({ ...challenger, hp: 12 } as any, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral({ ...makeGeneral('gD', []), hp: 12 } as any, 2)] }),
    ], [dealtEntry({ id: 'sm:1', seq: 1, targetId: 'gC', occasion: 'duel' }),
        dealtEntry({ id: 'sm:2', seq: 2, targetId: 'gC', occasion: 'meleeVsArmored' })]);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'gC', targetId: 'gD', ranged: false, consumeCard: ATTACK_COST,
    }));
    const rounds = events.filter(e => e.type === 'DAMAGE' && typeof (e.data as any)?.duelRound === 'number');
    // 两条腿都在场：若"决斗也算近战"，gC 那几轮会是 4。
    expect(rounds.filter(e => (e.data as any)?.targetId === 'gD').map(e => (e.data as any)?.damageTaken)).toEqual([3, 3, 3]);
    expect(rounds.filter(e => (e.data as any)?.targetId === 'gC').map(e => (e.data as any)?.damageTaken)).toEqual([2, 2, 2]);
    // 两笔都是持续（在场）笔⇒整场决斗零条销账令。
    expect(events.filter(e => e.type === 'STAT_MODIFY')).toHaveLength(0);
  });

  it('技能伤害那一路也在结算时先读造方那一格，用掉的一次性账由派生侧补销（cause 各归各的格）', () => {
    const counter: Skill = {
      name: '反击', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      effects: [{
        id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
        runtime: { type: 'DAMAGE', value: 2, target: 'ATTACKER' },
      }],
    };
    // 一次性 +1 种在反击那一员将（g2）身上：它打出去的那一笔伤害结算时才读账⇒这一格读到 3。
    const oneshot = dealtEntry({ ...{}, id: 'sm:1', seq: 1, targetPlayerId: 2, targetId: 'g2', ownerPlayerId: 2, ownerGeneralId: 'g2', expire: 'thisDamage' });
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1a', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [counter]), 2)] }),
    ], [oneshot]);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1a', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    const ask = getReactionAsk(engine.state)!;
    expect(ask.options.map(o => o.skillName)).toEqual(['反击']);
    const answered = engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(hpOf(engine, 1, 'g1a')).toBe(1);        // 卡面 2 点＋造方 1 点＝3 点，进护甲之前就已经是 3
    expect(answered.some(e => e.type === 'STAT_MODIFY'
      && (e.data as { ids?: string[] }).ids?.includes(oneshot.id)
      && (e.data as { cause?: string }).cause === 'DAMAGE_DEALT')).toBe(true);
    expect(engine.state.statModifiers ?? []).toHaveLength(0);
    expect(answered.filter(e => e.type === 'INJURY').map(e => [(e.data as any)?.targetId, (e.data as any)?.value])).toEqual([['g1a', 3]]);
  });

  it('预览那一刀与引擎那一刀读的是同一段算术（同一次 +1，两侧不会一个显示 2 一个结算 3）', () => {
    const ledger = [dealtEntry({ occasion: 'meleeVsArmored', targetId: 'g1', ownerGeneralId: 'g1' })];
    const prediction = predictAttack(2, 4, 1, ledger, 2, 'g2', 4, { playerId: 1, generalId: 'g1' }, false);
    expect(prediction).toMatchObject({ baseDamage: 2, takenDamage: 3, hpLost: 3, armorLost: 0, newHp: 1, newArmor: 1 });
    // 同一副账、同一个受方，把"远程"那一格翻上去：场合不成立⇒预览就是卡面 2 点。
    expect(predictAttack(2, 4, 1, ledger, 2, 'g2', 4, { playerId: 1, generalId: 'g1' }, true).takenDamage).toBe(2);
    // 与真机同一形状：近战腿在场，打出去的那一刀确实掉 3 点。
    expect(meleeScene(furyLegs(), 1).hp).toBe(1);
  });

  /** 两笔"固定"同时在场（造方挂在打出去的 g1 上、受方挂在挨打的 g2 上），走**真普攻**。
   *  这一档存在的理由＝跨侧赢家只由入算次序兑出（代码里没有第二次判断），而纯函数那档
   *  的接线是测试自己替引擎排的序，抓不到引擎有没有按这个次序调它（闸③复算 2026-10-15 缺件 1）。 */
  function crossSideBlow(ledger: StatModifier[]) {
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', []), 2)] }),
    ], ledger);
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    return { engine, hp: hpOf(engine, 2, 'g2') };
  }

  it('跨侧两笔"固定"相撞＝落到血上是受方那个数：造方固定为 9 被受方固定为 1 盖掉', () => {
    // 卡面近战 2 点：正序过完两道＝1 点；把两侧入算整体倒过来（受方先读原始值、造方再读受方那个数）＝9 点，这一员将当场死。
    const dealtFirst = { ...dtEntry('DAMAGE_DEALT', 'set', 9, 1, 'g1'), id: 'sm:1', seq: 1 };
    const takenLater = { ...dtEntry('DAMAGE_TAKEN', 'set', 1, 2, 'g2'), id: 'sm:2', seq: 2 };
    expect(crossSideBlow([dealtFirst, takenLater]).hp).toBe(3);
    // 数组位置与生效编号**一起反过来**写：赢家不变⇒钉的是入算次序，不是书写顺序、也不是先后编号。
    const takenFirst = { ...dtEntry('DAMAGE_TAKEN', 'set', 1, 2, 'g2'), id: 'sm:2', seq: 1 };
    const dealtLater = { ...dtEntry('DAMAGE_DEALT', 'set', 9, 1, 'g1'), id: 'sm:1', seq: 2 };
    expect(crossSideBlow([takenFirst, dealtLater]).hp).toBe(3);
    // 两侧各留一笔都是持续（在场）账⇒结算不销任何东西。
    expect((crossSideBlow([dealtFirst, takenLater]).engine.state.statModifiers ?? []).map(e => e.id).sort())
      .toEqual(['sm:1', 'sm:2']);
  });

  it('对照组（少了任何一半都测不出次序）：单侧那笔各自照自己的口径落', () => {
    // 只有造方那笔⇒固定为 3 一路过到护甲与体力（卡面 2 点被顶成 3 点）。
    expect(crossSideBlow([{ ...dtEntry('DAMAGE_DEALT', 'set', 3, 1, 'g1'), id: 'sm:1', seq: 1 }]).hp).toBe(1);
    // 只有受方那笔⇒卡面 2 点被摁到 1 点（与上一档同一个数，说明 3 那笔没串过来）。
    expect(crossSideBlow([{ ...dtEntry('DAMAGE_TAKEN', 'set', 1, 2, 'g2'), id: 'sm:1', seq: 1 }]).hp).toBe(3);
  });

  /**
   * 普查钉子。2.9.4 那趟钉的是"两个锚池里没有内容用「造成的伤害」、独立技能表还是
   * 空的"⇒那一刀结构上不动锚。v2.9.6 内容刀把表填上了第一枚（怒斩），这一档改口成
   * "谁在用、只有这一处"：卡面上仍然没有第二处（怒斩不印在任何将卡上，只由魏关羽
   * 「单骑」白送），所以两锚池的读数照旧是空表。
   * 至于这一枚会不会动锚＝跑出来才算，不靠这里预告（§12-121③）。
   */
  it('普查钉子：用「造成的伤害」的内容有且只有表上那枚怒斩，两锚池的卡面仍是一处没有', () => {
    const users = (pool: readonly General[]) => pool.filter(general =>
      (general.skills ?? []).some(skill => (skill.effects ?? []).some(effect =>
        (effect.runtime as { stat?: string; occasion?: unknown } | undefined)?.stat === 'DAMAGE_DEALT'
        || (effect.runtime as { occasion?: unknown } | undefined)?.occasion !== undefined)));
    expect(users(allGenerals).map(g => g.name)).toEqual([]);
    expect(users(DIY_FIXTURE_GENERALS).map(g => g.name)).toEqual([]);
    expect(standaloneSkills.map(s => s.name)).toEqual(['怒斩']);
    expect(standaloneSkills[0].effects?.map(e => e.runtime?.occasion)).toEqual(['duel', 'meleeVsArmored']);
  });
});

describe('stat modifier ledger · 收账', () => {
  it('阵亡⇒连"落在它身上"的那一半账也当场结束（不只它自己名下）', () => {
    const attacker = makeGeneral('g1', []);
    const victim = { ...makeGeneral('g2', []), hp: 1 };
    // 一笔别人给它加的账（跨将目标是 #28 刀7 的口径，今天编译面还不产出它，所以
    // 这里按账本的形状直接种进初始状态——收账判据是账本侧的，与谁写的无关）。
    const onVictim = {
      ...makeLedgerEntry('MELEE_ATK', 'delta', 5),
      targetPlayerId: 2, targetId: 'g2', ownerPlayerId: 3, ownerGeneralId: 'g3', ownerSkillId: 'g3:借力:e1',
    };
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(attacker, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ], [onVictim]);
    expect(engine.state.statModifiers ?? []).toHaveLength(1);

    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    expect(events.some(e => e.type === 'DEATH')).toBe(true);
    expect(engine.state.statModifiers ?? []).toHaveLength(0);
  });
});

describe('stat modifier ledger · 发动笔带周期', () => {
  it('回合结束时到期那一笔被收走，账本回到空（在场笔不受影响）', () => {
    const general = makeGeneral('g2', [{
      name: '蓄势', trigger: { type: 'onTurnStart' },
      effects: [{
        id: 'e1', trigger: { type: 'onTurnStart' },
        runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta', duration: 'untilSelfTurnEnd' },
      }],
    }]);
    const onField = makeFieldGeneral(general, 2);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [] }),
      makePlayer(2, { fieldGenerals: [onField] }),
    ]);

    // 轮到 2 号位：onTurnStart 发动⇒落一笔带周期的发动账。
    const started = engine.dispatch(createAction('END_TURN', 1));
    expect(started.some(e => e.type === 'STAT_MODIFY')).toBe(true);
    const afterStart = engine.state.statModifiers ?? [];
    expect(afterStart).toHaveLength(1);
    expect(afterStart[0]).toMatchObject({ passive: false, expire: 'untilSelfTurnEnd', seq: 1 });

    // 2 号位回合收官：那一笔当场结束。
    engine.dispatch(createAction('END_TURN', 2));
    expect(engine.state.statModifiers ?? []).toHaveLength(0);
  });

  it('发动那一笔由问窗决定：答「不发动」账本上一笔都没有', () => {
    const engine = buildDamageStatEngine();
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    const ask = getReactionAsk(engine.state);
    expect(ask).not.toBeNull();

    engine.dispatch(createAction('SKIP_REACTION', ask!.playerId, { nodeKey: ask!.nodeKey }));
    expect(engine.state.statModifiers ?? []).toHaveLength(0);
  });

  it('同一声答「发动」⇒账本上多一笔**发动**笔（passive=false，与在场笔分档）', () => {
    const engine = buildDamageStatEngine();
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }));
    const ask = getReactionAsk(engine.state)!;

    engine.dispatch(createAction('ACTIVATE_SKILL', ask.playerId, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    const ledger = engine.state.statModifiers ?? [];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      key: 'MELEE_ATK', mode: 'delta', value: 1, passive: false,
      ownerPlayerId: 2, ownerGeneralId: 'g2',
    });
    expect(ledger[0].expire).toBeUndefined();
  });
});
