/**
 * 2.7.2 choice 生产者候选构造器首批两枚（非内容刀：只接线、内置零转正）。
 *
 * GPT 三检 Q5 的最小验证问题：生产者能否从 ENGINE STATE 派生候选、开出
 * 一张合法的 CHOICE_REQUIRED 账（v2.6.3 通道的唯一生产者只能逐效果分支）。
 * 全部定义经唯一入口 engine.registerPlayerSkills 手工构造——choiceSource
 * 只存在于编译模型层，编译器今天产不出它（"接线≠可配"第四次预防针）。
 * 断言面：TARGET 型（枚举序与 label、开账恰一张要约、冻结/他人代择双拒、
 * 择定后只有被选那一名受伤且 targetPlayerId 键定正确、空候选不发要约、
 * choiceSource+多效果=退回逐效果分支）；HAND_CARD 型（手牌候选、择第 N 张
 * 真摘走第 N 张=非头部切片实证、空手不发要约、GIVE/DECK_PLACE 载荷 cardKeys
 * 逐字）；确定性两跑逐字节；cardKeys 缺省时三路结算与旧行为逐字一致（回归钉）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { createAction } from '../action/ActionTypes';
import type { General } from '../data/generals';
import type { GameCard } from '../data/cards';
import type { DataSkillDefinition } from './dataTypes';
import { enumerateHandCardCandidates, enumerateTargetCandidates } from './choiceCandidates';
import { selectHandCards } from '../core/eventProcessors/handSelection';
import { applyDiscardEvent, applyGiveEvent } from '../core/eventProcessors/generalEvents';
import { applyDeckPlaceEvent } from '../core/eventProcessors/deckEvents';

function makeGeneral(id: string, name: string, hp: number): General {
  return {
    id, name, faction: '魏', hp, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [],
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
    armorCards: [] as GameCard[],
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
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
    ...overrides,
  };
}

function makeState(players: EnginePlayer[]): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
    ],
    discardPile: [], drawState: null,
  };
}

function makeCard(id: string, name: string, type = '粮草'): GameCard {
  return { id, name, type } as GameCard;
}

/** TARGET 型生产者定义：择一场上将领造成 1 点技能伤害（模板效果恰一枚）。 */
function targetProducer(overrides: Partial<DataSkillDefinition> = {}): DataSkillDefinition {
  return {
    id: 'cp_target_1', name: '择击', trigger: 'onTurnStart',
    description: '择一敌将，对其造成1点技能伤害',
    choiceMode: true, choiceSource: 'TARGET',
    effects: [{ type: 'DAMAGE', value: 1, target: 'TARGET', description: '对其造成1点伤害' }],
    ...overrides,
  };
}

/** HAND_CARD 型生产者定义：择一自身手牌弃置。 */
function handProducer(overrides: Partial<DataSkillDefinition> = {}): DataSkillDefinition {
  return {
    id: 'cp_hand_1', name: '择弃', trigger: 'onTurnStart',
    description: '择一自身手牌弃置',
    choiceMode: true, choiceSource: 'HAND_CARD',
    effects: [{ type: 'DISCARD', value: 1, target: 'SELF', description: '弃置所选手牌' }],
    ...overrides,
  };
}

/** 场面：座 1 挂甲/乙两敌将，座 2 挂拥有者+丙（己方，ENEMY_FIELD 应排除）。 */
function targetTable() {
  return makeState([
    makePlayer(1, {
      fieldGenerals: [
        makeFieldGeneral(makeGeneral('cp_t_a', '甲', 6), 1, 0),
        makeFieldGeneral(makeGeneral('cp_t_b', '乙', 6), 1, 1),
      ],
    }),
    makePlayer(2, {
      fieldGenerals: [
        makeFieldGeneral(makeGeneral('cp_owner', '择主', 4), 2, 0),
        makeFieldGeneral(makeGeneral('cp_t_c', '丙', 6), 2, 1),
      ],
    }),
  ]);
}

function fireTurnStart(engine: GameEngine, endingPid: 1 | 2): GameEvent[] {
  return engine.dispatch(createAction('END_TURN', endingPid));
}

function pickOption(engine: GameEngine, key: string, optionIndex: number, chooserPid: number): GameEvent[] {
  return engine.dispatch(createAction('CHOOSE_OPTION', chooserPid, { choiceKey: key, optionIndex }));
}

function fieldOf(state: EngineState, generalId: string) {
  for (const p of state.players) {
    const fg = (p.fieldGenerals ?? []).find(
      f => (f as { general?: { id?: string } }).general?.id === generalId,
    ) as { currentHp: number } | undefined;
    if (fg) return fg;
  }
  return undefined;
}

function onlyRequired(events: GameEvent[]): Record<string, unknown> {
  const required = events.filter(e => e.type === 'CHOICE_REQUIRED');
  expect(required, '应恰开一张 CHOICE_REQUIRED').toHaveLength(1);
  return required[0].data as Record<string, unknown>;
}

function optionsOf(offer: Record<string, unknown>) {
  return (offer.options ?? []) as Array<{ label: string; events: GameEvent[] }>;
}

describe('v2.7.2 TARGET 型生产者：状态派生候选、标准要约、择定逐候选结算', () => {
  it('开账恰一张要约：候选=players序×fieldGenerals序、label=将名、ENEMY_FIELD 排除己座', () => {
    const engine = new GameEngine(targetTable());
    engine.registerPlayerSkills(2, [targetProducer()]);
    const events = fireTurnStart(engine, 1);
    const offer = onlyRequired(events);
    expect(String(offer.choiceKey)).toMatch(/^ch:\d+:\d+:/);
    expect(String(offer.choiceKey).endsWith('cp_target_1')).toBe(true);
    expect(offer.chooserPlayerId).toBe(2);
    const opts = optionsOf(offer);
    expect(opts.map(o => o.label)).toEqual(['甲', '乙']);
    for (const [i, id] of ['cp_t_a', 'cp_t_b'].entries()) {
      const ev = opts[i].events[0];
      expect(ev.type).toBe('DAMAGE');
      expect(ev.data).toMatchObject({ targetId: id, targetPlayerId: 1, damageType: 'skill', value: 1 });
    }
    // 延后结算：开账瞬间无人受伤
    expect(fieldOf(engine.state, 'cp_t_a')!.currentHp).toBe(6);
    expect(fieldOf(engine.state, 'cp_t_b')!.currentHp).toBe(6);
  });

  it('冻结+他人代择双拒，欠债人择定后只有被选那一名受伤、账清', () => {
    const engine = new GameEngine(targetTable());
    engine.registerPlayerSkills(2, [targetProducer()]);
    const events = fireTurnStart(engine, 1);
    const key = String(onlyRequired(events).choiceKey);
    expect(engine.state.pendingChoice?.key).toBe(key);

    const probe = fireTurnStart(engine, 1);
    expect(probe.some(e => e.type === 'ACTION_REJECTED'
      && (e.data as Record<string, unknown>)?.reason === 'CHOICE_PENDING')).toBe(true);
    const hijack = pickOption(engine, key, 0, 1);
    expect(hijack.some(e => e.type === 'ACTION_REJECTED'
      && (e.data as Record<string, unknown>)?.reason === 'NOT_CHOICE_PLAYER')).toBe(true);

    const picked = pickOption(engine, key, 1, 2);
    const resolved = picked.filter(e => e.type === 'CHOICE_RESOLVED');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].data).toMatchObject({ choiceKey: key, chooserPlayerId: 2, optionIndex: 1, label: '乙' });
    expect(engine.state.pendingChoice ?? null).toBeNull();
    expect(fieldOf(engine.state, 'cp_t_b')!.currentHp).toBe(5);
    expect(fieldOf(engine.state, 'cp_t_a')!.currentHp).toBe(6); // 未选项永不发生
    expect(fieldOf(engine.state, 'cp_owner')!.currentHp).toBe(4);
    expect(fieldOf(engine.state, 'cp_t_c')!.currentHp).toBe(6);
  });

  it('空候选不发要约：敌座无将=触发发生但零事件、世界不冻结', () => {
    const state = makeState([
      makePlayer(1, { fieldGenerals: [] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('cp_owner', '择主', 4), 2, 0)] }),
    ]);
    const engine = new GameEngine(state);
    engine.registerPlayerSkills(2, [targetProducer()]);
    const events = fireTurnStart(engine, 1);
    expect(events.some(e => e.type === 'CHOICE_REQUIRED')).toBe(false);
    expect(events.some(e => e.type === 'DAMAGE')).toBe(false);
    expect(engine.state.pendingChoice ?? null).toBeNull();
    expect(engine.state.currentPlayerId).toBe(2); // 回合照常推进，没被锁桌
  });

  it('choiceSource+多效果=退回逐效果预译分支（宁可不择也不静默丢效果）', () => {
    const def = targetProducer({
      effects: [
        { type: 'DAMAGE', value: 1, target: 'TARGET', description: '伤' },
        { type: 'DRAW_CARD', value: 1, target: 'SELF', description: '摸' },
      ],
    });
    const engine = new GameEngine(targetTable());
    engine.registerPlayerSkills(2, [def]);
    const events = fireTurnStart(engine, 1);
    const opts = optionsOf(onlyRequired(events));
    // 逐效果分支（DAMAGE+DRAW 两型）而非逐候选（若走候选则全为 DAMAGE 的 2 项）
    expect(opts.map(o => o.label)).toEqual(['伤', '摸']);
    expect(opts.map(o => o.events[0].type)).toEqual(['DAMAGE', 'DRAW']);
  });

  it('同配置两跑逐字节一致：候选枚举+择定全链零新增随机面', () => {
    const normalize = (e: GameEvent) =>
      JSON.stringify({ type: e.type, data: e.data })
        .replace(/"id":"[0-9a-f-]{36}"/g, '"id":"_u"')
        .replace(/"timestamp":\d+/g, '"timestamp":"_t"')
        .replace(/"rootEventId":"[^"]*"/g, '"rootEventId":"_v"')
        .replace(/"id":"action_[^"]*"/g, '"id":"_a"');
    const run = () => {
      const engine = new GameEngine(targetTable());
      engine.registerPlayerSkills(2, [targetProducer()]);
      const fire = fireTurnStart(engine, 1);
      const key = String(onlyRequired(fire).choiceKey);
      const pick = pickOption(engine, key, 0, 2);
      return { stream: [...fire, ...pick].map(normalize).join('\n'), final: JSON.stringify(engine.state) };
    };
    const first = run();
    const second = run();
    expect(second.stream).toBe(first.stream);
    expect(second.final).toBe(first.final);
  });
});

describe('v2.7.2 HAND_CARD 型生产者：手牌候选、非头部切片实证、cardKeys 逐字', () => {
  /** 场面：拥有者=座 1（在数组次位），轮到期 2 结束 → 座 1 的 TURN_START 触发。 */
  function handTable(hand: GameCard[]) {
    return makeState([
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('cp_plain', '路人', 4), 2, 0)] }),
      makePlayer(1, { hand: [...hand] }),
    ]);
  }

  it('候选=手牌数组序、label=卡名、每选项携该张 cardKeys 逐字', () => {
    const cards = [makeCard('cp_h_1', '乐'), makeCard('cp_h_2', '选'), makeCard('cp_h_3', '留')];
    const engine = new GameEngine(handTable(cards));
    engine.registerPlayerSkills(1, [handProducer()]);
    const offer = onlyRequired(fireTurnStart(engine, 2));
    expect(offer.chooserPlayerId).toBe(1);
    const opts = optionsOf(offer);
    expect(opts.map(o => o.label)).toEqual(['乐', '选', '留']);
    for (const [i, card] of cards.entries()) {
      const ev = opts[i].events[0];
      expect(ev.type).toBe('DISCARD');
      expect(ev.data).toMatchObject({ playerId: 1, count: 1, cardKeys: [card.id] });
    }
    // 延后结算：开账瞬间手牌分毫未动
    expect((engine.state.players[1].hand as GameCard[]).map(c => c.name)).toEqual(['乐', '选', '留']);
  });

  it('择第 N 张真摘走第 N 张（非头部切片），其余手牌相对序不动', () => {
    const cards = [makeCard('cp_h_1', '乐'), makeCard('cp_h_2', '选'), makeCard('cp_h_3', '留')];
    const engine = new GameEngine(handTable(cards));
    engine.registerPlayerSkills(1, [handProducer()]);
    const key = String(onlyRequired(fireTurnStart(engine, 2)).choiceKey);
    const picked = pickOption(engine, key, 1, 1);
    expect(picked.filter(e => e.type === 'CHOICE_RESOLVED')).toHaveLength(1);
    const hand = (engine.state.players.find(p => p.id === 1)!.hand as GameCard[]).map(c => c.name);
    expect(hand).toEqual(['乐', '留']); // 头名存活=切片政策被显式选择推翻
    expect(engine.state.discardPile.some(c => (c as GameCard).name === '选')).toBe(true);
    expect(engine.state.pendingChoice ?? null).toBeNull();
  });

  it('空手不发要约：触发发生但零 CHOICE_REQUIRED、不锁桌', () => {
    const engine = new GameEngine(handTable([]));
    engine.registerPlayerSkills(1, [handProducer()]);
    const events = fireTurnStart(engine, 2);
    expect(events.some(e => e.type === 'CHOICE_REQUIRED')).toBe(false);
    expect(engine.state.pendingChoice ?? null).toBeNull();
    expect(engine.state.currentPlayerId).toBe(1);
  });

  it('GIVE/DECK_PLACE 模板载荷逐字携 cardKeys（结算面三路共用同一 helper 的入口证明）', () => {
    const cards = [makeCard('cp_h_a', '赠一'), makeCard('cp_h_b', '赠二')];
    const give = new GameEngine(handTable(cards));
    give.registerPlayerSkills(1, [handProducer({
      id: 'cp_give_1', name: '择赠',
      effects: [{ type: 'GIVE', value: 1, target: 'ATTACKER', description: '把所选牌交给一名角色' }],
    })]);
    const giveOpts = optionsOf(onlyRequired(fireTurnStart(give, 2)));
    expect(giveOpts.map(o => o.label)).toEqual(['赠一', '赠二']);
    expect(giveOpts[1].events[0].data).toMatchObject({ fromPlayerId: 1, cardKeys: ['cp_h_b'], count: 1 });
    expect(giveOpts[1].events[0].type).toBe('GIVE');

    const place = new GameEngine(handTable(cards));
    place.registerPlayerSkills(1, [handProducer({
      id: 'cp_place_1', name: '择置',
      effects: [{ type: 'DECK_PLACE', value: 1, target: 'SELF', description: '把所选牌置于牌堆底' }],
    })]);
    const placeOpts = optionsOf(onlyRequired(fireTurnStart(place, 2)));
    expect(placeOpts[0].events[0].data).toMatchObject({ playerId: 1, dest: 'BOTTOM', cardKeys: ['cp_h_a'] });
    expect(placeOpts[0].events[0].type).toBe('DECK_PLACE');
  });
});

describe('v2.7.2 纯函数钉：候选枚举器与手牌选择单点', () => {
  it('enumerateTargetCandidates 三档作用域：ENEMY_FIELD 排他座 / SELF_FIELD 只本座 / ALL_FIELD 全座；阵亡玩家整域出局；顺序=players序×field序', () => {
    const state = makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('x_a', '甲', 4), 1, 0)] }),
      makePlayer(2, {
        isAlive: false,
        fieldGenerals: [makeFieldGeneral(makeGeneral('x_dead', '亡军', 4), 2, 0)],
      }),
      makePlayer(3, { fieldGenerals: [
        makeFieldGeneral(makeGeneral('x_b', '乙', 4), 3, 0),
        makeFieldGeneral(makeGeneral('x_c', '丙', 4), 3, 1),
      ] }),
    ]);
    expect(enumerateTargetCandidates(state, 3).map(c => c.label)).toEqual(['甲']);
    expect(enumerateTargetCandidates(state, 3, 'SELF_FIELD').map(c => c.label)).toEqual(['乙', '丙']);
    expect(enumerateTargetCandidates(state, 3, 'ALL_FIELD').map(c => c.label)).toEqual(['甲', '乙', '丙']);
    expect(enumerateTargetCandidates(state, 3).map(c => c.targetId)).toEqual(['x_a']);
  });

  it('enumerateHandCardCandidates：手牌数组序、cardKeys=[该张 runtime id]；无主/无牌出局', () => {
    const cards = [makeCard('y_1', '一'), makeCard('y_2', '二')];
    const state = makeState([makePlayer(1, { hand: [...cards] }), makePlayer(2)]);
    expect(enumerateHandCardCandidates(state, 1)).toEqual([
      { label: '一', cardKeys: ['y_1'] },
      { label: '二', cardKeys: ['y_2'] },
    ]);
    expect(enumerateHandCardCandidates(state, 9)).toEqual([]);
    expect(enumerateHandCardCandidates(state, 2)).toEqual([]);
  });

  it('selectHandCards 回归钉：无 cardKeys=头部切片/count 0 全手哨兵逐字不变；cardKeys 命中保相对序、未知 id 忽略、count 不参与；空 cardKeys 数组=等同缺省', () => {
    const hand = [makeCard('s_1', '一'), makeCard('s_2', '二'), makeCard('s_3', '三')];
    expect(selectHandCards(hand, 2)).toEqual({ moved: [hand[0], hand[1]], rest: [hand[2]] });
    expect(selectHandCards(hand, 0)).toEqual({ moved: [...hand], rest: [] });
    expect(selectHandCards(hand, 99)).toEqual({ moved: [...hand], rest: [] });
    expect(selectHandCards(hand, 1, ['s_3', 'nope'])).toEqual({ moved: [hand[2]], rest: [hand[0], hand[1]] });
    expect(selectHandCards(hand, 1, [])).toEqual({ moved: [hand[0]], rest: [hand[1], hand[2]] });
  });

  it('三路结算器：cardKeys 缺省载荷与 v2.7.2 前逐字一致（头部切片），显式选择摘非头部', () => {
    const hand = [makeCard('d_1', '一'), makeCard('d_2', '二'), makeCard('d_3', '三')];
    const fresh = () => makeState([
      makePlayer(1, { hand: [...hand] }),
      makePlayer(2, { hand: [] }),
    ]);
    const ev = (type: string, data: Record<string, unknown>): GameEvent =>
      ({ id: `cp_ev_${type}_${JSON.stringify(data).length}`, type, data, timestamp: 0 } as GameEvent);

    // DISCARD：缺省=摘头两张；显式=只摘中间那张
    const d1 = applyDiscardEvent(fresh(), ev('DISCARD', { playerId: 1, count: 2 }));
    expect((d1.players[0].hand as GameCard[]).map(c => c.name)).toEqual(['三']);
    const d2 = applyDiscardEvent(fresh(), ev('DISCARD', { playerId: 1, count: 2, cardKeys: ['d_2'] }));
    expect((d2.players[0].hand as GameCard[]).map(c => c.name)).toEqual(['一', '三']);

    // GIVE：缺省=头名过手；显式=非头部过手且守方相对序不动
    const g1 = applyGiveEvent(fresh(), ev('GIVE', { fromPlayerId: 1, toPlayerId: 2, count: 1 }));
    expect((g1.players[1].hand as GameCard[]).map(c => c.name)).toEqual(['一']);
    const g2 = applyGiveEvent(fresh(), ev('GIVE', { fromPlayerId: 1, toPlayerId: 2, count: 1, cardKeys: ['d_3'] }));
    expect((g2.players[1].hand as GameCard[]).map(c => c.name)).toEqual(['三']);
    expect((g2.players[0].hand as GameCard[]).map(c => c.name)).toEqual(['一', '二']);

    // DECK_PLACE：缺省=头名沉底；显式=指名沉底（deck 尾部逐字）
    const p1 = applyDeckPlaceEvent(fresh(), ev('DECK_PLACE', { playerId: 1, dest: 'BOTTOM', count: 1 }));
    expect((p1.players[0].hand as GameCard[]).map(c => c.name)).toEqual(['二', '三']);
    expect((p1.deck as GameCard[]).slice(-2).map(c => c.name)).toEqual(['材料', '一']);
    const p2 = applyDeckPlaceEvent(fresh(), ev('DECK_PLACE', { playerId: 1, dest: 'BOTTOM', count: 1, cardKeys: ['d_2'] }));
    expect((p2.players[0].hand as GameCard[]).map(c => c.name)).toEqual(['一', '三']);
    expect((p2.deck as GameCard[]).slice(-2).map(c => c.name)).toEqual(['材料', '二']);
  });
});
