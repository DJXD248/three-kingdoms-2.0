/**
 * v2.9.18 技能册·进料接线那一条路的真 store 证人。
 *
 * 上一档测试（`skills/skillNameIndex.test.ts`）用测试缝换名册，证的是"册子会跟着进料重算"；
 * 这一档证的是**生产接线本身**：册子的进料＝`poolGenerals()`，也就是这台机器此刻真在用的
 * 那份将领（仓库名册＋自制卡，都过一遍 §H3 策略过滤后的卡面编辑合并）。
 * 于是四件事必须同时成立：玩家自制的真内容技能进册、被删掉的自制卡退出册子、
 * 一场非开发者会话里那些"应用不上"的官方卡补丁不许偷偷进册、
 * 而册子上的"官方／玩家自制"读的是创建时冻结的那个来源（改过不等于变成官方卡）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { allGenerals, type SkillEffect } from '../data/generals';
import { hasSettleableContent } from '../data/skillTable';
import { DEV_MODE_DIGEST } from '../domain/devGate';
import { knownSkillNames, lookupSkillByName, skillBookCandidates, __resetSkillNameIndexForTests } from '../skills/skillNameIndex';
import { AUTHORED_GENERALS_KEY } from './editorPersistence';
import { useGameStore } from './gameStore';

const drawN = (value: number): SkillEffect[] => [{ id: 'e1', runtime: { type: 'DRAW_CARD', value, target: 'SELF' } }];
const drawOnce = () => drawN(1);

/** 现场挑一员"名下的技能全是空壳"的官方卡：给它挂上内容＝册子里恰好多出一枚，
 *  不会被"卡上别的技能一起被覆盖掉"这种干扰混进读数。 */
function allShellGeneral() {
  return allGenerals.find(g => g.skills.length > 0 && g.skills.every(s => !hasSettleableContent(s)));
}

describe('技能册·进料＝这台机器真在用的那份将领（v2.9.18）', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTHORED_GENERALS_KEY);
    __resetSkillNameIndexForTests();
    useGameStore.setState({
      authoredGenerals: [],
      skillEdits: {},
      generalEdits: {},
      developerMode: false,
      lockedGeneralIds: new Set<string>(),
    } as never);
  });

  afterEach(() => {
    __resetSkillNameIndexForTests();
    useGameStore.setState({ authoredGenerals: [], skillEdits: {}, developerMode: false } as never);
  });

  it('① 编辑器里新建一张自制卡（带真结算内容）⇒ 册子下一问就有它，出处＝玩家自制', () => {
    expect(lookupSkillByName('自创摸一张').status).toBe('unknown');
    const created = useGameStore.getState().addAuthoredGeneral(
      { name: '册子试验将', faction: '群', hp: 4, identity: '册子试验身份', skills: [{ name: '自创摸一张', effects: drawOnce() }] },
      'DIY',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = lookupSkillByName('自创摸一张');
    expect(found.status).toBe('found');
    if (found.status !== 'found') return;
    expect(found.owners).toEqual([{ label: '册子试验将（群）', origin: 'DIY' }]);
    expect(skillBookCandidates().some(c => c.name === '自创摸一张' && c.origins.includes('DIY'))).toBe(true);
  });

  it('② 删掉那张自制卡⇒它的技能跟着退出册子（重算是双向的，不是只进不出）', () => {
    const created = useGameStore.getState().addAuthoredGeneral(
      { name: '册子试验将', faction: '群', hp: 4, identity: '册子试验身份', skills: [{ name: '自创摸一张', effects: drawOnce() }] },
      'DIY',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(knownSkillNames()).toContain('自创摸一张');

    expect(useGameStore.getState().removeAuthoredGeneral(created.general.id)).toEqual({ ok: true, denial: null });
    expect(lookupSkillByName('自创摸一张').status).toBe('unknown');
  });

  /**
   * 用户这句是本刀的正文：「把自己编辑过的 DIY 卡放进『获得技能』那张册子」——
   * 编辑过的**官方卡**同样跟着走：卡面编辑一挂上可结算内容，那枚老形态空壳就自己进册，
   * 出处仍是官方（这种改动只可能发生在开发者模式下＝用户 2026-10-21 那句口径的下半截）。
   */
  it('③ 开发者模式下给官方卡上那枚只印了名字的空壳挂上内容⇒它进册，出处＝官方', () => {
    expect(useGameStore.getState().enableDeveloperMode(DEV_MODE_DIGEST)).toBe(true);
    const target = allShellGeneral();
    expect(target).toBeTruthy();
    if (!target) return;
    const shellName = target.skills[0]!.name;
    expect(lookupSkillByName(shellName).status).toBe('unknown');

    const before = knownSkillNames().length;
    const decision = useGameStore.getState().updateSkillEdit(target.id, [
      { name: shellName, description: target.skills[0]!.description, effects: drawOnce() },
    ]);
    expect(decision.allowed).toBe(true);

    const found = lookupSkillByName(shellName);
    expect(found.status).toBe('found');
    if (found.status !== 'found') return;
    // 进册的是**合并后那一份**，不是仓库名册里的空壳对象。
    expect(found.skill.effects).toEqual(drawOnce());
    expect(found.owners.map(o => o.origin)).toEqual(['official']);
    expect(knownSkillNames()).toHaveLength(before + 1);
  });

  /** §H3 层③：一场非开发者会话应用不上的官方卡补丁，界面上那句"你的改动还没生效"已经说了，
   *  册子这一头也必须跟着不认——否则会出现"册子里能获得、对局里拿到的还是原样"那种分叉。 */
  it('④ 非开发者会话里那些被挡下的官方卡补丁不进册（册子读的是过滤后的生效视图）', () => {
    const target = allShellGeneral();
    expect(target).toBeTruthy();
    if (!target) return;
    const shellName = target.skills[0]!.name;
    // 直接落到 store＝模拟"上一次开发者会话存下的补丁，这一次没开开发者模式"。
    useGameStore.setState({
      skillEdits: { [target.id]: [{ name: shellName, effects: drawOnce() }] },
      developerMode: false,
    } as never);

    expect(lookupSkillByName(shellName).status).toBe('unknown');
    expect(useGameStore.getState().blockedEdits().some(b => b.id === target.id)).toBe(true);
  });

  /** 用户那句口径的另一半（同一根轴，不是第二套判据）：出处看**创建时冻结**的那个来源，
   *  不看"后来有没有被改过"。所以开发者模式下改一张自制卡，它改进的是自己那一份内容，
   *  不会因此变成官方卡；反过来它编辑后的那一份照样进册。 */
  it('⑤ 开发者模式下改一张自制卡⇒进册的是改过的那一份，出处仍＝玩家自制', () => {
    expect(useGameStore.getState().enableDeveloperMode(DEV_MODE_DIGEST)).toBe(true);
    const created = useGameStore.getState().addAuthoredGeneral(
      { name: '册子试验将', faction: '群', hp: 4, identity: '册子试验身份', skills: [{ name: '自创摸一张', effects: drawOnce() }] },
      'DIY',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const decision = useGameStore.getState().updateSkillEdit(created.general.id, [
      { name: '自创摸一张', description: '出牌阶段，你摸两张牌', effects: drawN(2) },
    ]);
    expect(decision.allowed).toBe(true);

    const found = lookupSkillByName('自创摸一张');
    expect(found.status).toBe('found');
    if (found.status !== 'found') return;
    expect(found.skill.effects?.[0]?.runtime?.value).toBe(2);
    expect(found.owners.map(o => o.origin)).toEqual(['DIY']);
  });
});
