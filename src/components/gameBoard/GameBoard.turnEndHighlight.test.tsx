/**
 * 乙 线末片第二刀·拍 3 ㈂（2026-11-06）＝**场地那三态高亮＋点将详情**的证人。
 *
 * 这一格要钉的是四句，每句都落在可执行的判据上：
 *
 *  ㈁ 蓝＝清单里且 `activatable` 的那一格，复用既有那一串 `animate-pulse ring-2 ring-cyan-400`（会闪）。
 *  ㈂ 黄＝清单里但不可发动的那一格，`ring-2 ring-amber-400` 且**不闪**；那句话只能逐字来自候选账的
 *     `disabledReason`（`skills/turnEndSkills.ts` 的 `disabledReasonOf` 原文），界面一份都没写。
 *  ㈃ 不相关＝既不进蓝也不进黄，且 `onClick` 不走既有的 `clickFg`（问窗开着时点它不进详情）。
 *  ㈄ 黄框只在「完整」档出：智能档那份清单**根本没有**不可发动的条目（唯一的分档处
 *     `engineSteps.ts:291 visibleTurnEndAskItems` 滤掉了），界面自始至终没读档位。
 *
 * 夹具是**真读数**：候选账由生产那一条 `gameStore.endTurn`（开窗）＋`activateTurnEndSkill`（用掉一枚，
 * 于是它从蓝转黄、原因＝「本回合已发动过」）算出来，条目 id 逐条钉死——不拿"第一个满足某条件的
 * 条目"当夹具（v2.9.33 在册教训：那是把名册内容当隐式输入）。
 *
 * 计时器一位不碰：本文件没有任何 `vi.useFakeTimers`，也不把任何定时器挂进
 * `GameBoard.tsx` 那组故意不做 cleanup 的受击闪红计时器。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import GameBoard from '../GameBoard';
import { useGameStore, type Player } from '../../store/gameStore';
import type { General } from '../../data/generals';
import type { EngineState } from '../../core/GameState';
import { __resetResidentEngineContainer } from '../../store/engineExecutionBridge';
import { resetLiveReplay } from '../../replay/liveReplayRecorder';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 剥掉注释之后的生产源码（与 `tableCompute.test.ts`、`askClock.test.ts` 同一条剥法），
 * 再把换行符归一化——本机工作副本是 LF、`core.autocrlf=true`，证人不能认死某一种换行。
 * ⚠️ 这一步不是洁癖：`GameBoard.tsx` 的注释里**逐字写了** `settings.skillPromptMode` 那几个字
 * （说清楚界面为什么不必读档位），注释没剥干净，下面那枚档位钉就红。
 */
function codeOfGameBoard(): string {
  return readFileSync(path.join(here, '../GameBoard.tsx'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** 一枚回合结束技能（可发动）：与 `gameStore.turnEndAsk.test.ts` 那一份同形状，名字各用一枚。 */
function turnEndGeneral(id: string, skillName: string): General {
  return {
    id, instanceId: id, name: `将${id}`, faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0,
    skills: [{
      name: skillName,
      description: '回合结束时可发动',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    }],
  } as unknown as General;
}

/** 有技能、但不是回合结束那一格 ⇒ 在问窗里就是"不相关"的那一枚（不是没技能的那一枚）。 */
function otherTriggerGeneral(id: string, skillName: string): General {
  return {
    id, instanceId: id, name: `将${id}`, faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0,
    skills: [{
      name: skillName,
      description: '回合开始时可发动',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnStart', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    }],
  } as unknown as General;
}

/**
 * 三枚场上将领的固定名册（顺序＝前线槽 0/1/2）：
 * `g_blue`＝守夜（这一拍仍可发动⇒蓝）、`g_yellow`＝察更（开窗后被真发动用掉⇒黄）、
 * `g_none`＝蓄锐（回合开始技能，压根不进这份清单⇒不相关）。
 */
function roster(): General[] {
  return [turnEndGeneral('g_blue', '守夜'), turnEndGeneral('g_yellow', '察更'), otherTriggerGeneral('g_none', '蓄锐')];
}

function seatPlayer(id: number, name: string, generals: General[]): Player {
  return {
    id, name, faction: '魏', seatOrder: id, diceRoll: 10 + id,
    hand: [], generalPool: [], graveyard: [],
    baseHp: 6, baseMaxHp: 6, isAlive: true, isSpectating: false, avatarGeneral: null,
    statuses: [], isAi: false,
    fieldGenerals: generals.map((general, slot) => ({
      general, currentHp: general.hp, maxHp: general.hp,
      meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk, armor: 0, currentArmor: 0,
      armorCards: [], isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false,
      justDeployed: false, ownerId: id, position: { zone: 'front', slot, areaOwnerId: id },
    })),
  } as unknown as Player;
}

/** 把这份名册装进生产 store（展示面与引擎读数同一份引用＝生产镜像口径），并定好档位。 */
function installTable(mode: 'smart' | 'full') {
  const first = seatPlayer(1, '甲', roster());
  const second = seatPlayer(2, '乙', []);
  const engineState = {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    currentPlayerId: 1, turn: 5, round: 3, isFirstTurn: false,
    players: [first, second],
    deck: [
      { id: 'deck_1', name: '粮草', type: '粮草' },
      { id: 'deck_2', name: '材料', type: '材料' },
      { id: 'deck_3', name: '军备', type: '军备' },
      { id: 'deck_4', name: '粮草', type: '粮草' },
    ],
    discardPile: [], drawState: null, statModifiers: [],
    rngState: { s: 20261106 },
  } as unknown as EngineState;
  act(() => {
    useGameStore.setState({
      phase: 'playing', turnPhase: 'main', playerCount: 2, isTestMode: false,
      winnerId: null, gameOverBanner: null, defeatEvent: null,
      engineState, players: [first, second], currentPlayerIndex: 0, currentRound: 3,
      cardDeck: engineState.deck as never, discardPile: [] as never,
      turnEndAsk: null, reactionWindow: null, pendingChoice: null,
      pendingTurnTransition: null, drawContext: null, revealedDrawCards: [], skillActivations: [],
      settings: { ...useGameStore.getState().settings, skillPromptMode: mode },
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });
}

const get = () => useGameStore.getState();

/** 开窗（生产那一条 `endTurn`＝真分档、真候选账），再真发动 `g_yellow` 那一枚⇒它由蓝转黄。 */
function openWindowAndConsumeYellow() {
  get().endTurn();
  const ask = get().turnEndAsk;
  expect(ask, '人类席有两枚可发动的回合结束技能⇒该开窗').not.toBeNull();
  // 钉条目 id（开窗那一刻两枚都还亮）：这是真读数，不是界面自己扫的。
  expect(ask!.candidates.map(candidate => candidate.skillId)).toEqual(['g_blue:守夜:e1', 'g_yellow:察更:e1']);
  expect(get().activateTurnEndSkill('g_yellow:察更:e1', 'g_yellow')).toBe(true);
  return get().turnEndAsk!;
}

/** 场上那一格：槽里的文字是 `⚔️将<id>`＋体力，问窗面板里那几枚的文案是 `⚡ 将<id>【…】`，前缀分得开。 */
function slotButton(container: HTMLElement, generalId: string): HTMLButtonElement {
  const hits = [...container.querySelectorAll('button')]
    .filter(b => (b.textContent ?? '').includes(`⚔️将${generalId}`));
  expect(hits, `场上「将${generalId}」那格应当恰好一枚，实测 ${hits.length} 枚`).toHaveLength(1);
  return hits[0]!;
}
const cls = (container: HTMLElement, generalId: string) => slotButton(container, generalId).className;
const amberCount = (container: HTMLElement) => container.querySelectorAll('[class*="ring-amber-400"]').length;
/** 详情面板开没开＝那扇模态自己的「关闭」钮在不在（面板正文里另有「都不发动」等钮，不靠它们认）。 */
const detailOpen = (container: HTMLElement) =>
  [...container.querySelectorAll('button')].some(b => (b.textContent ?? '').trim() === '关闭');
const panelText = (container: HTMLElement) => {
  const close = [...container.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === '关闭')!;
  return (close.closest('div.fixed')?.textContent ?? '');
};
const click = (container: HTMLElement, generalId: string) =>
  act(() => { fireEvent.click(slotButton(container, generalId)); });

beforeEach(() => {
  __resetResidentEngineContainer();
  resetLiveReplay();
});
afterEach(cleanup);

describe('乙 拍 3 ㈂ 场地三态高亮：蓝＝可发动那一格（复用既有青框、会闪）', () => {
  it('蓝框挂在清单里且 activatable 的那一格上，且同一格一位不沾黄', () => {
    installTable('full');
    const ask = openWindowAndConsumeYellow();
    expect(ask.candidates.map(candidate => `${candidate.skillId}:${candidate.activatable ? '蓝' : '黄'}`))
      .toEqual(['g_blue:守夜:e1:蓝', 'g_yellow:察更:e1:黄']);

    const { container } = render(<GameBoard />);
    expect(cls(container, 'g_blue')).toContain('animate-pulse ring-2 ring-cyan-400');
    expect(cls(container, 'g_blue')).not.toContain('ring-amber-400');
  });
});

describe('乙 拍 3 ㈂ 场地三态高亮：黄＝清单里但不可发动（琥珀框、不闪）', () => {
  it('黄框只在真转过灰的那一格上：有 ring-2 ring-amber-400、不闪、也不进蓝', () => {
    installTable('full');
    const ask = openWindowAndConsumeYellow();
    // 前提自证：这句原因是候选账给的原文，界面没有第二份句子（测试里出现的这一句只用来比对）。
    expect(ask.candidates.find(candidate => candidate.generalId === 'g_yellow')!.disabledReason).toBe('本回合已发动过');

    const { container } = render(<GameBoard />);
    expect(cls(container, 'g_yellow')).toContain('ring-2 ring-amber-400');
    expect(cls(container, 'g_yellow')).not.toContain('animate-pulse');
    expect(cls(container, 'g_yellow')).not.toContain('ring-cyan-400');
  });
});

describe('乙 拍 3 ㈂ 场地三态高亮：不相关＝既不亮也不进详情', () => {
  it('有技能但不是这一格的将领：两色都不沾，问窗开着时点它不进详情', () => {
    installTable('full');
    openWindowAndConsumeYellow();
    const { container } = render(<GameBoard />);

    const before = cls(container, 'g_none');
    expect(before).not.toContain('ring-cyan-400');
    expect(before).not.toContain('ring-amber-400');
    expect(detailOpen(container)).toBe(false);
    click(container, 'g_none');
    expect(detailOpen(container), '不相关的那一格不许把详情面板叫出来').toBe(false);
  });
});

describe('乙 拍 3 ㈂ 档位钉：黄框只在「完整」档出', () => {
  it('同一份名册换到智能档⇒全桌零黄框，那一格直接从清单里消失（界面没读过档位）', () => {
    installTable('smart');
    const ask = openWindowAndConsumeYellow();
    // 真读数自证：智能档那份清单里根本没有不可发动的条目＝分档只发生在 engineSteps 那一处。
    expect(ask.candidates.map(candidate => candidate.skillId)).toEqual(['g_blue:守夜:e1']);

    const { container } = render(<GameBoard />);
    expect(amberCount(container), '智能档不许出现任何黄框').toBe(0);
    // 蓝框那一格不受影响（否则这条证人可以是"整桌都不亮"蒙绿的）。
    expect(cls(container, 'g_blue')).toContain('animate-pulse ring-2 ring-cyan-400');
    // 被用掉的那一枚在智能档里连框都没有＝它已经不在这份清单里了。
    expect(cls(container, 'g_yellow')).not.toContain('ring-cyan-400');
    expect(cls(container, 'g_yellow')).not.toContain('ring-amber-400');
  });

  it('对照：同一份料换回完整档⇒那一枚重新出黄框（上一条不是写死的）', () => {
    installTable('full');
    openWindowAndConsumeYellow();
    const { container } = render(<GameBoard />);
    expect(amberCount(container)).toBe(1);
    expect(cls(container, 'g_yellow')).toContain('ring-2 ring-amber-400');
  });
});

describe('乙 拍 3 ㈂ 点将详情：蓝给发动的钮，黄把原因写在脸上', () => {
  it('点蓝框⇒进详情，面板里那一枚的发动钮走的是既有的 canonical 发动（账本入账、回合号不动）', () => {
    installTable('full');
    openWindowAndConsumeYellow();
    const { container } = render(<GameBoard />);

    click(container, 'g_blue');
    expect(detailOpen(container)).toBe(true);
    expect(panelText(container)).toContain('发动【守夜】');

    const fire = [...container.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('发动【守夜】'))!;
    act(() => { fireEvent.click(fire); });

    const state = get();
    const ledger = (state.engineState.consumedSkills ?? []).map(entry => entry.stableId);
    expect(ledger.filter(entry => entry.includes('g_blue:守夜:e1')), `账本＝${JSON.stringify(ledger)}`).toHaveLength(1);
    expect(state.engineState.turn, '发动≠结束回合').toBe(5);
    expect(detailOpen(container), '发动完回牌桌，详情面板收掉').toBe(false);
  });

  it('点黄框⇒同一扇面板逐字显示那句 disabledReason（不是靠悬停 title 交付）', () => {
    installTable('full');
    const ask = openWindowAndConsumeYellow();
    const reason = ask.candidates.find(candidate => candidate.generalId === 'g_yellow')!.disabledReason!;
    const { container } = render(<GameBoard />);

    click(container, 'g_yellow');
    expect(detailOpen(container)).toBe(true);
    const text = panelText(container);
    expect(text, '面板正文要逐字含那句原文').toContain(reason);
    // 那一枚在面板里**不许**给发动的钮：置灰项永远不等于可发动项。
    expect(text).not.toContain('发动【察更】');
  });

  it('窗没开＝牌桌一位不亮、点谁都照旧进详情（㈂ 不许改既有那帧画面）', () => {
    installTable('full');
    expect(get().turnEndAsk, '没按结束回合⇒没有问窗').toBeNull();
    const { container } = render(<GameBoard />);

    expect(amberCount(container)).toBe(0);
    for (const id of ['g_blue', 'g_yellow', 'g_none']) {
      expect(cls(container, id), `将${id} 不该带任何问窗框`).not.toContain('ring-cyan-400');
    }
    click(container, 'g_none');
    expect(detailOpen(container), '问窗没开时点不相关的将领照旧进详情＝既有行为一位没改').toBe(true);
  });
});

describe('乙 拍 3 ㈂ 结构钉：判据不重抄、句子不自造、档位不读、倒计时的判定那一半不接', () => {
  it('正向自证：这枚证人读到的确实是 GameBoard 生产源码本体，不是空串', () => {
    const code = codeOfGameBoard();
    // 三样都是本轮真交付的东西：蓝复用既有那一串、黄是新的那一串、原因读的是候选账那一格。
    expect(code).toContain('animate-pulse ring-2 ring-cyan-400');
    expect(code).toContain('ring-2 ring-amber-400');
    expect(code).toContain('disabledReason');
    expect(code).toContain('askItemOf');
  });

  it('界面没有第二份判据：无 `activatable =` 赋值、无自造的置灰句子、不读档位、不碰倒计时那一族', () => {
    const code = codeOfGameBoard();

    // ㈁ 第二份 `activatable` 的算式＝违令（只许直接读候选账那一格）。
    expect(code, '界面不许再算一份 activatable').not.toMatch(/activatable\s*=[^=]/);
    // ㈂ 置灰原因句子只能来自 `disabledReasonOf` 的原文，界面一个字都不许写死。
    // （`GameBoard.tsx:606` 那句「不满足发动门槛：」是本轮之前就有的另一处界面文案，不归这一格管、也没动它。）
    for (const invented of ['本回合已发动过', '本局已用尽', '本回合已用尽']) {
      expect(code, `界面不许自造「${invented}」`).not.toContain(invented);
    }
    // ㈃ 分档只有 engineSteps 那一处⇒画面这半压根不需要读档位。
    expect(code, '界面不许自己读档位再分一次档').not.toContain('skillPromptMode');
    // ㈄ **边界随 ㈁ 移动**（2026-11-06，本轮当面向监督台报备，不是弱化）：㈂ 交回那一刻
    // 全树倒计时那一族非测试调用点＝0，所以那一钉当时是四格全禁。㈁ 落地后 v5 的 C7/C8
    // **要求**画面用 `remainingAskSec` 显剩余秒数、用 `waitingSeatsOf` 显"还差谁没答"⇒
    // 那两格从"违令"变成"必须"。仍然禁的是**判定**那一半：起锚 `askDeadlineAtMs` 与
    // 到点 `isAskDeadlineReached` 只许导演那一处（v5 C3/C4），画面碰一次＝第二份账。
    for (const judge of ['askDeadlineAtMs', 'isAskDeadlineReached']) {
      expect(code, `画面不许接判定那一格「${judge}」`).not.toContain(judge);
    }
    // 正向对照（尺自证）：这两条若扫的是空串或别的文件，上一条会假绿。
    expect(code, '㈁ 交付后画面确实用了那两个显示函数').toContain('remainingAskSec');
    expect(code).toContain('waitingSeatsOf');
  });
});
