/**
 * 2.6.4 收敛核验 · choice 面可达性全谱（非内容刀：全部合成模板，内置零载荷）。
 *
 * v2.6.3 装好了玩家决策通道的五要素（窗—候选—选择—回写—日志），本文件回答
 * 收敛核验的可达性问题：**十个触发键是否每一个都能承载 effectMode:'choice'
 * 开出一张可择定的 CHOICE_REQUIRED 账**。逐触发键合成"择一"技能（摸二/得甲
 * 两分支），强制触发场景克隆自 builtinReachability 同族形态，断言链固定：
 * 触发开账（恰一张要约、双选项、延后零落账）→ 冻结探针（非择定动作被拒）→
 * 欠债人择定（RESOLVED 先行 + 选中分支落账 + 未选分支永不发生）→ 账清。
 * 另含两枚反例钉：孤效果 choice=照常独立定义零要约；同配置两跑逐字节。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EngineState, EnginePlayer } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import { createAction } from '../action/ActionTypes';
import type { General, Skill, SkillTriggerConfig } from '../data/generals';
import { allGenerals } from '../data/generals';
import type { GameCard } from '../data/cards';
import { syncPlayerSkills, compileGeneralSkills } from '../skills/skillCompiler';

function makeGeneral(id: string, hp: number, skills: Skill[]): General {
  return {
    id, name: '择验' + id, faction: '魏', hp, type: '武将',
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

const COSTS = [1, 2, 3].map(i => ({ id: `cc_cost_${i}`, name: '粮草', type: '粮草' }));

/** 择一合成技能：摸两张牌 或 获得1点护甲（同一触发签名双 runtime 效果）。 */
function choiceSkill(name: string, trig: SkillTriggerConfig): Skill {
  return {
    name,
    description: `${name}描述兜底`,
    effectMode: 'choice',
    effects: [
      { id: 'e1', trigger: trig, runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' }, description: 'A：摸两张牌' },
      { id: 'e2', trigger: trig, runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' }, description: 'B：获得1点护甲' },
    ],
  };
}

interface Scenario {
  /** 触发键标签（失败定位用）。 */
  label: string;
  /** 欠债玩家（=技能拥有者座位）。 */
  chooserPid: number;
  /** 拥有者 runtime 卡 id（择定后场上对账用）。 */
  generalId: string;
  /** 触发步动作（构造 state 前由 build 提供）。 */
  fire: (ctx: { defId: string; generalId: string }) => ReturnType<typeof createAction>;
  /** 构造场面：拥有者挂 choiceSkill，返回 state 与其 choiceMode 定义 id。 */
  build: () => { state: EngineState; defId: string; generalId: string };
  /** 择定分支：0=摸牌（hand 增长对账），1=得甲（armor 增长对账；离阵将允许诚实空转）。 */
  pick: 0 | 1;
}

function ownerChoiceCtx(generalId: string, skillName: string, trig: SkillTriggerConfig) {
  const owner = makeGeneral(generalId, 4, [choiceSkill(skillName, trig)]);
  const def = compileGeneralSkills(owner).definitions.find(d => d.name === skillName);
  expect(def, `${generalId}:${skillName} 应编译出 choiceMode 定义`).toBeDefined();
  expect(def!.choiceMode).toBe(true);
  return { owner, defId: def!.id };
}

const attack = (attackerId: string, targetId: string) =>
  createAction('ATTACK', 1, { attackerId, targetId, ranged: false, consumeCard: { ...COSTS[0] } });

function scenarioFor(trigger: SkillTriggerConfig['type']): Scenario {
  const gid = `cc_${trigger}_o`;
  const trig: SkillTriggerConfig =
    trigger === 'onTurnStart' || trigger === 'onTurnEnd' ? { type: trigger, turnSubType: 'selfTurn' }
      : trigger === 'onDamageTaken' ? { type: trigger, damageSubType: 'allDamage' }
        : trigger === 'onDamageDealt' ? { type: trigger, damageSubType: 'attackDamage' }
          : { type: trigger };
  switch (trigger) {
    case 'onTurnStart': {
      const { owner, defId } = ownerChoiceCtx(gid, '择始', trig);
      return {
        label: 'onTurnStart', chooserPid: 2, generalId: gid,
        build: () => ({
          state: makeState([
            makePlayer(1, { fieldGenerals: [makeFieldGeneral(makeGeneral('cc_plain_a', 4, []), 1)] }),
            makePlayer(2, { fieldGenerals: [makeFieldGeneral(owner, 2)] }),
          ]),
          defId, generalId: gid,
        }),
        fire: () => createAction('END_TURN', 1),
        pick: 1,
      } as Scenario;
    }
    case 'onTurnEnd': {
      const { owner, defId } = ownerChoiceCtx(gid, '择终', trig);
      return {
        label: 'onTurnEnd', chooserPid: 1, generalId: gid,
        build: () => ({
          state: makeState([
            makePlayer(1, { fieldGenerals: [makeFieldGeneral(owner, 1)] }),
            makePlayer(2, { fieldGenerals: [] }),
          ]),
          defId, generalId: gid,
        }),
        fire: ({ defId: id, generalId }) =>
          createAction('ACTIVATE_SKILL', 1, { skillId: id, generalId }),
        pick: 0,
      } as Scenario;
    }
    case 'onDeploy': {
      const { owner, defId } = ownerChoiceCtx(gid, '择阵', trig);
      return {
        label: 'onDeploy', chooserPid: 1, generalId: gid,
        build: () => ({
          state: makeState([
            makePlayer(1, { fieldGenerals: [], hand: [owner, { ...COSTS[0] }, { ...COSTS[1] }] }),
            makePlayer(2, { fieldGenerals: [] }),
          ]),
          defId, generalId: gid,
        }),
        fire: ({ generalId }) => createAction('DEPLOY_GENERAL', 1, {
          general: makeGeneral(generalId, 4, [choiceSkill('择阵', trig)]),
          slot: 0, consumeCards: [{ ...COSTS[0] }],
        }),
        pick: 1,
      } as Scenario;
    }
    case 'onBecomingTarget':
    case 'onDamageTaken': {
      const { owner, defId } = ownerChoiceCtx(gid, '择承', trig);
      return {
        label: trigger, chooserPid: 2, generalId: gid,
        build: () => ({
          state: makeState([
            makePlayer(1, {
              fieldGenerals: [makeFieldGeneral(makeGeneral('cc_plain_b', 6, []), 1, 0)],
              hand: [{ ...COSTS[0] }],
            }),
            makePlayer(2, { fieldGenerals: [makeFieldGeneral(owner, 2, 0)] }),
          ]),
          defId, generalId: gid,
        }),
        fire: () => attack('cc_plain_b', gid),
        pick: 1,
      } as Scenario;
    }
    case 'onDamageDealt': {
      const { owner, defId } = ownerChoiceCtx(gid, '择击', trig);
      return {
        label: 'onDamageDealt', chooserPid: 1, generalId: gid,
        build: () => ({
          state: makeState([
            makePlayer(1, { fieldGenerals: [makeFieldGeneral(owner, 1, 0)], hand: [{ ...COSTS[0] }] }),
            makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('cc_prey', 4, []), 2, 0)] }),
          ]),
          defId, generalId: gid,
        }),
        fire: () => attack(gid, 'cc_prey'),
        pick: 1,
      } as Scenario;
    }
    case 'onKill': {
      const { owner, defId } = ownerChoiceCtx(gid, '择斩', trig);
      return {
        label: 'onKill', chooserPid: 1, generalId: gid,
        build: () => {
          const prey = makeFieldGeneral(makeGeneral('cc_prey_k', 4, []), 2, 0);
          prey.currentHp = 1;
          return {
            state: makeState([
              makePlayer(1, { fieldGenerals: [makeFieldGeneral(owner, 1, 0)], hand: [{ ...COSTS[0] }] }),
              makePlayer(2, { fieldGenerals: [prey] }),
            ]),
            defId, generalId: gid,
          };
        },
        fire: () => attack(gid, 'cc_prey_k'),
        pick: 0,
      } as Scenario;
    }
    case 'onDeath': {
      const { owner, defId } = ownerChoiceCtx(gid, '择亡', trig);
      return {
        // 死亡链姿态复核：账不清、人照择；离场将的得甲分支允许诚实空转，
        // 故选摸牌分支（账在玩家手上，与离场无关）。
        label: 'onDeath', chooserPid: 2, generalId: gid,
        build: () => {
          const victim = makeFieldGeneral(owner, 2, 0);
          victim.currentHp = 1;
          return {
            state: makeState([
              makePlayer(1, {
                fieldGenerals: [makeFieldGeneral(makeGeneral('cc_plain_c', 6, []), 1, 0)],
                hand: [{ ...COSTS[0] }],
              }),
              makePlayer(2, { fieldGenerals: [victim] }),
            ]),
            defId, generalId: gid,
          };
        },
        fire: () => attack('cc_plain_c', gid),
        pick: 0,
      } as Scenario;
    }
    case 'onCardLost': {
      const { owner, defId } = ownerChoiceCtx(gid, '择失', { type: 'onCardLost', cardSubType: 'lastHandLost' });
      return {
        // 连营同型喂招：击杀断肠将 → 弃光攻击方手牌 → 最后一张失去开账。
        label: 'onCardLost', chooserPid: 1, generalId: gid,
        build: () => {
          const caiwenTpl = allGenerals.find(g => g.id === 'qun_012');
          expect(caiwenTpl, '喂招断肠模板必须存在').toBeDefined();
          const feeder = JSON.parse(JSON.stringify(caiwenTpl)) as General;
          feeder.id = 'cc_caiwen';
          const prey = makeFieldGeneral(feeder, 2, 0);
          prey.currentHp = 1;
          return {
            state: makeState([
              makePlayer(1, {
                fieldGenerals: [makeFieldGeneral(owner, 1, 0)],
                hand: [{ ...COSTS[0] }, { ...COSTS[1] }],
              }),
              makePlayer(2, { fieldGenerals: [prey] }),
            ]),
            defId, generalId: gid,
          };
        },
        fire: () => attack(gid, 'cc_caiwen'),
        pick: 0,
      } as Scenario;
    }
    case 'onCardGained': {
      const { owner, defId } = ownerChoiceCtx(gid, '择得', { type: 'onCardGained', cardSubType: 'anyGained' });
      return {
        // v2.5.3 发放实证同型喂招：受击方分发 GIVE ATTACKER → CARD_GAINED 开账。
        label: 'onCardGained', chooserPid: 1, generalId: gid,
        build: () => {
          const taker = makeGeneral('cc_taker', 6, [{
            name: '分发',
            effects: [{ id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'GIVE', value: 1, target: 'ATTACKER' } }],
          }]);
          return {
            state: makeState([
              makePlayer(1, { fieldGenerals: [makeFieldGeneral(owner, 1, 0)], hand: [{ ...COSTS[0] }] }),
              makePlayer(2, {
                fieldGenerals: [makeFieldGeneral(taker, 2, 0)],
                hand: [{ id: 'cc_gift', name: '粮草', type: '粮草' }],
              }),
            ]),
            defId, generalId: gid,
          };
        },
        fire: () => attack(gid, 'cc_taker'),
        pick: 0,
      } as Scenario;
    }
    default:
      throw new Error(`choice 面全谱未登记场景：${trigger}`);
  }
}

const TRIGGER_KEYS: SkillTriggerConfig['type'][] = [
  'onTurnStart', 'onTurnEnd', 'onDeploy', 'onBecomingTarget',
  'onDamageDealt', 'onKill', 'onDamageTaken', 'onDeath',
  'onCardLost', 'onCardGained',
];

function fieldOf(state: EngineState, generalId: string) {
  for (const p of state.players) {
    const fg = (p.fieldGenerals ?? []).find(
      f => (f as { general?: { id?: string } }).general?.id === generalId,
    ) as { currentArmor: number; currentHp: number } | undefined;
    if (fg) return fg;
  }
  return undefined;
}

describe('2.6.4 choice 面可达全谱：十个触发键每键可开账、可择定、账清（合成模板，内置零载荷）', () => {
  for (const trigger of TRIGGER_KEYS) {
    it(`${trigger}：choiceMode 触发开一张要约→冻结探针→欠债人择定落账`, () => {
      const sc = scenarioFor(trigger);
      const { state, defId, generalId } = sc.build();
      const engine = new GameEngine(state);
      syncPlayerSkills(engine, engine.state);

      const fireEvents = engine.dispatch(sc.fire({ defId, generalId }));
      const required = fireEvents.filter(e => e.type === 'CHOICE_REQUIRED');
      expect(required, `${trigger} 应恰开一张 CHOICE_REQUIRED`).toHaveLength(1);
      const offer = required[0].data as Record<string, unknown>;
      expect(String(offer.choiceKey)).toMatch(/^ch:\d+:\d+:/);
      expect(String(offer.choiceKey).endsWith(defId)).toBe(true);
      expect(offer.chooserPlayerId).toBe(sc.chooserPid);
      const opts = (offer.options ?? []) as Array<{ label: string; events: Array<{ type: string }> }>;
      expect(opts.map(o => ({ label: o.label, types: o.events.map(e => e.type) }))).toEqual([
        { label: 'A：摸两张牌', types: ['DRAW'] },
        { label: 'B：获得1点护甲', types: ['GAIN_ARMOR'] },
      ]);
      // 延后结算：开账瞬间双分支都未落账
      expect(fireEvents.some(e => e.type === 'DAMAGE' && String((e.data as Record<string, unknown>)?.skillId ?? '') === defId)).toBe(false);
      const handBefore = (engine.state.players.find(p => p.id === sc.chooserPid)!.hand as unknown[]).length;
      const armorBefore = fieldOf(engine.state, generalId)?.currentArmor ?? 0;

      // 账住在状态里（A 类事实），非择定动作被冻结闸弹开
      expect(engine.state.pendingChoice).not.toBeNull();
      expect(engine.state.pendingChoice?.key).toBe(String(offer.choiceKey));
      const probe = engine.dispatch(createAction('END_TURN', sc.chooserPid === 1 ? 2 : 1));
      expect(probe.some(e => e.type === 'ACTION_REJECTED'
        && (e.data as Record<string, unknown>)?.reason === 'CHOICE_PENDING')).toBe(true);

      // 欠债人择定：RESOLVED 先行清账，选中分支走正常结算链
      const pickEvents = engine.dispatch(createAction('CHOOSE_OPTION', sc.chooserPid, {
        choiceKey: String(offer.choiceKey), optionIndex: sc.pick,
      }));
      const flat = [...fireEvents, ...pickEvents];
      const resolvedIdx = flat.findIndex(e => e.type === 'CHOICE_RESOLVED');
      expect(resolvedIdx).toBeGreaterThanOrEqual(0);
      const resolved = flat.filter(e => e.type === 'CHOICE_RESOLVED');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].data).toMatchObject({
        choiceKey: String(offer.choiceKey), chooserPlayerId: sc.chooserPid,
        optionIndex: sc.pick, label: sc.pick === 0 ? 'A：摸两张牌' : 'B：获得1点护甲',
      });
      expect(engine.state.pendingChoice ?? null).toBeNull();

      const draw = pickEvents.filter(e => e.type === 'DRAW'
        && String((e.data as Record<string, unknown>)?.skillId ?? '') === defId);
      const armor = pickEvents.filter(e => e.type === 'GAIN_ARMOR'
        && String((e.data as Record<string, unknown>)?.skillId ?? '') === defId);
      if (sc.pick === 0) {
        expect(draw).toHaveLength(1);
        expect((draw[0].data as Record<string, unknown>).count).toBe(2);
        expect(armor).toHaveLength(0); // 未选分支永不发生
        const handAfter = (engine.state.players.find(p => p.id === sc.chooserPid)!.hand as unknown[]).length;
        expect(handAfter).toBe(handBefore + 2);
      } else {
        expect(armor).toHaveLength(1);
        expect(draw).toHaveLength(0);
        const armorAfter = fieldOf(engine.state, generalId)?.currentArmor ?? 0;
        if (trigger === 'onDeath') {
          expect(armorAfter).toBe(0); // 离场将的得甲=结算闸诚实空转（账仍清、择仍有效）
        } else {
          expect(armorAfter).toBe(armorBefore + 1);
        }
      }
    });
  }

  it('反例钉：choice 模式孤效果（同触发仅一枚 runtime）=照常独立定义、永不开账 (v2.6.3 分组契约)', () => {
    const gid = 'cc_lonely_o';
    const owner: General = makeGeneral(gid, 4, [{
      name: '孤择',
      effectMode: 'choice',
      effects: [
        { id: 'e1', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' }, description: '仅一枚可运行效果' },
        { id: 'e2', trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' }, description: '纯描述效果（无 runtime）' },
      ],
    }]);
    const defs = compileGeneralSkills(owner).definitions;
    expect(defs).toHaveLength(1);
    expect(defs[0].choiceMode).toBeUndefined();
    expect(defs[0].effects.map(e => e.type)).toEqual(['DRAW_CARD']);

    const engine = new GameEngine(makeState([
      makePlayer(1, {
        fieldGenerals: [makeFieldGeneral(makeGeneral('cc_plain_d', 6, []), 1, 0)],
        hand: [{ ...COSTS[0] }],
      }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(owner, 2, 0)] }),
    ]));
    syncPlayerSkills(engine, engine.state);
    const events = engine.dispatch(attack('cc_plain_d', gid));
    expect(events.some(e => e.type === 'CHOICE_REQUIRED')).toBe(false);
    expect(events.some(e => e.type === 'DRAW'
      && String((e.data as Record<string, unknown>)?.skillId ?? '') === defs[0].id)).toBe(true);
    expect(engine.state.pendingChoice ?? null).toBeNull();
  });

  it('同配置两跑逐字节一致：choice 开账+择定全链零新增随机面', () => {
    const normalize = (e: GameEvent) =>
      JSON.stringify({ type: e.type, data: e.data })
        .replace(/"id":"[0-9a-f-]{36}"/g, '"id":"_u"')
        .replace(/"timestamp":\d+/g, '"timestamp":"_t"')
        .replace(/"rootEventId":"[^"]*"/g, '"rootEventId":"_v"')
        .replace(/"id":"action_[^"]*"/g, '"id":"_a"');
    const run = () => {
      const sc = scenarioFor('onDamageDealt');
      const { state, defId, generalId } = sc.build();
      const engine = new GameEngine(state);
      syncPlayerSkills(engine, engine.state);
      const a = sc.fire({ defId, generalId });
      a.id = 'cc_fixed_run';
      const fireEvents = engine.dispatch(a);
      const key = String((fireEvents.find(e => e.type === 'CHOICE_REQUIRED')!.data as Record<string, unknown>).choiceKey);
      const pick = createAction('CHOOSE_OPTION', sc.chooserPid, { choiceKey: key, optionIndex: 1 });
      pick.id = 'cc_fixed_pick';
      const pickEvents = engine.dispatch(pick);
      return {
        stream: [...fireEvents, ...pickEvents].map(normalize).join('\n'),
        final: JSON.stringify(engine.state),
      };
    };
    const first = run();
    const second = run();
    expect(second.stream).toBe(first.stream);
    expect(second.final).toBe(first.final);
  });
});
