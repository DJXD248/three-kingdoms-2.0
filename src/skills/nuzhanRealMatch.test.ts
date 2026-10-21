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
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { Player } from '../store/gameStore';
import type { EngineState } from '../core/GameState';
import type { General } from '../data/generals';
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

function installBoard() {
  const engineState = makeEngineState();
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
function playScript(awaken: boolean): ScriptReadout {
  const trace: string[] = [];
  installBoard();

  /** 把"此刻欠的那一次摸牌"按玩家那条路走完。这一格有两种来路：**回合开始**摸牌，以及
   *  将领阵亡给**受方**的那一张补偿牌（`chainedConsequences` 里 DEATH 那一支，带
   *  `resumePlayerId`＝出手的那一席）。 */
  const resolvePendingDraw = () => {
    const pending = s().engineState.drawState as any;
    if (!pending) return;
    const total = Math.max(0, Math.floor(pending.totalCards ?? 0));
    if (total > 0) {
      expect(s().executeDraw(0, total), `摸牌这一步没走过去：${JSON.stringify(pending)}`).toBe(true);
    }
    if (s().drawContext) s().confirmDraw();
    expect(s().engineState.drawState, '确认之后引擎还欠着一次摸牌').toBeNull();
  };
  const passTurn = () => { s().endTurn(); resolvePendingDraw(); };

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
