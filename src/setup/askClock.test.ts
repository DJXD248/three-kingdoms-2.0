/**
 * 询问窗那把尺的证人（乙 线末片第二刀 · 刀 1 拍 1）。
 *
 * 这一拍只把"尺子＋房间那一格"落地，界面上一位没动，所以证人也只咬三件事：
 * ①秒数怎么夹、到点怎么算、还差谁没答（纯函数）；
 * ②钳制与范围**全库只有一个出处**（`askClock.ts`），别处一律算自抄；
 * ③这一格是 GameState 根上的房间参数——进得了牌桌那面账，**进不了引擎那本账、
 *   也进不了录像**（W2 那枚白名单钉）。
 *
 * 每条都问过一个"合理假值"：要么改常量、要么把同一格挪到席位上，证人必须当场红。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASK_TIMEOUT_DEFAULT_SEC, ASK_TIMEOUT_MIN_SEC, ASK_TIMEOUT_MAX_SEC, ASK_TIMEOUT_CHOICES_SEC,
  clampAskTimeoutSec, askDeadlineAtMs, remainingAskSec, isAskDeadlineReached, waitingSeatsOf,
} from './askClock';
import { defaultAskTimeoutSec } from './runtimeSetup';
import { useGameStore } from '../store/gameStore';
import { storeStateToEngineState } from '../store/gameStateAdapter';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 生产代码（证人自己除外，`.test.` 一律不读），行尾先归一化再判。 */
function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) productionFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_SRC = productionFiles(srcRoot);
/**
 * 结构钉数的是**剥掉注释之后**的源码（在册口径：raw grep 的行数不是读数）——
 * 一句"别在这里抄边界"的注释不该被当成第二个出处，也不该把这一钉点亮。
 * 行尾先归一化（#335／#362 两次 CI 红都栽在 LF↔CRLF）。
 */
const stripComments = (text: string): string =>
  text
    .replace(/\s*\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
const read = (file: string): string => stripComments(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
const relative = (file: string): string => path.relative(srcRoot, file).replace(/\\/g, '/');

describe('askClock · 秒数怎么夹 (拍 1)', () => {
  it('默认值原样过钳制＝30，房主不选也是它', () => {
    expect(clampAskTimeoutSec(ASK_TIMEOUT_DEFAULT_SEC)).toBe(30);
    expect(defaultAskTimeoutSec()).toBe(30);
  });

  it('两个端点本身原样不动：15 与 90 都是合法值，不是"越界"', () => {
    expect(clampAskTimeoutSec(ASK_TIMEOUT_MIN_SEC)).toBe(15);
    expect(clampAskTimeoutSec(ASK_TIMEOUT_MAX_SEC)).toBe(90);
  });

  it('下界以下一律夹回 15（0／14／负数）', () => {
    expect(clampAskTimeoutSec(0)).toBe(15);
    expect(clampAskTimeoutSec(14)).toBe(15);
    expect(clampAskTimeoutSec(-7)).toBe(15);
  });

  it('上界以上一律夹回 90（91／999）', () => {
    expect(clampAskTimeoutSec(91)).toBe(90);
    expect(clampAskTimeoutSec(999)).toBe(90);
  });

  it('压根不是个数（NaN／Infinity）＝回默认 30，既不夹成 15 也不放行', () => {
    expect(clampAskTimeoutSec(Number.NaN)).toBe(30);
    expect(clampAskTimeoutSec(Number.POSITIVE_INFINITY)).toBe(30);
  });

  it('小数向下取整（45.7→45），到点的秒数永远是一个整数', () => {
    expect(clampAskTimeoutSec(45.7)).toBe(45);
    expect(clampAskTimeoutSec(89.99)).toBe(89);
  });

  it('界面那一格给的五个数全在尺内、含默认值、由小到大', () => {
    expect(ASK_TIMEOUT_CHOICES_SEC).toEqual([...ASK_TIMEOUT_CHOICES_SEC].sort((a, b) => a - b));
    expect(ASK_TIMEOUT_CHOICES_SEC).toContain(ASK_TIMEOUT_DEFAULT_SEC);
    for (const sec of ASK_TIMEOUT_CHOICES_SEC) {
      expect(sec).toBeGreaterThanOrEqual(ASK_TIMEOUT_MIN_SEC);
      expect(sec).toBeLessThanOrEqual(ASK_TIMEOUT_MAX_SEC);
      // 假值自查：这一格里的数若自己抄错了范围，钳制会把它挪动 ⇒ 立刻红。
      expect(clampAskTimeoutSec(sec)).toBe(sec);
    }
  });
});

describe('askClock · 到点怎么算 (拍 1)', () => {
  it('从锚点起算到那一格定的秒数之后：1000ms + 30s = 31000ms', () => {
    expect(askDeadlineAtMs(1000, 30)).toBe(31000);
    expect(askDeadlineAtMs(1000, 999)).toBe(1000 + ASK_TIMEOUT_MAX_SEC * 1000);
  });

  it('换了锚点到点就跟着换（R4 纯函数那一半：重置＝新锚点，旧到点不再算到点）', () => {
    const opened = askDeadlineAtMs(10_000, 30);
    const reconnected = askDeadlineAtMs(20_000, 30);
    expect(reconnected).not.toBe(opened);
    expect(isAskDeadlineReached(opened, opened)).toBe(true);
    expect(isAskDeadlineReached(opened, reconnected)).toBe(false);
  });

  it('还剩几秒：尾巴向上取整显示，到点归 0，过点绝不为负', () => {
    const deadline = askDeadlineAtMs(0, 30);
    expect(remainingAskSec(0, deadline)).toBe(30);
    expect(remainingAskSec(deadline - 1_000, deadline)).toBe(1);
    expect(remainingAskSec(deadline - 1, deadline)).toBe(1);
    expect(remainingAskSec(deadline, deadline)).toBe(0);
    expect(remainingAskSec(deadline + 5_000, deadline)).toBe(0);
  });

  it('到没到点含边界：等于到点那一毫秒即已到，早一毫秒未到', () => {
    expect(isAskDeadlineReached(30_999, 31_000)).toBe(false);
    expect(isAskDeadlineReached(31_000, 31_000)).toBe(true);
    expect(isAskDeadlineReached(31_001, 31_000)).toBe(true);
  });
});

describe('askClock · 还差谁没答 (W1 真数据)', () => {
  it('参加者 [1,2,3]、已答 [2] ⇒ 必等 [1,3]，且按参加者原序', () => {
    expect(waitingSeatsOf([1, 2, 3], [2])).toEqual([1, 3]);
  });

  it('两端对照：一个都没答＝全量原序；全都答过＝空表', () => {
    expect(waitingSeatsOf([1, 2, 3], [])).toEqual([1, 2, 3]);
    expect(waitingSeatsOf([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it('顺序跟着参加者走，不跟着已答名单走', () => {
    expect(waitingSeatsOf([3, 1, 2], [3])).toEqual([1, 2]);
  });
});

describe('askClock · 钳制与范围全库唯一出处 (R2 结构钉)', () => {
  it('扫描真的读到了生产代码（证人不是空跑）', () => {
    expect(ALL_SRC.length).toBeGreaterThan(100);
  });

  it('三个范围常量的定义处只有一处＝askClock.ts', () => {
    const definers = ALL_SRC
      .filter(file => /ASK_TIMEOUT_(MIN|MAX|DEFAULT)_SEC\s*=/.test(read(file)))
      .map(relative);
    expect(definers).toEqual(['setup/askClock.ts']);
  });

  it('钳制函数的定义处只有一处＝askClock.ts', () => {
    const definers = ALL_SRC
      .filter(file => /function clampAskTimeoutSec/.test(read(file)))
      .map(relative);
    expect(definers).toEqual(['setup/askClock.ts']);
  });

  it('除 askClock.ts 外，没有第二个出处把询问秒数与 15／90 这两个数写在同一行', () => {
    const smuggle = /.*(15|90).*(askTimeout|ASK_TIMEOUT|askDeadline)|(askTimeout|ASK_TIMEOUT|askDeadline).*(15|90)/;
    // 尺先自证：像模像样的"就地夹一次"必须被这条正则抓到，否则这一钉是空跑。
    expect(smuggle.test('const sec = Math.min(90, Math.max(15, askTimeoutSec));')).toBe(true);
    expect(smuggle.test('if (askTimeoutSec > 90) return 90;')).toBe(true);
    const offenders = ALL_SRC
      .filter(file => !file.endsWith(`${path.sep}setup${path.sep}askClock.ts`))
      .filter(file => read(file).split('\n').some(line => smuggle.test(line)))
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it('调用钳制的生产文件只有一个（别处想夹必须先经过这一道）', () => {
    const callers = ALL_SRC
      .filter(file => /clampAskTimeoutSec\(/.test(read(file)))
      .map(relative);
    expect(callers).toEqual(['setup/askClock.ts', 'store/gameStore.ts']);
  });
});

describe('askClock · 这一格是房间参数不是引擎事实 (W2 白名单钉)', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
  });

  it('setter 只认钳制后的数：递 5 秒进去拿到 15 秒', () => {
    useGameStore.getState().setAskTimeoutSec(5);
    expect(useGameStore.getState().askTimeoutSec).toBe(ASK_TIMEOUT_MIN_SEC);
    useGameStore.getState().setAskTimeoutSec(120);
    expect(useGameStore.getState().askTimeoutSec).toBe(ASK_TIMEOUT_MAX_SEC);
  });

  it('createRoom 定影：开局后牌桌认的就是房主那一个数', () => {
    const st = useGameStore.getState();
    st.setPlayerCount(2);
    st.setAskTimeoutSec(45);
    st.createRoom();
    const after = useGameStore.getState();
    expect(after.phase).toBe('lobby');
    expect(after.askTimeoutSec).toBe(45);
  });

  it('绕过 setter 直接塞进状态也不放过＝定影那一道钳制不是装饰（999→90）', () => {
    useGameStore.setState({ askTimeoutSec: 999 });
    const st = useGameStore.getState();
    st.setPlayerCount(2);
    st.createRoom();
    expect(useGameStore.getState().askTimeoutSec).toBe(ASK_TIMEOUT_MAX_SEC);
  });

  it('resetGame 回到默认那一个数，不是上一局房主定的那个', () => {
    useGameStore.getState().setAskTimeoutSec(90);
    useGameStore.getState().resetGame();
    expect(useGameStore.getState().askTimeoutSec).toBe(defaultAskTimeoutSec());
  });

  it('根上这一格进不了引擎那本账（正向对照：投影确实在搬东西）', () => {
    const projected = storeStateToEngineState({
      phase: 'playing',
      currentRound: 7,
      askTimeoutSec: 45,
      turnEndAsk: { playerId: 1, windowId: 'turn-end-ask:7:1', deadlineAtMs: 123_456, candidates: [] },
      players: [{ id: 1, hand: [], generalPool: [] }],
      cardDeck: [],
      discardPile: [],
      turnPhase: 'main',
      isFirstTurn: false,
    });
    expect(Object.keys(projected)).not.toContain('askTimeoutSec');
    const json = JSON.stringify(projected);
    expect(json).not.toMatch(/askTimeoutSec/);
    expect(json).not.toMatch(/deadlineAtMs/);
    // 尺自证：同一个探针必须量得出真正过去的格子，否则"没有它"只是投影了个空壳。
    expect(json).toContain('"round":7');
  });

  it('同一格挂到席位上就会漏进引擎读数（所以这条线只能留在根上）', () => {
    const leaked = storeStateToEngineState({
      phase: 'playing',
      currentRound: 1,
      players: [{ id: 1, askTimeoutSec: 45, deadlineAtMs: 123_456, hand: [], generalPool: [] }],
      cardDeck: [],
      discardPile: [],
      turnPhase: 'main',
      isFirstTurn: true,
    });
    const json = JSON.stringify(leaked.players?.[0] ?? {});
    expect(json).toContain('"askTimeoutSec":45');
    expect(json).toContain('"deadlineAtMs":123456');
  });

  it('录像那一路一个字都不认这两个词（条目形＝canonical 动作 + 引擎读数）', () => {
    const replayRoot = path.join(srcRoot, 'replay');
    const files = productionFiles(replayRoot);
    expect(files.length).toBeGreaterThan(3);
    const offenders = files.filter(file => /askTimeoutSec|deadlineAtMs/.test(read(file))).map(relative);
    expect(offenders).toEqual([]);
    // 尺自证：这些文件确实在搬引擎状态，不是几份空壳。
    expect(files.some(file => /EngineState/.test(read(file)))).toBe(true);
  });

  it('单机存档那一份也不带它（存档序列化的是引擎那本账 + 房名 + 人数）', () => {
    useGameStore.getState().setPlayerCount(2);
    useGameStore.getState().createRoom();
    useGameStore.getState().startGame();
    const blob = useGameStore.getState().createSerializedSnapshot(useGameStore.getState().roomName);
    expect(blob).not.toMatch(/askTimeoutSec|deadlineAtMs/);
    // 尺自证：同一份存档确实带着引擎读数，"没有它"不是因为啥也没写进去。
    expect(blob).toMatch(/"players"/);
  });
});
