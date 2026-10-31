/**
 * 乙 线第三片㈁（2026-11-01）＝**这一台机器此刻真在用的那份名单，按效力取出的那串字**。
 *
 * 它是握手第四格 `VersionStamp.content` 的唯一取料口：联机那条路（`src/components/OnlineLobby.tsx`
 * 交给 `joinRoom` 的那一枚 `rosterContent`）与将来算牌那侧都比的是这一串。
 * 契约落点＝`PROJECT_ARCH_MAP.md` §G 第 12 条 ㈡（名册指纹握手的最小形态）＋乙 线第二片那份
 * `src/setup/rosterHandover.ts`（算法与判据全住在那一侧，本文件只搬运，零新判据）。
 *
 * 三条口径抄在册，免得下一个人重新发明：
 *  ① **取的是效力、不是存档字节**。要的是 `poolGenerals()`（官方＋本机自制，且已过一遍卡面编辑
 *     合并与 §H3 策略过滤）与 `effectiveDisabledGenerals()`（过滤后才算数的那份"被关掉的编号"）。
 *     按 localStorage 原始字节取一定假绿：§H3 第三层就是让同一份存档在两台上不一样地生效。
 *  ② **算法复用第二片那一支** `rosterContentFingerprint`——它走内容包那两枚摘要（`stableText`
 *     ＋`digestText`）。各写一份迟早分叉：交料那侧算得相等、握手这侧算得不等，玩家看到的是
 *     同一条路的两张脸。
 *  ③ ⚠️ **这一串字是分叉预警，不是防人偷看那一档**。那颗摘要自己的边界写在 `contentPack.ts`
 *     的注释里（只抓下载不全／被人改过一个字，不扛有心人伪造），所以界面上的话只能说
 *     "两边名单不是同一份、开局会各发各的牌、这一局不能开始"，不许往"防作弊／已防偷看"上长。
 *
 * 成本（现场量到的，不是估的）：335 张的名单算一遍约 **4 毫秒**。因此调用它的那一侧是
 * **每次真要发/比一枚握手戳时才算一遍**，不是每条来信算一遍——见 `netSession.ts` 里
 * `RosterContentReader` 那段。
 */
import { rosterContentFingerprint } from '../setup/rosterHandover';
import { useGameStore } from './gameStore';

/** 本机那份效力名册的指纹（握手第四格 `content` 的值）。空名单也要给出一串字：那本身就是"这份名单是空的"。 */
export function localRosterContent(): string {
  const state = useGameStore.getState();
  return rosterContentFingerprint(state.poolGenerals(), state.effectiveDisabledGenerals());
}
