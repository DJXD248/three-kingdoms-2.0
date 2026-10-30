/**
 * J4 席位与清单判据的证人（v2.9.11）。
 *
 * 三条要紧的事各有钉子：
 *  1. **编号必须重算得出同一个**——房主收到客人交回的编号时是**当场重算**再对的，
 *     同一个局面算两次得到两个编号＝客人每次点都被判"这一步已经不成立"。
 *  2. **动作本体绝不上线**——编号只由"位置＋类型＋载荷摘要"构成，不含 `action.id`
 *     （那是进程计数器，重算必变）。
 *  3. **封顶不能封掉收尾出口**——一桌人多时合法集上百条，若把「⏭️结束回合」挤掉，
 *     整桌会停在这一席。
 */
import { describe, expect, it } from 'vitest';
import { createAction, type GameAction } from '../action/ActionTypes';
import type { EnginePlayer, EngineState } from '../core/GameState';
import { MAX_MOVE_KEY_LENGTH, MAX_MOVE_LABEL_LENGTH, MAX_NAME_LENGTH, MAX_MOVE_ITEMS, MAX_REFUSAL_LENGTH } from './netProtocol';
import {
  MOVE_REFUSAL,
  buildSeatMap,
  buildSeatMoves,
  capSeatMoves,
  canonicalPayload,
  describeMove,
  findSeatMove,
  isMySeat,
  moveKey,
  refusalReason,
  seatOfPeer,
} from './netSeat';

function player(id: number, extra: Partial<EnginePlayer> = {}): EnginePlayer {
  const base = {
    id,
    name: `玩家${id}`,
    faction: '蜀',
    hand: [],
    generalPool: [],
    fieldGenerals: [],
    graveyard: [],
    statuses: [],
    baseHp: 4,
    isAlive: true,
  };
  return { ...base, ...extra } as unknown as EnginePlayer;
}

function state(players: EnginePlayer[], extra: Partial<EngineState> = {}): EngineState {
  return { players, turn: 3, round: 2, currentPlayerId: players[0]?.id ?? 0, ...extra } as unknown as EngineState;
}

const general = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, instanceId: id, name, type: '武将', hp: 4, ...extra });

describe('席位表：谁坐哪一席', () => {
  it('房主占第一个非 AI 席，客人按进房顺序占后面的；AI 席压根不上表', () => {
    const rows = buildSeatMap({
      seats: [
        { seat: 0, isAi: false, label: '曹操' },
        { seat: 1, isAi: true, label: 'AI 关羽' },
        { seat: 2, isAi: false, label: '孙权' },
        { seat: 3, isAi: false, label: '吕布' },
      ],
      host: { id: 'H', name: '房主' },
      guests: [{ id: 'G1', name: '小张' }],
    });
    expect(rows).toEqual([
      { peer: 'H', seat: 0, name: '房主' },
      { peer: 'G1', seat: 2, name: '小张' },
      { peer: null, seat: 3, name: '吕布' },
    ]);
  });

  it('席位号乱序进来的也按从小到大排——两边读到的是同一张表', () => {
    const rows = buildSeatMap({
      seats: [{ seat: 4, isAi: false, label: '丁' }, { seat: 1, isAi: false, label: '甲' }, { seat: 2, isAi: true, label: '机器' }],
      host: { id: 'H', name: '房主' },
      guests: [],
    });
    expect(rows.map(r => r.seat)).toEqual([1, 4]);
  });

  it('全 AI 一桌 ⇒ 空表（协议层拒收空席位表，房主那边就不发）', () => {
    expect(buildSeatMap({ seats: [{ seat: 0, isAi: true, label: 'A' }, { seat: 1, isAi: true, label: 'B' }], host: { id: 'H', name: '房主' }, guests: [] })).toEqual([]);
  });

  it('客人比椅子多：多出来的人谁也不绑，界面上"这席还是本机在点"照常显示', () => {
    const rows = buildSeatMap({
      seats: [{ seat: 0, isAi: false, label: '甲' }],
      host: { id: 'H', name: '房主' },
      guests: [{ id: 'G1', name: '小张' }],
    });
    expect(rows).toEqual([{ peer: 'H', seat: 0, name: '房主' }]);
    expect(seatOfPeer(rows, 'G1')).toBeNull();
    expect(isMySeat(rows, 'G1', 0)).toBe(false);
    expect(isMySeat(rows, 'H', 0)).toBe(true);
  });

  it('名字超 12 字或带控制字符 ⇒ 收口成协议收得下的形状，绝不发出去才发现被拒', () => {
    const rows = buildSeatMap({
      seats: [
        { seat: 0, isAi: false, label: '曹操' },
        { seat: 1, isAi: false, label: '吕布' },
        { seat: 2, isAi: false, label: `${'一'.repeat(30)}\u0001` },
      ],
      host: { id: 'H', name: '房主' },
      guests: [{ id: 'G1', name: `${'名'.repeat(20)}` }],
    });
    expect(rows.map(r => r.peer)).toEqual(['H', 'G1', null]);
    expect([...rows[1].name].length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    // 没绑到人的那一格：席位自己的名字也要收得下、控制字符抹干净
    expect(rows[2].name).not.toContain('\u0001');
    expect([...rows[2].name].length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(seatOfPeer(null, 'H')).toBeNull();
  });
});

describe('编号：同一个局面重算两次，得到的必须是同一批编号', () => {
  const act = (): GameAction[] => [
    createAction('END_TURN', 0),
    createAction('ATTACK', 0, { attackerId: 'g1', targetId: 'base_1', ranged: false }),
    createAction('MOVE_GENERAL', 0, { generalId: 'g1', target: { zone: 'front', slot: 1, areaOwnerId: 0 } }),
  ];

  it('不含 action.id：进程计数器每造一枚就加一，掺进去等于每次刷新都换一批按钮', () => {
    const first = act().map((a, i) => moveKey(i, a));
    const second = act().map((a, i) => moveKey(i, a));
    expect(first[0]).not.toBe('');
    expect(second).toEqual(first);
    expect(first[1]).not.toBe(first[2]);
  });

  it('载荷改一个字节、或位置挪一格 ⇒ 编号就变（旧点击自然失效＝这一步已经不成立）', () => {
    const a = createAction('ATTACK', 0, { attackerId: 'g1', targetId: 'base_1', ranged: false });
    const b = createAction('ATTACK', 0, { attackerId: 'g1', targetId: 'base_2', ranged: false });
    expect(moveKey(0, a)).not.toBe(moveKey(0, b));
    expect(moveKey(0, a)).not.toBe(moveKey(1, a));
    expect(moveKey(0, a).length).toBeLessThanOrEqual(MAX_MOVE_KEY_LENGTH);
  });

  it('对象键的书写顺序不参与摘要：同一份载荷从不同调用点拼出来也是同一个编号', () => {
    expect(canonicalPayload({ a: 1, b: [2, { c: 3, d: undefined }] })).toBe(canonicalPayload({ b: [2, { d: undefined, c: 3 }], a: 1 }));
    expect(canonicalPayload(null)).toBe('null');
    expect(canonicalPayload(undefined)).toBe('null');
  });

  it('清单＝编号＋那句话＋类型；按编号能找到，找不到的返回 null', () => {
    const st = state([
      player(0, { name: '曹操', fieldGenerals: [{ general: general('g1', '夏侯惇'), ownerId: 0, currentHp: 3, maxHp: 4 }] }),
      player(1, { name: '孙权' }),
    ]);
    const moves = buildSeatMoves(st, act());
    expect(moves).toHaveLength(3);
    expect(moves[0].kind).toBe('END_TURN');
    expect(findSeatMove(moves, moves[1].key)?.label).toContain('孙权的营地');
    expect(findSeatMove(moves, 'nope')).toBeNull();
  });
});

describe('那句话：措辞逐字对齐牌桌已有的按钮', () => {
  const st = state([
    player(0, {
      name: '曹操',
      hand: [general('gx', '关羽'), general('gy', '张飞')],
      generalPool: [general('gp', '黄忠')],
      fieldGenerals: [{ general: general('g1', '夏侯惇'), ownerId: 0 }],
    }),
    player(1, { name: '孙权', fieldGenerals: [{ general: general('g9', '周瑜'), ownerId: 1 }] }),
  ]);
  const say = (type: GameAction['type'], payload?: unknown) => describeMove(st, createAction(type, 0, payload as never));

  it('收尾／投降／抽牌那几条用的是牌桌上那几行字', () => {
    expect(say('END_TURN')).toBe('⏭️结束回合');
    expect(say('SURRENDER')).toBe('🏳️确认投降');
    expect(say('CONFIRM_DRAW')).toBe('✓ 确认（抽完了）');
    expect(say('RESOLVE_BASE_LOSS')).toBe('🏯结算失去体力');
    expect(say('SKIP_REACTION')).toContain('🚫 跳过');
  });

  it('抽牌那条说清从哪两个来源各几张（一个都不抽时也得读得通）', () => {
    expect(say('DRAW', { fromGeneralPool: 1, fromCardPool: 2 })).toBe('🃏抽取 3 张（将领池 1 ＋抽牌堆 2）');
    expect(say('DRAW', { fromGeneralPool: 0, fromCardPool: 2 })).toBe('🃏抽取 2 张（抽牌堆 2）');
    expect(say('DRAW', { fromGeneralPool: 0, fromCardPool: 0 })).toContain('抽取 0 张');
  });

  it('前进／攻击／补给／叠甲都点名到具体的人与位置（场上那一格本来就公开）', () => {
    expect(say('MOVE_GENERAL', { generalId: 'g1', target: { zone: 'camp', slot: 0, areaOwnerId: 0 } })).toBe('🚶前进：夏侯惇 → 曹操的营地区域第1格');
    expect(say('MOVE_GENERAL', { generalId: 'g1', target: { zone: 'battle', slot: 2, areaOwnerId: null }, consumeCard: { id: 'c' } })).toBe('🚶前进：夏侯惇 → 战场第3格（消耗1张）');
    expect(say('ATTACK', { attackerId: 'g1', targetId: 'g9', ranged: true, consumeCard: { id: 'c' } })).toBe('🏹远程攻击：夏侯惇 → 周瑜（消耗1张）');
    expect(say('ATTACK', { attackerId: 'g1', targetId: 'base_1' })).toBe('⚔️近战攻击：夏侯惇 → 孙权的营地');
    expect(say('SUPPLY', { generalId: 'g1', consumeCards: [{ id: 'a' }, { id: 'b' }] })).toBe('💊补给：夏侯惇（用2张）');
    expect(say('EQUIP_ARMOR', { generalId: 'g1', armorCards: [{ id: 'a' }] })).toBe('🛡️叠甲：夏侯惇（军备1张）');
  });

  it('切片④：住在手牌／征召池／牌堆里的牌，那句话只给位置、不给牌名', () => {
    // 登场打的就是自己手里的将——名字在落场之前不许上线（传话线是全屋抄送的）。
    expect(say('DEPLOY_GENERAL', { general: general('gx', '关羽'), slot: 2, consumeCards: [{ id: 'a' }] })).toBe('⚔️登场将领：手牌第1张 → 营地区域第3格（消耗1张）');
    expect(say('DEPLOY_GENERAL', { general: general('gy', '张飞'), slot: 0, consumeCards: [{ id: 'a' }] })).toBe('⚔️登场将领：手牌第2张 → 营地区域第1格（消耗1张）');
    // 引用一个住在别人手里的牌号：既不给牌名，也要说清是哪一席的手牌。
    expect(say('ATTACK', { attackerId: 'gone', targetId: 'g1' })).toBe('⚔️近战攻击：不在场上的将 → 夏侯惇');
    const otherSeat = state([
      player(0, { name: '曹操', fieldGenerals: [{ general: general('g1', '夏侯惇'), ownerId: 0 }] }),
      player(1, { name: '孙权', hand: [general('hidden', '周泰')] }),
    ]);
    expect(describeMove(otherSeat, createAction('ATTACK', 0, { attackerId: 'g1', targetId: 'hidden' } as never)))
      .toBe('⚔️近战攻击：夏侯惇 → 孙权的手牌第1张');
    // 征召池同理：那一格也只放开给本席。
    expect(describeMove(st, createAction('ATTACK', 0, { attackerId: 'g1', targetId: 'gp' } as never)))
      .toBe('⚔️近战攻击：夏侯惇 → 征召池第1员');
    // 牌堆最严：次序连本席都不发，所以不报第几张。
    const deckOnly = state([player(0, { name: '曹操' })], { deck: [general('d1', '马超'), general('d2', '关羽')] } as never);
    expect(describeMove(deckOnly, createAction('DEPLOY_GENERAL', 0, { general: general('d2', '关羽'), slot: 0, consumeCards: [] } as never)))
      .toBe('⚔️登场将领：牌堆里的一张 → 营地区域第1格（消耗0张）');
    // 哪儿都查不到（载荷带来的名字压根不在牌桌上）⇒ 同样不许把那个名字念出去。
    expect(say('DEPLOY_GENERAL', { general: general('nowhere', '吕布'), slot: 1, consumeCards: [] })).toBe('⚔️登场将领：手里的一张将 → 营地区域第2格（消耗0张）');
  });

  it('抉择那一格照着状态里记录的选项念（房主侧才有这份原文）', () => {
    const withChoice = state([player(0, { name: '曹操' })], { pendingChoice: { key: 'k1', playerId: 0, options: [{ label: '弃一张牌', enabled: true }, { label: '什么都不做', enabled: false }] } } as never);
    expect(describeMove(withChoice, createAction('CHOOSE_OPTION', 0, { choiceKey: 'k1', optionIndex: 1 }))).toBe('🔀选项2：什么都不做（曹操）');
    expect(describeMove(withChoice, createAction('CHOOSE_OPTION', 0, { choiceKey: 'k1', optionIndex: 7 }))).toContain('这一项没有文字');
  });

  it('抉择那一格：选项动的是私格里的牌 ⇒ 念位置，绝不把选项原文那个牌名念出去', () => {
    // 真实形态：征召/弃牌那类问句把牌名写进 label，把运行时牌号冻在 events[].data.cardKeys 里。
    // 判据取牌号落在哪一格，不取 label 的字符串——名字互相同字太常见（手牌「乐」与场上「乐进」）。
    const ask = state([
      player(0, { name: '曹操', hand: [general('h1', '闪电'), general('h2', '乐')] }),
      player(1, { name: '孙权', fieldGenerals: [{ general: general('g9', '乐进'), ownerId: 1 }] }),
    ], {
      pendingChoice: {
        key: 'k1',
        playerId: 0,
        options: [
          { label: '闪电', enabled: true, events: [{ type: 'DISCARD', data: { cardKeys: ['h1'] } }] },
          { label: '乐', enabled: true, events: [{ type: 'DISCARD', data: { cardKeys: ['h2'] } }] },
          { label: '乐进', enabled: true, events: [{ type: 'DISCARD', data: { cardKeys: ['g9'] } }] },
          { label: '什么都不做', enabled: true, events: [] },
        ],
      },
    } as never);
    const choose = (optionIndex: number) => describeMove(ask, createAction('CHOOSE_OPTION', 0, { choiceKey: 'k1', optionIndex } as never));
    expect(choose(0)).toBe('🔀选项1：手牌第1张（曹操）');
    expect(choose(1)).toBe('🔀选项2：手牌第2张（曹操）');
    // 场上那一格本来就公开：号查到了名字就不许再被换成位置（过度遮蔽＝这一席读不懂在问什么）。
    expect(choose(2)).toBe('🔀选项3：乐进（曹操）');
    expect(choose(3)).toBe('🔀选项4：什么都不做（曹操）');
  });

  it('技能那一格：读不到候选时只说"发动技能"，绝不拿机器编号糊到界面上', () => {
    expect(say('ACTIVATE_SKILL', { skillId: 'wei_001:怒斩:0', generalId: 'g1' })).toBe('⚡发动技能');
  });

  it('每一条都不超过线上的 60 字上界，也不是空的（超限在词边界收口）', () => {
    const long = state([player(0, { name: `${'一'.repeat(40)}` })]);
    const moves = [
      createAction('MOVE_GENERAL', 0, { generalId: 'x', target: { zone: 'camp', slot: 0, areaOwnerId: 0 } }),
      createAction('DEPLOY_GENERAL', 0, { general: general('gx', `${'将'.repeat(40)}`), slot: 0, consumeCards: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}` })) }),
      createAction('CHOOSE_OPTION', 0, { choiceKey: 'k', optionIndex: 30 }),
    ].map(a => describeMove(long, a));
    for (const label of moves) {
      expect(label.length).toBeGreaterThan(0);
      expect([...label].length).toBeLessThanOrEqual(MAX_MOVE_LABEL_LENGTH);
    }
  });
});

describe('封顶：宁可挤掉一条攻击，也不挤掉收尾出口', () => {
  const many = (n: number, exitEvery = -1) => Array.from({ length: n }, (_, i) => ({
    key: `${i}-ATTACK-hash`,
    label: `第${i}步`,
    kind: (i === exitEvery ? 'END_TURN' : 'ATTACK') as never,
  }));

  it('没超 ⇒ 原样全发、omitted 为 0', () => {
    const capped = capSeatMoves(many(MAX_MOVE_ITEMS));
    expect(capped.sent).toHaveLength(MAX_MOVE_ITEMS);
    expect(capped.omitted).toBe(0);
  });

  it('超了 ⇒ 发满 32 条，且第 200 条那个「⏭️结束回合」一定在清单里', () => {
    const capped = capSeatMoves(many(200, 199));
    expect(capped.sent).toHaveLength(MAX_MOVE_ITEMS);
    expect(capped.omitted).toBe(200 - MAX_MOVE_ITEMS);
    expect(capped.sent[capped.sent.length - 1].key).toBe('199-ATTACK-hash');
    expect(capped.sent.every(i => i.key.length <= MAX_MOVE_KEY_LENGTH && i.label.length > 0)).toBe(true);
  });

  it('一桌人太多、连收尾出口都在封顶之外 ⇒ 挤掉最后一条把它换进来', () => {
    const capped = capSeatMoves(many(40, 39));
    expect(capped.sent).toHaveLength(MAX_MOVE_ITEMS);
    expect(capped.sent.map(i => i.key)).toContain('39-ATTACK-hash');
    expect(capped.omitted).toBe(40 - MAX_MOVE_ITEMS);
  });

  it('没有收尾出口的清单（响应问句那种）照样只挤条数，不硬塞东西', () => {
    const capped = capSeatMoves(many(50), 10);
    expect(capped.sent).toHaveLength(10);
    expect(capped.omitted).toBe(40);
  });

  it('空清单发出去是一条真话，不是漏发', () => {
    expect(capSeatMoves([])).toEqual({ sent: [], omitted: 0 });
  });
});

describe('退回时怎么说', () => {
  it('认得的门码翻成人读；认不出的把原码带上，绝不编一句好听的', () => {
    expect(refusalReason('NOT_CURRENT_PLAYER')).toBe('现在轮不到这一席行动');
    expect(refusalReason('GENERAL_IS_ARMING')).toBe('这员将在整备中，本回合不能动');
    expect(refusalReason('SOMETHING_NEW')).toContain('SOMETHING_NEW');
    expect(refusalReason('')).toBe(MOVE_REFUSAL.notExecuted);
    expect(refusalReason(undefined)).toBe(MOVE_REFUSAL.notExecuted);
  });

  it('再长的码也收在 120 字以内（协议那格只给这么多）', () => {
    const text = refusalReason(`X_${'Y'.repeat(300)}`);
    expect([...text].length).toBeLessThanOrEqual(MAX_REFUSAL_LENGTH);
  });

  it('房主自己的四句话都非空、且不超过 120 字', () => {
    for (const text of Object.values(MOVE_REFUSAL)) {
      expect(text.length).toBeGreaterThan(0);
      expect([...text].length).toBeLessThanOrEqual(MAX_REFUSAL_LENGTH);
    }
  });
});
