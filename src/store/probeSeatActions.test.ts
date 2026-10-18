/**
 * J4 只读探针的钉子（v2.9.11）。
 *
 * 房主给客人发"这一步能走"的清单、收到编号后当场重算再对，两边都靠探针。
 * 探针一旦带副作用，代价都不是编译期能看见的：推进 `rngState` ⇒ 客人下一次抽到
 * 的牌和清单上算好的不是同一张；推进对局 ⇒ 光"看一眼能走什么"就把回合走掉了；
 * 进录像 ⇒ 回放里凭空多出没有的一步。这三条各有一枚钉子，外加"同一个局面算两次
 * 得到同一张清单"（编号方案的命根子）。
 */
import { describe, expect, it } from 'vitest';
import type { EngineState } from '../core/GameState';
import { getLiveReplayEntryCount, resetLiveReplay } from '../replay/liveReplayRecorder';
import { probeSeatActions, __residentEngineProbe, __resetResidentEngineContainer } from './engineExecutionBridge';
import { canonicalPayload } from '../network/netSeat';

function makeState(): EngineState {
  return {
    version: 1,
    phase: 'playing',
    timelinePhase: 'ACTION',
    players: [
      {
        id: 1,
        name: '刘备',
        faction: '蜀',
        isAlive: true,
        baseHp: 5,
        hand: [{ id: 'card_kill', instanceId: 'c1', type: '杀', name: '杀' }],
        generalPool: [{ id: 'wei_001', instanceId: 'p1', type: '武将', name: '夏侯惇', hp: 4 }],
        fieldGenerals: [],
        graveyard: [],
        statuses: [],
      },
      {
        id: 2,
        name: '曹操',
        faction: '魏',
        isAlive: true,
        baseHp: 5,
        hand: [],
        generalPool: [],
        fieldGenerals: [],
        graveyard: [],
        statuses: [],
      },
    ],
    currentPlayerId: 1,
    turn: 3,
    round: 2,
    deck: [{ id: 'card_supply', instanceId: 'd1', type: '粮草', name: '粮草' }],
    discardPile: [],
    rngState: { seed: '探针不该碰它', cursor: 7 },
    metadata: { roomId: '探针房' },
  } as unknown as EngineState;
}

const shape = (state: EngineState) => JSON.stringify({
  turn: state.turn,
  round: state.round,
  currentPlayerId: state.currentPlayerId,
  phase: state.phase,
  hands: state.players.map(p => (Array.isArray(p.hand) ? p.hand : []).length),
  deck: (Array.isArray(state.deck) ? state.deck : []).length,
  rng: state.rngState,
});

describe('probeSeatActions：看一眼不能改变任何事', () => {
  it('不推随机游标、不推进对局、不碰常驻容器、不进录像', () => {
    resetLiveReplay();
    __resetResidentEngineContainer();
    const engineState = makeState();
    const storeState = { engineState };
    const before = shape(engineState);
    const entriesBefore = getLiveReplayEntryCount();
    const containerBefore = __residentEngineProbe().dispatches;

    const actions = probeSeatActions(storeState, 1);

    expect(shape(engineState)).toBe(before);
    expect(getLiveReplayEntryCount()).toBe(entriesBefore);
    expect(__residentEngineProbe().dispatches).toBe(containerBefore);
    // 探针确实读到了东西：这一席是当前行动席，合法集里至少要有「⏭️结束回合」
    expect(actions.map(a => a.type)).toContain('END_TURN');
    resetLiveReplay();
  });

  it('轮不到的那一席：一条也不给（不越权代打＝客人那边的第一道闸）', () => {
    const storeState = { engineState: makeState() };
    expect(probeSeatActions(storeState, 2)).toEqual([]);
  });

  it('同一个局面算两次 ⇒ 同一张清单（房主发清单与收编号时重算靠的就是这个）', () => {
    const storeState = { engineState: makeState() };
    const first = probeSeatActions(storeState, 1);
    const second = probeSeatActions(storeState, 1);
    expect(second.map(a => `${a.type}|${canonicalPayload(a.payload ?? null)}`))
      .toEqual(first.map(a => `${a.type}|${canonicalPayload(a.payload ?? null)}`));
    // 但 action.id 是进程计数器：它每次都变，所以绝不能进编号
    expect(second[0].id).not.toBe(first[0].id);
  });

  it('探针不认得的人（席位号不存在）⇒ 空清单，不抛错', () => {
    const storeState = { engineState: makeState() };
    expect(probeSeatActions(storeState, 99)).toEqual([]);
  });
});
