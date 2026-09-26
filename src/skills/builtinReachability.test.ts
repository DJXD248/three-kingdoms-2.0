/**
 * 2.5.4 收敛核验 · 逐技能强制触发可达性专项。
 *
 * 对全库 40 条内置 runtime 定义逐条构造"必然触发"的最小场景，断言每条
 * 定义都产出过带自身 skillId 的效果事件——随机档 ai-battle 里零触发的
 * 攻击链技能（v2.4.3 洞察①）在这里没有躲藏空间。onTurnEnd 走"候选在列
 * + ACTIVATE_SKILL 真响"两段（决策通道形态），onDeploy 走部署步重放
 * （v2.5.1 接线）。场景全部用真实内置模板克隆（换 id 防碰撞），判定键 =
 * 克隆体重编译的定义 id（与事件流 skillId 同一来源，绝不字符串拼接）。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type { GameAction } from '../action/ActionTypes';
import { createAction } from '../action/ActionTypes';
import { allGenerals, type General } from '../data/generals';
import type { GameCard } from '../data/cards';
import { syncPlayerSkills, compileGeneralSkills } from './skillCompiler';
import type { DataSkillDefinition } from './dataTypes';
import { listTurnEndSkillCandidates } from './turnEndSkills';

interface DefEntry {
  def: DataSkillDefinition;
  owner: General;
}

function cloneGeneral(newId: string, src: General): General {
  const copy = JSON.parse(JSON.stringify(src)) as General;
  copy.id = newId;
  return copy;
}

function makeGeneral(id: string, hp: number, skills: General['skills']): General {
  return {
    id, name: '陪练' + id, faction: '魏', hp, type: '武将',
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
      { id: 'deck_3', name: '军备', type: '军备' },
      { id: 'deck_4', name: '粮草', type: '粮草' },
    ],
    discardPile: [], drawState: null,
  };
}

const COSTS = [1, 2, 3].map(i => ({ id: `rcost_${i}`, name: '粮草', type: '粮草' }));
const EFFECT_EVENT_TYPES = new Set(['DRAW', 'DAMAGE', 'HEAL', 'GAIN_ARMOR', 'DISCARD', 'GIVE', 'EQUIP_STRIP']);
const ARMOR_CARD = (index: number): GameCard =>
  ({ id: `rc_armor_${index}`, name: '军备', type: '军备', description: '测试预挂军备' });

/** 全库编译账本快照：36 定义逐条带 owner，顺序由 generals.ts 决定。 */
function allCompiledEntries(): DefEntry[] {
  const entries: DefEntry[] = [];
  for (const general of allGenerals) {
    const { definitions } = compileGeneralSkills(general);
    for (const def of definitions) entries.push({ def, owner: general });
  }
  return entries;
}

function buildEngine(state: EngineState): GameEngine {
  const engine = new GameEngine(state);
  syncPlayerSkills(engine, engine.state);
  return engine;
}

/**
 * 场景判定键：克隆体（id=cloneId）重编译同一 name|effect 后缀的定义取回
 * 其真实 id——事件流/候选注册与断言同源，杜绝拼接漂移。
 */
function scenarioDefId(entry: DefEntry, cloneId: string): string {
  const suffix = entry.def.id.slice(entry.def.id.indexOf(':') + 1);
  const recompiled = compileGeneralSkills(cloneGeneral(cloneId, entry.owner)).definitions
    .find(d => d.id.slice(d.id.indexOf(':') + 1) === suffix);
  expect(recompiled, `${entry.def.id} 克隆体重编译后应仍存在`).toBeDefined();
  return recompiled!.id;
}

function hasEffectFor(events: GameEvent[], scenarioId: string): boolean {
  return events.some(e =>
    EFFECT_EVENT_TYPES.has(e.type)
    && String((e.data as Record<string, unknown>)?.skillId ?? '') === scenarioId);
}

/** 与 forceTrigger 场景同形的攻击 action 的 attacker/target 选择。 */
function attackPair(def: DataSkillDefinition, cloneId: string, index: number) {
  if (def.trigger === 'onCardLost') {
    // v2.6.2 场景：枭姬=强袭克隆剥离我装备（我是 TARGET）；连营=我击杀断肠将
    // 后被弃光手牌（我是 ATTACKER）。
    if (def.cardFilter === 'equipment') return { attackerId: `rc_qx_${index}`, targetId: cloneId };
    return { attackerId: cloneId, targetId: `rc_cw_${index}` };
  }
  if (def.damageTypeFilter === 'skill') {
    return { attackerId: cloneId, targetId: `rc_feeder_${index}` };
  }
  if (def.trigger === 'onBecomingTarget' || def.trigger === 'onDeath' || def.trigger === 'onDamageTaken') {
    return { attackerId: 'rc_plain_b', targetId: cloneId };
  }
  return { attackerId: cloneId, targetId: 'rc_prey' };
}

/** 两跑用例的预建 action：与场景派发同形，同一对象两跑复用。 */
function scenarioAction(entry: DefEntry, index: number): GameAction {
  const { def, owner } = entry;
  const cloneId = `rc${index}_${owner.id}`;
  const scenarioId = scenarioDefId(entry, cloneId);
  if (def.trigger === 'onTurnStart') return createAction('END_TURN', 1);
  if (def.trigger === 'onTurnEnd') {
    return createAction('ACTIVATE_SKILL', 1, { skillId: scenarioId, generalId: cloneId });
  }
  if (def.trigger === 'onDeploy') {
    return createAction('DEPLOY_GENERAL', 1, {
      general: cloneGeneral(cloneId, owner), slot: 0, consumeCards: [{ ...COSTS[0] }],
    });
  }
  const { attackerId, targetId } = attackPair(def, cloneId, index);
  return createAction('ATTACK', 1, {
    attackerId, targetId, ranged: false, consumeCard: { ...COSTS[0] },
  });
}

/**
 * 按触发类别构造必然触发场景并派发，返回该步事件流。
 * `injected`=预建 action（两跑用例：action.id 属派发层进程计数，
 * 同一对象复用于两跑为既有测试约定）。
 */
function forceTrigger(
  entry: DefEntry,
  index: number,
  injected?: GameAction,
): { state: EngineState; events: GameEvent[]; scenarioId: string } {
  const { def, owner } = entry;
  const cloneId = `rc${index}_${owner.id}`;
  const scenarioId = scenarioDefId(entry, cloneId);
  const clone = cloneGeneral(cloneId, owner);
  const tag = `# 未覆盖触发 ${def.trigger}（可达性专项需登记场景）`;
  const attack = (payload: unknown): GameAction =>
    injected ?? createAction('ATTACK', 1, payload);

  if (def.trigger === 'onTurnStart') {
    // 主将挂 p2，p1 结束回合 → p2 回合开始自动链
    const state = makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('rc_plain_a', 4, []), 1)] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(clone, 2)] }),
    ]);
    const engine = buildEngine(state);
    const action = injected ?? createAction('END_TURN', 1);
    return { state: engine.state, events: engine.dispatch(action), scenarioId };
  }

  if (def.trigger === 'onTurnEnd') {
    // 决策通道形态：候选必须先"在列"，再 ACTIVATE_SKILL 真响
    const state = makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(clone, 1)] }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    const engine = buildEngine(state);
    const candidate = listTurnEndSkillCandidates(engine.state, 1)
      .find(c => c.definition.id === scenarioId);
    expect(candidate, `${scenarioId} 应出现在回合结束候选`).toBeDefined();
    const action = injected ?? createAction('ACTIVATE_SKILL', 1, {
      skillId: scenarioId, generalId: cloneId,
    });
    return { state: engine.state, events: engine.dispatch(action), scenarioId };
  }

  if (def.trigger === 'onDeploy') {
    // 部署步补注册+重放（v2.5.1 接线），进场血量=消耗牌数
    const state = makeState([
      makePlayer(1, { fieldGenerals: [], hand: [clone, { ...COSTS[0] }, { ...COSTS[1] }] }),
      makePlayer(2, { fieldGenerals: [] }),
    ]);
    const engine = buildEngine(state);
    const action = injected ?? createAction('DEPLOY_GENERAL', 1, {
      general: clone, slot: 0, consumeCards: [{ ...COSTS[0] }],
    });
    return { state: engine.state, events: engine.dispatch(action), scenarioId };
  }

  if (def.trigger === 'onBecomingTarget' || def.trigger === 'onDeath'
    || def.trigger === 'onDamageTaken') {
    if (def.damageTypeFilter === 'skill') {
      // 技能伤喂招：owner（攻击方）打刚烈持有者，反伤=技能伤触发
      const ganglie = allGenerals.find(g => g.id === 'wei_003');
      expect(ganglie, '喂招刚烈模板必须存在').toBeDefined();
      const feederId = `rc_feeder_${index}`;
      const feeder = cloneGeneral(feederId, ganglie!);
      const state = makeState([
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(clone, 1, 0)], hand: [{ ...COSTS[0] }, { ...COSTS[2] }] }),
        makePlayer(2, { fieldGenerals: [makeFieldGeneral(feeder, 2, 0)] }),
      ]);
      const engine = buildEngine(state);
      const events = engine.dispatch(attack({
        attackerId: cloneId, targetId: `rc_feeder_${index}`, ranged: false, consumeCard: { ...COSTS[0] },
      }));
      // 反伤必须真实发生，否则 skillDamage 场景是假可达
      expect(hasTagged(events, `${feederId}:`), '刚烈反伤未触发=喂招链断裂').toBe(true);
      return { state: engine.state, events, scenarioId };
    }
    // owner 为受击/被击杀目标；onDeath 需一击致命：先手血。
    // 攻击方手里额外留一张牌：反馈型 DISCARD target=ATTACKER 需真实手牌才不空转。
    const victimHp = def.trigger === 'onDeath' ? 1 : clone.hp;
    const victim = makeFieldGeneral(clone, 2, 0);
    victim.currentHp = victimHp;
    if (def.effects[0]?.type === 'EQUIP_STRIP') {
      // 单点护甲吸不住一点伤害（armorDamage 规则），当次伤害后卡仍在，
      // 剥离必须真实落在场景里的这张军备上。
      victim.armorCards = [ARMOR_CARD(index)];
      victim.currentArmor = 1;
    }
    const state = makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('rc_plain_b', 6, []), 1, 0)],
        hand: [{ ...COSTS[0] }, { ...COSTS[1] }, { ...COSTS[2] }],
      }),
      makePlayer(2, { fieldGenerals: [victim] }),
    ]);
    const engine = buildEngine(state);
    // 先派发再取 state：对象字面量按序求值，dispatch 之前读 engine.state
    // 拿到的是派发前快照（可达性判定看终态时必须先落账）。
    const events = engine.dispatch(attack({
      attackerId: 'rc_plain_b', targetId: cloneId, ranged: false, consumeCard: { ...COSTS[0] },
    }));
    return { state: engine.state, events, scenarioId };
  }

  if (def.trigger === 'onDamageDealt' || def.trigger === 'onKill') {
    // owner 为攻击方；onKill 需靶子一击致命（直接压血）
    const prey = makeFieldGeneral(makeGeneral('rc_prey', 4, []), 2, 0);
    if (def.trigger === 'onKill') prey.currentHp = 1;
    if (def.effects[0]?.type === 'EQUIP_STRIP') {
      prey.armorCards = [ARMOR_CARD(index)];
      prey.currentArmor = 1;
    }
    const state = makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(clone, 1, 0)], hand: [{ ...COSTS[0] }, { ...COSTS[1] }] }),
      makePlayer(2, { fieldGenerals: [prey] }),
    ]);
    const engine = buildEngine(state);
    const events = engine.dispatch(attack({
      attackerId: cloneId, targetId: 'rc_prey', ranged: false, consumeCard: { ...COSTS[0] },
    }));
    return { state: engine.state, events, scenarioId };
  }

  if (def.trigger === 'onCardLost') {
    if (def.cardFilter === 'equipment') {
      // 枭姬场景：p1 强袭克隆攻击预挂军备的 p2 克隆 → 剥离结算派生
      // CARD_LOST via='EQUIP' → 装备谓词命中等量摸牌。
      const qiangxiId = `rc_qx_${index}`;
      const qiangxiTpl = allGenerals.find(g => g.id === 'wei_012');
      expect(qiangxiTpl, '喂招强袭模板必须存在').toBeDefined();
      const victim = makeFieldGeneral(clone, 2, 0);
      victim.currentHp = 8; // 典韦 4 点近战-1 护甲会打死 3 血孙尚香，先喂饱血
      victim.armorCards = [ARMOR_CARD(index)];
      victim.currentArmor = 1;
      const state = makeState([
        makePlayer(1, { fieldGenerals: [makeFieldGeneral(cloneGeneral(qiangxiId, qiangxiTpl!), 1, 0)], hand: [{ ...COSTS[0] }, { ...COSTS[1] }] }),
        makePlayer(2, { fieldGenerals: [victim] }),
      ]);
      const engine = buildEngine(state);
      const events = engine.dispatch(attack({
        attackerId: qiangxiId, targetId: cloneId, ranged: false, consumeCard: { ...COSTS[0] },
      }));
      return { state: engine.state, events, scenarioId };
    }
    // 连营场景（lastHandLost 及其余手牌谓词）：克隆攻击断肠靶子 → 击杀弃光
    // 攻击方手牌 → DISCARD 派生 CARD_LOST remainingHand=0 → 摸回一张。
    const caiwenId = `rc_cw_${index}`;
    const caiwenTpl = allGenerals.find(g => g.id === 'qun_012');
    expect(caiwenTpl, '喂招断肠模板必须存在').toBeDefined();
    const prey = makeFieldGeneral(cloneGeneral(caiwenId, caiwenTpl!), 2, 0);
    prey.currentHp = 1;
    const state = makeState([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(clone, 1, 0)], hand: [{ ...COSTS[0] }, { ...COSTS[1] }] }),
      makePlayer(2, { fieldGenerals: [prey] }),
    ]);
    const engine = buildEngine(state);
    const events = engine.dispatch(attack({
      attackerId: cloneId, targetId: caiwenId, ranged: false, consumeCard: { ...COSTS[0] },
    }));
    return { state: engine.state, events, scenarioId };
  }

  throw new Error(tag);
}

function hasTagged(events: GameEvent[], prefix: string): boolean {
  return events.some(e => String((e.data as Record<string, unknown>)?.skillId ?? '').startsWith(prefix));
}

/** 场景终态里指定武将身上剩余的装备卡数（找不到该武将返回 undefined）。 */
function armorCardsLeft(state: EngineState, generalId: string): number | undefined {
  for (const p of state.players) {
    const fg = (p.fieldGenerals ?? []).find(
      f => (f as { general?: { id?: string } }).general?.id === generalId,
    ) as { armorCards?: unknown[] } | undefined;
    if (fg) return (fg.armorCards ?? []).length;
  }
  return undefined;
}

const ENTRIES = allCompiledEntries();

describe('2.5.4 逐技能强制触发可达性专项（40/40 定义全谱）', () => {
  it('账本钉：40 条 runtime 定义 / 129 条诚实跳过，触发类别覆盖 8+onTurnEnd 全谱', () => {
    expect(ENTRIES).toHaveLength(40);
    let skipped = 0;
    for (const g of allGenerals) skipped += compileGeneralSkills(g).skipped.length;
    expect(skipped).toBe(129);
    const triggers = new Set(ENTRIES.map(e => `${e.def.trigger}${e.def.damageTypeFilter ? `:${e.def.damageTypeFilter}` : ''}`));
    expect([...triggers].sort()).toEqual([
      'onBecomingTarget', 'onCardLost', 'onDamageDealt:attack', 'onDamageTaken',
      'onDamageTaken:attack', 'onDamageTaken:skill', 'onDeath', 'onDeploy', 'onKill',
      'onTurnEnd', 'onTurnStart',
    ]);
  });

  it('每一条定义都能在强制场景里打出带自身 skillId 的效果事件', () => {
    const unreachable: string[] = [];
    ENTRIES.forEach((entry, i) => {
      const { state, events, scenarioId } = forceTrigger(entry, i);
      if (!hasEffectFor(events, scenarioId)) unreachable.push(entry.def.id);
      if (entry.def.effects[0]?.type === 'EQUIP_STRIP') {
        // 剥离不是空转：场景里预挂的那张军备必须真实离场。
        const carrier = entry.def.effects[0].target === 'SELF'
          ? `rc${i}_${entry.owner.id}` : 'rc_prey';
        expect(armorCardsLeft(state, carrier),
          `${entry.def.id} 应把预挂军备真实剥离`).toBe(0);
      }
    });
    expect(unreachable, `以下定义强制打不响：${unreachable.join(', ')}`).toEqual([]);
  });

  it('分触发类别逐类点名（失败时定位到类）', () => {
    const byTrigger = new Map<string, DefEntry[]>();
    ENTRIES.forEach((entry) => {
      const key = `${entry.def.trigger}|${entry.def.damageTypeFilter ?? 'any'}`;
      const list = byTrigger.get(key) ?? [];
      list.push(entry);
      byTrigger.set(key, list);
    });
    for (const [key, list] of byTrigger) {
      for (const entry of list) {
        const idx = ENTRIES.indexOf(entry);
        const { events, scenarioId } = forceTrigger(entry, idx);
        expect(
          hasEffectFor(events, scenarioId),
          `${key} → ${entry.def.id} 未打出效果事件`,
        ).toBe(true);
      }
    }
    expect(byTrigger.size).toBeGreaterThanOrEqual(9);
  });

  it('回合结束六条：候选在列且激活后 SKILL_ACTIVATED 与效果事件同现', () => {
    const turnEnd = ENTRIES.filter(e => e.def.trigger === 'onTurnEnd');
    expect(turnEnd).toHaveLength(6);
    for (const entry of turnEnd) {
      const idx = ENTRIES.indexOf(entry);
      const { events, scenarioId } = forceTrigger(entry, idx);
      expect(events.some(e => e.type === 'SKILL_ACTIVATED')).toBe(true);
      expect(hasEffectFor(events, scenarioId)).toBe(true);
    }
  });

  it('同一场景两跑事件流一致（可达性判定无随机旁路）', () => {
    // 同一 action 对象复用于两跑（action.id 属派发层进程计数）；剥离项
    // 仅为进程易变字段：action.id、事件 uuid id、timestamp、rootEventId。
    const normalizeEvent = (e: GameEvent) =>
      JSON.stringify({ type: e.type, data: e.data })
        .replace(/"id":"action_\d+"/g, '"id":"_a"')
        .replace(/"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g, '"_u"')
        .replace(/"timestamp":\d+/g, '"timestamp":"_t"')
        .replace(/"rootEventId":"[^"]*"/g, '"rootEventId":"_v"');
    ENTRIES.forEach((entry, i) => {
      const action = scenarioAction(entry, i);
      action.id = `rc_fixed_${i}`;
      const first = forceTrigger(entry, i, action).events;
      const second = forceTrigger(entry, i, action).events;
      expect(second.map(normalizeEvent)).toEqual(first.map(normalizeEvent));
    });
  });
});
