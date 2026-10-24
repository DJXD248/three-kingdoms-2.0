/**
 * 「营地成为攻击目标时」／「营地成为技能目标时」这两格的结算面（v2.9.19 营地两格刀）。
 *
 * 两格听的都不是新事件＝`BEFORE_DAMAGE`（纯通知、零状态位移），分家靠载荷里**两格
 * 已有的一维**：`isBase`（主语是营地不是将）＋`damageType`（这一刀是普攻还是技能）。
 * 而"打的是哪家营地"读的仍是「我听谁」那五档里的**同一个谓词**（用户 2026-10-24 的
 * 裁决原文＝「选B跟「我听谁」那五档做成同一根轴」）⇒全库没有第二套"哪家营地"的定语。
 *
 * 两格的差别也在事件流里看得见，所以这里各钉一边：
 *  ‧ 攻击那一格走的是普攻的 declare 那一拍⇒**伤害还没落**就问／就响（延后结算那套
 *    机制一条没改，只是营地那一身从此也有听众了）；
 *  ‧ 技能那一格读的是技能要打营地时新补的那一声⇒没打「强制发动」时要到那笔伤害
 *    落完才被问到（本刀如实登记的那条边界，第 11 条用例把它钉在读数上）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { General, Skill, SkillTriggerConfig } from '../data/generals';
import { supportsListenerScope, triggerTypeLabels } from '../data/generals';
import { compileSkill, syncPlayerSkills } from './skillCompiler';
import {
  LISTENER_SCOPE_HINT,
  buildTriggerOptionStrings,
  listenerScopeToStr,
  readListenerScopeCell,
  readTriggerCell,
  triggerToStr,
} from './skillExcelFormat';
import { parseSkillText } from './skillTextParse';
import { enumerateTargetCandidates } from './choiceCandidates';
import { PRIORITY } from './SkillTriggerBridge';
import { getReactionAsk } from './reactionChain';
import { matchesSkillEvent } from './skillEventMatch';
import { eventsHeardBy, TRIGGER_EVENTS } from './reactionTriggers';
import type { DataSkillDefinition } from './dataTypes';

const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' };

function makeGeneral(id: string, skills: Skill[]): General {
  return {
    id, name: '测试将' + id, faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
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

/** 站进对面区域的前线将——近战打对方营地唯一够得着的摆法。 */
function makeBaseRusher(general: General, ownerId: number, targetOwnerId: number) {
  const fg = makeFieldGeneral(general, ownerId);
  fg.position = { zone: 'front', slot: 0, areaOwnerId: targetOwnerId };
  return fg;
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  };
}

function buildEngine(players: EnginePlayer[]): GameEngine {
  const state: EngineState = {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
      { id: 'deck_4', name: '粮草', type: '粮草' },
      { id: 'deck_5', name: '材料', type: '材料' },
    ],
    discardPile: [], drawState: null,
  };
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  return engine;
}

function handOf(engine: GameEngine, playerId: number): number {
  return engine.state.players.find(p => p.id === playerId)!.hand!.length;
}

function baseHpOf(engine: GameEngine, playerId: number): number {
  return Number(engine.state.players.find(p => p.id === playerId)?.baseHp ?? -1);
}

function generalHpOf(engine: GameEngine, playerId: number, generalId: string): number | undefined {
  const list = (engine.state.players.find(p => p.id === playerId)?.fieldGenerals as any[] | undefined) ?? [];
  return list.find(fg => fg?.general?.id === generalId)?.currentHp;
}

/** 「营地成为○目标时，摸一张」。`forced` 留真＝钉自动路；问答侧另有专门一条。 */
function campTargetDraw(trigger: SkillTriggerConfig, forced: boolean = true): Skill {
  return {
    name: '护营',
    forced,
    effects: [{ id: 'e1', trigger, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  };
}

/** 攻方那一手「造成伤害后，对受击目标追加 1 点技能伤害」（【奋威】形）——
 *  受击目标是营地时，这一笔就是"技能要打哪家营地"的那条发射路。 */
function followUp(): Skill {
  return {
    name: '样·追击',
    forced: true,
    effects: [{
      id: 'e1',
      trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
      runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' },
    }],
  };
}

/** 席 1 的 g1 打**席 2 的营地**；观察的那一枚挂在席 2 在场的 g2 上。 */
function attackSeat2Base(observer: Skill, extraAttackers: Skill[] = []) {
  const engine = buildEngine([
    makePlayer(1, {
      fieldGenerals: [makeBaseRusher(makeGeneral('g1', extraAttackers), 1, 2)],
      hand: [ATTACK_COST],
    }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [observer]), 2)] }),
  ]);
  const events = engine.dispatch(
    createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }),
  );
  return { engine, events, drew: handOf(engine, 2), baseHp: baseHpOf(engine, 2) };
}

/** 同一把手，靶换成席 3 的营地（席 2 那位从头到尾没挨这一下）。 */
function attackSeat3Base(observer: Skill) {
  const engine = buildEngine([
    makePlayer(1, {
      fieldGenerals: [makeBaseRusher(makeGeneral('g1', []), 1, 3)],
      hand: [ATTACK_COST],
    }),
    makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [observer]), 2)] }),
    makePlayer(3, { fieldGenerals: [] }),
  ]);
  engine.dispatch(
    createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_3', ranged: false, consumeCard: ATTACK_COST }),
  );
  return { engine, drew: handOf(engine, 2), base3: baseHpOf(engine, 3) };
}

/** 营地那一身的 `BEFORE_DAMAGE` 载荷形状（declare 那一拍与技能补的那一声各一型）。 */
function campTargeting(overrides: Record<string, unknown> = {}) {
  return {
    type: 'BEFORE_DAMAGE' as const,
    data: {
      attackerId: 'g1',
      targetId: 'base_2',
      targetPlayerId: 2,
      ranged: false,
      baseDamage: 2,
      isBase: true,
      ...overrides,
    },
  };
}

function definition(trigger: SkillTriggerConfig): DataSkillDefinition {
  const { definitions, skipped } = compileSkill(
    { id: 'g2', name: '测试将g2' },
    campTargetDraw(trigger),
  );
  expect(skipped).toHaveLength(0);
  expect(definitions).toHaveLength(1);
  return definitions[0];
}

describe('营地成为攻击目标时 · 真链路（普攻 declare 那一拍）', () => {
  it('自家营地被普攻瞄上⇒挂这一格的在场将摸一张，营地照旧只掉 1 点', () => {
    const r = attackSeat2Base(campTargetDraw({ type: 'onBaseTargetedAtk' }));
    expect(r.drew).toBe(1);
    expect(r.baseHp).toBe(9);
  });

  it('这一格的"响"在伤害之前：事件流里那一声就在营地那笔 `DAMAGE` 前面', () => {
    const r = attackSeat2Base(campTargetDraw({ type: 'onBaseTargetedAtk' }));
    const flat = r.events.map(e => e.type);
    const notice = flat.indexOf('BEFORE_DAMAGE');
    const damage = flat.indexOf('DAMAGE');
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(damage).toBeGreaterThan(notice);
    // 补的那一声＝打营地那一身：带 `isBase` 与席位键，不带 `damageType`（缺省＝攻击）。
    const noticeData = r.events[notice].data as Record<string, unknown>;
    expect(noticeData.isBase).toBe(true);
    expect(noticeData.targetPlayerId).toBe(2);
    expect(noticeData.damageType).toBeUndefined();
  });

  it('不打「强制发动」＝停下来问，而且**问的时候营地一点没掉**（这一刀从此会延后）', () => {
    const r = attackSeat2Base(campTargetDraw({ type: 'onBaseTargetedAtk' }, false));
    expect(r.drew).toBe(0);
    expect(r.baseHp).toBe(10);
    const ask = getReactionAsk(r.engine.state);
    expect(ask?.trigger).toBe('onBaseTargetedAtk');
    expect(ask?.playerId).toBe(2);
    expect(ask?.generalId).toBe('g2');
    expect(ask?.options.map(o => o.skillName)).toEqual(['护营']);
    // 点头之后：先摸，那一刀才落下（续跑环重瞄读的是答完之后的状态）。
    r.engine.dispatch(createAction('ACTIVATE_SKILL', 2, {
      skillId: ask!.options[0].skillId, generalId: ask!.generalId,
    }));
    expect(handOf(r.engine, 2)).toBe(1);
    expect(baseHpOf(r.engine, 2)).toBe(9);
    expect(getReactionAsk(r.engine.state)).toBeNull();
  });

  it('摇头＝不发动，但**那一刀照样落**（问一句不等于取消这一下）', () => {
    const r = attackSeat2Base(campTargetDraw({ type: 'onBaseTargetedAtk' }, false));
    expect(r.baseHp).toBe(10);
    const ask = getReactionAsk(r.engine.state);
    expect(ask).not.toBeNull();
    r.engine.dispatch(createAction('SKIP_REACTION', ask!.playerId, { nodeKey: ask!.nodeKey }));
    expect(handOf(r.engine, 2)).toBe(0);
    expect(baseHpOf(r.engine, 2)).toBe(9);
    expect(getReactionAsk(r.engine.state)).toBeNull();
  });

  it('缺省只听自家：别家营地被攻⇒这一席那格不响（但那一席照样掉血）', () => {
    const r = attackSeat3Base(campTargetDraw({ type: 'onBaseTargetedAtk' }));
    expect(r.base3).toBe(9);
    expect(r.drew).toBe(0);
  });

  it('「听场上」＝哪家营地被攻打都响（席位归属读的就是那五档，同一根轴）', () => {
    const r = attackSeat3Base(campTargetDraw({ type: 'onBaseTargetedAtk', listenerScope: 'field' }));
    expect(r.base3).toBe(9);
    expect(r.drew).toBe(1);
  });

  it('「听己方（同一席位）」与缺省同义：只认自家营地那一身', () => {
    expect(attackSeat3Base(campTargetDraw({ type: 'onBaseTargetedAtk', listenerScope: 'allySeat' })).drew).toBe(0);
    expect(attackSeat2Base(campTargetDraw({ type: 'onBaseTargetedAtk', listenerScope: 'allySeat' })).drew).toBe(1);
  });

  it('「听敌方（其他席位）」：自家营地被打不响，别席被打响', () => {
    expect(attackSeat2Base(campTargetDraw({ type: 'onBaseTargetedAtk', listenerScope: 'enemySeat' })).drew).toBe(0);
    expect(attackSeat3Base(campTargetDraw({ type: 'onBaseTargetedAtk', listenerScope: 'enemySeat' })).drew).toBe(1);
  });

  it('「听除自身以外」在营地这一身折成"别家"（同席位没有第二家营地）', () => {
    expect(attackSeat2Base(campTargetDraw({ type: 'onBaseTargetedAtk', listenerScope: 'others' })).drew).toBe(0);
    expect(attackSeat3Base(campTargetDraw({ type: 'onBaseTargetedAtk', listenerScope: 'others' })).drew).toBe(1);
  });

  it('打的是那一席的将（营地没挨这一下）⇒这一格不响', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [campTargetDraw({ type: 'onBaseTargetedAtk' })]), 2)] }),
    ]);
    engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );
    // 这一手必须**真的打中了人**，否则"营地技不响"是空转出来的假证人。
    expect(generalHpOf(engine, 2, 'g2')).toBe(2);
    expect(baseHpOf(engine, 2)).toBe(10);
    expect(handOf(engine, 2)).toBe(0);
  });

  it('两格互不串：这一格不被"技能要打营地"那一身误响', () => {
    expect(matchesSkillEvent('onBaseTargetedAtk', { ownerId: 2, skill: definition({ type: 'onBaseTargetedAtk' }) },
      campTargeting({ damageType: 'skill' }) as never)).toBe(false);
  });
});

describe('营地成为技能目标时 · 真链路（技能要打营地时新补的那一声）', () => {
  /** 席 1 的 g1 带着【奋威】形的追击打席 2 的营地；观察的那一枚挂在席 2 的 g2 上。 */
  function skillHitsBase(observer: Skill, askObserver: boolean = false) {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeBaseRusher(makeGeneral('g1', [followUp()]), 1, 2)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [observer]), 2)] }),
    ]);
    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST }),
    );
    void askObserver;
    return { engine, events, drew: handOf(engine, 2), baseHp: baseHpOf(engine, 2) };
  }

  it('技能伤害落向营地⇒挂这一格的在场将摸一张（营地共掉 2 点：普攻 1＋技能 1）', () => {
    const r = skillHitsBase(campTargetDraw({ type: 'onBaseTargetedSkill' }));
    expect(r.drew).toBe(1);
    expect(r.baseHp).toBe(8);
  });

  it('补的那一声在技能那笔 `DAMAGE` **之前**，且带 `isBase`＋技能档的来源', () => {
    const r = skillHitsBase(campTargetDraw({ type: 'onBaseTargetedSkill' }));
    const skillDamage = r.events.find(e => e.type === 'DAMAGE'
      && (e.data as Record<string, unknown>).damageType === 'skill');
    expect(skillDamage).toBeDefined();
    const idx = r.events.indexOf(skillDamage!);
    // 实测位置：那一声是技能那笔 `DAMAGE` 之前**最后**的一声 `BEFORE_DAMAGE`；
    // 两者之间夹的是观察者发动本身的那一枚 `TRIGGERED` 标记（先发后落），
    // 所以这里比的是"先后"而不是"紧邻"——紧邻会把标记那一枚也算进来。
    const notices = r.events.slice(0, idx).filter(e => e.type === 'BEFORE_DAMAGE');
    expect(notices).toHaveLength(2); // 普攻 declare＋技能这一拍
    const notice = notices[notices.length - 1];
    const data = notice.data as Record<string, unknown>;
    expect(data.isBase).toBe(true);
    expect(data.damageType).toBe('skill');
    expect(data.targetPlayerId).toBe(2);
    expect(data.targetId).toBe('base_2');
    // 只补一声：整条流里的 `BEFORE_DAMAGE` 就是这两声，没有第三声。
    expect(r.events.filter(e => e.type === 'BEFORE_DAMAGE')).toHaveLength(2);
  });

  it('同一手追击打的是将领⇒不补这一声、那一格不响', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', [followUp()]), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [campTargetDraw({ type: 'onBaseTargetedSkill' })]), 2)] }),
    ]);
    const events = engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST }),
    );
    expect(generalHpOf(engine, 2, 'g2')).toBe(1); // 2 点普攻＋1 点技能追击，真打中了
    expect(events.filter(e => e.type === 'BEFORE_DAMAGE')).toHaveLength(1); // 只有普攻 declare 那一身
    expect(handOf(engine, 2)).toBe(0);
  });

  it('别家营地被技能瞄上（缺省只听自家）⇒不响', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeBaseRusher(makeGeneral('g1', [followUp()]), 1, 3)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [campTargetDraw({ type: 'onBaseTargetedSkill' })]), 2)] }),
      makePlayer(3, { fieldGenerals: [] }),
    ]);
    engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_3', ranged: false, consumeCard: ATTACK_COST }),
    );
    expect(baseHpOf(engine, 3)).toBe(8);
    expect(handOf(engine, 2)).toBe(0);
  });

  it('「听场上」那一档在技能这一格同样认别家营地', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeBaseRusher(makeGeneral('g1', [followUp()]), 1, 3)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [campTargetDraw({ type: 'onBaseTargetedSkill', listenerScope: 'field' })]), 2)] }),
      makePlayer(3, { fieldGenerals: [] }),
    ]);
    engine.dispatch(
      createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'base_3', ranged: false, consumeCard: ATTACK_COST }),
    );
    expect(handOf(engine, 2)).toBe(1);
  });

  it('不打「强制发动」照样停下来问；如实登记那条边界：问的时候那 1 点已经落了', () => {
    const r = skillHitsBase(campTargetDraw({ type: 'onBaseTargetedSkill' }, false));
    const ask = getReactionAsk(r.engine.state);
    expect(ask?.trigger).toBe('onBaseTargetedSkill');
    expect(ask?.playerId).toBe(2);
    // 这一声不在普攻那套延后机制里（`attackKey` 那一条续跑环管不着它）⇒伤害先落、后问。
    expect(r.baseHp).toBe(8);
    expect(handOf(r.engine, 2)).toBe(0);
    r.engine.dispatch(createAction('ACTIVATE_SKILL', 2, {
      skillId: ask!.options[0].skillId, generalId: ask!.generalId,
    }));
    expect(handOf(r.engine, 2)).toBe(1);
    expect(getReactionAsk(r.engine.state)).toBeNull();
  });

  it('绝不允许"又响又被问"：自动路注册的那一枚不会同时开格', () => {
    const r = skillHitsBase(campTargetDraw({ type: 'onBaseTargetedSkill' }, true));
    expect(r.drew).toBe(1);
    expect(getReactionAsk(r.engine.state)).toBeNull();
  });
});

describe('两格的席位与来源判据 · 单点（matchesSkillEvent）', () => {
  it('攻击那一格：自家席位响、别席不响、缺席位键不响、没有 `isBase` 不响', () => {
    const binding = { ownerId: 2, skill: definition({ type: 'onBaseTargetedAtk' }) };
    expect(matchesSkillEvent('onBaseTargetedAtk', binding, campTargeting() as never)).toBe(true);
    expect(matchesSkillEvent('onBaseTargetedAtk', binding, campTargeting({ targetPlayerId: 3 }) as never)).toBe(false);
    expect(matchesSkillEvent('onBaseTargetedAtk', binding, campTargeting({ targetPlayerId: undefined }) as never)).toBe(false);
    expect(matchesSkillEvent('onBaseTargetedAtk', binding, campTargeting({ isBase: undefined }) as never)).toBe(false);
  });

  it('技能那一格只认 `damageType:\'skill\'`，攻击那一格只认缺省那一档', () => {
    const atk = { ownerId: 2, skill: definition({ type: 'onBaseTargetedAtk' }) };
    const skl = { ownerId: 2, skill: definition({ type: 'onBaseTargetedSkill' }) };
    // 缺 `damageType`＝普攻那一刀（declare 那一拍是唯一不带这个字段的生产者）。
    expect(matchesSkillEvent('onBaseTargetedAtk', atk, campTargeting() as never)).toBe(true);
    expect(matchesSkillEvent('onBaseTargetedAtk', atk, campTargeting({ damageType: 'skill' }) as never)).toBe(false);
    expect(matchesSkillEvent('onBaseTargetedSkill', skl, campTargeting({ damageType: 'skill' }) as never)).toBe(true);
    expect(matchesSkillEvent('onBaseTargetedSkill', skl, campTargeting() as never)).toBe(false);
  });

  it('五档在营地这一身的读数表（与那五档的既有谓词逐字同源，不另写一份）', () => {
    const own = campTargeting({ damageType: 'skill' });
    const other = campTargeting({ damageType: 'skill', targetPlayerId: 3 });
    const read = (scope: 'self' | 'allySeat' | 'others' | 'enemySeat' | 'field', event: unknown) =>
      matchesSkillEvent('onBaseTargetedSkill',
        { ownerId: 2, skill: definition({ type: 'onBaseTargetedSkill', listenerScope: scope }) },
        event as never);
    expect([read('self', own), read('self', other)]).toEqual([true, false]);
    expect([read('allySeat', own), read('allySeat', other)]).toEqual([true, false]);
    expect([read('enemySeat', own), read('enemySeat', other)]).toEqual([false, true]);
    expect([read('others', own), read('others', other)]).toEqual([false, true]);
    expect([read('field', own), read('field', other)]).toEqual([true, true]);
  });

  it('分界另一半：将领那格「成为目标时」不被"打营地"那一身误响（`field`／`others` 同样不响）', () => {
    for (const scope of ['self', 'allySeat', 'others', 'enemySeat', 'field'] as const) {
      const binding = { ownerId: 2, skill: definition({ type: 'onBecomingTarget', listenerScope: scope }) };
      expect(matchesSkillEvent('onBecomingTarget', binding, campTargeting() as never)).toBe(false);
      expect(matchesSkillEvent('onBecomingTarget', binding, campTargeting({ targetPlayerId: 1, attackerId: 'g2' }) as never)).toBe(false);
    }
  });

  it('「营地受到伤害时」那一格照旧不认「我听谁」（名号里已写死自家）', () => {
    expect(supportsListenerScope('onBaseDamaged')).toBe(false);
    expect(supportsListenerScope('onBaseTargetedAtk')).toBe(true);
    expect(supportsListenerScope('onBaseTargetedSkill')).toBe(true);
  });
});

describe('接线、词源与档位', () => {
  it('两型听的都是**已经存在的那一声**＝BEFORE_DAMAGE，没有新事件类型（两条路同读一张表）', () => {
    expect(eventsHeardBy('onBaseTargetedAtk')).toEqual(['BEFORE_DAMAGE']);
    expect(eventsHeardBy('onBaseTargetedSkill')).toEqual(['BEFORE_DAMAGE']);
    expect(TRIGGER_EVENTS.onBaseTargetedAtk).toBe(eventsHeardBy('onBaseTargetedAtk'));
    // 表里"打营地"这一族一共三格：两格听伤害前那一声，一格听伤害后那一声（INJURY）。
    expect(Object.keys(TRIGGER_EVENTS).filter(k => TRIGGER_EVENTS[k as keyof typeof TRIGGER_EVENTS]?.includes('BEFORE_DAMAGE')))
      .toEqual(['onBecomingTarget', 'onBaseTargetedAtk', 'onBaseTargetedSkill']);
  });

  it('编译器不再点名"这一型没接线"，且「我听谁」真编进定义（不再悄悄当没填）', () => {
    expect(definition({ type: 'onBaseTargetedAtk' }).trigger).toBe('onBaseTargetedAtk');
    expect(definition({ type: 'onBaseTargetedAtk', listenerScope: 'field' }).listenerScope).toBe('field');
    expect(definition({ type: 'onBaseTargetedSkill', listenerScope: 'enemySeat' }).listenerScope).toBe('enemySeat');
    // 缺省＝不写这一维＝只听自家（扩面前那句逐字行为在营地这两格是同一个缺省）。
    expect(definition({ type: 'onBaseTargetedSkill' }).listenerScope).toBeUndefined();
  });

  it('档位与「成为目标时」同一档：伤害还没落那一层，同档内先后由同一份比较器定', () => {
    expect(PRIORITY.onBaseTargetedAtk).toBe(PRIORITY.onBecomingTarget);
    expect(PRIORITY.onBaseTargetedSkill).toBe(PRIORITY.onBecomingTarget);
  });

  it('如实登记这一声今天的可达面：「择一窗」的候选清单里压根没有营地⇒手动发动那一路出不了这一拍', () => {
    // 不是漏接线，是靶子形态的既有事实：三档候选全枚举一遍，一个 `base_` 都没有。
    // 想让玩家亲手选"某家的营地"＝玩法刀（要过三道闸），本刀不扩。
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', []), 2)] }),
    ]);
    for (const scope of ['ENEMY_FIELD', 'ALL_FIELD', 'SELF_FIELD'] as const) {
      const ids = enumerateTargetCandidates(engine.state, 1, scope).map(c => c.targetId ?? '');
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter(id => id.startsWith('base_'))).toEqual([]);
    }
  });

  it('Excel 那一格：写出→读回逐字同一结构，旧写法「本营成为…时」照样认得', () => {
    expect(readTriggerCell('营地成为攻击目标时').trigger).toEqual({ type: 'onBaseTargetedAtk' });
    expect(readTriggerCell('本营成为技能目标时').trigger).toEqual({ type: 'onBaseTargetedSkill' });
    expect(triggerToStr({ type: 'onBaseTargetedAtk' })).toBe('营地成为攻击目标时');
    // 「我听谁」在 Excel 里自占一列（`LISTENER_SCOPE_HEADER`），所以时机那一格
    // 永远不带档位后缀——这两格既然上了同一根轴，写法与「受到伤害后」逐字同族。
    expect(triggerToStr({ type: 'onBaseTargetedSkill', listenerScope: 'field' }))
      .toBe('营地成为技能目标时');
    expect(listenerScopeToStr('field')).toBe('听场上（所有玩家）');
    expect(readListenerScopeCell('听敌方（其他席位）').scope).toBe('enemySeat');
    expect(buildTriggerOptionStrings()).toContain('营地成为攻击目标时');
    expect(buildTriggerOptionStrings()).toContain('营地成为技能目标时');
  });

  it('「我听谁」那句提示里出现了这两格（名单现取，不手抄）', () => {
    expect(LISTENER_SCOPE_HINT).toContain('营地成为攻击目标时');
    expect(LISTENER_SCOPE_HINT).toContain('营地成为技能目标时');
  });

  it('大白话那一路认得这两格，且"今天还不会响"那句提示随接线自行消失', () => {
    for (const [text, type] of [
      ['营地成为攻击目标时，摸一张牌。', 'onBaseTargetedAtk'],
      ['营地成为技能目标时，摸一张牌。', 'onBaseTargetedSkill'],
    ] as const) {
      const draft = parseSkillText(text);
      expect(draft.issues).toHaveLength(0);
      expect(draft.effects[0]?.trigger?.type).toBe(type);
      expect(draft.notices.join('')).not.toMatch(/不会响/);
    }
  });

  it('卡面那句话由同一份时机词表生成，本刀不新增第二套说法', () => {
    expect(triggerTypeLabels.onBaseTargetedAtk).toBe('营地成为攻击目标时');
    expect(triggerTypeLabels.onBaseTargetedSkill).toBe('营地成为技能目标时');
  });
});
