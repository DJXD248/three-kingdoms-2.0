/**
 * v2.8.5 地基刀1 的 store 面：自建将领只住本机、只进本地牌池，
 * 仓库档案删不掉，未开发者借不到官方草稿的号。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { allGenerals } from '../data/generals';
import { AUTHORED_GENERALS_KEY, GENERAL_EDITS_KEY, loadAuthoredGenerals, loadPersistedGeneralEdits } from './editorPersistence';
import { useGameStore } from './gameStore';

const input = { name: '新试验将', faction: '蜀' as const, hp: 4, identity: '试验身份' };

describe('authored generals (store surface)', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTHORED_GENERALS_KEY);
    localStorage.removeItem(GENERAL_EDITS_KEY);
    useGameStore.setState({ authoredGenerals: [], developerMode: false, generalEdits: {} } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('新建即落本地：状态、localStorage、可重新读回三处一致', () => {
    const created = useGameStore.getState().addAuthoredGeneral(input, 'DIY');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(useGameStore.getState().authoredGenerals.map(g => g.id)).toEqual([created.general.id]);
    expect(loadAuthoredGenerals().map(g => g.id)).toEqual([created.general.id]);
    expect(JSON.parse(localStorage.getItem(AUTHORED_GENERALS_KEY) ?? '[]')).toHaveLength(1);
  });

  it('本地新建进本地牌池；仓库档案一张也不少', () => {
    const created = useGameStore.getState().addAuthoredGeneral(input, 'DIY');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = useGameStore.getState().poolGenerals().map(g => g.id);
    expect(ids).toContain(created.general.id);
    expect(ids.filter(id => allGenerals.some(g => g.id === id))).toHaveLength(allGenerals.length);
  });

  it('删除只对自建号放行：仓库档案号一律拒，且不动本地清单', () => {
    const created = useGameStore.getState().addAuthoredGeneral(input, 'DIY');
    if (!created.ok) throw new Error('setup failed');
    const before = useGameStore.getState().authoredGenerals.length;
    expect(useGameStore.getState().removeAuthoredGeneral(allGenerals[0].id)).toBe(false);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(before);
    expect(useGameStore.getState().removeAuthoredGeneral(created.general.id)).toBe(true);
    expect(useGameStore.getState().authoredGenerals).toHaveLength(0);
    expect(loadAuthoredGenerals()).toHaveLength(0);
  });

  // 删掉的是一张个档，它的差异补丁没有主体了 ⇒ 不留孤儿 overlay
  it('删除自建将同时清掉它自己的差异补丁与禁用标记', () => {
    const created = useGameStore.getState().addAuthoredGeneral(input, 'DIY');
    if (!created.ok) throw new Error('setup failed');
    const id = created.general.id;
    useGameStore.getState().updateGeneralEdit(id, { hp: 5 });
    useGameStore.getState().updateSkillEdit(id, [{ name: '临时技能' }]);
    useGameStore.getState().toggleDisabledGeneral(id);
    expect(useGameStore.getState().removeAuthoredGeneral(id)).toBe(true);
    expect(loadPersistedGeneralEdits()[id]).toBeUndefined();
    expect(loadAuthoredGenerals()).toHaveLength(0);
    expect(useGameStore.getState().generalEdits[id]).toBeUndefined();
    expect(useGameStore.getState().skillEdits[id]).toBeUndefined();
    expect(useGameStore.getState().disabledGenerals.has(id)).toBe(false);
  });

  it('非开发者请求 official 归属 ⇒ 落不到官方草稿层（无权即 DIY）', () => {
    const asDraft = useGameStore.getState().addAuthoredGeneral(input, 'official');
    expect(asDraft.ok && asDraft.general.source).toBe('DIY');
    expect(asDraft.ok && asDraft.general.id.startsWith('D-')).toBe(true);
  });

  it('开发者才拿得到官方草稿层：G- 号 + source=official', () => {
    // 本用例只测归属判定，不测口令链（那条链在 devGate 两处测试里钉）
    useGameStore.setState({ developerMode: true } as never);
    const asDraft = useGameStore.getState().addAuthoredGeneral(input, 'official');
    expect(asDraft.ok && asDraft.general.source).toBe('official');
    expect(asDraft.ok && asDraft.general.id.startsWith('G-')).toBe(true);
  });

  it('resetGame 不清自建清单：本机内容是玩家资产，不是对局状态', () => {
    const created = useGameStore.getState().addAuthoredGeneral(input, 'DIY');
    if (!created.ok) throw new Error('setup failed');
    useGameStore.getState().resetGame();
    expect(useGameStore.getState().authoredGenerals.map(g => g.id)).toEqual([created.general.id]);
  });

  it('坏存档进不了状态：读回时按准入判据过滤，遮蔽官方将的记录被丢弃', () => {
    localStorage.setItem(AUTHORED_GENERALS_KEY, JSON.stringify([
      { ...allGenerals[0], source: 'DIY' },
      { id: 'D-nope', name: '', source: 'DIY' },
    ]));
    expect(loadAuthoredGenerals()).toHaveLength(0);
  });

  it('改名后身份原地不动，历史修改仍按编号命中', () => {
    const created = useGameStore.getState().addAuthoredGeneral(input, 'DIY');
    if (!created.ok) throw new Error('setup failed');
    useGameStore.getState().updateGeneralEdit(created.general.id, { name: '改名后的将' });
    const after = useGameStore.getState().poolGenerals().find(g => g.id === created.general.id);
    expect(after?.name).toBe('改名后的将');
    expect(after?.identity).toBe('试验身份');
    expect(after?.hp).toBe(4);
  });

  it('旧存档里的冻结字段（补丁里带 id/source）读回时被剥掉并报出，不写进状态', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(GENERAL_EDITS_KEY, JSON.stringify({
      wei_001: { hp: 3, id: 'hijack_001', source: 'DIY' },
    }));
    expect(loadPersistedGeneralEdits()).toEqual({ wei_001: { hp: 3 } });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
