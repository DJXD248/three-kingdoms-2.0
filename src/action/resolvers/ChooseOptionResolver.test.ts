/**
 * 2.6.3 — choice 玩家决策通道（能力层非内容刀）：CHOICE_REQUIRED 开账 →
 * 冻结世界（validator 只认欠债玩家的 CHOOSE_OPTION）→ CHOICE_RESOLVED 先行
 * 清账 + 选中分支的预译事件按正常结算链落账。五连门拒收原因诚实；
 * 候选永不陈旧；延后效果的 RNG 消费发生在择定那一步（record-not-reroll）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../core/GameEngine';
import { EventProcessor } from '../../core/EventProcessor';
import { createInitialEngineState } from '../../core/GameState';
import type { EngineState, PendingChoice } from '../../core/GameState';
import { createAction } from '../ActionTypes';
import { syncPlayerSkills } from '../../skills/skillCompiler';
import type { General, Skill } from '../../data/generals';

/** 合成模板将（非内置转正）：择一术=同触发两效果 + effectMode choice。 */
const CHOICE_SKILL: Skill = {
  name: '演練・择一',
  description: '回合结束时：摸两张牌 或 造成1点伤害，二选一',
  effectMode: 'choice',
  effects: [
    { id: 'e1', description: '摸两张牌', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' } },
    { id: 'e2', description: '造成1点伤害', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' }, runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' } },
  ],
};

function choiceGeneral(id = 'g_choice'): General {
  return {
    id, instanceId: id, name: '择一将', faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [CHOICE_SKILL],
  } as unknown as General;
}

function fieldOf(general: General, ownerId: number) {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [], isArming: false,
    hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone: 'camp', slot: 0, areaOwnerId: ownerId },
  };
}

function makeState(generalOwner = 1, overrides: Partial<EngineState> = {}): EngineState {
  const state = createInitialEngineState();
  state.players = [
    { id: 1, name: 'P1', hand: [], fieldGenerals: generalOwner === 1 ? [fieldOf(choiceGeneral(), 1)] : [] } as any,
    { id: 2, name: 'P2', hand: [], fieldGenerals: generalOwner === 2 ? [fieldOf(choiceGeneral(), 2)] : [] } as any,
  ];
  state.currentPlayerId = 1;
  state.phase = 'playing';
  state.timelinePhase = 'ACTION';
  state.turn = 5;
  state.round = 2;
  state.deck = [
    { id: 'd1', name: '粮草', type: '粮草' },
    { id: 'd2', name: '材料', type: '材料' },
    { id: 'd3', name: '军备', type: '军备' },
    { id: 'd4', name: '粮草', type: '粮草' },
  ];
  return { ...state, ...overrides };
}

function freshEngine(state: EngineState): GameEngine {
  const engine = new GameEngine(state, { recordHistory: false });
  syncPlayerSkills(engine, state);
  return engine;
}

const CHOICE_ID = 'g_choice:演練・择一:choice';

function seedDebt(state: EngineState, pending: PendingChoice): EngineState {
  return { ...state, pendingChoice: pending };
}

const OFFER: PendingChoice = {
  key: 'ch:5:2:probe',
  playerId: 1,
  options: [
    { label: '摸两张牌', events: [{ type: 'DRAW', data: { playerId: 1, count: 2, skillId: CHOICE_ID } }] },
    { label: '弃一张牌', events: [{ type: 'DISCARD', data: { playerId: 1, count: 1, skillId: CHOICE_ID } }] },
  ],
};

describe('CHOICE_REQUIRED 开账 + 冻结世界 + CHOOSE_OPTION 结算 (2.6.3)', () => {
  it('真链开账：ACTIVATE_SKILL choiceMode 定义 → SKILL_ACTIVATED + CHOICE_REQUIRED，pendingChoice 成账', () => {
    const engine = freshEngine(makeState());
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: CHOICE_ID, generalId: 'g_choice' }));
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
    expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
    const required = events.find(e => e.type === 'CHOICE_REQUIRED');
    expect(required?.data).toMatchObject({
      chooserPlayerId: 1,
      skillId: CHOICE_ID,
      choiceKey: `ch:5:2:${CHOICE_ID}`,
    });
    const options = (required?.data as any).options as Array<{ label: string }>;
    expect(options.map(o => o.label)).toEqual(['摸两张牌', '造成1点伤害']);
    // 要约落账：A 类事实住在状态里
    expect(engine.state.pendingChoice).toMatchObject({
      key: `ch:5:2:${CHOICE_ID}`, playerId: 1,
    });
    // 延后结算：本步没有抽牌（零效果事件在本 dispatch 落账）
    expect(events.some(e => e.type === 'DRAW' && e !== required)).toBe(false);
    expect(engine.state.players[0].hand).toHaveLength(0);
    // 台账已记耗（择一术一次一账）
    expect(engine.state.consumedSkills).toHaveLength(1);
  });

  it('冻结世界：欠账期非择定动作一律 CHOICE_PENDING，择定后世界恢复运转', () => {
    const engine = freshEngine(seedDebt(makeState(), OFFER));
    const endTurn = engine.dispatch(createAction('END_TURN', 1));
    expect((endTurn.find(e => e.type === 'ACTION_REJECTED')?.data as any)?.reason).toContain('CHOICE_PENDING');
    const attack = engine.dispatch(createAction('ATTACK', 1, { attackerId: 'x', targetId: 'base_2', ranged: false }));
    expect((attack.find(e => e.type === 'ACTION_REJECTED')?.data as any)?.reason).toContain('CHOICE_PENDING');

    const resolved = engine.dispatch(createAction('CHOOSE_OPTION', 1, { choiceKey: OFFER.key, optionIndex: 0 }));
    expect(resolved.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
    expect(engine.state.pendingChoice).toBeNull();
    // 清账后 END_TURN 恢复可 dispatch（不再 CHOICE_PENDING）
    engine.state.currentPlayerId = 1;
    const after = engine.dispatch(createAction('END_TURN', 1));
    expect((after.find(e => e.type === 'ACTION_REJECTED')?.data as any)?.reason ?? '').not.toContain('CHOICE_PENDING');
  });

  it('他人代择被拒（含当前回合玩家≠欠债玩家时，欠债玩家的择定仍放行）', () => {
    // P2 owns the debt while P1 plays the turn — the frozen gate keys off
    // pendingChoice.playerId, NOT currentPlayerId.
    const state = makeState(2, { currentPlayerId: 1 });
    const engine = freshEngine(seedDebt(state, { ...OFFER, playerId: 2 }));
    const stolen = engine.dispatch(createAction('CHOOSE_OPTION', 1, { choiceKey: OFFER.key, optionIndex: 0 }));
    expect((stolen.find(e => e.type === 'ACTION_REJECTED')?.data as any)?.reason).toContain('NOT_CHOICE_PLAYER');
    // P1（当前回合玩家）的其他动作也被冻结闸吞掉
    const act = engine.dispatch(createAction('END_TURN', 1));
    expect((act.find(e => e.type === 'ACTION_REJECTED')?.data as any)?.reason).toContain('CHOICE_PENDING');
    // 欠债玩家 P2 的择定合法
    const ok = engine.dispatch(createAction('CHOOSE_OPTION', 2, { choiceKey: OFFER.key, optionIndex: 1 }));
    expect(ok.some(e => e.type === 'CHOICE_RESOLVED')).toBe(true);
    expect(engine.state.pendingChoice).toBeNull();
  });

  it('五连门拒收原因诚实（validator+resolver 双道）', () => {
    const reject = (state: EngineState, payload: unknown, playerId = 1): string => {
      const engine = freshEngine(state);
      const events = engine.dispatch(createAction('CHOOSE_OPTION', playerId, payload));
      return String((events.find(e => e.type === 'ACTION_REJECTED')?.data as any)?.reason ?? '');
    };
    const debt = seedDebt(makeState(), OFFER);
    expect(reject(debt, {})).toContain('INVALID_CHOOSE_OPTION_PAYLOAD');
    expect(reject(debt, { choiceKey: OFFER.key, optionIndex: -1 })).toContain('INVALID_CHOOSE_OPTION_PAYLOAD');
    expect(reject(debt, { choiceKey: 42, optionIndex: '0' })).toContain('INVALID_CHOOSE_OPTION_PAYLOAD');
    // 形状合法但无账可还
    expect(reject(makeState(), { choiceKey: OFFER.key, optionIndex: 0 })).toContain('NO_PENDING_CHOICE');
    // 旧要约冒领
    expect(reject(debt, { choiceKey: 'ch:1:1:stale', optionIndex: 0 })).toContain('CHOICE_KEY_MISMATCH');
    // 越界序号
    expect(reject(debt, { choiceKey: OFFER.key, optionIndex: 2 })).toContain('CHOICE_OPTION_OUT_OF_RANGE');
    // player 99 不存在：validator 冻结闸先给 NOT_CHOICE_PLAYER（非择定人），
    // 若择定人真实存在但不是他 → 同因；PLAYER_NOT_FOUND 留给 resolver 第二道
    expect(reject(debt, { choiceKey: OFFER.key, optionIndex: 0 }, 99)).toContain('NOT_CHOICE_PLAYER');
  });

  it('撞账不覆写 / 键不合的清账不吞现役账（settler 本体，EventProcessor 单入口）', () => {
    const processor = new EventProcessor();
    const opened = processor.process(makeState(), [
      { type: 'CHOICE_REQUIRED', data: { choiceKey: 'ch:5:2:first', chooserPlayerId: 1, options: [{ label: 'y', events: [] }] } },
    ]);
    expect(opened.pendingChoice).toMatchObject({ key: 'ch:5:2:first', playerId: 1 });
    const collided = processor.process(opened, [
      { type: 'CHOICE_REQUIRED', data: { choiceKey: 'ch:5:2:second', chooserPlayerId: 2, options: [{ label: 'x', events: [] }] } },
    ]);
    expect(collided.pendingChoice).toMatchObject({ key: 'ch:5:2:first' });
    const staleClear = processor.process(opened, [
      { type: 'CHOICE_RESOLVED', data: { choiceKey: 'ch:4:1:gone', chooserPlayerId: 1, optionIndex: 0, label: 'y' } },
    ]);
    expect(staleClear.pendingChoice).toMatchObject({ key: 'ch:5:2:first' });
    const cleared = processor.process(opened, [
      { type: 'CHOICE_RESOLVED', data: { choiceKey: 'ch:5:2:first', chooserPlayerId: 1, optionIndex: 0, label: 'y' } },
    ]);
    expect(cleared.pendingChoice).toBeNull();
  });

  it('legalActions：欠债玩家只见选项（枚举序=记录序），他人只见空集；枚举⇒可dispatch', () => {
    const engine = freshEngine(seedDebt(makeState(2), { ...OFFER, playerId: 2 }));
    const debtor = engine.legalActions(2);
    expect(debtor).toHaveLength(2);
    expect(debtor.map(a => (a.payload as any).optionIndex)).toEqual([0, 1]);
    expect(debtor.every(a => a.type === 'CHOOSE_OPTION')).toBe(true);
    expect(engine.legalActions(1)).toHaveLength(0);
    // 枚举出即可真派发
    const probe = freshEngine(seedDebt(makeState(2), { ...OFFER, playerId: 2 }));
    const events = probe.dispatch(debtor[1]);
    expect(events.some(e => e.type === 'ACTION_REJECTED')).toBe(false);
  });

  it('RNG 纪律：要约开账零随机（rngState 游标不动），抽牌消费发生在择定步', () => {
    const engine = freshEngine(makeState());
    const before = structuredClone(engine.state.rngState);
    engine.dispatch(createAction('ACTIVATE_SKILL', 1, { skillId: CHOICE_ID, generalId: 'g_choice' }));
    expect(engine.state.rngState).toEqual(before);
    const key = engine.state.pendingChoice!.key;
    const idx = engine.state.pendingChoice!.options.findIndex(o => o.label === '摸两张牌');
    engine.dispatch(createAction('CHOOSE_OPTION', 1, { choiceKey: key, optionIndex: idx }));
    // 择定步抽 2 进手：手牌+牌堆总量守恒于开账前的 4 张
    expect((engine.state.players[0].hand ?? []).length + (engine.state.deck as unknown[]).length).toBe(4);
    expect(engine.state.players[0].hand).toHaveLength(2);
  });
});
