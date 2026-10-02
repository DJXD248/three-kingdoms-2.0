/**
 * 「在场即生效」那一型的唯一落笔处（2.8 刀4＝#25，契约见 PROJECT_ARCH_MAP §F）。
 *
 * 用户裁决第 3 条把它和"发动"分开：这枚技能**不是一次发动**——它不进问窗、不
 * 需要玩家点头、不依赖「强制发动」那个开关、也不消耗"回合限 1 次"。它就是一笔
 * 账，条件是"这一员将在场上"。所以：
 *  - 它绝不出现在 `TRIGGER_EVENTS` 里（`matchesSkillEvent` 对 `passive` 恒
 *    false）⇒ 结构上不可能"响一次"，也就不可能被误当成发动（编译器头注释里
 *    onTurnEnd 那条"故意缺席事件面"的纪律，这是第二个实例）；
 *  - 它**只在登场那一刻落一笔**（下面 `passiveEventsForDeploy`），离场那一笔由
 *    `chainedConsequences` 的 DEATH／离场扫描统一销掉（裁决第 2 条：离场打断
 *    一切，与周期写法无关）；
 *  - 回场不续旧账：那是一次新的落笔、一个新的 `seq`（裁决第 2 条后半）。今天
 *    引擎里还没有"回归/调离"这条路径（【调离区】另立一刀），所以这里只有登场
 *    一个入口——**将来加回归路径时必须在这里补一次落笔**，否则那一员"人在场上、
 *    账却没有"。这条待办同时写在契约表里，不靠注释存活。
 *
 * 编译器替这一档把过三道闸（`skillCompiler.consider`）：带门槛的、带周期的、
 * 和「选择其一」混在一起的 passive 一律点名跳过。所以本文件**不需要**求值门槛，
 * 也不需要处理多效果择一——它看到的就是"一员将 ＋ 一笔改数"。
 */
import type { General } from '../data/generals';
import type { GameEvent } from '../core/Event';
import type { NewStatModifier } from '../core/eventProcessors/statModifierEvents';
import { compileGeneralSkills } from './skillCompiler';

/** 这一员将身上所有「在场即生效」技能各自要落的那一笔（顺序＝技能录入顺序）。 */
export function passiveEntriesOfGeneral(
  general: General,
  runtimeGeneralId: string,
  playerId: number,
): NewStatModifier[] {
  const { definitions } = compileGeneralSkills(general, runtimeGeneralId);
  const entries: NewStatModifier[] = [];
  for (const definition of definitions) {
    if (definition.passive !== true) continue;
    for (const effect of definition.effects) {
      if (effect.type !== 'MODIFY_STAT' || !effect.stat || !effect.modifyMode) continue;
      entries.push({
        key: effect.stat,
        mode: effect.modifyMode,
        value: Number(effect.value ?? 0),
        // 编译器已把这一档的目标强制收在 SELF（跨将目标是 #28 刀7）⇒ 被改的就
        // 是拥有者自己这一员，两个键都取自本次落笔的将，没有别的可能。
        targetPlayerId: playerId,
        targetId: runtimeGeneralId,
        ownerPlayerId: playerId,
        ownerGeneralId: runtimeGeneralId,
        ownerSkillId: definition.id,
        ownerSkillName: definition.name,
        // 锁定技徽章 ⇒ 这笔账别人移不走（skillCompiler 只在真有 MODIFY_STAT 时落键）。
        locked: definition.locked === true,
        passive: true,
        // 在场笔不填 `expire`：它的周期就是"在场"本身（填了会被编译器点名跳过）。
      });
    }
  }
  return entries;
}

/**
 * 登场事件的派生：把这一员将的在场笔译成 `STAT_MODIFY{op:'ADD'}`。
 * 没有在场技 ⇒ 返回空数组 ⇒ 事件流一字不多（两锚逐字的结构保证）。
 */
export function passiveEventsForDeploy(
  general: General,
  runtimeGeneralId: string,
  playerId: number,
): GameEvent[] {
  return passiveEntriesOfGeneral(general, runtimeGeneralId, playerId).map(modifier => ({
    type: 'STAT_MODIFY' as const,
    data: { op: 'ADD' as const, modifier, cause: 'PASSIVE_ON_FIELD' },
  }));
}
