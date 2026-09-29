/**
 * v2.2.9 human-vs-AI driver tests.
 *
 * These pin the phase-4 contract: AI seats act through the PRODUCTION store
 * pipeline only (createRoom → dice → draft → draw → turns), the seat stamps
 * (isAi/aiTier) survive the engine dispatch clones, human seats are never
 * touched by the driver, and a 2-AI match driven purely by runAiStep reaches
 * a real gameOver.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { GameState, Player } from '../store/gameStore';
import { assignFactions, createLobbyPlayers, defaultSeatModes, pickAiDraftPicks, buildDraftCandidates, type AiSeatMode } from '../setup/runtimeSetup';
import type { General } from '../data/generals';
import { resetAiControllers, runAiStep } from './aiTurnDriver';

function freshStore() {
  resetAiControllers();
  useGameStore.setState({
    phase: 'menu', players: [], currentPlayerIndex: 0, currentRound: 1,
    roomName: '人机测试房', winnerId: null, isTestMode: false,
    draftPlayerIndex: 0, selectedDraftGenerals: [], draftGenerals: [], draftQunGenerals: [],
    drawContext: null, revealedDrawCards: [], engineState: useGameStore.getState().engineState,
    seatModes: defaultSeatModes(), skillEdits: {}, generalEdits: {},
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

/** Room with the given seat modes, factions assigned, draft screen up. */
function setupRoomAtDraft(modes: AiSeatMode[]) {
  useGameStore.setState({
    seatModes: modes, playerCount: modes.length, roomName: '人机测试房',
  } as Partial<ReturnType<typeof useGameStore.getState>>);
  useGameStore.getState().createRoom();
  useGameStore.setState(st => ({ players: assignFactions(st.players) as Player[] }));
  useGameStore.getState().distributeDraftGenerals();
}

function drive(maxSteps: number, until: (s: GameState) => boolean): { steps: number; state: GameState } {
  for (let i = 0; i < maxSteps; i += 1) {
    const s = useGameStore.getState();
    if (until(s)) return { steps: i, state: s };
    const acted = runAiStep(s);
    expect(acted, `driver stalled at step ${i} (phase=${s.phase})`).toBe(true);
  }
  throw new Error(`step budget exhausted after ${maxSteps} steps`);
}

describe('seat stamps (v2.2.9)', () => {
  it('createLobbyPlayers stamps isAi/aiTier and renames AI seats', () => {
    const players = createLobbyPlayers(3, [
      { isAi: true, tier: 'aggressive' },
      { isAi: false, tier: 'balanced' },
      { isAi: true, tier: 'conservative' },
    ]);
    expect(players[0].name).toBe('AI·激进');
    expect(players[0].isAi).toBe(true);
    expect(players[0].aiTier).toBe('aggressive');
    expect(players[1].name).toBe('玩家2');
    expect(players[1].isAi).toBe(false);
    expect(players[2].aiTier).toBe('conservative');
  });

  it('pickAiDraftPicks takes 7 main + 3 群 and refuses short pools', () => {
    const { main, qun } = buildDraftCandidates('魏', new Set());
    const picks: General[] = pickAiDraftPicks(main, qun);
    expect(picks).toHaveLength(10);
    expect(picks.filter(g => g.faction === '群')).toHaveLength(3);
    expect(picks.filter(g => g.faction === '魏')).toHaveLength(7);
    expect(pickAiDraftPicks(main.slice(0, 5), qun)).toEqual([]);
  });
});

describe('runAiStep — draft phase', () => {
  beforeEach(freshStore);

  it('AI seats auto-draft legally (10 cards, 1–3 群) and open the initial draw', () => {
    setupRoomAtDraft([
      { isAi: true, tier: 'balanced' },
      { isAi: true, tier: 'conservative' },
    ]);
    drive(10, s => s.phase !== 'generalDraft');
    const s = useGameStore.getState();
    expect(s.phase).toBe('drawing');
    for (const p of s.players) {
      expect(p.generalPool).toHaveLength(10);
      const qun = p.generalPool.filter(g => g.faction === '群').length;
      expect(qun).toBeGreaterThanOrEqual(1);
      expect(qun).toBeLessThanOrEqual(3);
    }
  });

  it('human draft seats are left alone by the driver', () => {
    setupRoomAtDraft([
      { isAi: false, tier: 'balanced' },
      { isAi: true, tier: 'balanced' },
    ]);
    expect(runAiStep(useGameStore.getState())).toBe(false);
    expect(useGameStore.getState().phase).toBe('generalDraft');
  });
});

describe('runAiStep — lobby/dice chain (all-AI only)', () => {
  beforeEach(freshStore);

  it('advances lobby→diceRoll→factionAssign for an all-AI room', () => {
    useGameStore.setState({
      seatModes: [{ isAi: true, tier: 'balanced' }, { isAi: true, tier: 'aggressive' }],
      playerCount: 2,
    } as Partial<ReturnType<typeof useGameStore.getState>>);
    useGameStore.getState().createRoom();
    expect(useGameStore.getState().phase).toBe('lobby');
    runAiStep(useGameStore.getState());
    expect(useGameStore.getState().phase).toBe('diceRoll');
    // assignFactions schedules a real 1.5s timeout — keep it fake so it can
    // never fire into later tests.
    vi.useFakeTimers();
    runAiStep(useGameStore.getState());
    vi.useRealTimers();
    const s = useGameStore.getState();
    expect(s.phase).toBe('factionAssign');
    expect(s.players.every(p => p.faction !== null)).toBe(true);
  });

  it('stays hands-off while any seat is human', () => {
    useGameStore.setState({
      seatModes: [{ isAi: true, tier: 'balanced' }, { isAi: false, tier: 'balanced' }],
      playerCount: 2,
    } as Partial<ReturnType<typeof useGameStore.getState>>);
    useGameStore.getState().createRoom();
    expect(runAiStep(useGameStore.getState())).toBe(false);
    expect(useGameStore.getState().phase).toBe('lobby');
  });
});

describe('runAiStep — full 2-AI match through the production store', () => {
  beforeEach(freshStore);

  it('balanced vs conservative reaches gameOver with winner + stamps intact', () => {
    setupRoomAtDraft([
      { isAi: true, tier: 'balanced' },
      { isAi: true, tier: 'conservative' },
    ]);
    const { steps, state } = drive(8000, s => s.phase === 'gameOver');
    expect(state.winnerId).not.toBeNull();
    expect(steps).toBeGreaterThan(20);
    // isAi/aiTier must survive every dispatch clone of the whole match.
    expect(state.players.filter(p => p.isAi).length).toBe(2);
    expect(state.players.every(p => p.aiTier === 'balanced' || p.aiTier === 'conservative')).toBe(true);
    // And at least one seat actually played (deployed generals or lost base HP).
    const played = state.players.some(p => p.fieldGenerals.length > 0 || p.baseHp < p.baseMaxHp || p.graveyard.length > 0);
    expect(played).toBe(true);
  }, 180_000);
});

describe('runAiStep — human-vs-AI interleaving', () => {
  beforeEach(freshStore);

  it('idles on the human turn and acts again when the AI seat is up', () => {
    setupRoomAtDraft([
      { isAi: false, tier: 'balanced' },
      { isAi: true, tier: 'aggressive' },
    ]);
    // Human drafts seat 0 by hand (same 7+3 pick the AI would make).
    const s0 = useGameStore.getState();
    const picks = pickAiDraftPicks(s0.draftGenerals, s0.draftQunGenerals);
    useGameStore.setState({ selectedDraftGenerals: picks });
    useGameStore.getState().confirmDraft();

    const afterDraft = () => useGameStore.getState();
    // Seat 0 done → draft moves to the AI seat; one driver step finishes it
    // and opens the initial draw.
    expect(afterDraft().phase).toBe('generalDraft');
    expect(afterDraft().players[1].isAi).toBe(true);
    expect(runAiStep(afterDraft())).toBe(true);
    expect(afterDraft().phase).toBe('drawing');
    // Seat 1's stamp survived the BEGIN_DRAW projection writeback.
    expect(afterDraft().players[1].isAi).toBe(true);

    // The initial draw belongs to the human → driver must not touch it.
    expect(runAiStep(afterDraft())).toBe(false);

    // Human draws + confirms via the normal store flow → AI seat's turn.
    expect(afterDraft().executeDraw(5, 0)).toBe(true);
    afterDraft().confirmDraw();
    const sTurn = afterDraft();
    expect(sTurn.players[sTurn.currentPlayerIndex].isAi).toBe(true);

    // Now the AI acts on its own turn.
    const before = sTurn.engineState;
    expect(runAiStep(sTurn)).toBe(true);
    expect(useGameStore.getState().engineState).not.toBe(before);
  });
});

// v2.8.11 刀2：择一窗里可以被发动门槛置灰。司机若照旧硬点 0 号，灰项会被
// 解析器拒（CHOICE_OPTION_LOCKED），那一步零进展就成了死循环——所以兜底改成
// "记录顺序上的第一个可选项"，一个都没有则不动手（停滞守卫接手）。
describe('runAiStep — 择一窗里的置灰项（v2.8.11 刀2）', () => {
  beforeEach(freshStore);

  /** 把现役账本摆成指定形状，chooseOption 换成记录仪：只验司机择席，不验结算。 */
  const frozenWorldWith = (options: unknown[]): number[] => {
    const picks: number[] = [];
    const base = useGameStore.getState().engineState;
    useGameStore.setState({
      phase: 'playing',
      players: [{ id: 7, name: 'AI·均衡', isAi: true, aiTier: 'balanced', faction: '魏' }] as unknown as Player[],
      engineState: { ...base, pendingChoice: { key: 'ch:1:1:gate-driver', playerId: 7, options } },
      chooseOption: (index: number) => { picks.push(index); return true; },
    } as Partial<ReturnType<typeof useGameStore.getState>>);
    return picks;
  };

  it('0 号被门槛置灰⇒取记录顺序上的第一个可选项', () => {
    const picks = frozenWorldWith([
      { label: '摸三张牌', events: [], enabled: false, gateText: '手牌≥9' },
      { label: '摸一张牌', events: [] },
    ]);
    expect(runAiStep(useGameStore.getState())).toBe(true);
    expect(picks).toEqual([1]);
  });

  it('整窗都灰（桥接层不该造出这种窗）⇒不动作，绝不用点击硬撞', () => {
    const picks = frozenWorldWith([
      { label: '摸三张牌', events: [], enabled: false, gateText: '手牌≥9' },
      { label: '摸一张牌', events: [], enabled: false, gateText: '体力≥5' },
    ]);
    expect(runAiStep(useGameStore.getState())).toBe(false);
    expect(picks).toEqual([]);
  });
});
