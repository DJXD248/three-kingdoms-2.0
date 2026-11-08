/**
 * 询问倒计时那两格判据的证人（乙 线末片第二刀 · 刀 1 拍 3 ㈁，2026-11-06）。
 *
 * 这里只钉 `askClock.ts` 新加的两个**纯函数**——热座那一格（v5 的 C5＝业主裁"热座不套倒计时"）
 * 与"这一秒该为谁计时"那一格（C3＝键的形状 + 到点该按哪一颗钮）。表跑不跑、锚落不落由
 * `AskClockDirector.test.tsx` 那边钉，这一格只管算。
 *
 * 每条都问过一个"合理假值"：热座那一格换成 `humanSeatCount >= 1`、`activeNetRoomPresent ||`
 * 或整条反着写；键那一格换成只键窗不键人、或把 `channel` 写死成 `'turnEnd'`——都必须当场红。
 */
import { describe, it, expect } from 'vitest';
import { askAnchorKey, choiceAtDeadlineHit, isHotSeatTable } from './askClock';

describe('askClock · 热座判据四形 (拍 3 ㈁ · v5 C5)', () => {
  // 拆成四枚分开的 `it`：一枚 `it` 里循环多形＝第一形红就抛、其余不跑（v2.9.33 在册教训）。
  it('单机一位真人＝不是热座⇒这一桌套秒表（电脑那一席根本不问，`endTurn` 那颗门已排除）', () => {
    expect(isHotSeatTable(false, 1)).toBe(false);
  });

  it('单机两位真人＝热座⇒不套秒表（一个人替好几个人轮流点头，屏上压根没有"这一席走神了"这件事）', () => {
    expect(isHotSeatTable(false, 2)).toBe(true);
  });

  it('联机一位真人＝照常套秒表，哪怕这台机器上只有房主一个真人（客人那边真会不在屏幕前）', () => {
    expect(isHotSeatTable(true, 1)).toBe(false);
  });

  it('联机五位真人＝也照常套：联机那一臂一律照套，与本机几个真人无关', () => {
    expect(isHotSeatTable(true, 5)).toBe(false);
  });

  it('假值自查：真人席 0（还没进牌桌）不算热座，也不许把"没开联机房间"读成 null', () => {
    expect(isHotSeatTable(false, 0)).toBe(false);
    // 进料是布尔不是"有值没值"：把 `getActiveRoom()` 的 null 直接递进来必须落到"联机"那一侧才不套，
    // 这一条钉的是签名＝只有 `=== false` 才可能判成热座。
    expect(isHotSeatTable(null as unknown as boolean, 2)).toBe(false);
  });
});

describe('askClock · 这一秒该为谁计时 (拍 3 ㈁ · v5 C3/C4) (v6 追加㈠)', () => {
  const reaction = { choiceWindowKey: null, choiceDebtorId: null, reactionWindowId: 'rw:5:3:ev:x:1', reactionDebtorId: 2, turnEndWindowId: null, turnEndDebtorId: null };
  const turnEnd = { choiceWindowKey: null, choiceDebtorId: null, reactionWindowId: null, reactionDebtorId: null, turnEndWindowId: 'turn-end-ask:5:1', turnEndDebtorId: 1 };
  const choice = { choiceWindowKey: 'ch:5:3:g_choice:择一', choiceDebtorId: 1, reactionWindowId: null, reactionDebtorId: null, turnEndWindowId: null, turnEndDebtorId: null };

  it('响应链那一形：键＝窗身份|该答那一席，且把出口那一扇一起交回去（到点按的是「跳过」）', () => {
    expect(askAnchorKey(reaction)).toEqual({ key: 'rw:5:3:ev:x:1|2', channel: 'reaction' });
  });

  it('回合结束那一形：键＝`windowId|playerId`，出口＝「都不发动」', () => {
    expect(askAnchorKey(turnEnd)).toEqual({ key: 'turn-end-ask:5:1|1', channel: 'turnEnd' });
  });

  it('抉择窗那一形：键＝`choiceKey|playerId`，出口＝那一条 `CHOOSE_OPTION`', () => {
    expect(askAnchorKey(choice)).toEqual({ key: 'ch:5:3:g_choice:择一|1', channel: 'choice' });
  });

  it('三条都活着＝抉择排在最前（业主 11-06 原话㈠＝"那种窗也要算 30 秒"）', () => {
    const both = {
      choiceWindowKey: 'ch:5:3:g_choice:择一', choiceDebtorId: 1,
      reactionWindowId: 'rw:5:3:ev:x:1', reactionDebtorId: 2,
      turnEndWindowId: 'turn-end-ask:5:1', turnEndDebtorId: 1,
    };
    expect(askAnchorKey(both)).toEqual({ key: 'ch:5:3:g_choice:择一|1', channel: 'choice' });
    // 假值自查：反过来写（回合结束优先）时，回合结束那扇在抉择活着时压根不渲染⇒
    // 秒表会给一扇看不见的窗计时，这一条必须红。
    expect(askAnchorKey(both)?.key).not.toBe('turn-end-ask:5:1|1');
  });

  it('同一把窗换了人答＝换了键（业主裁第 4 条"各席各算各的"的落点；键只窗不人会蒙绿）', () => {
    const first = askAnchorKey(choice)!;
    const second = askAnchorKey({ ...choice, choiceDebtorId: 2 })!;
    expect(first.key).not.toBe(second.key);
    expect(second.key.endsWith('|2')).toBe(true);
    // 反证：窗身份一个字没变，所以"键变了"只能来自该答那一席那一半。
    expect(first.key.split('|')[0]).toBe(second.key.split('|')[0]);
  });

  it('缺一半就不算：没窗、或窗在但此刻没有该答的人⇒`null`（不起表、锚也清掉）', () => {
    expect(askAnchorKey({ choiceWindowKey: null, choiceDebtorId: null, reactionWindowId: null, reactionDebtorId: null, turnEndWindowId: null, turnEndDebtorId: null })).toBeNull();
    expect(askAnchorKey({ ...turnEnd, turnEndWindowId: null })).toBeNull();
    expect(askAnchorKey({ ...turnEnd, turnEndDebtorId: null })).toBeNull();
    expect(askAnchorKey({ ...choice, choiceDebtorId: null })).toBeNull();
    expect(askAnchorKey({ ...choice, choiceWindowKey: null })).toBeNull();
    // 席位号 0 不是合法读数（`Player.id` 从 1 起），这里不替它兜底，但也不许把 `null` 读成一个键。
    expect(askAnchorKey({ ...choice, choiceDebtorId: null, choiceWindowKey: null })).toBeNull();
  });

  it('choiceAtDeadlineHit：第一个 enabled !== false 的下标，全禁⇒null', () => {
    expect(choiceAtDeadlineHit([{ label: 'A', events: [] }])).toBe(0);
    expect(choiceAtDeadlineHit([{ label: 'A', enabled: false, events: [] }, { label: 'B', events: [] }])).toBe(1);
    expect(choiceAtDeadlineHit([{ label: 'A', enabled: false, events: [] }, { label: 'B', enabled: false, events: [] }])).toBeNull();
    expect(choiceAtDeadlineHit([])).toBeNull();
  });
});
