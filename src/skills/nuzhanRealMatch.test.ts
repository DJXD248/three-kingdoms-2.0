/**
 * v2.9.18 附带·**怒斩第一次在一局真对局里响**。
 *
 * 与相邻几档的分工（那些档早已把机制钉死，这里一律不重做）：
 *  · `weiGuanyuContent.test.ts`＝真的卡接上真的机制，但派发走的是 `new GameEngine(…)`
 *    那台**局外的引擎**——它证明"算术对"，不证明"玩家点得到"；
 *  · 这一档补的正是那一格：**每一步都走玩家点按钮的同一条路**（`useGameStore` 的
 *    `deployGeneral`／`moveGeneral`／`attackTarget`／`armGeneral`／`endTurn`／
 *    `activateReactionSkill`／`skipReaction`），于是常驻引擎、在场账、问窗、
 *    发动公告、活录像 recorder 全在这一趟里被一起过了一遍。
 *
 * 剧本是写死的（牌堆、手牌、护甲牌全是固定 id，一骰子都不掷）⇒同一副场面跑两遍
 * （点头／摇头）只差"觉醒那一格答了什么"，于是"怒斩那一刀多掉的 1 点"有当场生成的
 * 对照组，不靠任何一处手写期望值。
 *
 * 夹具只摆一样东西：对面那两位站在**战场**（`position` 由夹具放好，因为"把敌将搬进
 * 战场"需要对面那一席花一整回合走一步，与这一档要证的事无关）。卡牌一律取
 * `data/generals.ts` 里的真官方将：出手＝魏关羽 `wei_022`，死者＝诸葛亮 `shu_004`
 * （体力 3，两枚挂名技能永不响⇒不会反噬这一档的读数），活口＝张飞 `shu_003`
 * （体力 4，同理）。护甲不是夹具里手填一个数，是真的 `EQUIP_ARMOR` 从真的军备牌装上去。
 *
 * 文件里有**两局剧本**：第一局（`playScript`）钉的是怒斩**近战对披甲者**那条腿，
 * 第二局（`playDuelScript`，在下面）钉的是**决斗**那条腿——它补的是 v2.9.18 登记在册
 * 的那半格欠账（"决斗腿证人全在既有单测、真对局那一份还没补"，改坏探针 g2 当场逮出）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { Player } from '../store/gameStore';
import type { EngineState } from '../core/GameState';
import type { General, Skill } from '../data/generals';
import type { GameCard } from '../data/cards';
import { allGenerals } from '../data/generals';
import { __resetResidentEngineContainer } from '../store/engineExecutionBridge';
import { getLiveReplayDocument, getLiveReplayEntryCount, resetLiveReplay } from '../replay/liveReplayRecorder';
import { effectiveMaxHp, type StatModifier } from '../core/statModifiers';
import { getReactionAsk } from './reactionChain';
import { skillTable } from '../data/skillTable';

const guanYu = allGenerals.find(g => g.id === 'wei_022')!;
const zhugeLiang = allGenerals.find(g => g.id === 'shu_004')!;
const zhangFei = allGenerals.find(g => g.id === 'shu_003')!;
/** 怒斩取技能表上那一枚（v2.9.7 起＝「获得技能」唯一认的名单），不是这里另抄一份。 */
const nuzhan = skillTable.find(row => row.skill.name === '怒斩')!.skill;

const GRAIN = (n: number): GameCard => ({ id: `grain_${n}`, name: '粮草', type: '粮草', description: '' });
const ARMAMENT = (n: number): GameCard => ({ id: `arm_${n}`, name: '军备', type: '军备', description: '' });

function fieldOf(general: General, ownerId: number, zone: 'camp' | 'front' | 'battle', slot: number) {
  return {
    general, currentHp: general.hp, maxHp: general.hp,
    meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk,
    armor: general.armor, currentArmor: 0, armorCards: [],
    isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId,
    position: { zone, slot, areaOwnerId: zone === 'battle' ? null : ownerId },
  };
}

/** 写死的场面：p1 手里捏着真·魏关羽与四张粮草，p2 的两位官方将在战场、手里两张军备。
 *  两边各留一员**将池里的替补**——这条不是装饰：`TurnResolver` 写的现行规则是"回合开始时
 *  将池为空⇒先结算营地扣血"（`baseLossPending`），空池会让剧本在摸牌那一格被当场拒。 */
function makeEngineState(): EngineState {
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    players: [
      {
        id: 1, name: '玩家1', hp: 10, hand: [guanYu, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(GRAIN)],
        generalPool: [allGenerals.find(g => g.id === 'wei_001')!], fieldGenerals: [], graveyard: [],
        baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
      },
      {
        id: 2, name: '玩家2', hp: 10, hand: [ARMAMENT(1), ARMAMENT(2)],
        generalPool: [allGenerals.find(g => g.id === 'shu_005')!], graveyard: [],
        baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
        fieldGenerals: [
          fieldOf(zhugeLiang, 2, 'battle', 0),
          fieldOf(zhangFei, 2, 'battle', 1),
        ],
      },
    ],
    currentPlayerId: 1, turn: 3, round: 2,
    deck: Array.from({ length: 30 }, (_, i) => ({ id: `deck_${i + 1}`, name: '粮草', type: '粮草' as const })),
    discardPile: [], drawState: null,
  } as unknown as EngineState;
}

function installBoard(engineState: EngineState = makeEngineState()) {
  useGameStore.setState({
    players: engineState.players as unknown as Player[],
    currentPlayerIndex: 0, currentRound: 2, phase: 'playing', turnPhase: 'main',
    isTestMode: false, winnerId: null,
    engineState,
    cardDeck: engineState.deck as GameCard[],
    discardPile: engineState.discardPile as GameCard[],
    turnEndAsk: null, reactionWindow: null, skillActivations: [],
    drawContext: null, revealedDrawCards: [], gameOverBanner: null,
    defeatEvent: null, pendingTurnTransition: null,
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

const s = () => useGameStore.getState();
const seat = (playerId: number) =>
  s().engineState.players.find(p => p.id === playerId) as any;
const onField = (playerId: number, generalId: string) =>
  (seat(playerId)?.fieldGenerals ?? []).find((f: any) => f?.general?.id === generalId);
/** 当前该动手的那一席（＝界面上"现在轮到谁"那一格）：剧本每走一步都复述它，
 *  这样"回合到底交出去没有"是断言，不是我以为。 */
const whoActs = () => s().engineState.currentPlayerId;

interface ScriptReadout {
  /** 每一步读数串起来（失败时一眼看出卡在第几步）。 */
  trace: string[];
  ledger: readonly StatModifier[];
}

/**
 * 六步剧本：满血登场→上前线→砍诸葛亮一刀→（过一回合）给张飞披甲→（过一回合）再砍诸葛亮＝
 * 近战击杀战场里的角色⇒问「单骑」→答完（点头觉醒／摇头放弃）→（过两回合）→砍披甲的张飞。
 *
 * 两处"玩家点得出、抄近路点不出"的顺序，剧本照引擎那一遍走：
 *  · **过一回合**＝`endTurn` 之后引擎把下一席放进摸牌阶段（`drawState`＋`drawContext`），
 *    在那里点确认才进到出牌阶段；不确认就砍下一刀，那一刀是"摸牌阶段里砍出去的"；
 *  · **击杀那一格**同时留下两笔欠账——问窗（「单骑」）与给受方的那张补偿牌，而引擎在问窗
 *    没答完时把别的动作一律 `REACTION_PENDING` 拒回（连摸牌也一样）⇒先答话、再摸牌。
 */
/**
 * 把"此刻欠的那一次摸牌"按玩家那条路走完。这一格有两种来路：**回合开始**摸牌，以及
 * 将领阵亡给**受方**的那一张补偿牌（`chainedConsequences` 里 DEATH 那一支，带
 * `resumePlayerId`＝出手的那一席）。两局剧本共用这一句，所以它在模块层只有一份。
 */
function resolvePendingDraw() {
  const pending = s().engineState.drawState as any;
  if (!pending) return;
  const total = Math.max(0, Math.floor(pending.totalCards ?? 0));
  if (total > 0) {
    expect(s().executeDraw(0, total), `摸牌这一步没走过去：${JSON.stringify(pending)}`).toBe(true);
  }
  if (s().drawContext) s().confirmDraw();
  expect(s().engineState.drawState, '确认之后引擎还欠着一次摸牌').toBeNull();
}
function passTurn() { s().endTurn(); resolvePendingDraw(); }

function playScript(awaken: boolean): ScriptReadout {
  const trace: string[] = [];
  installBoard();

  // ① 登场（营地槽只有 0 与 2 两格，slot 1 是中格那一条旧账）。
  // 现行规则：登场垫几张牌＝这位将领当前几点体力（上限仍是卡面 4）⇒这里垫满 4 张，
  // 让他带着满血上场，"觉醒把上限削 1、当前体力跟着截回来"才量得出来。
  expect(s().deployGeneral(guanYu, 0, [GRAIN(1), GRAIN(2), GRAIN(3), GRAIN(4)])).toBe(true);
  // 「在场即生效」的补笔就在登场这一刻落：武圣那笔远程 +1 是账本给的，不是卡面印的。
  const wusheng = (s().engineState.statModifiers ?? []).filter(e => e.ownerSkillName === '武圣');
  expect(wusheng.map(e => [e.key, e.value])).toEqual([['RANGED_ATK', 1]]);
  expect(onField(1, guanYu.id).currentHp).toBe(4);
  trace.push(`deploy:武圣账=${wusheng.length}/血${onField(1, guanYu.id).currentHp}`);

  // ② 营地→前线一步（武将移动不吃牌）：不挪这一步，近战压根够不着战场（差 2 档）。
  s().moveGeneral(guanYu.id, { zone: 'front', slot: 0, areaOwnerId: 1 });
  expect(onField(1, guanYu.id).position.zone).toBe('front');
  trace.push('move:到前线');

  // ③ 第一刀：近战 2 点（武圣只加远程，这一刀与没武圣时同数）⇒诸葛亮 3→1。
  s().attackTarget(guanYu.id, zhugeLiang.id, false, GRAIN(5));
  expect(onField(2, zhugeLiang.id).currentHp).toBe(1);
  trace.push(`砍一:剩${onField(2, zhugeLiang.id).currentHp}`);

  // ④ 对面那一席：真的 EQUIP_ARMOR 装 2 点护甲（护甲容量读的是体力上限，张飞 4 够放）。
  passTurn();
  expect(whoActs()).toBe(2);
  expect(s().armGeneral(zhangFei.id, [ARMAMENT(1), ARMAMENT(2)])).toBe(true);
  expect(onField(2, zhangFei.id).currentArmor).toBe(2);
  trace.push('披甲:2');

  // ⑤ 回到这一席，第二刀＝近战击杀战场里的角色⇒单骑三格门槛全中⇒欠的那一格是「单骑」。
  passTurn();
  expect(whoActs()).toBe(1);
  s().attackTarget(guanYu.id, zhugeLiang.id, false, GRAIN(6));
  // 击杀一次派发同时留下**两格欠账**：问窗（「单骑」）与给**受方**的那张补偿牌。
  // 引擎在这里的现行规矩是问窗没答完⇒别的动作一律 `REACTION_PENDING` 拒回（连摸牌也一样），
  // 所以界面上玩家必然先点「单骑」那一句，补偿牌那一格排在后面——剧本照这个顺序走。
  const ask = getReactionAsk(s().engineState);
  expect(ask?.options.map(o => o.skillName), '三格全中却没问「单骑」').toEqual(['单骑']);
  const asked = ask!.options.map(o => o.skillName).join('/');
  const answered = awaken
    ? s().activateReactionSkill(ask!.options[0].skillId, ask!.generalId)
    : s().skipReaction();
  expect(answered, '问窗里那一格答不下去').toBe(true);
  resolvePendingDraw();
  expect(whoActs(), '补偿牌摸完该回到出手这一席').toBe(1);
  trace.push(`击杀:问=${asked}→${awaken ? '点头' : '摇头'}`);

  // ⑥ 过两回合（同一回合不许连击⇒这一刀是"觉醒之后"的第一刀），再砍披甲的张飞。
  passTurn();
  passTurn();
  expect(whoActs()).toBe(1);
  const hpBefore = onField(2, zhangFei.id).currentHp;
  s().attackTarget(guanYu.id, zhangFei.id, false, GRAIN(7));
  const armorLeft = onField(2, zhangFei.id).currentArmor;
  const hpLost = hpBefore - onField(2, zhangFei.id).currentHp;
  trace.push(`砍二:掉血${hpLost}/甲${armorLeft}`);

  return { trace, ledger: s().engineState.statModifiers ?? [] };
}

describe('怒斩·真对局剧本（走玩家点按钮那条路）', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });
  afterEach(() => {
    resetLiveReplay();
    __resetResidentEngineContainer();
  });

  it('点头这一局：觉醒→卡面长出怒斩→在场账补上→那一刀真的多吃 1 点，且这一切都进了本局录像', () => {
    const { trace, ledger } = playScript(true);
    const guan = onField(1, guanYu.id);

    // 卡面：三枚技能，怒斩＝技能表上交出来的那一枚（逐字相同）。
    expect(guan.general.skills.map((x: any) => x.name)).toEqual(['武圣', '单骑', '怒斩']);
    expect(guan.general.skills[2]).toEqual(nuzhan);
    // 上限被削 1、当前体力跟着截回来（卡面印刷值一字不改，削的是账本）。
    expect(guan.maxHp).toBe(4);
    expect(guan.currentHp).toBe(3);
    expect(effectiveMaxHp(ledger, { playerId: 1, generalId: guanYu.id }, guan)).toBe(3);

    // 在场账：怒斩那两笔（决斗／近战对有护甲者）在觉醒这一刻补齐，挂在关羽身上。
    const dealt = ledger.filter(e => e.key === 'DAMAGE_DEALT');
    expect(dealt.map(e => e.occasion)).toEqual(['duel', 'meleeVsArmored']);
    expect(dealt.every(e => e.targetId === guanYu.id)).toBe(true);
    // 额度：单骑这一局只响过一次。
    expect(s().engineState.consumedSkills?.map(q => q.limitKey)).toContain('wei_022:单骑');

    // 算术：近战 2 ＋怒斩 1 ＝ 3 点进护甲；护甲 2 挡 1 点⇒掉 2 点血、甲归零。
    expect(trace[trace.length - 1]).toBe('砍二:掉血2/甲0');

    // 这一局是"真在跑的那一局"：活录像里既有一刀砍张飞的 ATTACK，也有答单骑那一次表态。
    const doc = getLiveReplayDocument();
    expect(doc).not.toBeNull();
    expect(getLiveReplayEntryCount()).toBeGreaterThan(0);
    // 玩家亲手点完那一句，界面上也要飘出一声"谁发动了什么"（公告与强制发动共用同一处生产，
    // `store/activationNotices.ts`）；这一格要是断了，剧本里剩下的全是账、玩家什么也看不见。
    expect(s().skillActivations.map(a => a.skillName), '点完「单骑」没有发动公告').toContain('单骑');
    // 记进录像的那一刀：进账 3 点（近战 2 ＋怒斩 1）、身上掉 2 点血（护甲 2 挡掉 1 点）。
    const killBlow = doc!.entries.filter(e => e.action.type === 'ATTACK')
      .find(e => e.events.some(ev => ev.type === 'DAMAGE'
        && (ev.data as any)?.targetId === zhangFei.id
        && (ev.data as any)?.damageTaken === 3 && (ev.data as any)?.hpLost === 2));
    expect(killBlow, `录像里找不到"掉 2 点血那一刀"：${trace.join(' | ')}`).toBeTruthy();
    expect(doc!.entries.some(e => e.action.type === 'ACTIVATE_SKILL'
      && (e.action.payload as any)?.skillId === 'wei_022:单骑:chain')).toBe(true);
  });

  it('摇头这一局：账本没有怒斩那一刀、上限不动，砍同一格少掉 1 点血（对照组当场生成）', () => {
    const { trace, ledger } = playScript(false);
    const guan = onField(1, guanYu.id);
    expect(guan.general.skills.map((x: any) => x.name)).toEqual(['武圣', '单骑']);
    expect(guan.currentHp).toBe(4);
    expect(effectiveMaxHp(ledger, { playerId: 1, generalId: guanYu.id }, guan)).toBe(4);
    // 武圣那一笔仍在（它跟的是"在场"，不是"觉醒"），怒斩那两笔一笔都没有。
    expect(ledger.filter(e => e.key === 'DAMAGE_DEALT')).toEqual([]);
    expect(s().engineState.consumedSkills?.map(q => q.limitKey) ?? []).not.toContain('wei_022:单骑');
    // 摇头那一局也不许飘"单骑发动了"——公告只跟着真发动的那一次。
    expect(s().skillActivations.map(a => a.skillName)).not.toContain('单骑');
    // 同一条剧本、同一格护甲、同一把近战 2：护甲 2 挡 1 点⇒只掉 1 点血。
    expect(trace[trace.length - 1]).toBe('砍二:掉血1/甲0');
    // 对照组也进了录像：那一刀进账 2 点（没有怒斩那 1 点）、身上掉 1 点。
    expect(getLiveReplayDocument()?.entries.some(e => e.action.type === 'ATTACK'
      && e.events.some(ev => ev.type === 'DAMAGE'
        && (ev.data as any)?.targetId === zhangFei.id
        && (ev.data as any)?.damageTaken === 2 && (ev.data as any)?.hpLost === 1))).toBe(true);
  });

  it('两局之差正好是怒斩那 1 点：除"答了哪一句"以外，剧本每一步的读数逐字同轨', () => {
    const yes = playScript(true);
    const no = playScript(false);
    // 逐轨对照：登场／挪位／砍一刀／披甲四格两局逐字一样，最后一格只差那 1 点伤害；
    // 唯一被"答了什么"改写的就是击杀那一格（点头＝接了「单骑」，摇头＝拒了）。
    expect(yes.trace.length).toBe(no.trace.length);
    expect(yes.trace.slice(0, 4)).toEqual(no.trace.slice(0, 4));
    expect(yes.trace[4]).toContain('点头');
    expect(no.trace[4]).toContain('摇头');
    const hpLost = (line: string) => Number(line.match(/掉血(\d)/)?.[1]);
    expect(
      hpLost(yes.trace.at(-1)!) - hpLost(no.trace.at(-1)!),
    ).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 第二局剧本：怒斩的**决斗**那条腿（v2.9.18 登记的挂账＝"决斗腿证人全在既有单测、
// 真对局那一份还没补"，本轮销掉那一格）。
// ══════════════════════════════════════════════════════════════════════════

/**
 * 决斗入场券。官方池到今天还没有会挑决斗的卡（v2.9.6 登记在册的那一格），所以这一局
 * 的"开战"用一枚合成件「搦战」钉在对面那一员身上——形状逐字取 `weiGuanyuContent.test.ts`
 * 里那枚（A 侧先手＝技能拥有者、B 侧＝他刚打中的那一位）。
 *
 * **它只负责把决斗开起来**：账上那两笔 +1 全是真怒斩编译出来的，走的还是"近战击杀
 * 战场角色→问「单骑」→点头→获得技能→在场补账"那条真路；关羽那一张卡面一个字没改。
 *
 * 为什么这一局要绕到"由对面来挑衅"：那一腿要证的两句是「决斗里也多吃 1 点」＋
 * 「决斗不算近战攻击⇒不会多吃 2 点」，两句都要求**决斗对手身上还带着护甲**（护甲在场，
 * "近战"那条腿才有资格被误算进来）。而决斗是"造成伤害后"开起来的——如果由关羽动手，
 * 他那一刀必然先把对面的甲啃光（2 甲只挡 1 点），开场时就什么都测不出来了。
 * ⇒ 让披甲的那一位先去砍关羽一刀：那一刀的伤害落在**关羽自己的甲**上（文将近战 1 点，
 * 被 2 点甲整口吃掉），对面的甲一根没动，决斗开起来时正披着 2 点。
 */
const PROVOKE_DUEL: Skill = {
  name: '搦战',
  description: '你造成伤害后，你可以与目标角色决斗。',
  trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
    runtime: { type: 'DUEL', target: 'TARGET' },
  }],
};

/**
 * 决斗局的场面：p1 手里是魏关羽＋粮草＋两张军备（关羽自己披甲用），p2 那两位预摆在
 * 战场——张飞（挨两刀、给「单骑」那个人头）与**披甲的诸葛亮**（决斗对手，卡面上多一枚
 * 合成件「搦战」）。
 *
 * 卡片一律现拷一份，为的是这一档不依赖别处的实现细节：「获得技能」那一步是 spread 生成
 * 新对象、不改共用的那张卡（`core/eventProcessors/generalEvents.ts`），所以两局本来互不
 * 串味——而"不串味"这件事在本档里是**读数**，不是我记得那句代码：摇头那一局的账上
 * `DAMAGE_DEALT` 必须一笔都没有（两处在钉这一格），点头那一局必须是那两笔都在。
 */
function makeDuelEngineState(): EngineState {
  const guanCard: General = { ...guanYu, skills: guanYu.skills.map(s => ({ ...s })) };
  const zhugeCard: General = {
    ...zhugeLiang,
    skills: [...zhugeLiang.skills.map(s => ({ ...s })), { ...PROVOKE_DUEL }],
  };
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    players: [
      {
        id: 1, name: '玩家1', hp: 10,
        hand: [guanCard, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(GRAIN), ARMAMENT(1), ARMAMENT(2)],
        generalPool: [allGenerals.find(g => g.id === 'wei_001')!], fieldGenerals: [], graveyard: [],
        baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
      },
      {
        id: 2, name: '玩家2', hp: 10,
        hand: [ARMAMENT(3), ARMAMENT(4), GRAIN(20), GRAIN(21)],
        generalPool: [allGenerals.find(g => g.id === 'shu_005')!], graveyard: [],
        baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
        fieldGenerals: [
          fieldOf(zhangFei, 2, 'battle', 0),
          fieldOf(zhugeCard, 2, 'battle', 1),
        ],
      },
    ],
    currentPlayerId: 1, turn: 3, round: 2,
    deck: Array.from({ length: 30 }, (_, i) => ({ id: `deck_${i + 1}`, name: '粮草', type: '粮草' as const })),
    discardPile: [], drawState: null,
  } as unknown as EngineState;
}

interface DuelReadout extends ScriptReadout {
  /** 关羽在决斗里打出去的那几轮（逐轮事件原样留着，期望值一律不手写）。 */
  rounds: Array<Record<string, any>>;
  /** 决斗里"造成伤害"那一格销掉的笔数——怒斩是**在场**那型，不该被销。 */
  dealtRemoves: number;
  /** 决斗打完时关羽身上的怒斩两笔（场合）。 */
  occasions: string[];
  /** 决斗打完时场上活着的两位：关羽的体力、诸葛亮是否还在场。 */
  guanHp: number;
  zhugeAlive: boolean;
}

/**
 * 八步剧本（每一步都走玩家点按钮那条路）：
 * ① 登场→② 上前线→③ 关羽自己披 2 甲→（换席）④ 诸葛亮披 2 甲→（换席）⑤ 砍张飞一刀
 * →（换席）⑥ 再砍一刀＝近战击杀战场角色⇒问「单骑」→答（点头觉醒／摇头放弃）
 * →（换席）⑦ 诸葛亮砍关羽一刀：1 点被甲整口吃掉、甲归零，而**「造成伤害后」问出「搦战」**
 * →点头⇒决斗开起来，逐轮就是这一档要读的那几格。
 *
 * 为什么关羽先挨那一刀不吃体力：文将近战 1 点，2 点甲挡 1 点（`core/armorDamage.ts`
 * 那一句"2 甲换 1 点"），所以体力原样不动——决斗里双方各有三轮的额度，关羽若先掉血
 * 就会在第 3 轮倒下，证人只剩一轮。
 */
function playDuelScript(awaken: boolean): DuelReadout {
  const trace: string[] = [];
  installBoard(makeDuelEngineState());

  // ① 登场（垫 4 张＝当前 4 点体力⇒满血上场，觉醒那"削 1"才量得出来）。
  const guanCard = seat(1).hand[0] as unknown as General;
  expect(s().deployGeneral(guanCard, 0, [GRAIN(1), GRAIN(2), GRAIN(3), GRAIN(4)])).toBe(true);
  expect(onField(1, guanCard.id).currentHp).toBe(4);
  trace.push('deploy:血4');

  // ② 营地→前线（近战够着战场那一格）。
  s().moveGeneral(guanCard.id, { zone: 'front', slot: 0, areaOwnerId: 1 });
  expect(onField(1, guanCard.id).position.zone).toBe('front');
  trace.push('move:到前线');

  // ③ 关羽披 2 甲（整备中的将领这一回合不许再动手，所以砍人排在后面的回合）。
  expect(s().armGeneral(guanCard.id, [ARMAMENT(1), ARMAMENT(2)])).toBe(true);
  expect(onField(1, guanCard.id).currentArmor).toBe(2);
  trace.push('关羽披甲:2');

  // ④ 对面那一席：诸葛亮相真正的军备披 2 甲——**这一格的甲要一路留到决斗开场**。
  passTurn();
  expect(whoActs()).toBe(2);
  expect(s().armGeneral(zhugeLiang.id, [ARMAMENT(3), ARMAMENT(4)])).toBe(true);
  expect(onField(2, zhugeLiang.id).currentArmor).toBe(2);
  trace.push('亮披甲:2');

  // ⑤ 这一席：砍张飞第一刀（近战 2 点，此刻还没有怒斩⇒觉醒前后这一格读数一样）。
  passTurn();
  expect(whoActs()).toBe(1);
  s().attackTarget(guanCard.id, zhangFei.id, false, GRAIN(5));
  expect(onField(2, zhangFei.id).currentHp).toBe(2);
  trace.push('砍一:张飞剩2');

  // ⑥ 再砍一刀＝近战击杀战场里的角色⇒「单骑」三格全中⇒问那一句。
  passTurn();
  expect(whoActs()).toBe(2);
  passTurn();
  expect(whoActs()).toBe(1);
  s().attackTarget(guanCard.id, zhangFei.id, false, GRAIN(6));
  const awakenAsk = getReactionAsk(s().engineState);
  expect(awakenAsk?.options.map(o => o.skillName), '近战击杀却没问「单骑」').toEqual(['单骑']);
  expect(awakenAsk
    ? (awaken
      ? s().activateReactionSkill(awakenAsk.options[0].skillId, awakenAsk.generalId)
      : s().skipReaction())
    : false, '「单骑」那一句答不下去').toBe(true);
  resolvePendingDraw();
  trace.push(`击杀:单骑→${awaken ? '点头' : '摇头'}`);

  // ⑦ 对面那一席动手砍关羽：那一刀的意义是"把决斗开起来"，伤害本身被甲吃掉。
  passTurn();
  expect(whoActs()).toBe(2);
  const hpBeforeProvoke = onField(1, guanCard.id).currentHp;
  s().attackTarget(zhugeLiang.id, guanCard.id, false, GRAIN(20));
  expect(onField(1, guanCard.id).currentHp, '文将那一刀本该被 2 点甲整口吃掉').toBe(hpBeforeProvoke);
  expect(onField(1, guanCard.id).currentArmor, '甲挡了 1 点就该归零').toBe(0);
  const duelAsk = getReactionAsk(s().engineState);
  expect(duelAsk?.options.map(o => o.skillName), '造成伤害后却没问「搦战」').toEqual(['搦战']);
  expect(s().activateReactionSkill(duelAsk!.options[0].skillId, duelAsk!.generalId),
    '「搦战」那一句答不下去').toBe(true);
  trace.push(`挑衅:甲挡1→决斗开·关羽血${onField(1, guanCard.id).currentHp}`);

  // 决斗的逐轮就在"答完那句「搦战」"那一次派发里落进事件流⇒从**活录像**读，不抄引擎内部。
  const doc = getLiveReplayDocument();
  expect(doc, '决斗这一局没进活录像').not.toBeNull();
  const flat = doc!.entries.flatMap(entry => entry.events as Array<Record<string, any>>);
  const rounds = flat
    .filter(ev => ev.type === 'DAMAGE'
      && typeof (ev.data as any)?.duelRound === 'number'
      && (ev.data as any)?.sourceGeneralId === guanCard.id)
    .map(ev => ev.data as Record<string, any>);
  const dealtRemoves = flat.filter(ev => ev.type === 'STAT_MODIFY'
    && (ev.data as any)?.cause === 'DAMAGE_DEALT').length;
  resolvePendingDraw();

  const ledger = s().engineState.statModifiers ?? [];
  return {
    trace,
    ledger,
    rounds,
    dealtRemoves,
    occasions: ledger.filter(e => e.key === 'DAMAGE_DEALT').map(e => String(e.occasion)),
    guanHp: Number(onField(1, guanCard.id)?.currentHp ?? 0),
    zhugeAlive: Boolean(onField(2, zhugeLiang.id)),
  };
}

describe('怒斩·决斗腿的真对局剧本（第二局：由对面挑衅开起来的那场决斗）', () => {
  beforeEach(() => {
    __resetResidentEngineContainer();
    resetLiveReplay();
  });
  afterEach(() => {
    resetLiveReplay();
    __resetResidentEngineContainer();
  });

  it('点头这一局：决斗里关羽打出去的每一轮都真的多吃 1 点（近战 2＋决斗 1＝3 点进甲）', () => {
    const { trace, rounds, dealtRemoves, occasions, zhugeAlive } = playDuelScript(true);
    // **读数证人排在结构证人前面**（探针逐条点名两档失败形态，不靠"少打了一轮"这种间接症状）：
    // 把决斗也算成近战攻击＝两腿各 +1（用户 2026-10-08 明确撤回过的那种算法）时，关羽第一拳
    // 就把诸葛亮打死，若先判轮次结构，红的是"[2] 不等于 [2,4]"；先判这一格，红的才是 4 点本身。
    expect(rounds[0]?.damageTaken, trace.join(' | ')).toBe(3);
    // 决斗真开起来了，而关羽那几轮＝第 2、4 轮（A 侧先手恒为「搦战」的拥有者＝诸葛亮）。
    expect(rounds.map(r => r.duelRound)).toEqual([2, 4]);
    // 两条腿都在账上、都挂在关羽身上（在场那型⇒决斗打完还在，见下面 occasions）。
    expect(occasions.sort()).toEqual(['duel', 'meleeVsArmored']);
    // 对手身上有 2 点甲，而每一轮的读数＝3 点：不是 2（决斗腿没响＝探针 A）
    // 也不是 4（把决斗当近战攻击＝探针 B）。
    expect(rounds.map(r => r.damageTaken)).toEqual([3, 3]);
    // 原始伤害那一格照旧是卡面 2 点——+1 是"造成伤害"那一格给的，不写进 `value`。
    expect(rounds.map(r => r.value)).toEqual([2, 2]);
    // 第 2 轮＝3 点进 2 点甲：甲挡 1 点⇒掉 2 点血（诸葛亮 3→1）、甲归零。
    expect([rounds[0].newHp, rounds[0].newArmor]).toEqual([1, 0]);
    // 第 4 轮甲已经空了⇒3 点全落到身上＝诸葛亮离场（决斗打到第 4 轮收场）。
    expect(rounds[1].newHp).toBeLessThanOrEqual(0);
    expect(zhugeAlive, '决斗里阵亡的那一位不该还在场').toBe(false);
    // 在场那笔**不被决斗销掉**：逐轮一条 `STAT_MODIFY{REMOVE}` 都不该有。
    expect(dealtRemoves, '怒斩是"在场即生效"，决斗里没有可销的一次性账').toBe(0);
  });

  it('摇头这一局＝当场生成的对照组：同一场决斗、同一格护甲，每一轮少那 1 点', () => {
    const { trace, rounds, occasions, zhugeAlive } = playDuelScript(false);
    // 卡面没长出怒斩⇒账上"造成伤害"那一格一笔都没有（对照组不是我以为，是量出来的）。
    expect(occasions, trace.join(' | ')).toEqual([]);
    expect(rounds.map(r => r.duelRound)).toEqual([2, 4]);
    expect(rounds.map(r => r.damageTaken)).toEqual([2, 2]);
    // 第 2 轮＝2 点进 2 点甲：甲挡 1 点⇒只掉 1 点血（诸葛亮 3→2），第 4 轮补 2 点正好清空。
    expect([rounds[0].newHp, rounds[0].newArmor]).toEqual([2, 0]);
    expect(rounds[1].newHp).toBeLessThanOrEqual(0);
    expect(zhugeAlive).toBe(false);
  });

  it('两局逐轨对照：决斗的轮次结构一字不差，每一轮之差恰好 1 点', () => {
    const yes = playDuelScript(true);
    resetLiveReplay();
    const no = playDuelScript(false);
    // 除"答了哪一句"以外，前面每一格的读数逐字同轨（登场／挪位／披甲／亮披甲／砍一）。
    expect(yes.trace.slice(0, 5)).toEqual(no.trace.slice(0, 5));
    expect(yes.trace[5]).toContain('点头');
    expect(no.trace[5]).toContain('摇头');
    // 摇头那一局不许沾上点头那一局长出来的东西：账上"造成伤害"那一格必须一笔都没有。
    // （获得技能那一步走的是 spread 生成新对象、不改共用的那张卡，所以两局本来互不串味；
    // 这一格把这件事钉成**读数**，而不是靠谁记着那句实现。）
    expect(no.ledger.filter(e => e.key === 'DAMAGE_DEALT'), '对照组沾上了点头那局才有的账')
      .toEqual([]);
    // 轮次结构相同＝差的那 1 点不是"打了更多轮"换来的。
    expect(yes.rounds.map(r => r.duelRound)).toEqual(no.rounds.map(r => r.duelRound));
    expect(yes.rounds.map(r => r.damageTaken))
      .toEqual(no.rounds.map(r => Number(r.damageTaken) + 1));
    // 关羽自己：挨的每一刀都是 1 点、两局一样多，所以两局体力之差恰好是觉醒削掉的那 1 点上限。
    expect(yes.guanHp + 1).toBe(no.guanHp);
  });
});
