/**
 * v2.9.12 内容包 · store 那一层的原子性证人。
 * 界面已经核过一遍了，这里钉的是"绕过界面直接调库"也装不进半包：
 * 库里这一关自己把整包退回来，并把被挡下的逐条说出去（§H3 的老口径：拒绝要带理由）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { allGenerals, type General } from '../data/generals';
import { createAuthoredGeneral } from '../domain/generalProvenance';
import { AUTHORED_GENERALS_KEY, loadAuthoredGenerals } from './editorPersistence';
import { useGameStore } from './gameStore';

function diy(name: string): General {
  const created = createAuthoredGeneral({ name, faction: '蜀', hp: 4, identity: name, skills: [{ name: `${name}技` }] }, 'DIY');
  if (!created.ok) throw new Error(`setup failed: ${created.reason}`);
  return created.general;
}

describe('installAuthoredGenerals（内容包落库）', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTHORED_GENERALS_KEY);
    useGameStore.setState({ authoredGenerals: [], developerMode: false, generalEdits: {}, skillEdits: {}, lockedGeneralIds: new Set<string>() } as never);
  });

  it('整包一次落库：状态、localStorage、牌池三处都看得见', () => {
    const a = diy('张三'), b = diy('李四');
    const result = useGameStore.getState().installAuthoredGenerals([a, b]);
    expect(result.refused).toEqual([]);
    expect(result.installed).toHaveLength(2);
    expect(useGameStore.getState().authoredGenerals.map(g => g.id)).toEqual([a.id, b.id]);
    expect(loadAuthoredGenerals().map(g => g.id)).toEqual([a.id, b.id]);
    const poolIds = useGameStore.getState().poolGenerals().map(g => g.id);
    expect(poolIds).toContain(a.id);
    expect(poolIds.filter(id => allGenerals.some(g => g.id === id))).toHaveLength(allGenerals.length);
  });

  it('非开发者照样能装自己人的卡：§H3 只挡仓库名册上的官方卡，不挡玩家自制', () => {
    expect(useGameStore.getState().developerMode).toBe(false);
    expect(useGameStore.getState().installAuthoredGenerals([diy('张三')]).installed).toHaveLength(1);
  });

  it('一条编号不合法 ⇒ 整包一条也不写，且被挡下的那条说得出名字', () => {
    const good = diy('张三');
    const forged = { ...allGenerals[0], source: 'DIY' as const } as General;
    const result = useGameStore.getState().installAuthoredGenerals([good, forged]);
    expect(result.installed).toEqual([]);
    expect(result.refused).toEqual([forged.id]);
    expect(useGameStore.getState().authoredGenerals).toEqual([]);
    expect(localStorage.getItem(AUTHORED_GENERALS_KEY)).toBeNull();
  });

  it('本机已有同编号 ⇒ 整包退回来，绝不覆盖已有那张', () => {
    const mine = diy('张三');
    useGameStore.setState({ authoredGenerals: [mine] } as never);
    const theirs = { ...mine, hp: 1 } as General;
    const result = useGameStore.getState().installAuthoredGenerals([theirs, diy('李四')]);
    expect(result.installed).toEqual([]);
    expect(result.refused).toEqual(['张三（这台机器上已经有一张同编号的）']);
    expect(useGameStore.getState().authoredGenerals).toEqual([mine]);
  });

  it('装的卡进牌池后卡面逐字是包里那份（编号不重新发、技能不被改写）', () => {
    const a = diy('张三');
    useGameStore.getState().installAuthoredGenerals([a]);
    const inPool = useGameStore.getState().poolGenerals().find(g => g.id === a.id);
    expect(inPool).toEqual(a);
  });
});
