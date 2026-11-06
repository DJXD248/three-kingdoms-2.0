/**
 * 问窗那枚秒表（乙 线末片第二刀 · 刀 1 拍 3 ㈁，2026-11-06）的证人。
 *
 * 时钟口径**只用一种**：整份文件 `vi.useFakeTimers()`，`vi.setSystemTime` 定"现在"，
 * 推进用 `vi.advanceTimersByTime`（同一把假表既走 `setInterval` 也走 `Date.now()`）。
 * 这里绝不 `render(<GameBoard />)`——那文件受击闪红那一组定时器是**故意不做 cleanup** 的，
 * 一旦挂进来，下面 `vi.getTimerCount()` 那一枚钉就量不干净（v5 §3.6 要的正是这个读数）。
 *
 * 每枚证人都问过一个"合理假值"：把秒数写死成 30／把热座判据反着写／到点新增一条提交路／
 * cleanup 漏掉／换人不换锚——逐条写在正文注释里。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, render } from '@testing-library/react';
import AskClockDirector from './AskClockDirector';
import { useGameStore, type Player } from '../store/gameStore';
import type { General } from '../data/generals';
import type { EngineState } from '../core/GameState';
import { __resetResidentEngineContainer } from '../store/engineExecutionBridge';
import { getLiveReplayDocument, getLiveReplayEntryCount, resetLiveReplay } from '../replay/liveReplayRecorder';
import { attachRoom, detachRoom } from '../network/netRoom';
import { liveReactionAsk } from '../store/applyCanonicalAction';
import { NEVER_SENT_TOP_LEVEL } from '../network/snapshotView';

const here = path.dirname(fileURLToPath(import.meta.url));
const get = () => useGameStore.getState();
/** 固定的"现在"＝假表的原点；到点那一格永远由 `T0 + 秒数 × 1000` 反推，证人自己不算第二份。 */
const T0 = 1_760_000_000_000;

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) productionFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
/** 剥注释＋归一换行（在册口径：raw grep 的行数不是读数；本机 LF、CI 检出 CRLF）。 */
function strip(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}
function codeOf(rel: string): string {
  return strip(readFileSync(path.join(here, rel), 'utf8'));
}

/** 回合结束技能（开窗那一格读的就是它）。 */
function turnEndGeneral(id: string, skillName: string): General {
  return {
    id, instanceId: id, name: `将${id}`, faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0,
    skills: [{
      name: skillName, description: '回合结束时可发动',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    }],
  } as unknown as General;
}

/** 「受到伤害后」那一型：问答路听得懂 `INJURY` 那一声（`reactionTriggers.ts` 唯一那份表）。 */
function injuryGeneral(id: string, skillName: string, scope?: 'field'): General {
  return {
    id, instanceId: id, name: `将${id}`, faction: '魏', hp: 3, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0,
    skills: [{
      name: skillName, description: '受到伤害后可发动',
      effects: [{
        id: 'e1',
        trigger: scope ? { type: 'onDamageTaken', listenerScope: scope } : { type: 'onDamageTaken' },
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      }],
    }],
  } as unknown as General;
}

function seatPlayer(id: number, name: string, generals: General[], isAi: boolean): Player {
  return {
    id, name, faction: '魏', seatOrder: id, diceRoll: 10 + id,
    hand: [], generalPool: [], graveyard: [],
    baseHp: 6, baseMaxHp: 6, isAlive: true, isSpectating: false, avatarGeneral: null,
    statuses: [], isAi,
    fieldGenerals: generals.map((general, slot) => ({
      general, currentHp: general.hp, maxHp: general.hp,
      meleeAtk: general.meleeAtk, rangedAtk: general.rangedAtk, armor: 0, currentArmor: 0,
      armorCards: [], isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false,
      justDeployed: false, ownerId: id, position: { zone: 'front', slot, areaOwnerId: id },
    })),
  } as unknown as Player;
}

/**
 * 牌桌：席 1＝真人（本轮该答那一席），席 2＝电脑。
 * 真人席恰好一位 ⇒ 按 v5 C5 **不是**热座 ⇒ 这一桌该套秒表。
 * ⚠️ 秒数在这里定成 **45** 而不是默认的 30：导演若把秒数写死，下面所有对 `deadlineAtMs`
 * 的断言当场红（假值自查）。
 */
function installTable(generals: General[], mode: 'smart' | 'full' = 'full') {
  const first = seatPlayer(1, '甲', generals, false);
  const second = seatPlayer(2, '乙', [], true);
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
      turnEndAsk: null, reactionWindow: null, pendingChoice: null, askDeadline: null,
      pendingTurnTransition: null, drawContext: null, revealedDrawCards: [], skillActivations: [],
      askTimeoutSec: 45,
      settings: { ...useGameStore.getState().settings, skillPromptMode: mode },
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });
}

/** 联机那一臂的进料：挂一间假房（`getActiveRoom()` 从此非 null）。 */
function attachFakeRoom() {
  const connection = {
    state: { role: 'host', selfId: 1, name: '房主', roomCode: 'ASKCLOCK', phase: 'playing', note: '', peers: [] },
    leave: vi.fn(),
    send: vi.fn(() => true),
  };
  attachRoom({
    role: 'host', name: '房主', roomCode: 'ASKCLOCK', ticket: 'TK4TK4TK4TK4',
    address: 'ws://x', url: 'ws://x/ASKCLOCK', connection: connection as never,
  });
}

const anchor = () => get().askDeadline;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __resetResidentEngineContainer();
  resetLiveReplay();
});
afterEach(() => {
  cleanup();
  detachRoom();
  vi.useRealTimers();
});

describe('㈁ 起锚：非热座开窗即有锚（键＝窗身份|该答那一席，秒数＝房间那一个数）', () => {
  it('单机一位真人＋一位电脑：按了结束回合⇒开窗⇒挂载这一拍就起锚，锚值＝45 秒后（不是写死的 30）', () => {
    installTable([turnEndGeneral('g_blue', '守夜'), turnEndGeneral('g_yellow', '察更')]);
    expect(anchor()).toBeNull();
    act(() => { get().endTurn(); });
    expect(anchor(), '导演还没挂上表⇒锚必须是 null（不是"界面自己顺手起了一个"）').toBeNull();
    const ask = get().turnEndAsk!;
    expect(ask.candidates.map(c => c.skillId)).toEqual(['g_blue:守夜:e1', 'g_yellow:察更:e1']);

    render(<AskClockDirector />);
    expect(anchor()).toEqual({ key: `${ask.windowId}|${ask.playerId}`, deadlineAtMs: T0 + 45_000 });
    // 正向自证：这一格真的进过钳制（房间数 45 原样过），且窗身份与席位都在键里。
    expect(anchor()!.key).toContain('turn-end-ask:5:1');
  });

  it('热座（单机两位真人）⇒压根不起锚：一个人替好几席轮流点头，屏上没有"这一席走神了"这件事', () => {
    installTable([turnEndGeneral('g_blue', '守夜'), turnEndGeneral('g_yellow', '察更')]);
    act(() => {
      // 席 2 换成真人＝热座形状（`humanSeatCount > 1` 且无联机房间）。
      useGameStore.setState({ players: [get().players[0]!, seatPlayer(2, '乙', [], false)] as never });
      get().endTurn();
    });
    expect(get().turnEndAsk, '前提自证：窗照开，只是这一桌不套表').not.toBeNull();

    render(<AskClockDirector />);
    expect(anchor()).toBeNull();
    // 假值自查：若"热座不套"写反（或到点仍按钮），推进到远过到点后这一桌的账会自己动。
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(anchor()).toBeNull();
    expect(get().turnEndAsk, '热座局不许替下一位把上一位的牌打掉').not.toBeNull();
    expect(get().engineState.turn).toBe(5);
    expect(getLiveReplayEntryCount()).toBe(0);
  });

  it('同一形换到联机（挂上房间）⇒一律照套，哪怕这台机器上只有房主一个真人', () => {
    installTable([turnEndGeneral('g_blue', '守夜'), turnEndGeneral('g_yellow', '察更')]);
    act(() => {
      // 与上一条**同一形**（两位真人），唯一的差别＝这间假房。
      useGameStore.setState({ players: [get().players[0]!, seatPlayer(2, '乙', [], false)] as never });
      get().endTurn();
      attachFakeRoom();
    });
    expect(anchor(), '表还没挂⇒无锚（不是界面顺手起的）').toBeNull();

    render(<AskClockDirector />);
    // 假值自查：热座判据若漏掉联机那一臂（写成只看 `humanSeatCount > 1`），这里红。
    expect(anchor()).toEqual({ key: `${get().turnEndAsk!.windowId}|${get().turnEndAsk!.playerId}`, deadlineAtMs: T0 + 45_000 });
    expect(get().players.filter(p => !p.isAi), '前提自证：本机确实坐着两位真人').toHaveLength(2);
  });

  it('没开窗＝没该答的人⇒不起表；开完窗又闭掉＝锚当场清掉（表的存在由"有没有人欠答"决定）', () => {
    installTable([turnEndGeneral('g_blue', '守夜')]);
    render(<AskClockDirector />);
    expect(anchor()).toBeNull();
    act(() => { get().endTurn(); });
    expect(anchor()).not.toBeNull();
    act(() => { get().skipTurnEndAsk(); });
    expect(get().turnEndAsk).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(anchor(), '无窗⇒锚清掉，不给 HUD 留一个能显示 0 秒的旧读数').toBeNull();
  });
});

describe('㈁ 每一拍稳（W3）与到点只按那颗本来就合法的钮', () => {
  it('同一把窗连续两拍：键与到点逐字不动（重置＝换锚，不＝每拍重算一个更晚的到点）', () => {
    installTable([turnEndGeneral('g_blue', '守夜'), turnEndGeneral('g_yellow', '察更')]);
    act(() => { get().endTurn(); });
    render(<AskClockDirector />);
    const first = anchor()!;
    act(() => { vi.advanceTimersByTime(1_000); });
    const second = anchor()!;
    act(() => { vi.advanceTimersByTime(1_000); });
    const third = anchor()!;
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // 假值自查：若"每拍重新起锚"（把 `key` 不同判成"该重算"），秒数会永远跳不到头。
    expect(third.deadlineAtMs).toBe(T0 + 45_000);
    expect(getLiveReplayEntryCount(), '还没到点⇒一位账都不许多动').toBe(0);
  });

  it('到点＝替这一席按下「都不发动」：录出来的那条与人手点那一下**逐字相等**（含条目本体，不比条数）', () => {
    // 乙 案（人手点）与甲 案（到点自动按）各跑一遍同一条剧本，比对最后一条录像条目本体。
    const run = (byClock: boolean) => {
      __resetResidentEngineContainer();
      resetLiveReplay();
      vi.setSystemTime(T0);
      installTable([turnEndGeneral('g_blue', '守夜'), turnEndGeneral('g_yellow', '察更')]);
      act(() => { get().endTurn(); });
      const view = render(<AskClockDirector />);
      // 先真发动一枚：这一次 dispatch 只开录像文档、不记步（重置后首笔＝建档）。
      act(() => { expect(get().activateTurnEndSkill('g_yellow:察更:e1', 'g_yellow')).toBe(true); });
      expect(getLiveReplayEntryCount()).toBe(0);
      if (byClock) {
        act(() => { vi.advanceTimersByTime(45_000); });
      } else {
        view.unmount(); // 表停掉：下面这一下完全由"人"来按
        vi.setSystemTime(T0 + 45_000);
        act(() => { get().skipTurnEndAsk(); });
      }
      const doc = getLiveReplayDocument()!;
      return doc.entries.at(-1)!;
    };

    const byClockEntry = run(true);
    const byHandEntry = run(false);

    expect(getLiveReplayEntryCount()).toBe(1);
    expect(byClockEntry.action.type).toBe('END_TURN');
    // 逐字：整条条目本体（动作＋事件＋投影前后的引擎读数）对拷，不比条数也不比长度。
    // 唯一抹掉的是 `id` 那一族＝动作号与事件 UUID（`createAction` 的模块计数器与随机数，
    // 与"按的是哪一颗钮"无关）；除此之外一个字节都不许多。
    const body = (entry: unknown) => JSON.stringify(entry, (key, value) => (key === 'id' ? undefined : value));
    expect(body(byClockEntry)).toBe(body(byHandEntry));
    // 尺自证 ①：条目本体确实带着 `id` 这一族（否则上面那句是抹了个空集，等于没比对）。
    expect(JSON.stringify(byClockEntry)).toMatch(/"id":/);
    // 尺自证 ②：不是"两条都是空壳"——那一格确实往前走了回合，且带着刚才真发动的那笔账。
    expect((byClockEntry.afterState as unknown as { turn: number }).turn).toBe(6);
    expect((byHandEntry.afterState as unknown as { turn: number }).turn).toBe(6);
    expect((byClockEntry.afterState as unknown as { consumedSkills: unknown[] }).consumedSkills).toHaveLength(1);
    expect(byClockEntry.timestamp).toBe(T0 + 45_000);
  });

  it('响应链那一扇到点＝按「跳过」（同一颗钮、同一条出口），答完这一席该答的换成下一席', () => {
    installReactionTable();
    const windowId = get().reactionWindow!.id;
    const first = liveReactionAsk(get())!;
    expect(get().engineState.pendingReaction?.nodes).toHaveLength(1);
    render(<AskClockDirector />);
    expect(anchor()).toEqual({ key: `${windowId}|${first.playerId}`, deadlineAtMs: T0 + 45_000 });

    act(() => { vi.advanceTimersByTime(45_000); });
    const state = get();
    // 「跳过」走的就是既有那颗钮的出口⇒表态落进引擎那本账（不是界面自己清的）：
    // 台账键＝`${席位}:${将}`，写的是 EventProcessor，证人不改它。
    expect(state.engineState.pendingReaction?.nodes[0]?.answered)
      .toEqual([`${first.playerId}:${first.generalId}`]);
    expect(state.engineState.turn, '响应链那一格到点≠结束回合').toBe(5);
  });

  it('同一把窗换了该答那一席＝换键＝当场重新起锚（旧到点从此不算到点；各席各算各的）', () => {
    installReactionTable();
    const windowId = get().reactionWindow!.id;
    const firstDebtor = liveReactionAsk(get())!.playerId;
    render(<AskClockDirector />);
    const first = anchor()!;
    expect(first.key).toBe(`${windowId}|${firstDebtor}`);
    // 先让表真跳一秒：换人必须发生在"这一刻之后"，否则两把锚的到点数值天然相同，
    // 下面那句"变大"就量不出东西（W3 那条钉的就是这一秒里读数一位没动）。
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(anchor()).toEqual(first);

    act(() => { get().skipReaction(); }); // 人手替这一席按「跳过」⇒欠答的换到下一席
    expect(get().reactionWindow!.id, '前提自证：还是同一把窗').toBe(windowId);
    const next = liveReactionAsk(get())!;
    expect(next.playerId, '这份料必须真能问出两席（问不出＝夹具坏了，下面那句会假绿）').not.toBe(firstDebtor);

    const second = anchor()!;
    // 两条都断（只断键能蒙绿：`key` 变了但 `deadlineAtMs` 照旧＝下一席继承上一位的钟）。
    expect(second.key).toBe(`${windowId}|${next.playerId}`);
    expect(second.key).not.toBe(first.key);
    expect(second.deadlineAtMs).toBeGreaterThan(first.deadlineAtMs);
    expect(second.deadlineAtMs).toBe(T0 + 1_000 + 45_000);
  });
});

describe('㈁ 抉择窗那一扇不套表（v5 C6：它是「请选择其一」，没有「不发动」这个出口）', () => {
  it('只开着抉择窗⇒压根不起锚；推进到远过秒数也一位不替玩家选（第一项照旧留给玩家自己点）', () => {
    installTable([]);
    act(() => {
      useGameStore.setState({
        engineState: {
          ...get().engineState,
          pendingChoice: {
            key: 'ch:5:3:g_choice:择一', playerId: 1,
            options: [
              { label: '摸一张', events: [] },
              { label: '弃一张', events: [] },
            ],
          },
        },
      } as never);
    });
    expect(get().engineState.pendingChoice?.options.map(o => o.label)).toEqual(['摸一张', '弃一张']);
    render(<AskClockDirector />);
    expect(anchor(), '没有"是否执行"那一扇⇒这一秒不为任何人计时').toBeNull();

    act(() => { vi.advanceTimersByTime(120_000); });
    expect(anchor()).toBeNull();
    expect(get().engineState.pendingChoice?.options, '绝不自动替玩家选第一项').toHaveLength(2);
    expect(get().engineState.turn, '抉择窗到点不许有任何自动动作').toBe(5);
    expect(getLiveReplayEntryCount()).toBe(0);
  });
});

describe('㈁ 测试台与卸载', () => {
  it('`isTestMode` 压根不开问窗⇒天然无钟（这一条形没为它加任何条件）', () => {
    installTable([turnEndGeneral('g_blue', '守夜')]);
    act(() => { useGameStore.setState({ isTestMode: true } as never); });
    render(<AskClockDirector />);
    act(() => { get().endTurn(); });
    expect(get().turnEndAsk, '前提自证：测试台不开窗').toBeNull();
    expect(anchor()).toBeNull();
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(anchor()).toBeNull();
  });

  it('卸载⇒那枚表真的清掉（`getTimerCount` 回到基线）；卸载后再推进＝一位账都不许多动', () => {
    const idle = vi.getTimerCount();
    installTable([turnEndGeneral('g_blue', '守夜'), turnEndGeneral('g_yellow', '察更')]);
    act(() => { get().endTurn(); });
    const view = render(<AskClockDirector />);
    expect(vi.getTimerCount()).toBe(idle + 1);

    view.unmount();
    expect(vi.getTimerCount(), 'cleanup 漏掉＝全树第二枚表在无人看着的地方跑').toBe(idle);
    const before = getLiveReplayEntryCount();
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(getLiveReplayEntryCount()).toBe(before);
    expect(get().engineState.turn).toBe(5);
  });
});

describe('㈁ 结构钉：表只有一枚、读表处只有一处、界面不许自己起锚', () => {
  it('起锚与到点这两格判据的生产调用者只有导演那一处（界面/进程/store 一个都不许抄）', () => {
    const srcRoot = path.join(here, '..');
    const files = productionFiles(srcRoot);
    expect(files.length, '尺自证：这一趟确实扫到了生产代码').toBeGreaterThan(100);
    const relativeOf = (file: string) => path.relative(srcRoot, file).replace(/\\/g, '/');
    for (const symbol of ['askDeadlineAtMs', 'isAskDeadlineReached']) {
      const callers = files
        .filter(file => !relativeOf(file).endsWith('setup/askClock.ts'))
        .filter(file => new RegExp(`${symbol}\\(`).test(strip(readFileSync(file, 'utf8'))))
        .map(relativeOf);
      expect(callers, `「${symbol}」的生产调用者只许导演那一处`).toEqual(['components/AskClockDirector.tsx']);
    }
  });

  it('`App.tsx` 只挂一处 `<AskClockDirector />`（同级、与 `<AiDirector />` 并排）', () => {
    const code = codeOf('../App.tsx');
    expect(code.match(/<AskClockDirector \/>/g)).toHaveLength(1);
    expect(code.match(/<AiDirector \/>/g), '既有那枚 AI 司机一位没动').toHaveLength(1);
  });

  it('画面那一半不许读表、不许自己起锚：`GameBoard.tsx` 里没有 `Date.now()`、没有 `askDeadline =` 赋值', () => {
    const code = codeOf('GameBoard.tsx');
    expect(code, 'HUD 只许用导演交出来的"现在"（v5 C7）').not.toContain('Date.now()');
    expect(code, '界面不许自己造锚（锚只由导演那一处写）').not.toMatch(/askDeadline\s*=\s*\{/);
    expect(code, '界面不许调用写锚那颗 setter').not.toContain('setAskDeadline');
    // 尺自证：这一枚证人读的确实是本体，且导演那侧确实读了表（否则上一条是空跑）。
    expect(code).toContain('remainingAskSec');
    expect(codeOf('AskClockDirector.tsx')).toContain('Date.now()');
  });

  it('锚不落盘：存档那六格与快照白名单一个字没动（`NEVER_SENT_TOP_LEVEL` 仍是那 3 样）', () => {
    expect([...NEVER_SENT_TOP_LEVEL].sort()).toEqual(['pendingChoice', 'pendingReaction', 'rngState']);
    const persistence = codeOf('../store/editorPersistence.ts');
    expect(persistence).not.toContain('askDeadline');
  });
});

describe('㈁ 防倒退：三份既有证人的枚数与那条线没被这一拍改掉', () => {
  it('`turnEndAsk`／`tableCompute`／㈂ 那三本证人的 `it` 数＝31／18／10（这一轮只加不减）', () => {
    const count = (file: string) => (codeOf(file).match(/^\s+it\(/gm) ?? []).length;
    expect(count('../store/gameStore.turnEndAsk.test.ts'), '回合结束问窗那本证人被弱化了？').toBe(31);
    expect(count('../setup/tableCompute.test.ts')).toBe(18);
    expect(count('./gameBoard/GameBoard.turnEndHighlight.test.tsx')).toBe(10);
  });
});

/**
 * 响应链那一桌（`㈁` 的响应臂用料）：席 1 那一员听"场上任何一员受到伤害"（`field` 档），
 * 席 2 那一员只听自己挨的那一刀（缺省 `self`）⇒引擎那本账里同一格欠两个表态，
 * 先问席位号小的那一席（`collectListeners` 按名册顺序扫）。
 * 这一桌的 `pendingReaction` 是**照引擎正身写的一格事实**（`INJURY` 那一声＋格号），
 * 表态走生产那条 `skipReaction`⇒台账由 EventProcessor 自己落，证人不改它。
 */
function installReactionTable() {
  const first = seatPlayer(1, '甲', [injuryGeneral('g_answer', '应一', 'field')], false);
  const second = seatPlayer(2, '乙', [injuryGeneral('g_next', '应二')], true);
  const engineState = {
    version: 1, phase: 'playing', timelinePhase: 'ACTION',
    currentPlayerId: 1, turn: 5, round: 3, isFirstTurn: false,
    players: [first, second],
    deck: [{ id: 'deck_1', name: '粮草', type: '粮草' }],
    discardPile: [], drawState: null, statModifiers: [],
    rngState: { s: 20261106 },
    pendingReaction: {
      turn: 5,
      serial: 1,
      nodes: [{
        key: 'rn:5:1',
        sourceEvent: { type: 'INJURY', data: { targetPlayerId: 2, targetId: 'g_next', damage: 1 } },
        answered: [],
      }],
    },
  } as unknown as EngineState;
  act(() => {
    useGameStore.setState({
      phase: 'playing', turnPhase: 'main', playerCount: 2, isTestMode: false,
      winnerId: null, gameOverBanner: null, defeatEvent: null,
      engineState, players: [first, second], currentPlayerIndex: 0, currentRound: 3,
      cardDeck: engineState.deck as never, discardPile: [] as never,
      turnEndAsk: null, reactionWindow: null, pendingChoice: null, askDeadline: null,
      pendingTurnTransition: null, drawContext: null, revealedDrawCards: [], skillActivations: [],
      askTimeoutSec: 45,
      settings: { ...useGameStore.getState().settings, skillPromptMode: 'full' },
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });
  // 容器窗：参与者是**席位号**（1 与 2），与引擎那一格的两个欠答同一份名册。
  act(() => { get().openReactionWindow(undefined, [1, 2]); });
  expect(get().reactionWindow, '前提自证：容器窗开起来了').not.toBeNull();
}
