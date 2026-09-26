/**
 * v2.8.0 identity lock — store draft-chain regression (分发即锁 / 未征召即沉没 /
 * 编辑器现实参与分发 / draftDistributed 是 B 类镜像、不进 EngineState)。
 *
 * 官方池零同势力同名，双胞胎靠 generalEdits.identity 注入合成；吴池用
 * disabledGenerals 收窄到确定张数，保证候选面必含锁键载体卡（免抽样抖动）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { allGenerals, type General } from '../data/generals';
import type { Player } from './gameStoreTypes';

const wuGenerals = allGenerals.filter(g => g.faction === '吴');
const carrier = wuGenerals.find(g => g.name === '孙策')!;
const twin = wuGenerals.find(g => g.id !== carrier.id)!;
// 确定被发的 10 张：载体 + 双胞胎 + 8 张其余吴将；其余全部禁用。
const keptIds = new Set<string>([carrier.id, twin.id, ...wuGenerals.map(g => g.id).filter(id => id !== carrier.id && id !== twin.id).slice(0, 8)]);
const wuDisabled = new Set<string>(wuGenerals.map(g => g.id).filter(id => !keptIds.has(id)));

const surfaceOf = (s: { draftGenerals: General[]; draftQunGenerals: General[] }): General[] => [
  ...s.draftGenerals, ...s.draftQunGenerals,
];

// 两座同为吴：跨座锁（同锁键挡另一张）在候选面上可直接观察。
const twoWuSeats = [
  { id: 1, name: '玩家1', faction: '吴', seatOrder: 0 },
  { id: 2, name: '玩家2', faction: '吴', seatOrder: 1 },
] as unknown as Player[];

function armDraftState() {
  useGameStore.setState({
    players: twoWuSeats,
    disabledGenerals: wuDisabled,
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

describe('gameStore 征召链身份锁', () => {
  beforeEach(() => {
    useGameStore.setState({
      skillEdits: {},
      generalEdits: {},
      disabledGenerals: new Set<string>(),
      identityRegistry: [],
      draftDistributed: [],
      selectedDraftGenerals: [],
      draftPlayerIndex: 0,
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('同锁双胞胎同面只发一张（编辑器填身份参与分发）', () => {
    armDraftState();
    useGameStore.getState().distributeDraftGenerals();
    const ids = surfaceOf(useGameStore.getState()).map(g => g.id);
    // 无身份注入时两张都在面上（豁免基线）
    expect(ids).toContain(carrier.id);
    expect(ids).toContain(twin.id);

    useGameStore.setState({ generalEdits: { [twin.id]: { identity: carrier.name } } } as never);
    useGameStore.getState().distributeDraftGenerals();
    const ids2 = surfaceOf(useGameStore.getState()).map(g => g.id);
    expect(ids2.filter(id => id === carrier.id || id === twin.id)).toHaveLength(1);
  });

  it('分发即锁：座0候选全体计入 draftDistributed，沉没卡照锁，座1挡下另一张', () => {
    armDraftState();
    useGameStore.setState({ generalEdits: { [twin.id]: { identity: carrier.name } } } as never);
    useGameStore.getState().distributeDraftGenerals();
    const s0 = useGameStore.getState();
    const dealt = surfaceOf(s0);
    expect(s0.draftDistributed).toHaveLength(dealt.length);

    const survivor = dealt.find(g => g.id === carrier.id || g.id === twin.id)!;
    const otherId = survivor.id === carrier.id ? twin.id : carrier.id;
    // 只征召主面 → 群面整段沉没
    useGameStore.setState({ selectedDraftGenerals: s0.draftGenerals.slice(0, 10) });
    s0.confirmDraft();

    const s1 = useGameStore.getState();
    expect(s1.draftPlayerIndex).toBe(1);
    expect(s1.draftDistributed).toHaveLength(dealt.length + surfaceOf(s1).length);
    for (const sunk of s0.draftQunGenerals) {
      expect(s1.draftDistributed.map(g => g.id)).toContain(sunk.id);
    }
    // 另一半从未被分发（同面已去重），但同锁键已被载体占据 → 座1也拿不到
    expect(surfaceOf(s1).map(g => g.id)).not.toContain(otherId);
  });

  it('draftDistributed 只住 store 镜像，不进 EngineState（B 类）', () => {
    armDraftState();
    useGameStore.getState().distributeDraftGenerals();
    expect('draftDistributed' in useGameStore.getState().engineState).toBe(false);
  });

  it('留空身份（无身份）不参与锁：两张同势力改名卡可同面共存', () => {
    armDraftState();
    useGameStore.setState({
      generalEdits: {
        [carrier.id]: { identity: '', name: '无名甲' },
        [twin.id]: { identity: '', name: '无名乙' },
      },
    } as never);
    useGameStore.getState().distributeDraftGenerals();
    const ids = surfaceOf(useGameStore.getState()).map(g => g.id);
    expect(ids).toContain(carrier.id);
    expect(ids).toContain(twin.id);
  });
});
