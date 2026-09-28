/**
 * v2.8.8 N2 (§H8)：白锁的 store 面。锁是**写侧**判定——编辑/删除/覆盖/禁用
 * 全走同一写闸门；装配（生效视图）从不读锁，锁住的卡已有内容照常生效。
 * 锁只住本机 localStorage，不进源文件/EngineState/录像 ⇒ 无换锚。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { allGenerals, type General } from '../data/generals';
import {
  LOCKED_GENERALS_KEY,
  loadLockedGenerals,
  loadPersistedGeneralEdits,
  loadPersistedSkillEdits,
} from './editorPersistence';
import { createAuthoredGeneral } from '../domain/generalProvenance';

const ledger = allGenerals.find(g => g.name === '关羽' && g.faction === '蜀') as General;
const authoredFixture = createAuthoredGeneral({ name: '锁试·自建将', faction: '蜀', hp: 3 }, 'DIY');
if (!authoredFixture.ok) throw new Error('fixture 造卡失败');
const diy = authoredFixture.general;

const GENERAL_PATCH = { hp: 9 };
const SKILL_PATCH = [{ name: '锁试技能', description: '摸一张牌' }];

function arm(options: { developerMode: boolean; locked?: string[] }) {
  localStorage.clear();
  useGameStore.setState({
    developerMode: options.developerMode,
    skillEdits: {},
    generalEdits: {},
    disabledGenerals: new Set<string>(),
    lockedGeneralIds: new Set<string>(options.locked ?? []),
    authoredGenerals: [diy],
    identityRegistry: [],
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

describe('N2 白锁：写闸门', () => {
  beforeEach(() => arm({ developerMode: false }));

  it('锁定自建卡=之后的写全被拒并报 USER_LOCKED，store 与存档都没动', () => {
    expect(useGameStore.getState().toggleGeneralLock(diy.id)).toEqual({ allowed: true });
    const actions = useGameStore.getState();
    expect(actions.updateGeneralEdit(diy.id, GENERAL_PATCH)).toEqual({ allowed: false, denial: 'USER_LOCKED' });
    expect(actions.updateSkillEdit(diy.id, SKILL_PATCH)).toEqual({ allowed: false, denial: 'USER_LOCKED' });
    expect(actions.toggleDisabledGeneral(diy.id)).toEqual({ allowed: false, denial: 'USER_LOCKED' });
    expect(useGameStore.getState().generalEdits[diy.id]).toBeUndefined();
    expect(loadPersistedGeneralEdits()[diy.id]).toBeUndefined();
    expect(loadPersistedSkillEdits()[diy.id]).toBeUndefined();
    expect(useGameStore.getState().disabledGenerals.size).toBe(0);
  });

  it('解锁后同一张卡立刻写得回去（锁不是永久禁改）', () => {
    useGameStore.getState().toggleGeneralLock(diy.id);
    useGameStore.getState().toggleGeneralLock(diy.id);
    expect(useGameStore.getState().updateGeneralEdit(diy.id, GENERAL_PATCH)).toEqual({ allowed: true });
  });

  it('白锁绝不挡住自己的解锁：连按两次=锁上又放开', () => {
    expect(useGameStore.getState().toggleGeneralLock(diy.id).allowed).toBe(true);
    expect(useGameStore.getState().isGeneralLocked(diy.id)).toBe(true);
    expect(useGameStore.getState().toggleGeneralLock(diy.id).allowed).toBe(true);
    expect(useGameStore.getState().isGeneralLocked(diy.id)).toBe(false);
  });

  it('非开发者不能给官方金锁卡加白锁（两套计算互不越权）', () => {
    expect(useGameStore.getState().toggleGeneralLock(ledger.id))
      .toEqual({ allowed: false, denial: 'OFFICIAL_READ_ONLY' });
    expect(useGameStore.getState().lockedGeneralIds.size).toBe(0);
  });

  it('开发者模式：官方可将也挡得住白锁（写侧取更严的一边）', () => {
    arm({ developerMode: true });
    expect(useGameStore.getState().toggleGeneralLock(ledger.id)).toEqual({ allowed: true });
    expect(useGameStore.getState().updateGeneralEdit(ledger.id, GENERAL_PATCH))
      .toEqual({ allowed: false, denial: 'USER_LOCKED' });
    // 但金锁优先：解锁之后仍被系统层挡（回到 OFFICIAL 判定要先在开发者模式里做）
    useGameStore.getState().toggleGeneralLock(ledger.id);
    expect(useGameStore.getState().updateGeneralEdit(ledger.id, GENERAL_PATCH)).toEqual({ allowed: true });
  });

  it('删除自建卡=写：锁住时拒绝并点名，卡片与锁都不动', () => {
    useGameStore.getState().toggleGeneralLock(diy.id);
    expect(useGameStore.getState().removeAuthoredGeneral(diy.id))
      .toEqual({ ok: false, denial: 'USER_LOCKED' });
    expect(useGameStore.getState().authoredGenerals).toHaveLength(1);
    // 解锁后删得掉，且死号的锁一并清掉（不留孤儿锁）
    useGameStore.getState().toggleGeneralLock(diy.id);
    expect(useGameStore.getState().removeAuthoredGeneral(diy.id)).toEqual({ ok: true, denial: null });
    expect(loadLockedGenerals().has(diy.id)).toBe(false);
  });

  it('批量删除/批量禁用：两类拒绝分开点名，绝不并栏', () => {
    arm({ developerMode: true });
    useGameStore.getState().updateGeneralEdit(ledger.id, GENERAL_PATCH);
    useGameStore.getState().updateGeneralEdit(diy.id, GENERAL_PATCH);
    useGameStore.getState().toggleGeneralLock(diy.id);
    useGameStore.setState({ developerMode: false });

    const del = useGameStore.getState().batchDeleteEdits([ledger.id, diy.id]);
    expect(del).toEqual({ applied: [], rejected: [ledger.id], deniedLock: [diy.id] });
    expect(useGameStore.getState().generalEdits[diy.id]).toEqual(GENERAL_PATCH);
  });

  it('批量锁定/解锁：金锁卡被拒并点名，可动的卡照锁', () => {
    const r = useGameStore.getState().batchToggleLocked([ledger.id, diy.id], true);
    expect(r).toEqual({ applied: [diy.id], rejected: [ledger.id] });
    expect(useGameStore.getState().isGeneralLocked(diy.id)).toBe(true);
    expect(useGameStore.getState().isGeneralLocked(ledger.id)).toBe(false);
  });

  it('文本导入：被白锁挡的行进 deniedLock，被系统挡的行进 rejected，各报各的名', () => {
    // 开发者把官方将白锁住 ⇒ 系统层放行、白锁层拒绝
    arm({ developerMode: true });
    useGameStore.getState().toggleGeneralLock(ledger.id);
    const devView = useGameStore.getState().importSkillEditsFromText(`${ledger.name}|锁挡行`);
    expect(devView).toEqual({ count: 0, rejected: [], deniedLock: [ledger.name] });
    expect(loadPersistedSkillEdits()[ledger.id]).toBeUndefined();
    // 未解锁就退开发者 ⇒ 金锁优先报 OFFICIAL，白锁仍住在档上
    useGameStore.setState({ developerMode: false });
    const playerView = useGameStore.getState().importSkillEditsFromText(`${ledger.name}|系统挡行`);
    expect(playerView).toEqual({ count: 0, rejected: [ledger.name], deniedLock: [] });
  });

  it('身份改名级联是写：白锁卡的差异层字节不动', () => {
    useGameStore.getState().updateGeneralEdit(diy.id, { identity: '甲身份' });
    useGameStore.getState().toggleGeneralLock(diy.id);
    useGameStore.getState().addIdentity('甲身份');
    expect(useGameStore.getState().renameIdentity('甲身份', '乙身份')).toBe(true);
    expect(useGameStore.getState().generalEdits[diy.id]).toEqual({ identity: '甲身份' });
  });

  it('覆盖也算写：pending-resolve 的 modify 走 updateSkillEdit 同样被挡', () => {
    useGameStore.getState().toggleGeneralLock(diy.id);
    expect(useGameStore.getState().updateSkillEdit(diy.id, SKILL_PATCH))
      .toEqual({ allowed: false, denial: 'USER_LOCKED' });
    expect(useGameStore.getState().skillEdits[diy.id]).toBeUndefined();
  });
});

describe('N2 白锁：装配不读锁（锁不停内容）', () => {
  beforeEach(() => arm({ developerMode: false }));

  it('锁住已有改动的自建卡：合并视图照旧生效、池子照旧含它、blocked 清单不增行', () => {
    useGameStore.getState().updateGeneralEdit(diy.id, GENERAL_PATCH);
    useGameStore.getState().toggleGeneralLock(diy.id);

    const merged = useGameStore.getState().getGeneralWithEdits(diy);
    expect(merged.hp).toBe(GENERAL_PATCH.hp);
    expect(useGameStore.getState().poolGenerals().map(g => g.id)).toContain(diy.id);
    expect(useGameStore.getState().blockedEdits()).toEqual([]);
    // 装配面用的 mayEditGeneral 含锁 ⇒ 只说明「写不进」，不说明「不生效」
    expect(useGameStore.getState().mayEditGeneral(diy.id)).toBe(false);
  });

  it('锁住一张带禁用标记的卡：它仍然算禁用（锁不改变已生效状态）', () => {
    useGameStore.getState().toggleDisabledGeneral(diy.id);
    useGameStore.getState().toggleGeneralLock(diy.id);
    expect([...useGameStore.getState().effectiveDisabledGenerals()]).toEqual([diy.id]);
  });

  it('锁只住本机：持久化往返后仍是同一批 id，且不动其他存档键', () => {
    useGameStore.getState().toggleGeneralLock(diy.id);
    expect(loadLockedGenerals()).toEqual(new Set([diy.id]));
    expect(JSON.parse(localStorage.getItem(LOCKED_GENERALS_KEY) ?? '[]')).toEqual([diy.id]);
    // 坏档=空集合，绝不炸
    localStorage.setItem(LOCKED_GENERALS_KEY, '{not json');
    expect(loadLockedGenerals()).toEqual(new Set());
    localStorage.setItem(LOCKED_GENERALS_KEY, '[1, "ok", null]');
    expect(loadLockedGenerals()).toEqual(new Set(['ok']));
  });
});
