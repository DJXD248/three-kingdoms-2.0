/**
 * J2 客人端牌桌的证人：它读的是**遮蔽后**的那一份，所以这里刻意把 buildBroadcastView
 * 也接进来——两层对接得上，才是"客人看得见同一局"；单层各自好看等于没证。
 * 反向那条同样重要：观战面里一个能按的东西都不许有（客人动手＝J4）。
 * 切片③（v2.9.25）加的是"自己那一席画牌面、别人那一格画张数"，以及两张表谁先到都不崩。
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import NetSpectator from './NetSpectator';
import type { EngineState } from '../core/GameState';
import { buildBroadcastView } from '../network/snapshotView';

function hiddenCard(id: string) {
  return { id, name: `暗牌-${id}`, type: '粮草' };
}

function state(): EngineState {
  return {
    version: 1,
    phase: 'turn',
    timelinePhase: 'ACTION',
    players: [
      {
        id: 1,
        name: '房主甲',
        faction: '蜀',
        seatOrder: 0,
        baseHp: 6,
        baseMaxHp: 6,
        isAlive: true,
        isSpectating: false,
        isAi: false,
        hand: [hiddenCard('h1'), hiddenCard('h2'), hiddenCard('h3')],
        generalPool: [hiddenCard('p1'), hiddenCard('p2')],
        fieldGenerals: [
          {
            general: { id: 'g1', name: '赵云', faction: '蜀', type: '武将', skills: [] },
            ownerId: 1,
            position: { q: 0, r: 0 },
            currentHp: 3,
            maxHp: 4,
            meleeAtk: 2,
            rangedAtk: 1,
            armor: 1,
            currentArmor: 2,
            isArming: false,
            hasMoved: true,
            hasAttacked: false,
            hasSupplied: false,
            justDeployed: false,
            armorCards: [hiddenCard('arm-1'), hiddenCard('arm-2')],
          },
        ],
        graveyard: [],
        statuses: [],
      },
      {
        id: 2,
        name: '客人乙',
        faction: '魏',
        seatOrder: 1,
        baseHp: 0,
        isAlive: false,
        hand: [hiddenCard('q1'), hiddenCard('q2')],
        generalPool: [hiddenCard('poolq1')],
        fieldGenerals: [],
        graveyard: [],
        statuses: [],
      },
    ],
    currentPlayerId: 1,
    turn: 4,
    round: 2,
    deck: [hiddenCard('d1'), hiddenCard('d2'), hiddenCard('d3'), hiddenCard('d4')],
    discardPile: [hiddenCard('x1')],
    metadata: { winnerId: 1, roomId: 'ROOMAA', SECRET_TOP: '不该上线' },
    drawState: { current: 0 },
    isFirstTurn: false,
    rngState: { seed: 1, cursor: 2 },
    statModifiers: {},
    consumedSkills: [],
    pendingChoice: null,
    pendingReaction: null,
  } as unknown as EngineState;
}

const text = () => document.body.textContent ?? '';

describe('客人那一格的牌桌：读得到公开事实，读不到私有内容，也没有任何东西可按', () => {
  it('场上将名／体力／护甲、轮到谁、营地剩多少、牌堆几张——全都跟着房主那份走', () => {
    render(<NetSpectator snapshot={buildBroadcastView(state())} />);
    const shown = text();
    expect(shown).toContain('第 2 轮 · 轮到');
    expect(shown).toContain('房主甲');
    expect(shown).toContain('行动中');
    expect(shown).toContain('赵云');
    expect(shown).toContain('本局结束：房主甲');
    expect(shown).toContain('🏯6');
    expect(shown).toContain('已阵亡');
    expect(shown).toContain('场上没有将领');
  });

  it('私有内容只显示数量：🃏3 张 · 👤2 员 · 牌堆 4 张，牌面一个不出现', () => {
    render(<NetSpectator snapshot={buildBroadcastView(state())} />);
    const shown = text();
    expect(shown).toContain('🃏3 张');
    expect(shown).toContain('👤2 员');
    expect(shown).toContain('牌堆里还剩 4 张 · 弃牌堆 1 张');
    expect(shown).not.toContain('暗牌');
  });

  it('还没收到局面时给一句人读的话，不是一片空白', () => {
    const first = render(<NetSpectator snapshot={null} />);
    expect(text()).toContain('还没收到房主发来的局面');
    first.unmount();
    render(<NetSpectator snapshot={buildBroadcastView({ ...state(), players: [] })} />);
    expect(text()).toContain('还没收到房主发来的局面');
  });

  it('观战面里没有任何可点的元素（客人动手＝J4）', () => {
    render(<NetSpectator snapshot={buildBroadcastView(state())} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('button, a[href], input, select, textarea')).toHaveLength(0);
  });
});

/**
 * 切片③（v2.9.25）：房主按席位各出一份，客人这一格第一次能画出**自己**的牌面。
 * 这里刻意把 `buildBroadcastView(state, 那一席)` 与 `mySeat` 成对喂进来：
 * 放开的口径由遮蔽层定，画不画由这一格判，两边对不上就是泄牌或白屏。
 */
describe('客人自己那一席画牌面，别人那一格仍只画张数', () => {
  it('第 2 席那份 + mySeat=2 ⇒ 我的手牌与征召池是牌面，第 1 席的仍是数量', () => {
    render(<NetSpectator snapshot={buildBroadcastView(state(), 2)} mySeat={2} />);
    const shown = text();
    expect(shown).toContain('暗牌-q1');
    expect(shown).toContain('暗牌-q2');
    expect(shown).toContain('暗牌-poolq1');
    expect(shown).toContain('你的席位');
    // 对面那一席一个字也没跟着放开（连房主自己也是"别人"）。
    expect(shown).not.toContain('暗牌-h1');
    expect(shown).not.toContain('暗牌-p1');
    expect(shown).toContain('🃏3 张');
  });

  it('场上将领身上那几张军备不在放开之列（需求点的是手牌与征召池）', () => {
    render(<NetSpectator snapshot={buildBroadcastView(state(), 1)} mySeat={1} />);
    const shown = text();
    expect(shown).toContain('暗牌-h1');
    expect(shown).not.toContain('暗牌-arm-1');
    expect(shown).not.toContain('暗牌-arm-2');
  });

  it('两张表谁先到都不崩：席位表先、指名的快照还没到 ⇒ 照旧只画张数', () => {
    render(<NetSpectator snapshot={buildBroadcastView(state())} mySeat={2} />);
    const shown = text();
    expect(shown).toContain('🃏2 张');
    expect(shown).not.toContain('暗牌');
  });

  it('说了"哪一席是我"才改口；没排上位子时那句话仍是真话', () => {
    const first = render(<NetSpectator snapshot={buildBroadcastView(state(), 2)} mySeat={2} />);
    expect(text()).toContain('你自己那一席的手牌与征召池画的是牌面');
    expect(text()).toContain('牌堆顺序谁都不发');
    first.unmount();

    render(<NetSpectator snapshot={buildBroadcastView(state())} />);
    expect(text()).toContain('现在还没给你排定席位');
  });

  it('放开自己那一份之后，这一格仍然一处也不可点', () => {
    render(<NetSpectator snapshot={buildBroadcastView(state(), 2)} mySeat={2} />);
    expect(document.querySelectorAll('button, a[href], input, select, textarea')).toHaveLength(0);
  });
});
