/**
 * 联机切片⑤·腿1（㈢ 演出刀，v2.9.25）客人那一格的界面证人。
 *
 * 这里量的只有一件事：**画上屏的必须是收到的那些数**——收到才画、没收到写「还没定」，
 * 中间不许出现一个本机自己摇出来的点数（用户那句逐字是"主机先走定下数据…客人画面变动"，
 * 客人这边没有"先走"这一步的授权）。判据住在 `network/netSetupSteps`，这一格不许重算一遍，
 * 所以证人打的是界面措辞与那五个公开字段的落点，不打规则。
 */
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { EngineState } from '../core/GameState';
import { NetSetupPanel } from './NetSetupPanel';

/** 只填这一格真正会读的那几格；其余按 null 交给判据层自己去认。 */
const view = (state: Record<string, unknown>): EngineState => state as unknown as EngineState;

const lobbyTwo = {
  phase: 'diceRoll',
  players: [
    { id: 1, name: '房主乙', diceRoll: 0, seatOrder: 0, faction: '' },
    { id: 2, name: '客人甲', diceRoll: 0, seatOrder: 1, faction: '' },
  ],
};

const rolled = {
  phase: 'diceRoll',
  players: [
    { id: 1, name: '房主乙', diceRoll: 11, seatOrder: 0, faction: '' },
    { id: 2, name: '客人甲', diceRoll: 4, seatOrder: 1, faction: '' },
  ],
};

const assigned = {
  phase: 'factionAssign',
  players: [
    { id: 1, name: '房主乙', diceRoll: 11, seatOrder: 0, faction: '蜀' },
    { id: 2, name: '客人甲', diceRoll: 4, seatOrder: 1, faction: '魏' },
  ],
};

const text = () => document.body.textContent ?? '';

describe('㈢ 客人那一格：只画收到的数，不画自己摇的', () => {
  it('标题就把这一格的性质说清：这里的数全是房主定下来发过来的，本机一颗骰子也不摇', () => {
    render(<NetSetupPanel snapshot={null} />);
    expect(text()).toContain('本机一颗骰子也不摇');
    expect(text()).toContain('房主那边定下来发过来的');
  });

  it('还没收到任何局面 ⇒ 说的是"现在没有读数"，不是一块空白，也不是"房主掉线了"', () => {
    render(<NetSetupPanel snapshot={null} />);
    expect(text()).toContain('现在没有开局那一段的读数');
  });

  it('房主那边骰子还没掷（收到的点数是 0）⇒ 席位在、每格写「还没定」，一个点数也不许出现', () => {
    render(<NetSetupPanel snapshot={view(lobbyTwo)} />);
    expect(text()).toContain('房主那边骰子还在滚');
    expect(text()).toContain('第 1 席');
    expect(text()).toContain('房主乙');
    // 两席各写一次"点数还没定"——一席都不许替他们补一个数。
    expect(screen.getAllByText(/🎲 还没定/)).toHaveLength(2);
    expect(text()).not.toMatch(/🎲 \d/);
  });

  it('点数一到就上屏，逐字是收到的那两个数；座次那句写清算的是房主那边', () => {
    render(<NetSetupPanel snapshot={view(rolled)} />);
    expect(text()).toContain('骰子停下');
    expect(text()).toContain('🎲 11');
    expect(text()).toContain('🎲 4');
    expect(text()).toContain('座次第 1 位');
    expect(text()).toContain('不是本机排的');
    // 点数都定了 ⇒ 那句"还在滚"不许还挂在屏上。
    expect(text()).not.toContain('房主那边骰子还在滚');
  });

  it('分势力那一步：势力也到了就写"由房主那边定下并发来"，接着才是各家征召', () => {
    render(<NetSetupPanel snapshot={view(assigned)} />);
    expect(text()).toContain('蜀');
    expect(text()).toContain('魏');
    expect(text()).toContain('跟骰子一起到');
    expect(text()).toContain('接着是各家征召');
  });

  it('势力只收到一半 ⇒ 画收到的那一席，没收到的那格写「还没定」', () => {
    render(
      <NetSetupPanel
        snapshot={view({ phase: 'factionAssign', players: [{ id: 1, name: '房主乙', diceRoll: 11, seatOrder: 0, faction: '蜀' }, { id: 2, name: '客人甲', diceRoll: 4, seatOrder: 1, faction: '' }] })}
      />,
    );
    expect(text()).toContain('势力还没全到');
    expect(text()).toContain('势力还没定');
  });

  it('征召那一步：这一格说的是"看下面那张进度表"，并写明候选名单与点将还没做（⑤c／⑤d）', () => {
    render(<NetSetupPanel snapshot={view({ phase: 'generalDraft', players: assigned.players })} />);
    expect(text()).toContain('各家挑到哪儿了看下面那张征召进度表');
    expect(text()).toContain('一张牌也没有');
    expect(text()).toContain('⑤c');
    expect(text()).toContain('⑤d');
    expect(text()).toContain('这一段现在只有进度可看');
  });

  it('开局走完（drawing/playing/gameOver 都算）⇒ 说的是"跟着变的是下面牌桌那一份"', () => {
    for (const phase of ['drawing', 'playing', 'gameOver']) {
      render(<NetSetupPanel snapshot={view({ phase, players: assigned.players })} />);
      expect(text()).toContain('开局那一段走完了');
      expect(text()).toContain('下面牌桌那一份局面');
      cleanup();
    }
  });

  it('一份没有席位的读数（players 是空桌）⇒ 不配一句"骰子停下"，只说这一份里一个席位也没收到', () => {
    render(<NetSetupPanel snapshot={view({ phase: 'diceRoll', players: [] })} />);
    expect(text()).toContain('一个席位也没收到');
    expect(text()).not.toContain('骰子停下');
  });

  it('别人那几席的牌在这格里没有落点：整格文字搜不到手牌、征召池或候选名单里任何一个引用', () => {
    render(
      <NetSetupPanel
        snapshot={view({
          phase: 'generalDraft',
          players: [
            { id: 1, name: '房主乙', diceRoll: 11, seatOrder: 0, faction: '蜀', hand: [{ id: 'hand-SECRET' }], generalPool: [{ id: 'pool-SECRET' }] },
            { id: 2, name: '客人甲', diceRoll: 4, seatOrder: 1, faction: '魏', hand: [{ hidden: true }], generalPool: [{ hidden: true }] },
          ],
          deck: [{ id: 'deck-SECRET' }],
        })}
      />,
    );
    expect(text()).not.toMatch(/SECRET/);
    expect(text()).not.toMatch(/hidden/);
  });

  it('陌生阶段名（比如对面那份来自更老的一套界面态）⇒ 说"不属于开局这一段"，不硬凑一档', () => {
    render(<NetSetupPanel snapshot={view({ phase: 'turn', players: assigned.players })} />);
    expect(text()).toContain('或那份读数不属于开局这一段');
  });
});
