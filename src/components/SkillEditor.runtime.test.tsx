/**
 * SkillEditor runtime-entry smoke test — verifies the UI wiring added in 2.2.0:
 * switching a skill to multi-effect mode, picking a structured runtime effect
 * (类型/数值/目标) in the new RuntimeEditor, and saving must land a real
 * `runtime` payload in the store that the skill compiler can execute.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { compileGeneralSkills } from '../skills/skillCompiler';
import { GATE_SYNTAX_HINT } from '../skills/skillGateText';

function findRuntimeSelect(): HTMLSelectElement {
  const selects = Array.from(document.querySelectorAll('select'));
  const el = selects.find(s => s.options[0]?.text?.startsWith('纯描述'));
  if (!el) throw new Error('结构化效果下拉未出现');
  return el as HTMLSelectElement;
}

describe('SkillEditor: structured runtime entry', () => {
  beforeEach(() => {
    cleanup();
    // §H3: 编辑器对官方将的写入需要开发者模式——本文件的意图（改动落到
    // store 并被编译器接受）在权限打开后逐字保持。
    useGameStore.setState({ skillEdits: {}, generalEdits: {}, developerMode: true });
  });

  it('selecting 摸牌 in the effect card saves a runtime payload the compiler accepts', () => {
    // 2.4.1 起部分内置技能自带 runtime——编辑器冒烟须挑首技仍为纯描述的武将
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);

    // Open the general in the editor (left list button contains the name)
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    expect(listBtn).toBeTruthy();
    fireEvent.click(listBtn!);

    // Switch the first skill from single-effect to multi-effect mode
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    // Set the structured runtime effect: 摸牌
    const sel = findRuntimeSelect();
    fireEvent.change(sel, { target: { value: 'DRAW_CARD' } });

    // Default value control appears (last number input = runtime 数值 field)
    const nums = Array.from(document.querySelectorAll('input[type="number"]'));
    const num = nums[nums.length - 1] as HTMLInputElement;
    expect(num.value).toBe('1');

    fireEvent.click(screen.getByText('💾 保存修改'));

    const saved = useGameStore.getState().skillEdits[target.id];
    expect(saved).toBeTruthy();
    const eff = saved[0].effects?.[0];
    expect(eff?.runtime).toEqual({ type: 'DRAW_CARD', value: 1, target: 'TARGET' });

    // The payload reaches the runtime compiler: without a trigger nothing
    // executes yet (honest skip), proving the effect was compiled from data.
    const edited = { ...target, skills: saved.map(s => ({ ...s })) } as typeof target;
    const noTrigger = compileGeneralSkills(edited);
    expect(noTrigger.definitions).toHaveLength(0);
    expect(noTrigger.skipped.some(sk => sk.reason === 'NO_TRIGGER')).toBe(true);
  });

  it('choosing 纯描述 keeps the effect descriptive (no runtime, compiler skips)', () => {
    // 2.4.1 起部分内置技能自带 runtime——编辑器冒烟须挑首技仍为纯描述的武将
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    const sel = findRuntimeSelect();
    fireEvent.change(sel, { target: { value: 'DAMAGE' } });
    expect(findRuntimeSelect().value).toBe('DAMAGE');
    fireEvent.change(findRuntimeSelect(), { target: { value: '' } }); // back to 纯描述

    fireEvent.click(screen.getByText('💾 保存修改'));
    const saved = useGameStore.getState().skillEdits[target.id];
    expect(saved[0].effects?.[0].runtime).toBeUndefined();
  });

  it('DECK_PLACE exposes the 放置位置 selector and persists dest=TOP (v2.6.1)', () => {
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    const findDestSelect = () => Array.from(document.querySelectorAll('select'))
      .find(s => s.options[0]?.text?.startsWith('牌堆底')) as HTMLSelectElement | undefined;

    // 看牌堆顶/放回牌堆同为上表新枚；REVEAL 无位置面→不应出现放置位置下拉
    fireEvent.change(findRuntimeSelect(), { target: { value: 'REVEAL' } });
    expect(screen.getByText(/观看牌堆顶/)).toBeTruthy();
    expect(findDestSelect()).toBeUndefined();

    fireEvent.change(findRuntimeSelect(), { target: { value: 'DECK_PLACE' } });
    expect(screen.getByText(/张手牌放回牌堆/)).toBeTruthy();
    const dest = findDestSelect();
    expect(dest).toBeTruthy();
    expect(dest!.value).toBe('BOTTOM'); // 缺省=牌堆底
    fireEvent.change(dest!, { target: { value: 'TOP' } });

    fireEvent.click(screen.getByText('💾 保存修改'));
    const saved = useGameStore.getState().skillEdits[target.id];
    expect(saved[0].effects?.[0].runtime)
      .toEqual({ type: 'DECK_PLACE', value: 1, target: 'TARGET', dest: 'TOP' });
  });

  it('v2.8 刀4 #25：「修改数值」的三格（改哪个数／怎么改／有效周期）录入并进了存档，编译器照收', () => {
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    const findStatSelect = (labelText: string) =>
      (Array.from(document.querySelectorAll('label'))
        .find(l => l.textContent?.includes(labelText))
        ?.parentElement?.querySelector('select') as HTMLSelectElement | undefined);

    fireEvent.change(findRuntimeSelect(), { target: { value: 'MODIFY_STAT' } });
    const stat = findStatSelect('改哪个数');
    const mode = findStatSelect('怎么改');
    const duration = findStatSelect('有效周期');
    expect(stat && mode && duration).toBeTruthy();
    // 三道缺省：钥匙默认近战、形态默认增减、周期默认那一档（留空＝在场即结束，不是"永久"）。
    expect(stat!.value).toBe('MELEE_ATK');
    expect(mode!.value).toBe('delta');
    expect(duration!.value).toBe('');
    // 目标这一格由录入面直接钉死在「自身」（跨将目标是 #28 刀7，今天选了就是"看着能
    // 响其实不响"），下面存档那行 `target:'SELF'` 就是它的实证。

    fireEvent.change(stat!, { target: { value: 'MAX_HP' } });
    fireEvent.change(mode!, { target: { value: 'set' } });
    fireEvent.change(duration!, { target: { value: 'untilSelfTurnEnd' } });
    const num = Array.from(document.querySelectorAll('input[type="number"]')).pop() as HTMLInputElement;
    fireEvent.change(num, { target: { value: '3' } });

    fireEvent.click(screen.getByText('💾 保存修改'));
    const saved = useGameStore.getState().skillEdits[target.id];
    expect(saved[0].effects?.[0].runtime).toEqual({
      type: 'MODIFY_STAT', value: 3, target: 'SELF',
      stat: 'MAX_HP', modifyMode: 'set', duration: 'untilSelfTurnEnd',
    });

    // 存档形状直接进编译器：带触发即成一条定义，三格逐字搬到运行时（不带触发则诚实
    // 跳过，但绝不因"改数不完整"被拒）。
    const firstSkill = saved[0]!;
    const withTrigger = {
      ...target,
      skills: [{
        ...firstSkill,
        trigger: { type: 'onTurnStart' as const },
        effects: firstSkill.effects!.map(e => ({ ...e, trigger: { type: 'onTurnStart' as const } })),
      }],
    } as unknown as typeof target;
    const compiled = compileGeneralSkills(withTrigger);
    expect(compiled.skipped.filter(s => s.reason === 'MODIFY_STAT_INCOMPLETE')).toHaveLength(0);
    expect(compiled.definitions).toHaveLength(1);
    expect(compiled.definitions[0].effects[0]).toMatchObject({
      type: 'MODIFY_STAT', stat: 'MAX_HP', modifyMode: 'set', duration: 'untilSelfTurnEnd', target: 'SELF',
    });
  });

  it('v2.9.0 射程刀：「改哪个数」那格真下拉里出现了「射程」，选中即存成 RANGE，编译器照收', () => {
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    const findStatSelect = (labelText: string) =>
      (Array.from(document.querySelectorAll('label'))
        .find(l => l.textContent?.includes(labelText))
        ?.parentElement?.querySelector('select') as HTMLSelectElement | undefined);

    fireEvent.change(findRuntimeSelect(), { target: { value: 'MODIFY_STAT' } });
    const stat = findStatSelect('改哪个数')!;
    // 证人就长在真渲染出来的那个下拉上：候选面（值＋给玩家看的中文）逐字对齐词表。
    const rendered = Array.from(stat.options).map(o => [o.value, o.text] as const);
    expect(rendered).toEqual([
      ['MELEE_ATK', '近战攻击力'],
      ['RANGED_ATK', '远程攻击力'],
      ['MAX_HP', '体力上限'],
      ['DAMAGE_TAKEN', '受到的伤害'],
      ['RANGE', '射程'],
    ]);

    fireEvent.change(stat, { target: { value: 'RANGE' } });
    // 一次性那一档对射程没有"被用掉一次"的那一刻⇒界面当场点名。
    fireEvent.change(findStatSelect('有效周期')!, { target: { value: 'thisDamage' } });
    expect(screen.getByText(/这一把钥匙没有"被用掉一次"的那一刻/)).toBeTruthy();
    fireEvent.change(findStatSelect('有效周期')!, { target: { value: '' } });

    const num = Array.from(document.querySelectorAll('input[type="number"]')).pop() as HTMLInputElement;
    fireEvent.change(num, { target: { value: '1' } });
    fireEvent.click(screen.getByText('💾 保存修改'));

    const saved = useGameStore.getState().skillEdits[target.id];
    expect(saved[0].effects?.[0].runtime)
      .toEqual({ type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'RANGE', modifyMode: 'delta' });

    const firstSkill = saved[0]!;
    const withTrigger = {
      ...target,
      skills: [{
        ...firstSkill,
        trigger: { type: 'onTurnStart' as const },
        effects: firstSkill.effects!.map(e => ({ ...e, trigger: { type: 'onTurnStart' as const } })),
      }],
    } as unknown as typeof target;
    const compiled = compileGeneralSkills(withTrigger);
    expect(compiled.skipped.filter(s => s.reason === 'MODIFY_STAT_INCOMPLETE')).toHaveLength(0);
    expect(compiled.definitions).toHaveLength(1);
    expect(compiled.definitions[0].effects[0]).toMatchObject({ type: 'MODIFY_STAT', stat: 'RANGE', modifyMode: 'delta', value: 1 });
  });

  it('v2.9.0 射程刀：射程×一次性保存后编译器逐条点名，不落半条定义', () => {
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);

    const findStatSelect = (labelText: string) =>
      (Array.from(document.querySelectorAll('label'))
        .find(l => l.textContent?.includes(labelText))
        ?.parentElement?.querySelector('select') as HTMLSelectElement)!;

    fireEvent.change(findRuntimeSelect(), { target: { value: 'MODIFY_STAT' } });
    fireEvent.change(findStatSelect('改哪个数'), { target: { value: 'RANGE' } });
    fireEvent.change(findStatSelect('有效周期'), { target: { value: 'thisDamage' } });
    fireEvent.click(screen.getByText('💾 保存修改'));

    const saved = useGameStore.getState().skillEdits[target.id];
    const firstSkill = saved[0]!;
    const compiled = compileGeneralSkills({
      ...target,
      skills: [{
        ...firstSkill,
        trigger: { type: 'onTurnStart' as const },
        effects: firstSkill.effects!.map(e => ({ ...e, trigger: { type: 'onTurnStart' as const } })),
      }],
    } as unknown as typeof target);
    expect(compiled.definitions).toHaveLength(0);
    expect(compiled.skipped.some(s => s.reason === 'MODIFY_STAT_ONESHOT_KEY_UNSUPPORTED')).toBe(true);
  });

  /**
   * 2.9.3 刀A·「获得技能」那一格的真机形状（闸③复算点名：编译面与 Excel 往返都有钉，
   * 唯独界面那个名字框零证人）。它同时钉四件"看得见"的事：没有数字框（这一档不读数）、
   * 目标只写"自己"（不给下拉）、名册查不到时当场说、写了名字之后 `runtime.skillName`
   * 真的存进 store 并被编译器解析成那枚技能。
   */
  it('v2.9.3 刀A：效果类型切到「获得技能」——没有数字框、目标只有"自己"、名字存得下、名册外的名字当场说', () => {
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    fireEvent.click(Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name))!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);
    fireEvent.change(findRuntimeSelect(), { target: { value: 'GAIN_SKILL' } });

    // ① 这一档根本不读「数值」格：给它数字框＝"界面填了个数、引擎认的是别的"（§12-55 同族）。
    // 只认效果卡里那一格（编辑器头部还有体力/近战/远程三个数字框，那不是本档的账）。
    expect(screen.queryByText('└ 数值')).toBeNull();
    // ② 目标不给下拉：跨将加技能是 #28 那条目标选择器的内容，今天没有。
    const targetRow = Array.from(document.querySelectorAll('label'))
      .find(l => l.textContent?.trim() === '目标')!.parentElement!;
    expect(targetRow.querySelector('select')).toBeNull();
    expect(targetRow.textContent).toContain('这一档只往自己的技能表上添一枚');
    const nameInput = document.querySelector('input[aria-label="获得技能名"]') as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    // ③ 空名＝红字说"这样填保存后会被逐条点名跳过"（拦在录入面，不等用户去对局里发现）。
    // 只认这句警告本身：空名时预览那句也带"还没写要拿哪一枚"，那是两处、不是两处 bug。
    expect(screen.getByText(/这样填的效果保存后会被引擎逐条点名跳过/)).toBeTruthy();

    // ④ 名册里查得到的名字：警告撤掉，保存后 store 里落的是**名字**（不是 id、不是将名）。
    fireEvent.change(nameInput, { target: { value: '屯田' } });
    expect(screen.queryByText(/这样填的效果保存后会被引擎逐条点名跳过/)).toBeNull();
    expect(screen.queryByText(/名册里暂时没有/)).toBeNull();
    expect(screen.getByText(/获得技能「屯田」/)).toBeTruthy();   // 预览那句读的就是同一个名字
    fireEvent.click(screen.getByText('💾 保存修改'));
    const saved = useGameStore.getState().skillEdits[target.id]!;
    expect(saved[0].effects?.[0].runtime).toEqual({ type: 'GAIN_SKILL', target: 'SELF', skillName: '屯田' });
    const compiled = compileGeneralSkills(
      { ...target, skills: saved.map(s => ({ ...s, trigger: { type: 'onTurnStart' as const },
        effects: s.effects!.map(e => ({ ...e, trigger: { type: 'onTurnStart' as const } })) })) } as unknown as typeof target);
    expect(compiled.definitions[0]?.effects.some(e => e.type === 'GAIN_SKILL' && e.gainedSkill?.name === '屯田')).toBe(true);

    // ⑤ 名册外的名字（＝还没进池的那一枚）：不拦保存，但当场把"会被点名跳过"说清。
    fireEvent.change(document.querySelector('input[aria-label="获得技能名"]') as HTMLInputElement,
      { target: { value: '还没有这一枚' } });
    expect(screen.getByText(/名册里暂时没有「还没有这一枚」/)).toBeTruthy();
  });
});

// v2.8.3 刀 B：发动门槛的录入面接线——打字即翻译成结构化条件，看不懂就地说明。
describe('SkillEditor: 发动门槛录入（🚪 门槛框）', () => {
  beforeEach(() => {
    cleanup();
    // §H3: 编辑器对官方将的写入需要开发者模式——本文件的意图（改动落到
    // store 并被编译器接受）在权限打开后逐字保持。
    useGameStore.setState({ skillEdits: {}, generalEdits: {}, developerMode: true });
  });

  const openFirstEffect = () => {
    const target = allGenerals.find(g => (g.skills[0]?.effects?.length ?? 0) === 0)!;
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);
    // v2.8.11 刀2：门槛框有两个了——第 1 个是「整组门槛」（技能级），最后一个
    // 是这条效果的「逐项门槛」。既有断言说的都是逐项那一栏，取末位保持原意。
    const gateInputs = Array.from(document.querySelectorAll('input[placeholder^="留空＝没门槛"]')) as HTMLInputElement[];
    expect(gateInputs.length).toBeGreaterThanOrEqual(2);
    return { target, gateInput: gateInputs[gateInputs.length - 1], groupGateInput: gateInputs[0] };
  };

  const save = (id: string) => {
    // 保存后按钮两秒内显示"✅ 已保存"，同一元素，两种文字都要认。
    fireEvent.click(screen.getByText(/保存修改|已保存/));
    return useGameStore.getState().skillEdits[id]!;
  };

  it('门槛打字→回显→存进 store→编译器带着条件走引擎侧', () => {
    const { target, gateInput } = openFirstEffect();

    // 一条能进编译模型的效果要三件齐全：触发时机 + 结构化效果 + 门槛。
    const quickInput = document.querySelector('input[placeholder^="或打字"]') as HTMLInputElement;
    fireEvent.change(quickInput, { target: { value: '回合结束时' } });
    fireEvent.click(screen.getAllByText('照这个填')[0]);
    fireEvent.change(gateInput, { target: { value: '手牌≤2，牌堆≥5' } });
    expect(screen.getByText('手牌≤2')).toBeTruthy();
    // 旧词照旧读得懂，但回显与写出的永远是现行那一个名字（v2.8.18 §八第 6 条：一个牌摞只留一个名字）。
    expect(screen.getByText('抽牌堆≥5')).toBeTruthy();
    const runtimeSelect = Array.from(document.querySelectorAll('select'))
      .find(s => s.options[0]?.text?.startsWith('纯描述')) as HTMLSelectElement;
    fireEvent.change(runtimeSelect, { target: { value: 'DRAW_CARD' } });

    const saved = save(target.id);
    expect(saved[0].effects?.[0].conditions).toEqual([
      { metric: 'HAND_COUNT', op: 'LTE', value: 2 },
      { metric: 'DECK_COUNT', op: 'GTE', value: 5 },
    ]);
    const general = allGenerals.find(g => g.id === target.id)!;
    const compiled = compileGeneralSkills({ ...general, skills: saved });
    const gated = compiled.definitions.find(d => (d.conditions?.length ?? 0) === 2);
    expect(gated).toBeTruthy();
    expect(gated!.conditions).toEqual(saved[0].effects![0].conditions);
  });

  it('看不懂的门槛就地标红，保存后不落成条件（宁缺勿猜）', () => {
    const { target, gateInput } = openFirstEffect();
    fireEvent.change(gateInput, { target: { value: '攻击范围内没有马' } });
    expect(screen.getByText(/没看懂（这些条件不会生效）/)).toBeTruthy();
    expect(screen.getByText('「攻击范围内没有马」')).toBeTruthy();
    expect(save(target.id)[0].effects?.[0].conditions).toBeUndefined();
  });

  it('v2.9.3 刀C：三枚击杀形状的量认得、存得下；那句词表提示只有一个来源', () => {
    const { target, gateInput } = openFirstEffect();
    fireEvent.change(gateInput, { target: { value: '近战击杀=1，被杀者在战场=1，身边与战场己方=0' } });
    expect(screen.queryByText(/没看懂（这些条件不会生效）/)).toBeNull();
    expect(screen.getByText('近战击杀=1')).toBeTruthy();
    // 挂在非击杀的触发时机上也不许静悄悄：界面当场说清"这条永远不成立"。
    expect(screen.getByText(/只有击杀那一声才有账可查/)).toBeTruthy();
    expect(save(target.id)[0].effects?.[0].conditions).toEqual([
      { metric: 'KILL_BY_MELEE', op: 'EQ', value: 1 },
      { metric: 'VICTIM_IN_BATTLE_AREA', op: 'EQ', value: 1 },
      { metric: 'ALLY_NEAR_OR_BATTLE_COUNT', op: 'EQ', value: 0 },
    ]);
    // 提示语逐字等于 `skillGateText.ts` 的那一份，且界面上不存在第二份手抄——
    // 真机点验撞见过一次：新量在词表里放开了，组件里另抄的那句还写"只有六个量"。
    const hintLines = Array.from(document.querySelectorAll('p'))
      .filter(p => p.textContent === GATE_SYNTAX_HINT);
    expect(hintLines.length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain('能填的量只有');
  });

  it('v2.8.11 刀2：「选择其一」×门槛照常录入，不再整条拒录（红字说明已撤）', () => {    const { gateInput, groupGateInput } = openFirstEffect();
    fireEvent.change(gateInput, { target: { value: '手牌≤2' } });
    expect(screen.queryByText(/暂时不能配门槛/)).toBeNull();

    const modeSelect = Array.from(document.querySelectorAll('select'))
      .find(s => Array.from(s.options).some(o => o.value === 'choice')) as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: 'choice' } });
    // 不再有"配了门槛也不能用"的警告，只剩两级顺序的说明
    expect(screen.queryByText(/暂时不能配门槛/)).toBeNull();
    expect(screen.getByText(/先判「整组门槛」/)).toBeTruthy();

    // 整组门槛独立成栏：写它⇒落在技能上，不污染逐项那栏
    fireEvent.change(groupGateInput, { target: { value: '体力≤1' } });
    expect(screen.getByText('体力≤1')).toBeTruthy();
  });

  it('打字快填触发时机：半截细分不猜，报没看懂', () => {
    const { target } = openFirstEffect();
    const quickInput = document.querySelector('input[placeholder^="或打字"]') as HTMLInputElement;
    expect(quickInput).toBeTruthy();
    fireEvent.change(quickInput, { target: { value: '受到伤害后→攻击' } });
    fireEvent.click(screen.getAllByText('照这个填')[0]);
    expect(screen.getByText(/这个写法没看懂/)).toBeTruthy();

    fireEvent.change(quickInput, { target: { value: '受到伤害后→攻击伤害' } });
    fireEvent.click(screen.getAllByText('照这个填')[0]);
    expect(screen.queryByText(/这个写法没看懂/)).toBeNull();
    expect(save(target.id)[0].effects?.[0].trigger).toEqual({ type: 'onDamageTaken', damageSubType: 'attackDamage' });
  });
});
