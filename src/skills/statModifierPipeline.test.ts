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
