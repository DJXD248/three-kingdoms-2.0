/**
 * 触发时机接入线·第 2 刀「直到X前生效」(`untilExpire`) 的接线测试。
 * 契约＝PROJECT_HANDOFF.md §16 状态表那一格（已接线）＋§12-177 本轮判据；顺序＝用户
 * 2026-11-10 裁的「4、3、1+2，5暂时挂起，6、7两个先把前面四个做完再说」。
 *
 * 这一档的形状＝**带死线的在场账**，与「在场即生效」是姊妹（2.8 刀4 那一型）：
 *  · 它**不是一次发动**——不进问窗、不依赖「强制发动」、不耗"一局一次／回合限 N 次"；
 *  · 它**不监听任何一声**——`TRIGGER_EVENTS` 里没有它（第三个"编译而不听"的例外），
 *    所以真链路那一侧永远不会有 `TRIGGERED`；
 *  · 它与上一型只差一寸——那一笔账多带一条死线 X，X 写在**时机那一格**；
 *  · 销账**一把新的机制都没加**：四个回合词走账本已有的回合边界总闸，
 *    「被击杀／离开场上」与离场总闸同义（契约表第 2 条），哪个先到算哪个。
 *
 * 测试因此分四层写，缺一层就有一条假路可走：
 *  ①编译器判据（哪些形状编得出、哪些形状点名）——防"能填却不响"与"悄悄收下"；
 *  ②落笔形状（账本上那笔长什么样、cause 各归各格）——防"记录了而未消费"；
 *  ③真链路到期（回合边界／离场）——防"落了笔而没人收"；
 *  ④入口存在性的普查钉子（内容里一处没有）——防把"内容现状"读成"代码缺陷"，
 *    这一档同时是两锚不换名的成因说明。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { General, Skill, SkillTriggerConfig, ExpireCondition } from '../data/generals';
import { allGenerals, expireLabels, triggerTypeLabels } from '../data/generals';
import { buildTriggerOptionStrings, readTriggerCell, triggerToStr } from './skillExcelFormat';
import { triggerPhrase } from './skillSentence';
import { compileSkill, judgeSkillEffect, syncPlayerSkills } from './skillCompiler';
import { eventsHeardBy } from './reactionTriggers';
import { getReactionAsk } from './reactionChain';
import { passiveEventsForDeploy, passiveEventsForGainedSkill, passiveEntriesOfGeneral } from './passiveModifiers';
import { isExpiredAtTurnBoundary } from '../core/statModifiers';

function general(skills: Skill[]): General {
  return makeGeneralLike('test_001', skills);
}

function makeGeneralLike(id: string, skills: Skill[]): General {
  return {
    id, name: '测试将' + id, faction: '魏', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
  };
}

/** 带死线的那一型：时机那一格＝〔这一型 ＋ X〕，效果只填「改数值」。 */
function windowSkill(
  expire: ExpireCondition,
  overrides: Partial<Skill> = {},
  runtime: NonNullable<Skill['effects']>[number]['runtime'] = {
    type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta',
  },
): Skill {
  const trigger: SkillTriggerConfig = { type: 'untilExpire', expireCondition: expire };
  return {
    name: '锋锐', trigger,
    effects: [{ id: 'e1', trigger, runtime }],
    ...overrides,
  };
}

function makeFieldGeneral(g: General, ownerId: number, slot = 0): any {
  return {
    general: g, currentHp: g.hp, maxHp: g.hp,
    meleeAtk: g.meleeAtk, rangedAtk: g.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [],
    isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone: 'front', slot, areaOwnerId: 1 },
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  } as EnginePlayer;
}

function buildEngine(players: EnginePlayer[]): GameEngine {
  const state: EngineState = {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
    ],
    discardPile: [], drawState: null,
  } as EngineState;
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  return engine;
}

const COST = { id: 'cost_1', name: '粮草', type: '粮草' };
const COST_2 = { id: 'cost_2', name: '粮草', type: '粮草' };

function ledgerOf(state: EngineState) {
  return state.statModifiers ?? [];
}

function hpOf(engine: GameEngine, playerId: number, generalId: string): number | undefined {
  const player = engine.state.players.find(p => p.id === playerId);
  const fg = (player?.fieldGenerals as any[] | undefined)?.find(f => f?.general?.id === generalId);
  return fg?.currentHp;
}

// ── ① 编译器判据：哪些形状编得出、哪些形状点名 ────────────────────────

describe('untilExpire · 编译器判据（第 2 刀）', () => {
  it('时机＋死线＋改数＝编得出一 Definition：trigger 是这一型、死线逐字搬过来', () => {
    const { definitions, skipped } = compileSkill(general([]), windowSkill('untilSelfTurnStart'), 'g1');
    expect(skipped).toEqual([]);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      id: 'g1:锋锐:e1',
      name: '锋锐',
      trigger: 'untilExpire',
      expireCondition: 'untilSelfTurnStart',
      effects: [{ type: 'MODIFY_STAT', stat: 'MELEE_ATK', modifyMode: 'delta', value: 1, target: 'SELF' }],
    });
    // 姊妹那一位的位**不在**：这一型有到期时刻，不能自称"周期就是在场"。
    expect(definitions[0].passive).toBeUndefined();
  });

  it('这一型编出来却不听任何一声：既不在事件面上，也没有第二枚"编译而不听"混进来', () => {
    expect(eventsHeardBy('untilExpire')).toEqual([]);
    expect(eventsHeardBy('passive')).toEqual([]);
    // 对照：已接线的发动型确实听得见东西（否则上面两个空数组只是"整个表没接线"）。
    expect(eventsHeardBy('onDamageTaken').length).toBeGreaterThan(0);
  });

  it('死线只许一个出处：没填 X ⇒ 点名 UNTIL_EXPIRE_WINDOW_MISSING，不悄悄降级成在场即生效', () => {
    const { definitions, skipped } = compileSkill(general([]), {
      name: '锋锐', trigger: { type: 'untilExpire' },
      effects: [{
        id: 'e1', trigger: { type: 'untilExpire' },
        runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' },
      }],
    }, 'g1');
    expect(definitions).toHaveLength(0);
    expect(skipped[0].reason).toBe('UNTIL_EXPIRE_WINDOW_MISSING');
  });

  it('四档点名各归各格：动作不是改数／效果里又填周期／带门槛／带觉醒徽章', () => {
    const judge = (skill: Skill) => judgeSkillEffect(
      skill.effects![0], skill.effects![0].trigger,
      { skillConditions: skill.conditions, awakeningTag: (skill.tags ?? []).includes('觉醒技') },
    );
    expect(judge(windowSkill('untilSelfTurnEnd', {}, { type: 'DRAW_CARD', value: 1, target: 'SELF' })))
      .toBe('UNTIL_EXPIRE_EFFECT_UNSUPPORTED');
    expect(judge(windowSkill('untilSelfTurnEnd', {}, {
      type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta', duration: 'untilSelfTurnEnd',
    }))).toBe('UNTIL_EXPIRE_DURATION_CONFLICT');
    expect(judge(windowSkill('untilSelfTurnEnd', { conditions: [{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }] })))
      .toBe('UNTIL_EXPIRE_CONDITION_UNSUPPORTED');
    expect(judge(windowSkill('untilSelfTurnEnd', { tags: ['觉醒技'] })))
      .toBe('AWAKENING_UNTIL_EXPIRE_CONFLICT');
    // 正常那一格必须给 undefined——否则上面四档"全都点名"可能只是判据本身在乱咬。
    expect(judge(windowSkill('untilSelfTurnEnd'))).toBeUndefined();
  });

  it('「我听谁」这一栏对这一型不出现：塞进来点名，不悄悄当成"只听自家"', () => {
    const trigger: SkillTriggerConfig = { type: 'untilExpire', expireCondition: 'untilSelfTurnEnd', listenerScope: 'field' };
    expect(judgeSkillEffect(
      { id: 'e1', trigger, runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' } },
      trigger, {},
    )).toBe('TRIGGER_SUBTYPE_UNSUPPORTED');
  });

  it('额度三格照常不落键：限定技／每回合限 N 次／觉醒位都不能挂在一个"没有发动这一刻"的账上', () => {
    const { definitions } = compileSkill(general([]), windowSkill('untilSelfTurnEnd', {
      tags: ['限定技'], turnLimit: 2,
    }), 'g1');
    expect(definitions).toHaveLength(1);
    expect(definitions[0].limitKey).toBeUndefined();
    expect(definitions[0].turnQuota).toBeUndefined();
    expect(definitions[0].awakening).toBeUndefined();
    // 锁定技那一枚徽章照旧跟着改数落笔——它是账本位，不是额度位。
    const locked = compileSkill(general([]), windowSkill('untilSelfTurnEnd', { tags: ['锁定技'] }), 'g1');
    expect(locked.definitions[0].locked).toBe(true);
  });

  it('「选择其一」与链式若-则都组不成：整组点名，绝不当成"全都要"或"响完这一环再说"', () => {
    const modify = {
      type: 'MODIFY_STAT' as const, value: 1, target: 'SELF' as const,
      stat: 'MELEE_ATK' as const, modifyMode: 'delta' as const,
    };
    const trigger: SkillTriggerConfig = { type: 'untilExpire', expireCondition: 'untilSelfTurnEnd' };
    const choice = compileSkill(general([]), {
      name: '锋锐', effectMode: 'choice', trigger,
      effects: [
        { id: 'e1', trigger, runtime: modify },
        { id: 'e2', trigger, runtime: { ...modify, value: 2 } },
      ],
    }, 'g1');
    expect(choice.definitions).toHaveLength(0);
    expect(choice.skipped.map(s => s.reason)).toEqual(['UNTIL_EXPIRE_GROUP_UNSUPPORTED', 'UNTIL_EXPIRE_GROUP_UNSUPPORTED']);

    const chain = compileSkill(general([]), {
      name: '锋锐', effectMode: 'chain', trigger,
      effects: [
        { id: 'e1', trigger, runtime: modify },
        { id: 'e2', trigger, runtime: { ...modify, stat: 'RANGED_ATK' } },
      ],
    }, 'g1');
    expect(chain.definitions).toHaveLength(0);
    expect(chain.skipped.map(s => s.reason)).toEqual(['UNTIL_EXPIRE_GROUP_UNSUPPORTED', 'UNTIL_EXPIRE_GROUP_UNSUPPORTED']);

    // 对照组：同一组若只有一块积木（孤效果），照常编出定义——点名只针对"组不成"的那些。
    const single = compileSkill(general([]), {
      name: '锋锐', effectMode: 'choice', trigger,
      effects: [{ id: 'e1', trigger, runtime: modify }],
    }, 'g1');
    expect(single.definitions).toHaveLength(1);
  });

  it('两条不同的死线＝两个不同的窗口：签名把它们拆开，绝并不成"同一刻响的一组"', () => {
    const modify = {
      type: 'MODIFY_STAT' as const, value: 1, target: 'SELF' as const,
      stat: 'MELEE_ATK' as const, modifyMode: 'delta' as const,
    };
    const { definitions } = compileSkill(general([]), {
      name: '锋锐', effectMode: 'choice',
      effects: [
        { id: 'e1', trigger: { type: 'untilExpire', expireCondition: 'untilSelfTurnEnd' }, runtime: modify },
        { id: 'e2', trigger: { type: 'untilExpire', expireCondition: 'untilOtherTurnEnd' }, runtime: { ...modify, stat: 'RANGED_ATK' } },
      ],
    }, 'g1');
    // 各自成组⇒各自点名？不：签名不同⇒两组各只有一枚⇒按孤效果照常编出两条定义。
    expect(definitions).toHaveLength(2);
    expect(definitions.map(d => d.expireCondition)).toEqual(['untilSelfTurnEnd', 'untilOtherTurnEnd']);
  });
});

// ── ② 落笔形状：账本上那一笔长什么样 ────────────────────────────────

describe('untilExpire · 登场落笔（在场账的姊妹）', () => {
  it('一笔 STAT_MODIFY{op:ADD}：死线逐字进 expire、passive 位写 false、cause 各归各格', () => {
    const events = passiveEventsForDeploy(general([windowSkill('untilSelfTurnStart')]), 'g1#2', 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'STAT_MODIFY',
      data: {
        op: 'ADD',
        cause: 'UNTIL_EXPIRE_ON_FIELD',
        modifier: {
          key: 'MELEE_ATK', mode: 'delta', value: 1,
          targetPlayerId: 1, targetId: 'g1#2',
          ownerPlayerId: 1, ownerGeneralId: 'g1#2',
          ownerSkillId: 'g1#2:锋锐:e1', ownerSkillName: '锋锐',
          locked: false, passive: false, expire: 'untilSelfTurnStart',
        },
      },
    });
  });

  it('在场即生效那一型逐字不动：不填 expire、cause 仍是 PASSIVE_ON_FIELD（两锚的结构保证）', () => {
    const passiveEvents = passiveEventsForDeploy(general([{
      name: '刚毅', trigger: { type: 'passive' },
      effects: [{
        id: 'e1', trigger: { type: 'passive' },
        runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' },
      }],
    }]), 'g1#2', 1);
    expect(passiveEvents).toHaveLength(1);
    expect((passiveEvents[0].data as any).cause).toBe('PASSIVE_ON_FIELD');
    expect('expire' in (passiveEvents[0].data as any).modifier).toBe(false);
    expect((passiveEvents[0].data as any).modifier.passive).toBe(true);
  });

  it('两型并排挂在同一员将身上＝各落一笔、各带各的 cause，互不遮蔽', () => {
    const entries = passiveEntriesOfGeneral(general([
      windowSkill('untilSelfTurnEnd'),
      {
        name: '刚毅', trigger: { type: 'passive' },
        effects: [{
          id: 'e1', trigger: { type: 'passive' },
          runtime: { type: 'MODIFY_STAT', value: 2, target: 'SELF', stat: 'RANGED_ATK', modifyMode: 'delta' },
        }],
      },
    ]), 'g1#2', 1);
    expect(entries.map(e => e.key)).toEqual(['MELEE_ATK', 'RANGED_ATK']);
    expect(entries.map(e => e.passive)).toEqual([false, true]);
    expect(entries[0].expire).toBe('untilSelfTurnEnd');
    expect('expire' in entries[1]).toBe(false);
  });

  it('被编译器点名的那些形状⇒这里连笔都没有（绝不"记录而未消费"）', () => {
    expect(passiveEntriesOfGeneral(general([windowSkill('untilSelfTurnEnd', {}, {
      type: 'DRAW_CARD', value: 1, target: 'SELF',
    })]), 'g1#2', 1)).toEqual([]);
    expect(passiveEntriesOfGeneral(general([{
      name: '锋锐', trigger: { type: 'untilExpire' },
      effects: [{
        id: 'e1', trigger: { type: 'untilExpire' },
        runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' },
      }],
    }]), 'g1#2', 1)).toEqual([]);
  });

  it('「获得技能」那一次补落同一条路：拿到的是一型带死线的账⇒当场补一笔，cause 也点名', () => {
    const events = passiveEventsForGainedSkill(general([]), windowSkill('untilOtherTurnEnd'), 'g1#2', 1);
    expect(events).toHaveLength(1);
    expect((events[0].data as any)).toMatchObject({
      op: 'ADD', cause: 'UNTIL_EXPIRE_ON_FIELD',
      modifier: { passive: false, expire: 'untilOtherTurnEnd' },
    });
  });

  it('六档死线都能落笔（词表与账本同一把钥匙，本刀不为某一档另开一条路）', () => {
    const windows: ExpireCondition[] = [
      'untilSelfTurnStart', 'untilSelfTurnEnd', 'untilOtherTurnStart', 'untilOtherTurnEnd',
      'untilDeath', 'untilLeaveField',
    ];
    for (const expire of windows) {
      const [entry] = passiveEntriesOfGeneral(general([windowSkill(expire)]), 'g1#2', 1);
      expect(entry, expire).toMatchObject({ passive: false, expire });
    }
  });
});

// ── ③ 真链路：落笔、生效、到期收账 ──────────────────────────────────

describe('untilExpire · 真链路（登场落笔⇒回合边界／离场收账）', () => {
  it('登场即落一笔，不经问窗、不产生 TRIGGERED，也不落进"发动"那一档', () => {
    const attacker = makeGeneralLike('g1', [windowSkill('untilSelfTurnStart')]);
    const engine = buildEngine([
      makePlayer(1, { hand: [attacker, COST, COST_2] }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, {
      general: attacker, slot: 0, consumeCards: [COST],
    }));
    expect(events.filter(e => e.type === 'STAT_MODIFY').length).toBe(1);
    expect(events.some(e => e.type === 'TRIGGERED')).toBe(false);
    expect(getReactionAsk(engine.state)).toBeNull();
    expect(ledgerOf(engine.state)).toHaveLength(1);
    expect(ledgerOf(engine.state)[0]).toMatchObject({
      key: 'MELEE_ATK', mode: 'delta', value: 1, passive: false, expire: 'untilSelfTurnStart',
    });
  });

  it('窗口内那一刀吃的是账：卡面 2 点＋这笔 +1 ⇒ 掉 3 点；死线还没到，账照旧在场', () => {
    const attacker = makeGeneralLike('g1', [windowSkill('untilSelfTurnStart')]);
    const victim = makeGeneralLike('g2', []);
    const engine = buildEngine([
      makePlayer(1, { hand: [attacker, COST, COST_2] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(victim, 2)] }),
    ]);
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: attacker, slot: 0, consumeCards: [COST] }));
    engine.dispatch(createAction('ATTACK', 1, { attackerId: 'g1', targetId: 'g2', ranged: false, consumeCard: COST_2 }));
    expect(hpOf(engine, 2, 'g2')).toBe(1);
    expect(ledgerOf(engine.state)).toHaveLength(1);
  });

  /** 登场落笔⇒两趟 END_TURN，中间各读一次账本（回合边界总闸那半条真链路）。 */
  function ledgerAcrossTwoTurns(expire: ExpireCondition): number[] {
    const attacker = makeGeneralLike('g1', [windowSkill(expire)]);
    const engine = buildEngine([
      makePlayer(1, { hand: [attacker, COST] }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: attacker, slot: 0, consumeCards: [COST] }));
    const after = [ledgerOf(engine.state).length];
    engine.dispatch(createAction('END_TURN', 1));
    after.push(ledgerOf(engine.state).length);
    engine.dispatch(createAction('END_TURN', 2));
    after.push(ledgerOf(engine.state).length);
    return after;
  }

  it('「到下个己方回合开始前」：自家回合收官不收账，回到自家回合开始才收', () => {
    expect(ledgerAcrossTwoTurns('untilSelfTurnStart')).toEqual([1, 1, 0]);
  });

  it('「到下个己方回合结束前」：自家回合一开始就过期（窗口只跨这一回合）', () => {
    // 第一格＝登场落的那笔；第二格＝轮到别人时那笔**还在**（死线是"自家回合结束"，
    // 而自家那一趟 END_TURN 还没走）——所以这里读的是 END_TURN(1) 之后的账。
    const attacker = makeGeneralLike('g1', [windowSkill('untilSelfTurnEnd')]);
    const engine = buildEngine([
      makePlayer(1, { hand: [attacker, COST] }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: attacker, slot: 0, consumeCards: [COST] }));
    expect(ledgerOf(engine.state)).toHaveLength(1);
    engine.dispatch(createAction('END_TURN', 1));
    expect(ledgerOf(engine.state), '自家回合结束＝死线到，当场结束').toHaveLength(0);
  });

  it('「到下个其他玩家回合结束前」：自家回合收官不收账，别人那一圈走完才收', () => {
    expect(ledgerAcrossTwoTurns('untilOtherTurnEnd')).toEqual([1, 1, 0]);
  });

  it('「到下个其他玩家回合开始前」：轮到别人那一刻就收', () => {
    const attacker = makeGeneralLike('g1', [windowSkill('untilOtherTurnStart')]);
    const engine = buildEngine([
      makePlayer(1, { hand: [attacker, COST] }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: attacker, slot: 0, consumeCards: [COST] }));
    expect(ledgerOf(engine.state)).toHaveLength(1);
    engine.dispatch(createAction('END_TURN', 1));   // ⇒ 其他玩家回合开始＝死线到
    expect(ledgerOf(engine.state)).toHaveLength(0);
  });

  it('六档死线在账本里各归两把总闸之一：四个回合词各且仅收于一声、两档与离场同义（本刀零新机制）', () => {
    /**
     * 这笔账的归属席位＝1（`passiveEntriesOfGeneral(..., 1)`）。四声各拿一次"该收"与
     * 三次"不该收"：断言的是**恰好那一声**，不是"某一声会红"——少一根名单都可能悄悄多收。
     * 「自家／其他」比的是账的归属，与被改的那一位无关（`statModifiers.ts:227`）。
     */
    const boundaries = [
      { edge: 'start' as const, playerId: 1 },  // 自家回合开始
      { edge: 'end' as const, playerId: 1 },    // 自家回合结束
      { edge: 'start' as const, playerId: 2 },  // 其他玩家回合开始
      { edge: 'end' as const, playerId: 2 },    // 其他玩家回合结束
    ];
    const label = (b: { edge: 'start' | 'end'; playerId: number }) =>
      `until${b.playerId === 1 ? 'Self' : 'Other'}Turn${b.edge === 'start' ? 'Start' : 'End'}`;
    const firedAt = (expire: ExpireCondition) => {
      const [entry] = passiveEntriesOfGeneral(general([windowSkill(expire)]), 'g1', 1);
      expect(entry, expire).toBeDefined();
      expect(entry!.expire, expire).toBe(expire);
      const mod = { ...entry!, id: 'sm:1', seq: 1 };
      return boundaries.filter(b => isExpiredAtTurnBoundary(mod, b)).map(label);
    };
    for (const word of ['untilSelfTurnStart', 'untilSelfTurnEnd', 'untilOtherTurnStart', 'untilOtherTurnEnd'] as const) {
      expect(firedAt(word), word).toEqual([word]);
    }
    // 离场那两档**不该**被任何一声回合边界收走——它们只由离场／阵亡／席位覆灭那把总闸收，
    // 这正是"零新销账机制"的形状：总闸各管各的，没有第三把。
    for (const word of ['untilDeath', 'untilLeaveField'] as const) {
      expect(firedAt(word), word).toEqual([]);
    }
  });

  it('离场那一档（直到被击杀前）＝与在场账同一把总闸收走，人没了账也没了', () => {
    const windowed = { ...makeGeneralLike('g1', [windowSkill('untilDeath')]), hp: 1 };
    const raider = makeGeneralLike('g2', []);
    const engine = buildEngine([
      makePlayer(1, { hand: [windowed, COST] }),
      // 对手那一员踩在同一片区域的前线（近战够得着自家营地那一格，判据见 `core/attackReach.ts:85`）。
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(raider, 2)], hand: [COST_2] }),
    ]);
    // ① 自家回合登场⇒落一笔带死线的在场账。
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: windowed, slot: 0, consumeCards: [COST] }));
    expect(ledgerOf(engine.state)).toHaveLength(1);
    expect(ledgerOf(engine.state)[0]).toMatchObject({ passive: false, expire: 'untilDeath' });
    // ② 换到对手那一席：回合边界总闸**不该**收走离场那一档（这一趟就是它的反证）。
    engine.dispatch(createAction('END_TURN', 1));
    expect(ledgerOf(engine.state), '回合换人收不走"直到被击杀前"').toHaveLength(1);
    // ③ 对手一刀带走⇒离场／阵亡那把总闸连带把这一笔也收走。
    engine.dispatch(createAction('ATTACK', 2, {
      attackerId: 'g2', targetId: 'g1', ranged: false, consumeCard: COST_2,
    }));
    expect(engine.state.players.find(p => p.id === 1)?.fieldGenerals).toHaveLength(0);
    expect(ledgerOf(engine.state), '离场总闸连带把带死线的那一笔也收走').toHaveLength(0);
  });

  it('对照（少了这一例就测不出"到期"与"压根没落笔"的差别）：没有这一型的将登场＝事件流一字不多', () => {
    const plain = makeGeneralLike('g1', []);
    const engine = buildEngine([makePlayer(1, { hand: [plain, COST] }), makePlayer(2)]);
    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, { general: plain, slot: 0, consumeCards: [COST] }));
    expect(events.some(e => e.type === 'STAT_MODIFY')).toBe(false);
    expect(engine.state.statModifiers).toBeUndefined();
  });
});

// ── ④ 入口存在性的普查钉子（内容现状＝两锚不换名的成因） ──────────────

/**
 * 与 `passiveModifiers.test.ts` 末尾那条同一手法：只有把"内容里有一处／没有一处"做成
 * 断言，"接线了却没卡在用"才不会被后来人误读成"根本没接线"。
 *
 * 第 2 刀的现状＝**官方池与 DIY 夹具里一处都没有**（本刀只交付引擎侧这一格，不替用户
 * 写卡面内容——名册是他亲手写的字段，改它要有他当轮原话）。⇒ 两锚因此逐字不动，
 * 成因是三成因里的「没碰到」，不是"碰到了也一样"。
 */
describe('untilExpire · 内容入口的普查钉子（本刀零卡片使用）', () => {
  const usersOf = (pool: readonly General[]) => pool.filter(g =>
    (g.skills ?? []).some(s =>
      s.trigger?.type === 'untilExpire'
      || (s.effects ?? []).some(e => e.trigger?.type === 'untilExpire')));

  it('官方名册一处没有：这一格今天只能由 DIY 玩家自己写出来', () => {
    const officials = allGenerals.filter(g => g.source !== 'DIY');
    expect(officials.length).toBeGreaterThan(0);
    expect(usersOf(officials).map(g => g.id)).toEqual([]);
    // 名册里 `untilExpire` 只出现在词表（类型／细分／标签／分档表），不在任何一张卡面上。
    const json = JSON.stringify(officials.map(g => g.skills));
    expect(json.includes('"untilExpire"')).toBe(false);
  });

  it('两锚的另一半输入面（DIY 夹具）也一处没有⇒对局读数结构上不动', () => {
    const fixture = allGenerals.filter(g => g.source === 'DIY');
    expect(usersOf(fixture).map(g => g.id)).toEqual([]);
  });

  it('落笔函数逐位将走一遍⇒没有一位落出"带死线的在场笔"', () => {
    // 只数这一型：名册里有两张关羽落的是**姊妹**那一型（在场即生效、不带死线），
    // 它们的钉子归 `passiveModifiers.test.ts`。这一例的判据＝"带死线"两位取其一
    // （`passive:false` 或填了 `expire`）⇒有卡用这一型当场红。
    for (const g of allGenerals) {
      const entries = passiveEntriesOfGeneral(g, `${g.id}#1`, 1);
      expect(entries.filter(e => e.passive === false || 'expire' in e), g.name).toEqual([]);
    }
  });

  it('六档死线一词一读：词表里那一枚枚都能被账本的既有算术读到（没有第二份名单）', () => {
    // 判据两头各咬一次：① 词表新增一档而落笔那一路不认它⇒这里红；② 落笔悄悄收下一个
    // 词表里不存在的"期限"⇒`passiveEntriesOfGeneral` 给的 expire 对不上任何标签⇒也红。
    const words = Object.keys(expireLabels) as ExpireCondition[];
    expect(words.length).toBe(6);
    for (const word of words) {
      const [entry] = passiveEntriesOfGeneral(general([windowSkill(word)]), 'g1', 1);
      expect(entry, word).toBeDefined();
      expect(entry!.expire, word).toBe(word);
    }
  });
});

// ── ⑤ 玩家看得见的那几行字往返＝显示与结算同一把钥匙 ──────────────────

/**
 * §12-112 那条常设口径的反方向护栏＝**接线了、也得看得见**；这一格今天已接线，
 * 所以"看得见"那三处（Excel 那一格、下拉清单、卡面话拼句）必须逐字指回引擎读的
 * 同一枚 `expireCondition`。判据一律**抄实现的函数**（`triggerToStr`／`readTriggerCell`
 * 是录入面唯一入口），测试不自造第二套解析。
 */
describe('untilExpire · 看得见的字与结得了的账同一把钥匙（Excel 格／下拉／卡面话）', () => {
  const words = Object.keys(expireLabels) as ExpireCondition[];

  it('Excel「触发」那一格逐字往返：写出去 → 读回来＝同一个时机＋同一个 X', () => {
    for (const word of words) {
      const cfg: SkillTriggerConfig = { type: 'untilExpire', expireCondition: word };
      const cell = triggerToStr(cfg);
      expect(cell, word).toBe(`${triggerTypeLabels.untilExpire}→${expireLabels[word]}`);
      // 严格入口（不是宽松版）：读不懂会交回 `unreadable`，这里两头都不许发生。
      const read = readTriggerCell(cell);
      expect(read.unreadable, word).toBeUndefined();
      expect(read.trigger, word).toEqual(cfg);
    }
  });

  it('读回来的那一格照常编得出、照常落笔⇒不是"填得回却结不了"那一族事故', () => {
    for (const word of words) {
      const cfg = readTriggerCell(triggerToStr({ type: 'untilExpire', expireCondition: word })).trigger!;
      const skill: Skill = {
        name: '锋锐', trigger: cfg,
        effects: [{
          id: 'e1', trigger: cfg,
          runtime: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'MELEE_ATK', modifyMode: 'delta' },
        }],
      };
      const { definitions, skipped } = compileSkill(general([]), skill, 'g1');
      expect(skipped, word).toEqual([]);
      expect(definitions, word).toHaveLength(1);
      expect(definitions[0].expireCondition, word).toBe(word);
      expect(passiveEntriesOfGeneral(general([skill]), 'g1#1', 1)[0], word)
        .toMatchObject({ passive: false, expire: word });
    }
  });

  it('下拉清单里有这一格（六档各一行）＋卡面话把 X 写在括号里', () => {
    const options = buildTriggerOptionStrings();
    for (const word of words) {
      expect(options).toContain(`${triggerTypeLabels.untilExpire}→${expireLabels[word]}`);
    }
    expect(triggerPhrase({ type: 'untilExpire', expireCondition: 'untilSelfTurnStart' }))
      .toBe('直到X前生效（到下个己方回合开始前）');
  });
});
