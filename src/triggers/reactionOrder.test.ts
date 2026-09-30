/**
 * 2.8.22 #71 第一层：响应顺序比较器。
 *
 * 一条比较器、人和 AI 共用（用户 2026-09-30 裁决："基础游戏规则不应该区分开人和
 * AI"）。这里既测纯函数，也测它接进 `TriggerEngine.process` 之后**确实生效**——
 * 纯函数测的是算术，接线的证人测的是"结算走的就是这一条"。
 */

import { describe, expect, it } from 'vitest';

import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { TriggerEngine } from './TriggerEngine';
import type { TriggerDefinition } from './types';
import { orderReactionCandidates, victimRefOf, type ReactionCandidate, type ReactionOrderingContext } from './reactionOrder';

interface Named extends ReactionCandidate {
  name: string;
}

const ctx = (over: Partial<ReactionOrderingContext> = {}): ReactionOrderingContext => ({
  seatOrder: [1, 2, 3, 4],
  victimGenerals: [],
  victimSeats: [],
  ...over
});
const namesOf = (list: Named[]): string[] => list.map(c => c.name);
const ordered = (candidates: Named[], over: Partial<ReactionOrderingContext> = {}): string[] =>
  namesOf(orderReactionCandidates(candidates, ctx(over)));

describe('orderReactionCandidates — 用户给的工作例逐字钉住', () => {
  // 「玩家1 攻击 玩家2 的 A 与 玩家3 的 C」，A/B 同坐席 2、C 坐席 3、D 坐席 4。
  const workExample: Named[] = [
    { name: 'A', ownerId: 2, generalId: 'gA', priority: 50 },
    { name: 'C', ownerId: 3, generalId: 'gC', priority: 50 },
    { name: 'D', ownerId: 4, generalId: 'gD', priority: 50 },
    { name: 'B', ownerId: 2, generalId: 'gB', priority: 50 }
  ];

  it('⇒ A→C→D→B：受击组整组先、组内座次升序、非受击组从受击组末席绕圈', () => {
    expect(ordered(workExample, { victimGenerals: ['gA', 'gC'], victimSeats: [2, 3] })).toEqual(['A', 'C', 'D', 'B']);
  });

  it('受击者是将领那一层，不是席位那一层：同席没挨打的那一员必须排到绕圈之后', () => {
    // 只点名 A：B 与 A 同坐席 2，但 B 没有挨这一下 ⇒ B 属非受击组，绕圈从席 2 的后一席数起。
    expect(ordered(workExample, { victimGenerals: ['gA'], victimSeats: [2] })).toEqual(['A', 'C', 'D', 'B']);
  });

  it('点名不到场上任何一员（打本营这类）⇒ 退到席位那一层：那位玩家的全部监听算受击组', () => {
    // targetId='base_2' 不会等于任何将领 id，所以按 targetPlayerId=2 分整席。
    expect(ordered(workExample, { victimGenerals: ['base_2'], victimSeats: [2] })).toEqual(['A', 'B', 'C', 'D']);
  });

  it('同席位内的多名响应者＝注册顺序，绝不顺手重排（B11 那 19 次同席撞车逐字的前提）', () => {
    const candidates: Named[] = [
      { name: 'first', ownerId: 2, generalId: 'g1', priority: 50 },
      { name: 'second', ownerId: 2, generalId: 'g2', priority: 50 },
      { name: 'third', ownerId: 2, generalId: 'g3', priority: 50 }
    ];
    expect(ordered(candidates)).toEqual(['first', 'second', 'third']);
    expect(ordered(candidates, { victimGenerals: ['g2'], victimSeats: [2] })).toEqual(['second', 'first', 'third']);
  });

  it('没有受击者（回合开始这类）＝输出逐字等于输入＝交刀前的注册顺序', () => {
    const candidates: Named[] = [3, 1, 4, 2].map(id => ({ name: `seat${id}`, ownerId: id, priority: 50 }));
    expect(ordered(candidates)).toEqual(['seat3', 'seat1', 'seat4', 'seat2']);
  });

  it('档位压过分组：高优先级的非受击者仍排在受击组的低优先级之前', () => {
    const candidates: Named[] = [
      { name: 'victimLowTier', ownerId: 2, generalId: 'gV', priority: 50 },
      { name: 'neutralHighTier', ownerId: 4, generalId: 'gN', priority: 60 }
    ];
    expect(ordered(candidates, { victimGenerals: ['gV'], victimSeats: [2] })).toEqual([
      'neutralHighTier',
      'victimLowTier'
    ]);
  });

  it('绕圈起点＝受击组末席的后一席：受击者坐末席时，非受击组从 1 号位重新数起', () => {
    const candidates: Named[] = [
      { name: 'seat2', ownerId: 2, generalId: 'g2', priority: 50 },
      { name: 'seat1', ownerId: 1, generalId: 'g1', priority: 50 },
      { name: 'victim', ownerId: 4, generalId: 'gV', priority: 50 },
      { name: 'seat3', ownerId: 3, generalId: 'g3', priority: 50 }
    ];
    expect(ordered(candidates, { victimGenerals: ['gV'], victimSeats: [4] })).toEqual([
      'victim',
      'seat1',
      'seat2',
      'seat3'
    ]);
  });

  it('认不出席位（或座位表为空）时只退化掉座次轴，档位分层照旧生效', () => {
    const candidates: Named[] = [
      { name: 'low', ownerId: 9, priority: 50 },
      { name: 'high', ownerId: 8, priority: 60 }
    ];
    expect(ordered(candidates, { seatOrder: [], victimSeats: [9] })).toEqual(['high', 'low']);
  });

  it('认不出席位的非受击者排在有席位者之后，不抢整组的头', () => {
    const candidates: Named[] = [
      { name: 'unknownSeat', ownerId: 99, generalId: 'gX', priority: 50 },
      { name: 'seat1', ownerId: 1, generalId: 'g1', priority: 50 },
      { name: 'victim', ownerId: 3, generalId: 'gV', priority: 50 }
    ];
    expect(ordered(candidates, { seatOrder: [1, 2, 3], victimGenerals: ['gV'] })).toEqual([
      'victim',
      'seat1',
      'unknownSeat'
    ]);
  });
});

describe('victimRefOf — 分组轴只认"这件事作用在谁身上"', () => {
  const ref = (data: Record<string, unknown>) => victimRefOf({ type: 'DAMAGE', data } as GameEvent);

  it('攻击打到将领：将领键与席位键各归各', () => {
    expect(ref({ targetPlayerId: 3, targetId: 'wei_001__inst_a', damageType: 'attack' })).toEqual({
      victimGenerals: ['wei_001__inst_a'],
      victimSeats: [3]
    });
  });

  it('技能伤害同样带 targetPlayerId（决斗那一路将来共用）', () => {
    expect(ref({ targetPlayerId: 2, damageType: 'skill' })).toEqual({ victimGenerals: [], victimSeats: [2] });
  });

  it('target 与 targetId 是同一件事的两个写法，取到就停', () => {
    expect(ref({ target: 'shu_002__inst_b', targetId: 'shu_002__inst_b', targetPlayerId: 1 }).victimGenerals).toEqual([
      'shu_002__inst_b'
    ]);
  });

  it('只有行序（回合开始的 playerId）不算受击⇒两个轴都空', () => {
    expect(ref({ playerId: 2 })).toEqual({ victimGenerals: [], victimSeats: [] });
  });
});

describe('比较器接进 TriggerEngine.process 之后真的按它动', () => {
  const table = { players: [{ id: 1 }, { id: 2 }, { id: 3 }] } as unknown as EngineState;

  const listener = (
    id: string,
    ownerId: number,
    generalId: string,
    eventType: TriggerDefinition['eventType']
  ): TriggerDefinition => ({
    id,
    ownerId,
    generalId,
    eventType,
    priority: 50,
    enabled: true,
    createEvents: () => [{ type: 'CUSTOM', data: { kind: 'fired-by', ownerId, generalId } }]
  });

  const ownersOf = (events: GameEvent[]): Array<number | undefined> =>
    events.map(ev => (ev.data as { ownerId?: number }).ownerId);
  const generalsOf = (events: GameEvent[]): Array<string | undefined> =>
    events.map(ev => (ev.data as { generalId?: string }).generalId);

  it('注册顺序把受击方排在后面⇒结算仍先走受击方（同档内不再"先注册先动"）', () => {
    const engine = new TriggerEngine();
    // 故意让"非受击的席 3"先注册：交刀前它会先动。
    engine.register(listener('neutral-seat3', 3, 'gN', 'DAMAGE'));
    engine.register(listener('victim-seat2', 2, 'gV', 'DAMAGE'));

    const result = engine.process(table, {
      type: 'DAMAGE',
      data: { targetPlayerId: 2, targetId: 'gV', damageType: 'attack' }
    } as GameEvent);

    expect(generalsOf(result.events)).toEqual(['gV', 'gN']);
    expect(ownersOf(result.events)).toEqual([2, 3]);
  });

  it('同席没挨打的那一员排到绕圈之后（受击者是将领那一层）', () => {
    const engine = new TriggerEngine();
    engine.register(listener('self-seat1', 1, 'gSelf', 'DAMAGE'));
    engine.register(listener('seatmate-seat2', 2, 'gMate', 'DAMAGE'));
    engine.register(listener('struck-seat2', 2, 'gStruck', 'DAMAGE'));

    const result = engine.process(table, {
      type: 'DAMAGE',
      data: { targetPlayerId: 2, targetId: 'gStruck', damageType: 'attack' }
    } as GameEvent);

    // gStruck（席 2，挨打）→ 绕圈从席 2 后一席＝席 3（无人）→席 1（gSelf）→席 2（gMate）。
    expect(generalsOf(result.events)).toEqual(['gStruck', 'gSelf', 'gMate']);
  });

  it('打本营点名不到将领会退到席位：受击玩家的全部监听先动', () => {
    const engine = new TriggerEngine();
    engine.register(listener('other-seat1', 1, 'gOther', 'DAMAGE'));
    engine.register(listener('hit-seat2', 2, 'gHit', 'DAMAGE'));
    engine.register(listener('mate-seat2', 2, 'gMate', 'DAMAGE'));

    // targetId 是主寨（base_2），场上没有任何一员的 id 等于它⇒按席位分受击组。
    const result = engine.process(table, {
      type: 'DAMAGE',
      data: { targetPlayerId: 2, targetId: 'base_2', damageType: 'attack' }
    } as GameEvent);

    expect(ownersOf(result.events)).toEqual([2, 2, 1]);
    expect(generalsOf(result.events)).toEqual(['gHit', 'gMate', 'gOther']);
  });

  it('没有受击者的事件＝仍按注册顺序（默认档不产生任何重排）', () => {
    const engine = new TriggerEngine();
    engine.register(listener('a', 3, 'gA', 'CUSTOM'));
    engine.register(listener('b', 1, 'gB', 'CUSTOM'));

    const result = engine.process(table, { type: 'CUSTOM', data: { playerId: 2 } } as GameEvent);
    expect(ownersOf(result.events)).toEqual([3, 1]);
  });
});
