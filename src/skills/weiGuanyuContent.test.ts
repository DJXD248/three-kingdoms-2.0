/**
 * v2.9.6 内容刀·魏关羽：这一刀真的进池的三枚东西（武圣／单骑／怒斩）从**内容定义**
 * 一路跑到**下一刀的算术**。
 *
 * 与相邻几档的分工（那些档已经把机制钉死，这里一律不重做）：
 *  · `awakeningSkill.test.ts`＝觉醒技徽章⇒问窗⇒额度⇒三格门槛（夹具是自造的同型卡）；
 *  · `damageDealt.test.ts`＝场合两枚、入算次序、决斗逐轮（夹具是手写的账本条目）；
 *  · `gainSkill.test.ts`＝「获得技能」那一条效果本身；
 *  · `passiveModifiers.test.ts`＝在场账的形状与普查。
 * 这一档只回答一个问题：**换上真的卡，这些机制接上了没有**——所以场面里的关羽、
 * 武圣、单骑全部从 `data/generals.ts` 当场取，怒斩从 `data/skillTable.ts` 那张技能表上
 * 当场取（v2.9.7 起＝「获得技能」唯一认的名单），
 * 只有"对面站谁"和"谁挑起来一场决斗"这两样与本刀要证的事无关，才用合成件。
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../core/GameEngine';
import type { EnginePlayer, EngineState } from '../core/GameState';
import { createAction } from '../action/ActionTypes';
import { effectiveMaxHp, type StatModifier } from '../core/statModifiers';
import { getAttackValue } from '../core/attackValue';
import { allGenerals, type General, type Skill } from '../data/generals';
import { skillTable } from '../data/skillTable';
import { compileGeneralSkills, syncPlayerSkills } from './skillCompiler';
import { passiveEntriesOfGeneral } from './passiveModifiers';
import { getReactionAsk } from './reactionChain';

const wei = allGenerals.find(g => g.id === 'wei_022')!;
const shu = allGenerals.find(g => g.id === 'shu_002')!;
/** 怒斩从**技能表**上取（不是从自建清单那一份另抄一遍）：表上那一行交出来的对象
 *  与「单骑」按名字拿到的必须是同一个，否则"表里一个样、卡上另一个样"就成立了。 */
const nuzhanRow = skillTable.find(row => row.skill.name === '怒斩')!;
const nuzhan = nuzhanRow.skill;

/** 与既有几档同一副夹具形状：`areaOwnerId` 一律 1（除战场）＝这一库"近战够得着"的
 *  惯用摆法——距离按 `core/attackReach.ts` 数：自家前线(档 1) ↔ 战场(档 2) 差 1，
 *  而"敌前线"按对面镜像成档 3，近战压根打不到（写错这里，第二刀会被当场拒）。 */
function makeFieldGeneral(general: General, ownerId: number, slot = 0,
  zone: 'camp' | 'front' | 'battle' = 'front', overrides: Record<string, unknown> = {}) {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: 0, currentArmor: 0, armorCards: [],
    isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId, position: { zone, slot, areaOwnerId: zone === 'battle' ? null : 1 },
    ...overrides,
  };
}

function makeGeneral(id: string, hp = 4, skills: Skill[] = []): General {
  return {
    id, name: '沙场将' + id, faction: '群', hp, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills,
  } as unknown as General;
}

function makePlayer(id: number, overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    id, name: 'Player ' + id, hp: 8, hand: [], generalPool: [], fieldGenerals: [],
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [], ...overrides,
  } as EnginePlayer;
}

const COST = (n: number) => ({ id: `cost_${n}`, name: '粮草', type: '粮草' });

function makeState(players: EnginePlayer[], ledger?: StatModifier[]): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: players[0]?.id ?? null, turn: 1, round: 1,
    deck: Array.from({ length: 8 }, (_, i) => ({ id: `deck_${i + 1}`, name: '粮草', type: '粮草' as const })),
    discardPile: [], drawState: null,
    ...(ledger ? { statModifiers: ledger } : {}),
  } as EngineState;
}

function buildEngine(players: EnginePlayer[], ledger?: StatModifier[]): GameEngine {
  const state = makeState(players, ledger);
  const engine = new GameEngine(state, { recordHistory: false });
  syncPlayerSkills(engine, state);
  return engine;
}

const fieldOf = (engine: GameEngine, playerId: number, generalId: string) =>
  (engine.state.players.find(p => p.id === playerId)?.fieldGenerals as any[] | undefined)
    ?.find(f => f?.general?.id === generalId);

/** 真链路场面：魏关羽（前线）近战击杀 p2 那员只剩 1 体、踩在战场的将。
 *  同席再无别人⇒单骑那三格门槛全中。`awaken` 决定点头还是摇头；`armor` 决定
 *  下一刀砍的那名敌将有没有护甲（怒斩的近战那条腿只认"有护甲"这一格）。 */
function soloRiderScene(awaken: boolean, armor = 2) {
  const victim = makeFieldGeneral(makeGeneral('dj_victim', 1), 2, 0, 'battle');
  const survivor = makeFieldGeneral(makeGeneral('dj_armored', 8), 2, 1, 'front',
    { armor, currentArmor: armor });
  const guanYu = makeFieldGeneral(wei, 1, 0, 'front');
  const engine = buildEngine([
    makePlayer(1, { fieldGenerals: [guanYu], hand: [COST(1), COST(2), COST(3)] }),
    makePlayer(2, { fieldGenerals: [victim, survivor] }),
  ]);
  const kill = engine.dispatch(createAction('ATTACK', 1, {
    attackerId: wei.id, targetId: 'dj_victim', ranged: false, consumeCard: COST(1),
  }));
  const ask = getReactionAsk(engine.state);
  expect(ask?.options.map(o => o.skillName), '三格全中却不开格：单骑没被问').toEqual(['单骑']);
  engine.dispatch(createAction(awaken ? 'ACTIVATE_SKILL' : 'SKIP_REACTION', ask!.playerId,
    awaken ? { skillId: ask!.options[0].skillId, generalId: ask!.generalId } : { nodeKey: ask!.nodeKey }));
  // 换到 p1 的下一回合：这一刀才是"觉醒之后"的一刀（同一回合内不许连击）。
  engine.dispatch(createAction('END_TURN', 1));
  engine.dispatch(createAction('END_TURN', 2));
  const blow = engine.dispatch(createAction('ATTACK', 1, {
    attackerId: wei.id, targetId: 'dj_armored', ranged: false, consumeCard: COST(2),
  }));
  const target = fieldOf(engine, 2, 'dj_armored');
  return { engine, kill, blow, hpLost: 8 - (target?.currentHp ?? 0), armorLeft: target?.currentArmor };
}

describe('魏关羽·内容形态（三枚各就各位）', () => {
  it('名册上的那一格：魏关羽＝体力 4、近战 2、远程 1，技能两枚「武圣」「单骑」', () => {
    expect(wei.hp).toBe(4);
    expect(wei.meleeAtk).toBe(2);
    expect(wei.rangedAtk).toBe(1);
    expect(wei.skills?.map(s => s.name)).toEqual(['武圣', '单骑']);
    // 用户裁决：两家「武圣」是同一个效果⇒**同一个对象**，不是抄两遍。
    expect(shu.skills?.map(s => s.name)).toEqual(['武圣']);
    expect(wei.skills?.[0]).toBe(shu.skills?.[0]);
  });

  it('编译面：一枚在场账＋一条链式觉醒，三格门槛落在定义级，怒斩嵌的是表上那一枚', () => {
    const { definitions, skipped } = compileGeneralSkills(wei, 'wei_022');
    expect(skipped).toEqual([]);
    expect(definitions.map(d => d.id)).toEqual(['wei_022:武圣:e1', 'wei_022:单骑:chain']);
    const wusheng = definitions[0];
    expect(wusheng).toMatchObject({ passive: true, locked: true, name: '武圣' });
    const danqi = definitions[1];
    expect(danqi).toMatchObject({
      trigger: 'onKill', awakening: true, effectChain: true, limitKey: 'wei_022:单骑',
    });
    expect(danqi.conditions).toHaveLength(3);
    // 「获得技能」拿到的必须是技能表上交出来的那一个对象（同名再编一枚＝两个来源分叉）。
    const gained = danqi.effects.find(e => e.type === 'GAIN_SKILL')?.gainedSkill;
    expect(gained).toBe(nuzhan);
  });

  it('怒斩自己：两笔在场账、两个场合，一枚都不许丢（编译只认在场这一型）', () => {
    const entries = passiveEntriesOfGeneral(
      { ...makeGeneral('x1'), skills: [nuzhan] } as General, 'x1', 1);
    expect(entries).toHaveLength(2);
    expect(entries.map(e => [e.key, e.mode, e.value, e.occasion]))
      .toEqual([['DAMAGE_DEALT', 'delta', 1, 'duel'], ['DAMAGE_DEALT', 'delta', 1, 'meleeVsArmored']]);
    expect(entries.every(e => e.passive === true)).toBe(true);
    // 怒斩卡面没挂「锁定技」⇒这两笔今天不是锁定账；要不要补那枚徽章是内容问题，等用户裁。
    expect(entries.map(e => e.locked)).toEqual([false, false]);
  });
});

describe('武圣（在场即生效）真的动了远程攻击力', () => {
  it('真卡从手里登场⇒落一笔远程 +1 的锁定账；读数点把它接到远程那把钥匙上', () => {
    const engine = buildEngine([
      makePlayer(1, { hand: [wei, COST(1)] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('dj_opp', 8), 2)] }),
    ]);
    const events = engine.dispatch(createAction('DEPLOY_GENERAL', 1, {
      general: wei, slot: 0, consumeCards: [COST(1)],
    }));
    const adds = events.filter(e => e.type === 'STAT_MODIFY');
    expect(adds).toHaveLength(1);
    const ledger = engine.state.statModifiers ?? [];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      key: 'RANGED_ATK', mode: 'delta', value: 1, passive: true, locked: true,
      ownerSkillName: '武圣', targetId: wei.id,
    });
    const deployed = fieldOf(engine, 1, wei.id);
    const target = { playerId: 1, generalId: wei.id };
    expect(getAttackValue(deployed?.general, true, { ledger, target })).toBe(2);
    // 改坏读数：钥匙不能串——只加远程，近战那把仍是卡面 2；没有账时远程仍是 1。
    expect(getAttackValue(deployed?.general, false, { ledger, target })).toBe(2);
    expect(getAttackValue(deployed?.general, true, { ledger: [], target })).toBe(1);
  });
});

describe('单骑→怒斩：真链路（问一次、削上限、拿到那一枚、账跟着来）', () => {
  it('点头⇒上限少 1 且当前体力跟着截、卡面长出怒斩、账本落下那两笔在场账', () => {
    const { engine, kill } = soloRiderScene(true);
    expect(kill.some(e => e.type === 'DEATH')).toBe(true);
    const gained = engine.state.players.flatMap(p => (p.fieldGenerals as any[]))
      .find(f => f?.general?.id === wei.id);
    expect(gained.general.skills.map((s: Skill) => s.name)).toEqual(['武圣', '单骑', '怒斩']);
    // 状态里那一枚与表上那枚逐字相同。身份（`toBe`）已经在上面编译面那档钉过：派发
    // 会克隆状态，所以"同一个对象"这句话只能说在编译产物上，不能说在克隆之后的卡面上。
    expect(gained.general.skills[2]).toEqual(nuzhan);
    // 卡面印刷值一字不改，削的是账本；当前体力跟着截回来。
    expect(gained.maxHp).toBe(4);
    expect(effectiveMaxHp(engine.state.statModifiers, { playerId: 1, generalId: wei.id }, gained)).toBe(3);
    expect(gained.currentHp).toBe(3);
    // 「在场即生效」的补笔真的发生：觉醒之后怒斩不再是空名字。
    const ledger = (engine.state.statModifiers ?? []).filter(e => e.key === 'DAMAGE_DEALT');
    expect(ledger.map(e => e.occasion)).toEqual(['duel', 'meleeVsArmored']);
    expect(ledger.every(e => e.passive === true && e.targetId === wei.id)).toBe(true);
    // 名册上那一个对象一个字都没被改：觉醒写的是**状态里那张表**，不是 `allGenerals`
    // 里共用的这一份（改了就会污染同一进程里后面每一局、每一个测试的卡面）。
    expect(wei.skills?.map(s => s.name)).toEqual(['武圣', '单骑']);
  });

  it('摇头⇒什么都没有：不削上限、不长技能、不落账，下一刀的伤害与对照组逐字相同', () => {
    const declined = soloRiderScene(false);
    const fg = fieldOf(declined.engine, 1, wei.id)!;
    expect(fg.general.skills.map((s: Skill) => s.name)).toEqual(['武圣', '单骑']);
    expect(fg.currentHp).toBe(4);
    expect((declined.engine.state.statModifiers ?? []).filter(e => e.key === 'DAMAGE_DEALT')).toEqual([]);
    expect(declined.hpLost).toBe(1);
  });

  it('觉醒那一刀砍在有护甲的敌将身上：怒斩的近战腿进护甲之前＋1（对照＝没觉醒的 1 点）', () => {
    const { engine, hpLost, armorLeft } = soloRiderScene(true);
    // 近战 2 ＋怒斩 1 ＝ 3 点进护甲；护甲 2 挡掉 1 点⇒掉 2 点血、甲归零。
    expect(hpLost).toBe(2);
    expect(armorLeft).toBe(0);
    expect(engine.state.consumedSkills?.map(q => q.limitKey)).toContain('wei_022:单骑');
  });
});

describe('怒斩的两条腿在真对局里各管各的场合', () => {
  it('砍一名**没有护甲**的敌将＝卡面 2 点：近战那条腿压根不进场（场合是账身上的标签，不是门槛）', () => {
    // 同一副觉醒之后的场面，只把护甲换成 0。若场合被当成摆设（谁在场都 +1），
    // 这一刀会是 3 点——这条断言就是钉住那种改法的证人。
    expect(soloRiderScene(true, 0).hpLost).toBe(2);
    // 没觉醒时同一格也是 2 点⇒两半合起来才说明"+1 只属于有护甲那一档"。
    expect(soloRiderScene(false, 0).hpLost).toBe(2);
  });

  /** 决斗那一路今天官方池还没有会挑它的卡⇒入场用合成件（搦战），
   *  但**账本里那两笔是真怒斩编译出来的**（`passiveEntriesOfGeneral`）。
   *  受方带 2 点护甲：这样"近战那条腿要是被当成决斗也算"就会当场多冒 1 点。 */
  function duelWith(ledgerEntries: 'both' | 'duel_only') {
    const entries = passiveEntriesOfGeneral(
      { ...makeGeneral('x1'), skills: [nuzhan] } as General, 'gC', 1)
      .filter(e => ledgerEntries === 'both' || e.occasion === 'duel')
      .map((e, i) => ({ ...e, id: `sm:${i + 1}`, seq: i + 1 } as StatModifier));
    const challenger = makeGeneral('gC', 12, [{
      name: '搦战', trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
      effects: [{
        id: 'e1', trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
        runtime: { type: 'DUEL', target: 'TARGET' },
      }],
    }]);
    const engine = buildEngine([
      makePlayer(1, { fieldGenerals: [makeFieldGeneral(challenger, 1)], hand: [COST(1)] }),
      makePlayer(2, { fieldGenerals: [makeFieldGeneral(makeGeneral('gD', 12), 2, 0, 'front',
        { armor: 2, currentArmor: 2 })] }),
    ], entries);
    const events = engine.dispatch(createAction('ATTACK', 1, {
      attackerId: 'gC', targetId: 'gD', ranged: false, consumeCard: COST(1),
    }));
    return {
      // 决斗里 gC 打出去的那三轮（第 1、3、5 轮）各算一次 +1。
      rounds: events.filter(e => e.type === 'DAMAGE' && typeof (e.data as any)?.duelRound === 'number')
        .filter(e => (e.data as any)?.targetId === 'gD')
        .map(e => (e.data as any)?.damageTaken),
      hpLost: 12 - (fieldOf(engine, 2, 'gD')?.currentHp ?? 0),
    };
  }

  it('决斗的每一轮各算一次 +1（用户 2026-10-14 裁的第 1 条），而近战那条腿在决斗的每一轮里一律不算', () => {
    const both = duelWith('both');
    const duelOnly = duelWith('duel_only');
    // 两条腿都在场＝决斗那三轮逐字一样的 3 点：若决斗也算"近战攻击"，这里是 4。
    expect(both.rounds).toEqual([3, 3, 3]);
    expect(duelOnly.rounds).toEqual([3, 3, 3]);
    // 而开场那一刀（不是决斗轮）在有护甲的目标上确实多吃了那 1 点⇒整场差 1 点：
    // 这一格证明"近战腿没在决斗里响"不是因为压根没给它机会，是因为场合对不上。
    expect(both.hpLost - duelOnly.hpLost).toBe(1);
    expect([duelOnly.hpLost, both.hpLost]).toEqual([10, 11]);
  });
});
