/**
 * #49 拼积木编辑器的界面接线证人（v2.9.8）。
 * 三件事必须在真组件上成立：挑积木⇒话替用户写出来；手改过⇒积木再变也不覆盖；
 * 手改态下那颗「↺ 用积木重写这句」一点就把生成句放回去。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import SkillEditor from './SkillEditor';
import { allGenerals } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { clickIntoSkillsStep } from '../test/wizardStep';

function findRuntimeSelect(): HTMLSelectElement {
  const el = Array.from(document.querySelectorAll('select'))
    .find(s => s.options[0]?.text?.startsWith('纯描述'));
  if (!el) throw new Error('结构化效果下拉未出现');
  return el as HTMLSelectElement;
}

function effectBox(): HTMLTextAreaElement {
  const el = screen.getByLabelText('效果1卡面文字') as HTMLTextAreaElement;
  expect(el).toBeTruthy();
  return el;
}

/**
 * #157（2026-11-05 修）用的那把等待尺。每一次 `fireEvent` 之后，这条测试等的都是**自己那一指造成的
 * 那一次重算**，而不是"界面上此刻恰好有的那句字"。
 *
 * 为什么是 6 秒：这一步的重算本来是同步的（`patchEffect` 在 onChange 里就把那句写进 state，
 * `act()` 在 fireEvent 返回前已经把它刷进 DOM），所以绿色路径下等待在第一拍就通过，这个上限
 * 平时根本吃不到；它只在"那一指真的没造成那次变化"（＝真回归）时才生效。故意留在 6 秒而不是
 * 抄同族那份 `{ timeout: 20_000 }`，是为了让失败以断言原文出现（"expected 摸 4 张牌 to be …"），
 * 不被全局 20 秒先判成超时——本机 99% 负载下这条本来就要跑 ~9 秒，再等满 20 秒就撞上限了。
 * 不动 `vitest.config.ts` 的全局 testTimeout、不降并发。
 */
const SETTLED = { timeout: 6_000 };

describe('拼积木→生成文字→文字还能改', () => {
  beforeEach(() => {
    cleanup();
    useGameStore.setState({ skillEdits: {}, generalEdits: {}, developerMode: true });
  });

  const openFirstPlainSkill = () => {
    // 夹具按号钉死（v2.9.33 就地更正）：原先取"名册里第一枚没有 effects 的技能"，
    // 那隐含两条前提——它同时也没有卡面话、而且那位玩家身上只有一枚技能。
    // 甲三那把 90 格补卡面话正好打在原先挑中的张辽「突袭」上，第一条前提被那一刀推翻⇒
    // 改按 id 钉一枚三样都满足的（单技能·无积木·无卡面话），并在这里当场自证，前提再漂就红得明白。
    const target = allGenerals.find(g => g.id === 'shu_016')!;
    const plain = target.skills[0] as { name?: string; effects?: unknown[]; description?: string };
    expect(
      target.skills.length === 1 && (plain.effects?.length ?? 0) === 0 && String(plain.description ?? '').trim() === '',
      `夹具前提漂了（需单技能·无积木·无卡面话）：${target.id}＝${JSON.stringify(target.skills)}`,
    ).toBe(true);
    render(<SkillEditor onClose={() => {}} />);
    const listBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes(target.name));
    fireEvent.click(listBtn!);
    clickIntoSkillsStep();
    fireEvent.click(screen.getAllByText('＋ 切换为多效果模式')[0]);
    return target;
  };

  it('挑一块积木，下面那句卡面话就替用户写好了', () => {
    openFirstPlainSkill();
    fireEvent.change(findRuntimeSelect(), { target: { value: 'DRAW_CARD' } });
    const box = effectBox();
    expect(box.value).toBe('摸 1 张牌。');

    // 数值那一格改到 3 ⇒ 句子跟着改（这句还是"上一次生成的那句"，所以跟着积木走）
    const nums = Array.from(document.querySelectorAll('input[type="number"]'));
    fireEvent.change(nums[nums.length - 1], { target: { value: '3' } });
    expect(effectBox().value).toBe('摸 3 张牌。');
    expect(screen.queryByText('↺ 用积木重写这句')).toBeNull();
  });

  it('手打过一次就不再覆盖，并且给一条回到自动生成回去的路', async () => {
    openFirstPlainSkill();
    fireEvent.change(findRuntimeSelect(), { target: { value: 'DRAW_CARD' } });
    // 第一步等的就是"挑了 DRAW_CARD 这块积木"造成的那次重算：格子里出现那句生成话。
    await waitFor(() => expect(effectBox().value).toBe('摸 1 张牌。'), SETTLED);

    const box = effectBox();
    fireEvent.change(box, { target: { value: '摸牌，然后本回合不能再移动。' } });
    // 手打这一句落定的样子＝格子里是这句，且界面同时给出那条回到自动生成的路。
    await waitFor(() => {
      expect(effectBox().value).toBe('摸牌，然后本回合不能再移动。');
      expect(screen.queryByText('↺ 用积木重写这句')).toBeTruthy();
    }, SETTLED);

    const nums = Array.from(document.querySelectorAll('input[type="number"]'));
    fireEvent.change(nums[nums.length - 1], { target: { value: '4' } });
    // 积木改到 4 造成的变化＝生成句变成「摸 4 张牌。」而手改那句一个字不许动——这才叫"不再覆盖"。
    await waitFor(() => expect(effectBox().value).toBe('摸牌，然后本回合不能再移动。'), SETTLED);

    fireEvent.click(screen.getByText('↺ 用积木重写这句'));
    // 这一点之后要的是那一次重算的结果：必须是按刚打进去的 4 生成的那一句，旧渲染给不出这个 4。
    await waitFor(() => expect(effectBox().value).toBe('摸 4 张牌。'), SETTLED);
  });

  it('保存下去的还是那三个格子（积木＋一句人话），没有偷偷新增第四样东西', () => {
    const target = openFirstPlainSkill();
    fireEvent.change(findRuntimeSelect(), { target: { value: 'HEAL' } });
    expect(effectBox().value).toBe('回复 1 点体力。');
    fireEvent.click(screen.getByText('💾 保存修改'));

    const saved = useGameStore.getState().skillEdits[target.id];
    const eff = saved?.[0]?.effects?.[0];
    expect(eff?.runtime).toEqual({ type: 'HEAL', value: 1, target: 'TARGET' });
    expect(eff?.description).toBe('回复 1 点体力。');
    // 生成句就是卡面上那句话：编译器不读它，读的是上面那格积木。
    expect(Object.keys(saved![0])).toEqual(expect.arrayContaining(['name', 'description', 'effects']));
    expect(saved![0]).not.toHaveProperty('autoText');
  });

  it('纯文字那一档（没有积木）界面如实说明它不参与结算', () => {
    openFirstPlainSkill();
    fireEvent.click(screen.getByText('切换为单效果模式（将清除所有子效果与整组门槛）'));
    expect(screen.getByText(/这一档只有文字、没有积木/)).toBeTruthy();
  });
});
