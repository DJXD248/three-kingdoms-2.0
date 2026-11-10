/**
 * 「确定攻击目标时」这一格的结算面（触发时机接入线·第 1 刀，用户 2026-11-10 裁的顺序）。
 *
 * 一句话契约：这一格问的是**出手的那一员**，不是**被瞄上的那一位**。它听的是全库**已经有**
 * 的那一声——普攻 declare 那一拍的 `BEFORE_DAMAGE`（`core/attackBlow.ts`），与将领那格
 * 「成为目标时」、营地那两格「营地成为攻击目标时」同一条、同一拍；换的只是载荷里读哪一侧的键。
 * ⇒ 没有新事件类型、没有新发射点、事件流一字节未改（这也是两锚本轮该判 `same` 的理由）。
 *
 * 三条判据各钉一边，全库只有这些出处：
 *  ‧ **主语换边**＝`skillEventMatch.ts` 里新那一挡读 `action.playerId` + `attackerId`；
 *  ‧ **打营地也响**＝用户同日那句词表口径（「角色」只含场上将领、「目标」含将领与营地），
 *    这一格名号里写的是"目标"⇒不挡 `isBase`；与「成为目标时」恰好在这一点上分道；
 *  ‧ **"这事是谁引起的"** 沿用缺省那一档（只听普攻）⇒决斗开局与技能补的那一声不响这一格。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { General, Skill, SkillTriggerConfig } from '../data/generals';
import { getTriggerSubOptions, supportsListenerScope, triggerTypeLabels } from '../data/generals';
import { compileSkill, syncPlayerSkills } from './skillCompiler';
import { readTriggerCell, triggerToStr } from './skillExcelFormat';
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

/** 【先声】形：「确定攻击目标时，摸一张」。`forced` 留真＝钉自动路，问答侧另有专门一条。 */
function confirmDraw(trigger: SkillTriggerConfig, forced: boolean = true): Skill {
  return {
    name: '先声',
    forced,
    effects: [{ id: 'e1', trigger, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  };
}

function definition(trigger: SkillTriggerConfig, generalId = 'g1'): DataSkillDefinition {
  // 第三个参数＝将领**实例** id：编译出来的 `sourceGeneralId` 只认它（`skillCompiler.ts:504`）。
  // 不传＝那一格空着，而 `others`／`self` 两档在"说不出是哪一员"时都按 fail-closed 不响，
  // 于是这组读数表会量到一个引擎里根本不存在的形状。
  const { definitions, skipped } = compileSkill(
    { id: generalId, name: '测试将' + generalId },
    { ...confirmDraw(trigger), name: '先声' },
    generalId,
  );
  expect(skipped).toHaveLength(0);
  expect(definitions).toHaveLength(1);
  return definitions[0];
}

/** 普攻 declare 那一拍的载荷**逐字形状**（`core/attackBlow.ts` 的 `declareNotice`）：
 *  发起方那一侧的两个键＝`action.playerId`（席位）与 `attackerId`（哪一员将）。 */
function declareEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'BEFORE_DAMAGE' as const,
    data: {
      action: { type: 'ATTACK', playerId: 1, payload: { attackerId: 'g1', targetId: 'g2' } },
      attackerId: 'g1',
      targetId: 'g2',
      targetPlayerId: 2,
      ranged: false,
      baseDamage: 2,
      attackStage: 'declare',
      ...overrides,
    },
  };
}

/** 决斗开局那一身的形状（`core/eventProcessors/duelEvents.ts` 的 `openingNotice`）：
 *  只有 `sourceGeneralId`/`targetId` 与 `damageType:'skill'`，**没有** `action`、
 *  **没有** `attackerId`⇒发起方那一侧压根说不出是谁出手。 */
function duelOpeningEvent() {
  return {
    type: 'BEFORE_DAMAGE' as const,
    data: {
      sourceGeneralId: 'g1',
      targetId: 'g2',
      skillId: 'sk_1',
      damageType: 'skill',
      duelKey: 'duel:1:1:g1>g2',
      duelStage: 'opening',
    },
  };
}

describe('第 1 刀接线面·四处各只有一份表', () => {
  it('「确定攻击目标时」从此编译得出（不再是 TRIGGER_UNSUPPORTED）', () => {
    const { definitions, skipped } = compileSkill(
      makeGeneral('g1', []),
      confirmDraw({ type: 'onTargetConfirmed' }),
      'g1',
    );
    expect(skipped).toEqual([]);
    expect(definitions).toHaveLength(1);
    expect(definitions[0].trigger).toBe('onTargetConfirmed');
  });

  it('听得懂的那一声与「成为目标时」逐字同一条＝`BEFORE_DAMAGE`', () => {
    expect(TRIGGER_EVENTS.onTargetConfirmed).toEqual(['BEFORE_DAMAGE']);
    expect(eventsHeardBy('onTargetConfirmed')).toEqual(eventsHeardBy('onBecomingTarget'));
  });

  it('同一次"伤害还没落"⇒档位也同＝50，先后仍由 `reactionOrder.ts` 那一份比较器决定', () => {
    expect(PRIORITY.onTargetConfirmed).toBe(50);
    expect(PRIORITY.onTargetConfirmed).toBe(PRIORITY.onBecomingTarget);
  });

  it('认「我听谁」那一栏（谁出手＝席位那一维），不认"攻击／技能"那一栏（名号里写死了"攻击"）', () => {
    expect(supportsListenerScope('onTargetConfirmed')).toBe(true);
    expect(getTriggerSubOptions('onTargetConfirmed')).toBeNull();
  });

  it('词表往返：Excel 那一格「确定攻击目标时」解析得出、写回去也是同一句', () => {
    expect(triggerTypeLabels.onTargetConfirmed).toBe('确定攻击目标时');
    expect(readTriggerCell('确定攻击目标时').trigger).toEqual({ type: 'onTargetConfirmed' });
    expect(triggerToStr({ type: 'onTargetConfirmed' })).toBe('确定攻击目标时');
  });
});

describe('matchesSkillEvent · 主语换边（同一声、两个主语）', () => {
  it('缺省 `self` 档：只听得出"我自己出手"，别人打不算', () => {
    const mine = { ownerId: 1, skill: definition({ type: 'onTargetConfirmed' }) };
    expect(matchesSkillEvent('onTargetConfirmed', mine, declareEvent() as never)).toBe(true);
    expect(matchesSkillEvent('onTargetConfirmed', mine, declareEvent({
      action: { type: 'ATTACK', playerId: 2, payload: {} },
      attackerId: 'g3',
    }) as never)).toBe(false);
    // 缺发起方那一侧的键＝说不出谁出手⇒fail-closed，绝不把"不知道"读成"是我"（与 `self`
    // 档"知道将 Id 时键必须对得上"那一句同一口径）。发信侧 `declareNotice` 两键恒带，
    // 这两句钉的是判据本身，不是某个真实事件的偶然缺键。
    expect(matchesSkillEvent('onTargetConfirmed', mine, declareEvent({ action: undefined }) as never)).toBe(false);
    expect(matchesSkillEvent('onTargetConfirmed', mine, declareEvent({ attackerId: undefined }) as never)).toBe(false);
  });

  it('打营地也响：这一格名号里的"目标"含将领与营地（用户 2026-11-10 词表口径）', () => {
    const mine = { ownerId: 1, skill: definition({ type: 'onTargetConfirmed' }) };
    expect(matchesSkillEvent('onTargetConfirmed', mine, declareEvent({
      targetId: 'base_2', targetPlayerId: 2, isBase: true,
    }) as never)).toBe(true);
    // 同一身把主语换到「成为目标时」⇒**不响**：营地不是任何一员将，那一格没有主语。
    const victim = { ownerId: 2, skill: definition({ type: 'onBecomingTarget' }, 'g2') };
    expect(matchesSkillEvent('onBecomingTarget', victim, declareEvent({
      targetId: 'base_2', targetPlayerId: 2, isBase: true,
    }) as never)).toBe(false);
  });

  it('两格分界只在一侧：同一声普攻，出手的那位响这一格、被瞄上的那位响那一格', () => {
    const attacker = { ownerId: 1, skill: definition({ type: 'onTargetConfirmed' }) };
    const victim = { ownerId: 2, skill: definition({ type: 'onBecomingTarget' }, 'g2') };
    expect(matchesSkillEvent('onTargetConfirmed', attacker, declareEvent() as never)).toBe(true);
    expect(matchesSkillEvent('onTargetConfirmed', victim, declareEvent() as never)).toBe(false);
    expect(matchesSkillEvent('onBecomingTarget', victim, declareEvent() as never)).toBe(true);
    expect(matchesSkillEvent('onBecomingTarget', attacker, declareEvent() as never)).toBe(false);
  });

  it('决斗开局那一身不响：既缺发起方那一侧的键，`damageType:\'skill\'` 也落在缺省那一档以外', () => {
    const mine = { ownerId: 1, skill: definition({ type: 'onTargetConfirmed' }) };
    expect(matchesSkillEvent('onTargetConfirmed', mine, duelOpeningEvent() as never)).toBe(false);
    // 两把锁各自单独咬得住：
    // ①键齐、只把来源换成技能（＝技能打营地补的那一声那一档）⇒仍然不响，挡住它的是
    //   「这事是谁引起的」那一根轴（缺省＝只听普攻），不是缺键。
    expect(matchesSkillEvent('onTargetConfirmed', mine, declareEvent({ damageType: 'skill' }) as never)).toBe(false);
    // ②来源留缺省那一档、只把发起方那两个键拿掉⇒照样不响。
    expect(matchesSkillEvent('onTargetConfirmed', mine, declareEvent({
      damageType: undefined, action: undefined, attackerId: undefined,
    }) as never)).toBe(false);
    // ③这一格的"来源"那一档在编译面上**压根填不进去**（名号里写死了"攻击"⇒录入面不给那格
    //   下拉，`skillCompiler.ts:443` 只替「成为目标时」解这一维）⇒编出来的定义读到的永远是缺省。
    expect(definition({ type: 'onTargetConfirmed' }).targetSource).toBeUndefined();
  });

  it('五档在"谁出手"这一身的读数表（与那五档的既有谓词逐字同源）', () => {
    const mine = declareEvent();
    const others = declareEvent({
      action: { type: 'ATTACK', playerId: 2, payload: {} },
      attackerId: 'g3',
      targetId: 'g1',
      targetPlayerId: 1,
    });
    const read = (scope: 'self' | 'allySeat' | 'others' | 'enemySeat' | 'field', event: unknown) =>
      matchesSkillEvent('onTargetConfirmed',
        { ownerId: 1, skill: definition({ type: 'onTargetConfirmed', listenerScope: scope }) },
        event as never);
    expect([read('self', mine), read('self', others)]).toEqual([true, false]);
    expect([read('allySeat', mine), read('allySeat', others)]).toEqual([true, false]);
    expect([read('enemySeat', mine), read('enemySeat', others)]).toEqual([false, true]);
    expect([read('field', mine), read('field', others)]).toEqual([true, true]);
    // `others`＝"除自身这一员以外"：别的席位那一员必然算别人。
    expect([read('others', mine), read('others', others)]).toEqual([false, true]);
    // 同席位另一员将出手也算"其他角色"（用户 2026-10-18 口径逐字＝「其他角色＝自身以外」）。
    expect(read('others', declareEvent({ attackerId: 'g9' }))).toBe(true);
  });
});

describe('真链路 · 自动路（打了「强制发动」）', () => {
  /** 席 1 的 g1 打席 2 在场的 g2；那一格挂在**出手的 g1** 身上。 */
  function attackWith(extraAttackerSkills: Skill[], extraVictimSkills: Skill[] = []) {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', extraAttackerSkills), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g2', extraVictimSkills), 2)],
      }),
    ]);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    return { engine, events };
  }

  it('自己出手⇒摸一张，那一刀照旧落（伤害数值与没有这一格时逐字相同）', () => {
    const r = attackWith([confirmDraw({ type: 'onTargetConfirmed' })]);
    expect(handOf(r.engine, 1)).toBe(1);
    expect(generalHpOf(r.engine, 2, 'g2')).toBe(2);
  });

  it('问在伤害之前：事件流里那一声排在这一刀的 `DAMAGE` 前面', () => {
    const r = attackWith([confirmDraw({ type: 'onTargetConfirmed' })]);
    const flat = r.events.map(e => e.type);
    const notice = flat.indexOf('BEFORE_DAMAGE');
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(flat.indexOf('DAMAGE')).toBeGreaterThan(notice);
  });

  it('绝不一技能两响：一场攻击里这一格只摸一张（自动路与问答路的听众名单同读一份表）', () => {
    const r = attackWith([confirmDraw({ type: 'onTargetConfirmed' })]);
    expect(r.events.filter(e => e.type === 'BEFORE_DAMAGE')).toHaveLength(1);
    expect(handOf(r.engine, 1)).toBe(1);
  });

  it('缺省档不响别人的攻击：同一枚挂在被瞄上的那一员身上 ⇒ 谁也没摸', () => {
    const r = attackWith([], [confirmDraw({ type: 'onTargetConfirmed' })]);
    expect(handOf(r.engine, 1)).toBe(0);
    expect(handOf(r.engine, 2)).toBe(0);
  });

  it(`「我听谁」放开成 \`field\` ⇒ 别人出手也算（界面上那一格与引擎读的是同一个谓词）`, () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [confirmDraw({ type: 'onTargetConfirmed', listenerScope: 'field' })]), 2)],
      }),
    ]);
    engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    expect(handOf(engine, 2)).toBe(1);
  });

  it('打营地同样走这一格：出手的那一员摸一张，营地照旧只掉 1 点', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeBaseRusher(makeGeneral('g1', [confirmDraw({ type: 'onTargetConfirmed' })]), 1, 2)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST,
    }));
    expect(handOf(engine, 1)).toBe(1);
    expect(baseHpOf(engine, 2)).toBe(9);
  });
});

describe('真链路 · 问答路（没打「强制发动」⇒停下来问出手的那一席）', () => {
  function attackUnforced() {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', [confirmDraw({ type: 'onTargetConfirmed' }, false)]), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', []), 2)] }),
    ]);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    return { engine, events };
  }

  it('问的是发起方那一席，而且问的时候那一刀还没落（目标血量一点没动）', () => {
    const r = attackUnforced();
    const types = r.events.map(e => e.type);
    expect(types).toContain('BEFORE_DAMAGE');
    expect(types).not.toContain('DAMAGE');
    // 悬着的整拍＝连"这一刀的粮草"都还没付：手牌仍是出手前那一枚，没有摸进来的一张。
    expect(r.engine.state.players[0].hand?.map(c => (c as { id?: string }).id)).toEqual(['cost_1']);
    expect(generalHpOf(r.engine, 2, 'g2')).toBe(4);
    const ask = getReactionAsk(r.engine.state);
    expect(ask?.trigger).toBe('onTargetConfirmed');
    expect(ask?.playerId).toBe(1);
    expect(ask?.generalId).toBe('g1');
    expect(ask?.options.map(o => o.skillName)).toEqual(['先声']);
  });

  it('点头⇒先摸一张，那一刀才落下（续跑环重瞄读的是答完之后的状态）', () => {
    const r = attackUnforced();
    const ask = getReactionAsk(r.engine.state)!;
    r.engine.dispatch(createAction('ACTIVATE_SKILL', 1, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(handOf(r.engine, 1)).toBe(1);
    expect(generalHpOf(r.engine, 2, 'g2')).toBe(2);
    expect(getReactionAsk(r.engine.state)).toBeNull();
  });

  it('交白卷⇒那一刀照常落，谁也没摸（"都不发动"是一条本来就合法的回答）', () => {
    const r = attackUnforced();
    const ask = getReactionAsk(r.engine.state)!;
    r.engine.dispatch(createAction('SKIP_REACTION', 1, { nodeKey: ask.nodeKey }));
    expect(handOf(r.engine, 1)).toBe(0);
    expect(generalHpOf(r.engine, 2, 'g2')).toBe(2);
    expect(getReactionAsk(r.engine.state)).toBeNull();
  });

  it('打营地时同样问发起方：答完之后营地才掉那 1 点', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeBaseRusher(makeGeneral('g1', [confirmDraw({ type: 'onTargetConfirmed' }, false)]), 1, 2)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'base_2', ranged: false, consumeCard: ATTACK_COST,
    }));
    const ask = getReactionAsk(engine.state);
    expect(ask?.playerId).toBe(1);
    expect(baseHpOf(engine, 2)).toBe(10);
    engine.dispatch(createAction('ACTIVATE_SKILL', 1, {
      skillId: ask!.options[0].skillId, generalId: ask!.generalId,
    }));
    expect(handOf(engine, 1)).toBe(1);
    expect(baseHpOf(engine, 2)).toBe(9);
  });

  it('同一场攻击里两格各问一次不串：出手的那位与挨打的那位各自答自己那一格', () => {
    const engine = buildEngine([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', [confirmDraw({ type: 'onTargetConfirmed' }, false)]), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [{
          name: '回刺',
          effects: [{ id: 'e1', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } }],
        }]), 2)],
      }),
    ]);
    engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: ATTACK_COST,
    }));
    // 两格同档（50）⇒先问谁由 `reactionOrder.ts` 那一份比较器说了算，这里只数"各问得到一次"。
    const heard: string[] = [];
    for (let i = 0; i < 4; i++) {
      const ask = getReactionAsk(engine.state);
      if (!ask) break;
      heard.push(ask.trigger as string);
      engine.dispatch(createAction('SKIP_REACTION', ask.playerId as number, { nodeKey: ask.nodeKey }));
    }
    expect(heard).toContain('onTargetConfirmed');
    expect(heard).toContain('onBecomingTarget');
    expect(heard.filter(t => t === 'onTargetConfirmed')).toHaveLength(1);
    // 两格都交白卷⇒那一刀落一次，反伤没有听众所以不追加。
    expect(generalHpOf(engine, 2, 'g2')).toBe(2);
    expect(generalHpOf(engine, 1, 'g1')).toBe(4);
  });
});
