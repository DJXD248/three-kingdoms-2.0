import type { EngineState } from './GameState';
import type { GameEvent } from './Event';
import { getRuntimeCardId } from '../utils/runtimeIdentity';

/**
 * 自动发动路的**结算侧在场资格**（用户 2026-10-03 裁决，原文＝PROJECT_HANDOFF §12-101：
 * 「将领不在场上不能发动技能，被砍死了不算在场上，能发动就是空发，就算是『强制发动』
 * 不能发动」；判断时刻＝乙案＝**这一刀整个算完之后主人还在不在场**，与问答路同一条判据）。
 *
 * 为什么必须住在结算侧而不是发射侧：自动路的效果在触发链展开时就生成了（那一刻主人
 * 通常还在场），落账却排在来源那一笔之后——`EngineDispatchFlow.resolveTriggerChain` 对着
 * **结算前**的状态展开整条链，所以发射侧压根看不见这一刀会不会把主人打死。问答路没有这个
 * 问题（它的候选在结算之后才枚举），因此两半各有一个执法点：
 *   ‧ 发射侧＝`SkillTriggerBridge.ownerCanActivate`（掐掉"主人在重入时已经离场"那一半，
 *     典型＝受到伤害后摸牌：`INJURY` 是结算后派生的那一声明）
 *   ‧ 结算侧＝本文件（掐掉"效果先生成、主人后被砍死"那一半，典型＝成为目标时反伤）
 * 两个执法点读的是**同一个事实**（主人此刻还列不列在席上的在场名单里），不新增第二条状态
 * 转移路径：不合规的那一笔既不落账、也不留在事件流里⇒界面上与账本上都"压根没发生"，
 * 与问答路的形状逐字相同（问答路是压根不生成）。
 *
 * **豁免＝主人自身阵亡那一型**（`onDeath`＝遗言／遗计，官方账里四张将在用）：它按定义就在
 * 主人离场那一刻发动。豁免不由本文件再判一次，而由发射侧写在事件载荷上的
 * `ownerPresenceRequired` 决定（一处判断、一处读取，不分叉）。
 */
export function effectOwnerLeftField(state: EngineState, event: GameEvent): boolean {
  const data = (typeof event.data === 'object' && event.data !== null
    ? event.data
    : {}) as Record<string, unknown>;
  // 只有自动发动路生成的那一笔带这两个键（`SkillTriggerBridge.translateEffect` 盖章）；
  // 不带＝不是这一路（问答路的发动、引擎内部触发、派生通知……），照旧放行。
  if (data.ownerPresenceRequired !== true) return false;
  const generalId = String(data.ownerGeneralId ?? '');
  if (!generalId) return false;
  const seat = String(data.sourceId ?? '');
  const owner = (state.players ?? []).find(player => String(player.id) === seat);
  const fieldGenerals = Array.isArray(owner?.fieldGenerals) ? owner?.fieldGenerals : [];
  return !fieldGenerals.some(fg =>
    getRuntimeCardId((fg as { general?: unknown }).general as never) === generalId);
}
