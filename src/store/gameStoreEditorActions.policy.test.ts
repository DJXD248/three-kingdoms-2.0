/**
 * §H3 三层禁改执法·第②层（store 动作守卫）与第③层（装配停用+报出）。
 * 第①层是录入面，本文件的断言同时钉住"拒了要带原因"这条对用户可见的口径。
 *
 * 取证事实（本刀修的漏洞）：改动前 developerMode 只挡得住界面入口，
 * 直接调 store 就能写官方将；开发者模式改过的官方将，退出模式甚至刷新后
 * （developerMode 不持久化）照样被对局消费。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { allGenerals, type General } from '../data/generals';
import { loadPersistedGeneralEdits, loadPersistedSkillEdits } from './editorPersistence';
import { createAuthoredGeneral } from '../domain/generalProvenance';

const ledger = allGenerals.find(g => g.name === '关羽' && g.faction === '蜀') as General;
const otherLedger = allGenerals.find(g => g.id !== ledger.id) as General;

const authoredFixture = createAuthoredGeneral({ name: '自建·测试将', faction: '蜀', hp: 3 }, 'DIY');
if (!authoredFixture.ok) throw new Error('fixture 造卡失败');
const diy = { general: authoredFixture.general };

const SKILL_PATCH = [{ name: '越权改技', description: '摸一张牌' }];
const GENERAL_PATCH = { hp: 9 };

function arm(options: { developerMode: boolean }) {
  localStorage.clear();
  useGameStore.setState({
    developerMode: options.developerMode,
    skillEdits: {},
    generalEdits: {},
    disabledGenerals: new Set<string>(),
    authoredGenerals: [diy.general],
    identityRegistry: [],
  } as Partial<ReturnType<typeof useGameStore.getState>>);
}

describe('第②层：store 写动作按权限拒', () => {
  beforeEach(() => arm({ developerMode: false }));

  it('非开发者改官方将=拒，返回原因，store 与存档都没动', () => {
    const actions = useGameStore.getState();
    expect(actions.updateSkillEdit(ledger.id, SKILL_PATCH)).toEqual({ allowed: false, denial: 'OFFICIAL_READ_ONLY' });
    expect(actions.updateGeneralEdit(ledger.id, GENERAL_PATCH)).toEqual({ allowed: false, denial: 'OFFICIAL_READ_ONLY' });
    expect(useGameStore.getState().skillEdits).toEqual({});
    expect(useGameStore.getState().generalEdits).toEqual({});
    expect(loadPersistedSkillEdits()[ledger.id]).toBeUndefined();
    expect(loadPersistedGeneralEdits()[ledger.id]).toBeUndefined();
  });

  it('开发者模式同一张卡改得动（判据没被写成永久禁改）', () => {
    arm({ developerMode: true });
    const actions = useGameStore.getState();
    expect(actions.updateSkillEdit(ledger.id, SKILL_PATCH)).toEqual({ allowed: true });
    expect(actions.updateGeneralEdit(ledger.id, GENERAL_PATCH)).toEqual({ allowed: true });
    expect(useGameStore.getState().generalEdits[ledger.id]).toEqual(GENERAL_PATCH);
  });

  it('自建卡（D-*）在开发者模式外也改得动——禁改只针对仓库账本', () => {
    const actions = useGameStore.getState();
    expect(actions.updateGeneralEdit(diy.general.id, GENERAL_PATCH)).toEqual({ allowed: true });
    expect(useGameStore.getState().generalEdits[diy.general.id]).toEqual(GENERAL_PATCH);
  });

  it('禁用/删除也是改：非开发者挡下并报出，数据原样保留', () => {
    const actions = useGameStore.getState();
    expect(actions.toggleDisabledGeneral(ledger.id)).toEqual({ allowed: false, denial: 'OFFICIAL_READ_ONLY' });
    expect(useGameStore.getState().disabledGenerals.size).toBe(0);

    // 开发者先留下改动，再由非开发者批量删除：只删得掉自建的
    arm({ developerMode: true });
    useGameStore.getState().updateGeneralEdit(ledger.id, GENERAL_PATCH);
    useGameStore.getState().updateGeneralEdit(diy.general.id, GENERAL_PATCH);
    useGameStore.setState({ developerMode: false });

    const del = useGameStore.getState().batchDeleteEdits([ledger.id, diy.general.id]);
    expect(del).toEqual({ applied: [diy.general.id], rejected: [ledger.id] });
    expect(useGameStore.getState().generalEdits[ledger.id]).toEqual(GENERAL_PATCH);
    expect(useGameStore.getState().generalEdits[diy.general.id]).toBeUndefined();

    const toggle = useGameStore.getState().batchToggleDisabled([ledger.id, diy.general.id], true);
    expect(toggle).toEqual({ applied: [diy.general.id], rejected: [ledger.id] });
  });

  it('文本导入逐行判：越权行报名字，不静默吞', () => {
    const result = useGameStore.getState().importSkillEditsFromText(`${ledger.name}|测试技能`);
    expect(result).toEqual({ count: 0, rejected: [ledger.name] });
    expect(useGameStore.getState().skillEdits).toEqual({});
  });

  it('身份改名级联不越权改写官方将的差异层', () => {
    arm({ developerMode: true });
    useGameStore.getState().addIdentity('甲身份');
    useGameStore.getState().updateGeneralEdit(ledger.id, { identity: '甲身份' });
    useGameStore.getState().updateGeneralEdit(diy.general.id, { identity: '甲身份' });
    useGameStore.setState({ developerMode: false });

    expect(useGameStore.getState().renameIdentity('甲身份', '乙身份')).toBe(true);
    expect(useGameStore.getState().generalEdits[ledger.id]).toEqual({ identity: '甲身份' });
    expect(useGameStore.getState().generalEdits[diy.general.id]).toEqual({ identity: '乙身份' });
  });
});

describe('第③层：装配停用并报出（不删不回滚）', () => {
  it('刷新后的未激活会话：官方改动仍在档、但不再进对局', () => {
    arm({ developerMode: true });
    useGameStore.getState().updateGeneralEdit(ledger.id, GENERAL_PATCH);
    useGameStore.getState().updateSkillEdit(ledger.id, SKILL_PATCH);
    useGameStore.getState().toggleDisabledGeneral(otherLedger.id);
    // 等价于"退出开发者模式/刷新"：developerMode 不落盘，回未激活态
    useGameStore.setState({ developerMode: false });

    const merged = useGameStore.getState().getGeneralWithEdits(ledger);
    expect(merged.hp).toBe(ledger.hp);
    expect(merged.skills).toEqual(ledger.skills);

    expect(useGameStore.getState().generalEdits[ledger.id]).toEqual(GENERAL_PATCH);
    expect(useGameStore.getState().skillEdits[ledger.id]).toEqual(SKILL_PATCH);
    expect(loadPersistedGeneralEdits()[ledger.id]).toEqual(GENERAL_PATCH);

    const blocked = useGameStore.getState().blockedEdits();
    expect(blocked.map(b => b.kind).sort()).toEqual(['disabled', 'generalEdits', 'skillEdits']);
    expect(blocked.find(b => b.kind === 'skillEdits')?.name).toBe(ledger.name);

    expect([...useGameStore.getState().effectiveDisabledGenerals()]).toEqual([]);
    expect(useGameStore.getState().disabledGenerals.has(otherLedger.id)).toBe(true);

    // 重新进开发者模式：同一批数据立刻恢复生效（停用≠删除）
    useGameStore.setState({ developerMode: true });
    expect(useGameStore.getState().getGeneralWithEdits(ledger).hp).toBe(GENERAL_PATCH.hp);
    expect(useGameStore.getState().blockedEdits()).toEqual([]);
    expect([...useGameStore.getState().effectiveDisabledGenerals()]).toEqual([otherLedger.id]);
  });

  it('本地征召面读的是停用后的现实：官方卡回到原样，自建卡照改', () => {
    arm({ developerMode: true });
    useGameStore.getState().updateGeneralEdit(ledger.id, GENERAL_PATCH);
    useGameStore.getState().updateGeneralEdit(diy.general.id, { name: '改过名的自建将' });
    useGameStore.setState({ developerMode: false });

    const pool = useGameStore.getState().poolGenerals();
    expect(pool.find(g => g.id === ledger.id)?.hp).toBe(ledger.hp);
    expect(pool.find(g => g.id === diy.general.id)?.name).toBe('改过名的自建将');
  });

  it('仓库账本本身不被差异层改写：AI 标准池读到的永远是原值', () => {
    arm({ developerMode: true });
    useGameStore.getState().updateGeneralEdit(ledger.id, GENERAL_PATCH);
    useGameStore.setState({ developerMode: false });
    // src/ai/** 与 matchSetup 读的是这份模块级账本，不经 store，也不读存档。
    const fromLedger = allGenerals.find(g => g.id === ledger.id) as General;
    expect(fromLedger.hp).toBe(ledger.hp);
    expect(useGameStore.getState().generalEdits[ledger.id]).toEqual(GENERAL_PATCH);
  });
});

describe('第①层：录入面用的就是同一个判定根', () => {
  it('mayEditGeneral 与 store 守卫同进同退', () => {
    arm({ developerMode: false });
    expect(useGameStore.getState().mayEditGeneral(ledger.id)).toBe(false);
    expect(useGameStore.getState().mayEditGeneral(diy.general.id)).toBe(true);
    useGameStore.setState({ developerMode: true });
    expect(useGameStore.getState().mayEditGeneral(ledger.id)).toBe(true);
  });
});
