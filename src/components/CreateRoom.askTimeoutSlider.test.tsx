/**
 * CreateRoom 等待时间滑块的证人（乙 线末片第二刀 · 刀 1 追加㈡）。
 *
 * 业主 2026-11-06 第二轮原话＝「做一个像现在调整抽卡数量一样的滑动块」⇒那五颗预设钮
 * 换成一枚 `input type="range"`。要钉的四条：
 *  K1 边界与真值各只有一处：`min`/`max` 读 `askClock` 那两枚常量，`value` 读同一格房间参数
 *     （不是本地草稿 state 与房间参数两份账）；拖动写回的也是那一格。
 *  K2 钳制仍是活的，而且**走真入口**：界面那条路是 `setAskTimeoutSec`，它里面才有
 *     `clampAskTimeoutSec`。⚠️ 直接 `useGameStore.setState({askTimeoutSec:999})` 不会被夹——
 *     zustand 的 setState 不过任何判据，拿它当"钳制证人"＝钉了一件本来就不成立的事。
 *  K3 那五颗钮的出处 `ASK_TIMEOUT_CHOICES_SEC` 在生产源码里零消费（注释不算出处），
 *     否则界面某处偷偷读回去＝两套账。
 *  K4 默认仍 30；这一屏只有一枚滑块，没有第二处能改这个数的控件。
 *  S7 开局页那句话把三扇窗各自的默认出路逐条说真（措辞与代码同批落地＝§12-163③）。
 *
 * 换行符不是判据：读文件出口归一成 LF（v2.9.30 CI #362 那一族）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CreateRoom from './CreateRoom';
import { useGameStore } from '../store/gameStore';
import { ASK_TIMEOUT_DEFAULT_SEC, ASK_TIMEOUT_MAX_SEC, ASK_TIMEOUT_MIN_SEC } from '../setup/askClock';

afterEach(() => {
  cleanup();
});

/** 这一屏只读 playerCount／roomName／askTimeoutSec／seatModes，别的一格都不碰。 */
function install(askTimeoutSec = ASK_TIMEOUT_DEFAULT_SEC): void {
  act(() => {
    useGameStore.setState({ playerCount: 2, roomName: '滑块房', askTimeoutSec });
  });
}

const sliderOf = (): HTMLInputElement => screen.getByRole('slider') as HTMLInputElement;
const dragTo = (sec: number): void => {
  fireEvent.change(sliderOf(), { target: { value: String(sec) } });
};
/** 滑块此刻的真值读数（它从房间参数那一格来，界面不另存草稿）。 */
const shownSec = (): string => sliderOf().value;

describe('刀 1 追加㈡ · 等待时间滑块 (K1／K4)', () => {
  it('K1 边界读常量、真值读房间参数：拖到 15／90／中间值，store 与屏上读数一起走', () => {
    install();
    render(<CreateRoom />);

    const slider = sliderOf();
    expect(Number(slider.min)).toBe(ASK_TIMEOUT_MIN_SEC);
    expect(Number(slider.max)).toBe(ASK_TIMEOUT_MAX_SEC);
    expect(Number(slider.step)).toBe(1);
    expect(shownSec()).toBe(String(ASK_TIMEOUT_DEFAULT_SEC));

    for (const sec of [ASK_TIMEOUT_MIN_SEC, ASK_TIMEOUT_MAX_SEC, 37, 60]) {
      dragTo(sec);
      expect(useGameStore.getState().askTimeoutSec).toBe(sec);
      expect(shownSec()).toBe(String(sec));
      // 屏上那枚大号读数与滑块同源：界面不另存一份草稿。点名读数那一格——
      // 边界标签在 sec＝15／90 时与它同文，`getByText` 会撞两处。
      const readout = document.querySelector('.tabular-nums');
      expect(readout?.textContent).toBe(`${sec} 秒`);
    }
  });

  it('K1 反向：房间参数被别处改了，滑块跟着走（value 不是组件自己的 state）', () => {
    install();
    render(<CreateRoom />);
    expect(shownSec()).toBe('30');

    act(() => {
      useGameStore.getState().setAskTimeoutSec(45);
    });
    expect(shownSec()).toBe('45');
  });

  it('K4 默认仍 30；这一屏只有一枚滑块，那五颗「N秒」按钮一颗都不剩', () => {
    install();
    render(<CreateRoom />);

    expect(useGameStore.getState().askTimeoutSec).toBe(ASK_TIMEOUT_DEFAULT_SEC);
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    const presetButtons = screen.getAllByRole('button').filter(b => /^\d+秒$/.test(b.textContent ?? ''));
    expect(presetButtons).toHaveLength(0);
    // 这一屏唯一能写这个数的控件就是那枚滑块（别的入口＝第二处可改＝两套账）。
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });
});

describe('刀 1 追加㈡ · 钳制仍只有一道 (K2)', () => {
  it('K2 上界：界面那条真入口递 999 ⇒ 夹到 90，滑块读数也是 90', () => {
    install();
    render(<CreateRoom />);

    act(() => {
      useGameStore.getState().setAskTimeoutSec(999);
    });
    expect(useGameStore.getState().askTimeoutSec).toBe(ASK_TIMEOUT_MAX_SEC);
    expect(shownSec()).toBe(String(ASK_TIMEOUT_MAX_SEC));
  });

  it('K2 下界：递 3 ⇒ 夹到 15（不是原样收下，也不是回默认）', () => {
    install();
    render(<CreateRoom />);

    act(() => {
      useGameStore.getState().setAskTimeoutSec(3);
    });
    expect(useGameStore.getState().askTimeoutSec).toBe(ASK_TIMEOUT_MIN_SEC);
    expect(shownSec()).toBe(String(ASK_TIMEOUT_MIN_SEC));
  });

  it('K2 没定过那一格：NaN ⇒ 回默认 30，不是 0 秒', () => {
    install();
    render(<CreateRoom />);

    act(() => {
      useGameStore.getState().setAskTimeoutSec(Number.NaN);
    });
    expect(useGameStore.getState().askTimeoutSec).toBe(ASK_TIMEOUT_DEFAULT_SEC);
    expect(shownSec()).toBe(String(ASK_TIMEOUT_DEFAULT_SEC));
  });
});

describe('刀 1 追加㈡ · 五颗预设钮的出处不许被读回去 (K3)', () => {
  it('K3 `ASK_TIMEOUT_CHOICES_SEC` 在生产源码里只有声明那一处（剥注释后点名）', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      path.resolve(here, 'CreateRoom.tsx'),
      path.resolve(here, '../setup/askClock.ts'),
    ];
    const holders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      const hits = text.split('\n').filter(line => line.includes('ASK_TIMEOUT_CHOICES_SEC'));
      for (const hit of hits) holders.push(`${path.basename(file)}: ${hit.trim()}`);
    }
    // 唯一允许的那一处＝`askClock.ts` 里那条 export 声明本身；界面一处都不许读。
    expect(holders).toHaveLength(1);
    expect(holders[0]).toContain('export const ASK_TIMEOUT_CHOICES_SEC');
    expect(holders[0].startsWith('CreateRoom.tsx')).toBe(false);
  });
});

describe('刀 1 追加㈡ · 开局页那句话要说真 (S7)', () => {
  it('S7 三扇窗各自的默认出路逐条写在脸上，热座与 AI 那两句仍在', () => {
    install();
    render(<CreateRoom />);

    const desc = screen.getByText(/开局前定一次，全场席位共用这一个数/).textContent ?? '';
    expect(desc).toContain('超过这个秒数没答，系统就替这一席做那一条本来就合法的默认选择');
    expect(desc).toContain('回合结束＝都不发动');
    expect(desc).toContain('响应＝跳过');
    expect(desc).toContain('"请选择其一"＝第一项');
    expect(desc).toContain('AI 席位不等这一趟');
    expect(desc).toContain('同屏轮流操作的热座局不套这一格');
    // 旧那句只说"都不发动"＝抉择窗进表之后就是假话，不许留着。
    expect(desc).not.toContain('系统就替他按下那条本来就合法的「都不发动」');
  });
});