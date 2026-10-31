/**
 * 乙 线第三片㈁（2026-11-01）·取料口自己的证人。
 *
 * 这一档要钉的是那句“握手第四格＝这一台机器此刻真在用的那份名单按效力取的那串字”里
 * 三个词各自：**按效力**（不是 localStorage 字节）、**此刻真在用**（每次现取，不冻存）、
 * **那份名单**（关掉一个将与多出张自制卡都算变了）。
 * 算法本身不在这里重验——那是乙 线第二片 `rosterHandover.test.ts` 的活；这里只验接线。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { General } from '../data/generals';
import { createAuthoredGeneral } from '../domain/generalProvenance';
import { rosterContentFingerprint } from '../setup/rosterHandover';
import { ROSTER_CONTENT_UNREPORTED } from '../network/netProtocol';
import { useGameStore } from './gameStore';
import { localRosterContent } from './rosterContent';

function diy(name: string): General {
  const created = createAuthoredGeneral({ name, faction: '蜀', hp: 4, identity: name, skills: [{ name: `${name}技` }] }, 'DIY');
  if (!created.ok) throw new Error(`setup failed: ${created.reason}`);
  return created.general;
}

function resetStore(): void {
  useGameStore.setState({ authoredGenerals: [], disabledGenerals: new Set<string>(), generalEdits: {}, skillEdits: {}, developerMode: false } as never);
}

describe('localRosterContent（握手第四格的取料口）', () => {
  beforeEach(() => resetStore());

  it('交的就是那两样输出走同一把尺——本文件不写第二套算法', () => {
    const state = useGameStore.getState();
    expect(localRosterContent()).toBe(rosterContentFingerprint(state.poolGenerals(), state.effectiveDisabledGenerals()));
  });

  it('给出一串摘要形状的值，绝不给空、也不给那句“没报出名册”', () => {
    const value = localRosterContent();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
    expect(value).not.toBe(ROSTER_CONTENT_UNREPORTED);
  });

  it('此刻真在用＝每次现取：装上一张自制卡，下一枚戳就跟着变；退回原样又逐字相同', () => {
    const before = localRosterContent();
    useGameStore.setState({ authoredGenerals: [diy('张三')] } as never);
    const withNewGeneral = localRosterContent();
    expect(withNewGeneral).not.toBe(before);

    resetStore();
    expect(localRosterContent()).toBe(before);
  });

  it('“那份名单”包括被关掉的将：关掉一个 ⇒ 值变；重新打开 ⇒ 回到原值', () => {
    const mine = diy('李四');
    useGameStore.setState({ authoredGenerals: [mine] } as never);
    const before = localRosterContent();

    useGameStore.setState({ disabledGenerals: new Set([mine.id]) } as never);
    // 这条先把前提量了：这一张的“关掉”确实被 §H3 那层认下（否则下面那句断言只是在比两个没变的值）。
    expect(useGameStore.getState().effectiveDisabledGenerals().has(mine.id)).toBe(true);
    expect(localRosterContent()).not.toBe(before);

    useGameStore.setState({ disabledGenerals: new Set<string>() } as never);
    expect(localRosterContent()).toBe(before);
  });

  it('一份空名单算出来也是一串字，不等于那句“没报出名册”：空是一种名单，没交上来是另一回事', () => {
    const empty = rosterContentFingerprint([], []);
    expect(empty).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
    expect(empty).not.toBe(ROSTER_CONTENT_UNREPORTED);
    expect(empty).not.toBe(localRosterContent());
  });
});
