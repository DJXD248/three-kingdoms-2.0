/**
 * J2 客人端呈现契约的字段级证人：正向＝公开的事实一份不少（客人看得见同一局），
 * 反向＝私有的内容一个字都不上线（手牌内容、将池内容、牌堆顺序、随机游标、
 * 待答问答里已翻译好的效果）。反向断言比正向重要：漏一格就是泄牌。
 */
import { describe, expect, it } from 'vitest';
import type { EngineState } from '../core/GameState';
import { MAX_WIRE_BYTES } from './netProtocol';
import { HIDDEN_MARKER, NEVER_SENT_TOP_LEVEL, buildBroadcastView, hiddenCount } from './snapshotView';
import { isRestorableEngineState } from '../store/gameStateAdapter';
import { createCardDeck } from '../data/cards';
import { allGenerals } from '../data/generals';

function hiddenCard(id: string) {
  return { id, name: `暗牌-${id}`, type: '粮草' };
}

function fieldGeneral(ownerId: number) {
  return {
    general: { id: 'g1', name: '赵云', faction: '蜀', type: '武将', skills: [] },
    ownerId,
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
  };
}

function matchState(): EngineState {
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
        diceRoll: 17,
        hp: 4,
        baseHp: 6,
        baseMaxHp: 6,
        isAlive: true,
        isSpectating: false,
        isAi: false,
        aiTier: 'tier2',
        hand: [hiddenCard('p1-h1'), hiddenCard('p1-h2'), hiddenCard('p1-h3')],
        generalPool: [hiddenCard('p1-pool-1'), hiddenCard('p1-pool-2')],
        fieldGenerals: [fieldGeneral(1)],
        graveyard: [{ id: 'dead-1', name: '关羽', faction: '蜀', type: '武将', skills: [] }],
        statuses: [{ id: 'st-1', kind: 'flipped', duration: 1, stacks: 2, metadata: { cardId: 'SECRET_STATUS' } }],
        // 索引签名允许别人往玩家身上挂东西 ⇒ 白名单必须把它挡下来
        SECRET_PLAYER_FIELD: '不该上线',
      },
      {
        id: 2,
        name: '客人乙',
        faction: '魏',
        seatOrder: 1,
        baseHp: 5,
        isAlive: true,
        hand: [hiddenCard('p2-h1')],
        generalPool: [],
        fieldGenerals: [],
        graveyard: [],
        statuses: [],
      },
    ],
    currentPlayerId: 1,
    turn: 7,
    round: 4,
    deck: [hiddenCard('deck-1'), hiddenCard('deck-2'), hiddenCard('deck-3')],
    discardPile: [{ id: 'disc-1', name: '赤兔马', type: '军备' }],
    metadata: { winnerId: null, roomId: 'ROOMAA', source: 'zustand-compatibility-adapter', drawPlayerId: 1 },
    drawState: { reason: 'turnStart', playerId: 1, totalCards: 2 },
    isFirstTurn: false,
    rngState: { s: 123456789 },
    consumedSkills: [{ stableId: '7:1:赵云:冲阵', skillId: '1:赵云:冲阵', turn: 7, playerId: 1 }],
    pendingChoice: {
      key: 'ch:7:4:1:赵云:冲阵',
      playerId: 1,
      options: [{ label: '拿牌堆顶第一张', events: [{ type: 'DRAW', data: { cardId: 'deck-1' } }] as never }],
    },
    pendingReaction: { turn: 7, serial: 1, nodes: [] },
    statModifiers: [
      {
        id: 'sm:1',
        seq: 1,
        key: 'maxHp',
        mode: 'delta',
        value: 1,
        targetPlayerId: 1,
        targetId: 'g1',
        ownerPlayerId: 1,
        ownerGeneralId: 'g1',
        ownerSkillId: '1:赵云:冲阵',
        locked: false,
        passive: true,
      } as never,
    ],
  };
}

describe('J2 遮蔽视图：只发公开的事实', () => {
  const view = buildBroadcastView(matchState());

  it('手牌／将领池／牌堆：数量保住、内容全换成遮罩', () => {
    expect(hiddenCount(view.players[0].hand)).toBe(3);
    expect(hiddenCount(view.players[1].hand)).toBe(1);
    expect(hiddenCount(view.players[0].generalPool)).toBe(2);
    expect(hiddenCount(view.deck)).toBe(3);
    for (const card of [...view.players[0].hand!, ...view.players[1].hand!, ...view.deck!]) {
      expect(card).toEqual(HIDDEN_MARKER);
    }
  });

  it('反向断言：暗牌的名字一个都没上线（手牌、将池、牌堆、护甲牌）', () => {
    const wire = JSON.stringify(view);
    for (const id of ['p1-h1', 'p1-h2', 'p1-h3', 'p2-h1', 'p1-pool-1', 'deck-1', 'deck-2', 'arm-1', 'arm-2']) {
      expect(wire).not.toContain(id);
    }
    expect(wire).not.toContain('SECRET_STATUS');
    expect(wire).not.toContain('SECRET_PLAYER_FIELD');
  });

  it('牌堆顺序绝不上线：连数组的先后都还原不出内容', () => {
    const wire = JSON.stringify(matchState().deck);
    const masked = JSON.stringify(view.deck);
    expect(wire).not.toBe(masked);
    expect(masked).toBe(JSON.stringify([HIDDEN_MARKER, HIDDEN_MARKER, HIDDEN_MARKER]));
  });

  it('三样绝不上线：随机游标、待答选择、待答响应（后者装着已翻译好的效果）', () => {
    for (const key of NEVER_SENT_TOP_LEVEL) {
      expect(view).not.toHaveProperty(key);
    }
    expect(JSON.stringify(view)).not.toContain('拿牌堆顶第一张');
  });

  it('场面事实一份不少：轮到谁、第几轮、营地、场上将领、墓地、弃牌堆、状态、修正器账本', () => {
    expect(view.currentPlayerId).toBe(1);
    expect(view.turn).toBe(7);
    expect(view.round).toBe(4);
    expect(view.phase).toBe('turn');
    expect(view.timelinePhase).toBe('ACTION');
    expect(view.players[0].name).toBe('房主甲');
    expect(view.players[0].baseHp).toBe(6);
    expect(view.players[1].baseHp).toBe(5);
    expect(view.players[0].fieldGenerals).toHaveLength(1);
    const fg = view.players[0].fieldGenerals![0] as Record<string, unknown>;
    expect(fg.general).toMatchObject({ name: '赵云' });
    expect(fg.currentHp).toBe(3);
    expect(fg.currentArmor).toBe(2);
    expect(hiddenCount(fg.armorCards)).toBe(2);
    expect(view.players[0].graveyard).toEqual([expect.objectContaining({ name: '关羽' })]);
    expect(view.discardPile).toEqual([expect.objectContaining({ name: '赤兔马' })]);
    expect(view.players[0].statuses).toEqual([{ id: 'st-1', kind: 'flipped', duration: 1, stacks: 2 }]);
    expect(view.statModifiers).toHaveLength(1);
    expect(view.consumedSkills).toHaveLength(1);
    expect(view.drawState).toEqual({ reason: 'turnStart', playerId: 1, totalCards: 2 });
  });

  it('metadata 只留客人看得见的两把钥匙，房主自己的记账不落线上', () => {
    expect(Object.keys(view.metadata!).sort()).toEqual(['roomId', 'winnerId']);
  });

  it('算出来的形状仍是合法 EngineState ⇒ 客人端那道闸（isRestorableEngineState）放得过去', () => {
    expect(isRestorableEngineState(view)).toBe(true);
    expect(isRestorableEngineState(buildBroadcastView({ ...matchState(), players: [], currentPlayerId: null }))).toBe(true);
  });

  it('一份真牌桌（满牌堆＋场上八员＋墓地弃牌堆都装着）遮蔽后仍在单帧上限内', () => {
    const shuffle = () => 0.5; // 不借 Math.random：这组证人每次量到同一个数
    const deck = createCardDeck(shuffle);
    const roster = allGenerals.slice(0, 12);
    const full = matchState();
    full.deck = deck;
    full.discardPile = deck.slice(0, 20);
    full.players = full.players.map((p, i) => ({
      ...p,
      hand: deck.slice(0, 8),
      graveyard: roster.slice(i * 6, i * 6 + 6),
      fieldGenerals: roster.slice(i * 2, i * 2 + 4).map((g) => ({ ...fieldGeneral(p.id), general: g })),
    }));
    const bytes = new TextEncoder().encode(JSON.stringify(buildBroadcastView(full))).length;
    expect(full.deck.length).toBeGreaterThanOrEqual(50);
    expect(bytes).toBeLessThan(MAX_WIRE_BYTES);
    expect(bytes).toBeLessThan(64 * 1024);
  });
});
