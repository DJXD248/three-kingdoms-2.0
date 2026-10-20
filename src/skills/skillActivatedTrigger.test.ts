/**
 * 「其他将领技能发动时」这一格的结算面（v2.9.15 乙档刀）。
 *
 * 它听的**不是新事件**＝`SKILL_ACTIVATED`（三条发动路共用的那一句"刚刚有人发动了
 * 技能"，唯一生产点 `skills/skillQuota.ts`）。这一格以前接不上电的根因就在这里：
 * 那一声以前只在定义带「一局一次」额度时才发，普通技能发动一声不吭⇒下拉里有这一格、
 * 事件面上却没有东西可听。本刀起每次**真发动**都出声（空发不出＝裁决④），而带台账键
 * 的那一身一字未变⇒状态位移仍然为零（两个锚因此结构上不动）。
 *
 * 三条判据各有一格用例钉着，且每格都配"对照组"（同一副场面里那件**确实发生了**的事），
 * 否则"没响"是空转出来的假证人——这条口径见 §12-130（营地刀同一手法）：
 * ①**套娃只传一层**：`viaActivation` 那一身它不听（少了这一句，两员互相喂牌喂到牌堆抽干）；
 * ②**"什么算别人"不另写一份**：档位钉死 `others`，与 v2.9.13 那五档共用同一个席位＋将领
 *   联合谓词⇒**同席位另一员将也算"别人"**、**同一员将自己发动不算**；
 * ③**说不清是谁的发动不算**：同席位那一身只有座次、说不出哪一员⇒fail-closed。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type { General, Skill, SkillTriggerConfig } from '../data/generals';
import { triggerTypeLabels, supportsListenerScope } from '../data/generals';
import { compileSkill, syncPlayerSkills } from './skillCompiler';
import { readTriggerCell, triggerToStr } from './skillExcelFormat';
import { triggerPhrase } from './skillSentence';
import { parseSkillText } from './skillTextParse';
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
    // `areaOwnerId` 一律写 1＝这批夹具能近战互砍的站位前提（与 listenerScope／营地
    // 那两副夹具同一摆法）。改成"各回各家"这一刀就直接判非法、证人空转（实测）。
    position: { zone: 'front' as const, slot, areaOwnerId: 1 },
  };
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 4, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  };
}

function makeState(players: EnginePlayer[], currentPlayerId?: number): EngineState {
  return {
    version: 1, phase: 'playing', currentPlayerId: currentPlayerId ?? players[0]?.id ?? null,
    timelinePhase: 'ACTION', players, turn: 1, round: 1,
    deck: Array.from({ length: 12 }, (_, i) => ({ id: `deck_${i}`, name: '粮草', type: '粮草' })),
    discardPile: [], drawState: null,
  };
}

function buildEngine(state: EngineState): GameEngine {
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, state);
  return engine;
}

/** 本刀那一格：别的将领发动技能⇒自己摸一张。`forced` 留真＝钉自动路。 */
function listen(name: string): Skill {
  return {
    name,
    forced: true,
    effects: [{
      id: 'e1',
      trigger: { type: 'onOtherSkillActivated' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
  };
}

/** 一受击就自动摸一张（＝"别人发动一次"的那个发动源，走触发链自动路）。 */
function autoDrawOnHurt(name: string): Skill {
  return {
    name,
    forced: true,
    effects: [{
      id: 'e1',
      trigger: { type: 'onDamageTaken' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    }],
  };
}

/** 同一件事、但不打「强制发动」＝走响应链问答那一身（本刀要钉的第二条发动路）。 */
function askDrawOnHurt(name: string): Skill {
  return { ...autoDrawOnHurt(name), forced: false };
}

function handOf(engine: GameEngine, playerId: number): number {
  return engine.state.players.find(p => p.id === playerId)!.hand!.length;
}
function hpOf(engine: GameEngine, playerId: number, generalId: string): number | undefined {
  const fg = (engine.state.players.find(p => p.id === playerId)!.fieldGenerals as any[])
    .find(f => f?.general?.id === generalId);
  return fg?.currentHp;
}
function activations(events: GameEvent[]): GameEvent[] {
  return events.filter(e => e.type === 'SKILL_ACTIVATED');
}

/** 玩家 `current` 用 `attackerId` 打 `targetId`；返回这一趟的全部事件。 */
function attack(engine: GameEngine, current: number, attackerId: string, targetId: string): GameEvent[] {
  return engine.dispatch(createAction('ATTACK', current, {
    attackerId, targetId, ranged: false, consumeCard: ATTACK_COST,
  }));
}

describe('其他将领技能发动时 · 真链路（自动路：别人发动⇒我响）', () => {
  it('别席那一员将自动发动了技能⇒挂这一格的在场将摸一张（对照组：挨打的那一刀真的打中了）', () => {
    const engine = buildEngine(makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1, 0), makeFieldGeneral(makeGeneral('g1b', [listen('风声')]), 1, 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [autoDrawOnHurt('自护')]), 2)] }),
    ]));
    const events = attack(engine, 1, 'g1', 'g2');
    // 先证明"发动"这件事实实在在发生过（否则后面那句"摸了一张"没有对照）
    expect(hpOf(engine, 2, 'g2')).toBe(2);
    expect(activations(events).map(e => (e.data as { skillName?: string }).skillName)).toEqual(['自护', '风声']);
    expect(handOf(engine, 2)).toBe(1);   // 自护那一摸
    expect(handOf(engine, 1)).toBe(1);   // 本刀那一摸
  });

  it('对照：同一副场面但挨打的那一员没有技能⇒没有任何发动⇒监听一声不响', () => {
    const engine = buildEngine(makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1, 0), makeFieldGeneral(makeGeneral('g1b', [listen('风声')]), 1, 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', []), 2)] }),
    ]));
    const events = attack(engine, 1, 'g1', 'g2');
    expect(hpOf(engine, 2, 'g2')).toBe(2);        // 刀真的落了
    expect(activations(events)).toHaveLength(0);  // 却没有任何一次发动
    expect(handOf(engine, 1)).toBe(0);            // ⇒监听不响（这一句不是空转）
  });

  it('同一员将**自己**发动技能不算"其他将领"⇒不响（先证明那一次发动确实发生了）', () => {
    const engine = buildEngine(makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [autoDrawOnHurt('自护'), listen('风声')]), 2)] }),
    ]));
    const events = attack(engine, 1, 'g1', 'g2');
    expect(activations(events).map(e => (e.data as { skillName?: string }).skillName)).toEqual(['自护']);
    expect(handOf(engine, 2)).toBe(1);            // 只有自护那一摸，风声没响
  });

  it('同一席位、**另一员将**发动的＝也算"其他将领"（用户口径逐字＝其他角色＝自身以外，按将不按席）', () => {
    const engine = buildEngine(makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1)],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, {
        fieldGenerals: [
          makeFieldGeneral(makeGeneral('g2', [autoDrawOnHurt('自护')]), 2, 0),
          makeFieldGeneral(makeGeneral('g2b', [listen('风声')]), 2, 1),
        ],
      }),
    ]));
    const events = attack(engine, 1, 'g1', 'g2');
    expect(activations(events).map(e => (e.data as { skillName?: string }).skillName)).toEqual(['自护', '风声']);
    expect(handOf(engine, 2)).toBe(2);
  });

  it('套娃只传一层：两员监听各响一次就停，绝不互相喂到牌堆抽干', () => {
    const engine = buildEngine(makeState([
      makePlayer(1, {
        fieldGenerals: [
          makeFieldGeneral(makeGeneral('g1', []), 1, 0),
          makeFieldGeneral(makeGeneral('g1c', [listen('丙')]), 1, 1),
        ],
        hand: [ATTACK_COST],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [autoDrawOnHurt('甲')]), 2)] }),
      makePlayer(3, { fieldGenerals: [makeFieldGeneral(makeGeneral('g3', [listen('乙')]), 3)] }),
    ]));
    const events = attack(engine, 1, 'g1', 'g2');
    // 第一层：甲（挨打那位发动）。第二层：丙、乙各替这一声响一次，
    // 而它们自己那一身带着 viaActivation⇒没有第三层。
    expect(activations(events).map(e => (e.data as { skillName?: string }).skillName).sort())
      .toEqual(['丙', '乙', '甲']);
    expect(activations(events).filter(e => (e.data as { viaActivation?: boolean }).viaActivation === true))
      .toHaveLength(2);
    expect(handOf(engine, 1)).toBe(1);
    expect(handOf(engine, 2)).toBe(1);
    expect(handOf(engine, 3)).toBe(1);
  });
});

describe('其他将领技能发动时 · 真链路（另外两条发动路也算"有人发动了"）', () => {
  it('问答路：别人**点头**发动了⇒我这一格响（拒答那一身不算发动，因此不响）', () => {
    function scene() {
      return buildEngine(makeState([
        makePlayer(1, {
          fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1, 0), makeFieldGeneral(makeGeneral('g1b', [listen('风声')]), 1, 1)],
          hand: [ATTACK_COST],
        }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [askDrawOnHurt('奸雄')]), 2)] }),
      ]));
    }
    const yes = scene();
    attack(yes, 1, 'g1', 'g2');
    const ask = getReactionAsk(yes.state)!;
    expect(ask.playerId).toBe(2);
    const events = yes.dispatch(createAction('ACTIVATE_SKILL', 2, {
      skillId: ask.options[0].skillId, generalId: ask.generalId,
    }));
    expect(activations(events).map(e => (e.data as { skillName?: string }).skillName)).toEqual(['奸雄', '风声']);
    expect(handOf(yes, 1)).toBe(1);

    // 摇头＝没有发动⇒监听当然不响（对照，钉"问答路只有点头那一身才算发动"）
    const no = scene();
    attack(no, 1, 'g1', 'g2');
    const ask2 = getReactionAsk(no.state)!;
    const skipped = no.dispatch(createAction('SKIP_REACTION', 2, { nodeKey: ask2.nodeKey }));
    expect(activations(skipped)).toHaveLength(0);
    expect(handOf(no, 1)).toBe(0);
  });

  it('回合结束路：别人回合结束发动了⇒我这一格响（这一路那一身带台账键，监听听的同一声）', () => {
    const turnEnd: Skill = {
      name: '守夜',
      effects: [{
        id: 'e1', trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    };
    const engine = buildEngine(makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g_te', [turnEnd]), 1)] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2b', [listen('风声')]), 2)] }),
    ]));
    const events = engine.dispatch(createAction('ACTIVATE_SKILL', 1, {
      skillId: 'g_te:守夜:e1', generalId: 'g_te',
    }));
    expect(activations(events).map(e => (e.data as { skillName?: string }).skillName)).toEqual(['守夜', '风声']);
    expect(handOf(engine, 1)).toBe(1);
    expect(handOf(engine, 2)).toBe(1);
    // 回合结束那一路的账照旧落（本刀没有把它改成纯通知）
    expect(engine.state.consumedSkills ?? []).toHaveLength(1);
  });
});

// ── 单点判据（matchesSkillEvent）──

function listenDefinition(trigger: SkillTriggerConfig): DataSkillDefinition {
  const skill: Skill = {
    name: '风声', forced: true,
    effects: [{ id: 'e1', trigger, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } }],
  };
  const { definitions, skipped } = compileSkill({ id: 'g1', name: '测试将g1' }, skill, 'g1');
  expect(skipped).toHaveLength(0);
  expect(definitions).toHaveLength(1);
  return definitions[0];
}

/** 发动公告那一身（`skillQuota.mintActivation` 的纯通知形状，逐键照抄）。 */
function activation(overrides: Record<string, unknown> = {}) {
  return {
    type: 'SKILL_ACTIVATED' as const,
    data: {
      skillId: 'g9:技:e1', skillName: '技', effectId: 'e1',
      generalId: 'g9', playerId: 2, ...overrides,
    },
  };
}

describe('其他将领技能发动时 · 单点判据（matchesSkillEvent）', () => {
  const binding = { ownerId: 1, skill: listenDefinition({ type: 'onOtherSkillActivated' }) };

  it('别的席位＝响；同席位同一员＝不响；同席位另一员＝响；说不清是哪一员＝不响', () => {
    // 默认那一声＝别的席位（playerId 2）那一员将 g9 发动的
    expect(matchesSkillEvent('onOtherSkillActivated', binding, activation() as never)).toBe(true);
    // 同席位、另一员将＝照样算"其他将领"（用户 2026-10-18 口径逐字＝其他角色＝自身以外）
    expect(matchesSkillEvent('onOtherSkillActivated', binding, activation({ playerId: 1, generalId: 'g9' }) as never)).toBe(true);
    // 同一席位、同一员将自己发动⇒不算别人
    expect(matchesSkillEvent('onOtherSkillActivated', binding, activation({ playerId: 1, generalId: 'g1' }) as never)).toBe(false);
    // 席位已经分出"不是我"⇒那一身说不出哪一员也算别人
    expect(matchesSkillEvent('onOtherSkillActivated', binding, activation({ generalId: '' }) as never)).toBe(true);
    // 同席位且那一身说不出是哪一员＝fail-closed，绝不把"不知道"读成"是别人"
    expect(matchesSkillEvent('onOtherSkillActivated', binding, activation({ playerId: 1, generalId: '' }) as never)).toBe(false);
    // 同一句话的另一半：定义自己说不出是哪一员（无 sourceGeneralId）⇒同席位判不成"别的将"⇒不响
    const faceless = { ownerId: 1, skill: { ...listenDefinition({ type: 'onOtherSkillActivated' }), sourceGeneralId: undefined } };
    expect(matchesSkillEvent('onOtherSkillActivated', faceless, activation({ playerId: 1, generalId: 'g9' }) as never)).toBe(false);
    // 座次都没有＝这件事根本没落到某一位玩家身上⇒不响
    expect(matchesSkillEvent('onOtherSkillActivated', binding, activation({ playerId: undefined }) as never)).toBe(false);
  });

  it('带 viaActivation 的那一身它不听（套娃只传一层就住在这两句里）', () => {
    expect(matchesSkillEvent('onOtherSkillActivated', binding, activation({ viaActivation: true }) as never)).toBe(false);
    // 对照：同一身只差那一个键
    expect(matchesSkillEvent('onOtherSkillActivated', binding, activation({ viaActivation: undefined }) as never)).toBe(true);
  });

  it('这一格把档位**钉死**成 others：定义里硬塞「我听谁」也不改判据（编译器另有点名拒绝兜住录入）', () => {
    const pushed = { ownerId: 1, skill: listenDefinition({ type: 'onOtherSkillActivated' }) };
    pushed.skill.listenerScope = 'self';
    expect(matchesSkillEvent('onOtherSkillActivated', pushed, activation({ playerId: 1, generalId: 'g9' }) as never)).toBe(true);
    expect(matchesSkillEvent('onOtherSkillActivated', pushed, activation({ playerId: 1, generalId: 'g1' }) as never)).toBe(false);
  });

  it('它只听发动公告那一声：门住在触发面表里，不在判据里（所以这里不重复设第二道门）', () => {
    // `matchesSkillEvent` 的入参已经由 `TRIGGER_EVENTS` 筛过事件类型（见上面那一格），
    // 判据本身只看键。这一条钉的是"分工"：把类型门挪进判据＝两处各一份、迟早分叉。
    expect(eventsHeardBy('onOtherSkillActivated')).toEqual(['SKILL_ACTIVATED']);
    expect(eventsHeardBy('onDamageTaken')).not.toContain('SKILL_ACTIVATED');
  });
});

// ── 编译与词源 ──

describe('其他将领技能发动时 · 编译与词源', () => {
  it('下拉里那一格今天编成定义、不再被点名"结算还没接线"', () => {
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '测试将g1' }, listen('风声'), 'g1');
    expect(skipped).toHaveLength(0);
    expect(definitions[0].trigger).toBe('onOtherSkillActivated');
    expect(definitions[0].listenerScope).toBeUndefined();
  });

  it('从 Excel／旧存档硬塞进来的「我听谁」＝点名拒绝，绝不悄悄当"只听自己"（记录而未消费＝假账）', () => {
    const skill: Skill = {
      name: '风声',
      effects: [{
        id: 'e1',
        trigger: { type: 'onOtherSkillActivated', listenerScope: 'field' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    };
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '测试将g1' }, skill, 'g1');
    expect(definitions).toHaveLength(0);
    expect(skipped[0]?.reason).toBe('TRIGGER_SUBTYPE_UNSUPPORTED');
  });

  it('这一型听的是**已经存在的那一声**＝SKILL_ACTIVATED，没有新事件类型、没有新发射点', () => {
    expect(eventsHeardBy('onOtherSkillActivated')).toEqual(['SKILL_ACTIVATED']);
    expect(TRIGGER_EVENTS.onOtherSkillActivated).toBe(eventsHeardBy('onOtherSkillActivated'));
    expect(Object.values(TRIGGER_EVENTS).flat()).not.toContain('SKILL_USED');
  });

  it('它**不认**「我听谁」那一栏（界面上整格不出现＝与营地那一格同一条诚实口径）', () => {
    expect(supportsListenerScope('onOtherSkillActivated')).toBe(false);
    expect(supportsListenerScope('onBaseDamaged')).toBe(false);
  });

  it('卡面那句话由同一份时机词表生成，本刀不新增第二套说法', () => {
    expect(triggerTypeLabels.onOtherSkillActivated).toBe('其他将领技能发动时');
    expect(triggerPhrase({ type: 'onOtherSkillActivated' })).toBe('其他将领技能发动时');
  });
});

describe('其他将领技能发动时 · 录入面与词源（Excel 那一格与大白话那一路都吃公共表）', () => {
  it('Excel 那一格：写出→读回逐字同一结构', () => {
    expect(readTriggerCell('其他将领技能发动时').trigger).toEqual({ type: 'onOtherSkillActivated' });
    expect(triggerToStr({ type: 'onOtherSkillActivated' })).toBe('其他将领技能发动时');
  });

  it('大白话那一路自动认得，且"今天还不会响"那句提示随接线自行消失', () => {
    const draft = parseSkillText('其他将领技能发动时，摸一张牌。');
    expect(draft.issues).toHaveLength(0);
    expect(draft.effects[0]?.trigger?.type).toBe('onOtherSkillActivated');
    expect(draft.notices.join('')).not.toMatch(/不会响/);
  });
});

// ── 发动公告本身的两条底线（这一格能成立的前提）──

describe('发动公告 · 每次真发动都出声，但纯通知不动状态', () => {
  it('两声发动都落了效果，台账却一个字没写＝公告本身不动状态', () => {
    const engine = buildEngine(makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('g1', []), 1, 0), makeFieldGeneral(makeGeneral('g1b', [listen('风声')]), 1, 1)], hand: [ATTACK_COST] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('g2', [autoDrawOnHurt('自护')]), 2)] }),
    ]));
    const events = attack(engine, 1, 'g1', 'g2');
    expect(activations(events)).toHaveLength(2);   // 两声公告确实响了
    expect(handOf(engine, 1)).toBe(1);             // 效果也确实结了
    expect(handOf(engine, 2)).toBe(1);
    // 而这一路的定义都不带「一局一次」额度⇒台账空＝纯通知没有状态位移
    expect(engine.state.consumedSkills ?? []).toHaveLength(0);
  });
});
