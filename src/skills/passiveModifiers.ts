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
 *
 * ── 触发时机接入线·第 2 刀（用户 2026-11-10 裁的顺序）：这一族多了一个姊妹。
 * 「直到X前生效」(`untilExpire`) 走的正是上面这一条路，一个字都没另起炉灶：同样
 * 不进事件面（`TRIGGER_EVENTS` 里没有它，这是继 onTurnEnd／passive 之后第三个
 * "编译而不听"的例外）、同样不是一次发动、同样只在登场与「获得技能」两拍落笔。
 * 唯一的差别＝它多带一条死线 X，落笔时写进账本已有的 `expire` 那一格：
 *  · 四个回合词由 `chainedConsequences` 的回合边界总闸收账（`TURN_EXPIRES`），
 *  · `untilDeath`／`untilLeaveField` 与离场／阵亡／席位覆灭那三道总闸同义（契约表
 *    第 2 条），X 到没到都由**同一批已有的销账**收走。
 * ⇒ 零新增销账机制、零新增事件类型。编译器同样把过闸：没有 X、效果不是「改数值」、
 * 效果里又填周期、带门槛、觉醒技、混进「选择其一」／链式，一律点名跳过（六个
 * `UNTIL_EXPIRE_*`／`AWAKENING_UNTIL_EXPIRE_CONFLICT` 码）——所以这里看到的仍只是
 * "一员将 ＋ 一笔改数 ＋（可能）一条死线"。
 */
import type { General, Skill } from '../data/generals';
import type { GameEvent } from '../core/Event';
import type { NewStatModifier } from '../core/eventProcessors/statModifierEvents';
import { compileGeneralSkills } from './skillCompiler';

/** 这一员将身上所有「在场账」（在场即生效 ＋ 直到X前生效）各自要落的那一笔（顺序＝技能录入顺序）。 */
export function passiveEntriesOfGeneral(
  general: General,
  runtimeGeneralId: string,
  playerId: number,
): NewStatModifier[] {
  const { definitions } = compileGeneralSkills(general, runtimeGeneralId);
  const entries: NewStatModifier[] = [];
  for (const definition of definitions) {
    // 两型姊妹共用这一支：`passive` 那型不带死线，`untilExpire` 那型必带（编译器拦的）。
    // 除这两型以外的定义——包括一切"发动"型——在这里一律不被看见。
    const onField = definition.passive === true;
    const windowed = definition.trigger === 'untilExpire';
    if (!onField && !windowed) continue;
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
        // 「在场持续」这一位在账本里说的是"这不是一次发动"。第 2 刀那一型同样不是
        // 发动，但它**有**到期时刻，所以这位写 false——两位各说各话会让人把死线
        // 读成"在场"（`isExpiredAtTurnBoundary` 只认 `expire`，不认这一位；这一位
        // 现在的读数点是销账总闸与界面，语义必须逐字对得上）。
        passive: onField,
        // 在场笔不填 `expire`：它的周期就是"在场"本身（填了会被编译器点名跳过）。
        // 带死线那一型反之**必填**（缺 X 的定义编译器根本编不出来），X 到点由账本
        // 已有的两把总闸收走：四个回合词走回合边界，「被击杀／离开场上」与离场同义。
        ...(windowed && definition.expireCondition
          ? { expire: definition.expireCondition }
          : {}),
        // 「造成的伤害」那一把钥匙可以带场合（2.9.4＝怒斩的两条腿正是挂在在场笔上，
        // 用户裁决「允许」：在场即生效的被动读造方伤害点）。同样只在真填了时才出现这个键。
        ...(effect.occasion !== undefined ? { occasion: effect.occasion } : {}),
      });
    }
  }
  return entries;
}

/**
 * 登场事件的派生：把这一员将的在场笔（含第 2 刀那型带死线的）译成 `STAT_MODIFY{op:'ADD'}`。
 * 两型都没有⇒返回空数组⇒事件流一字不多（两锚逐字的结构保证）。
 * `cause` 只给人读（现读的落点＝测试与结算提示），两位各一枚：在场笔／带死线的在场笔。
 */
export function passiveEventsForDeploy(
  general: General,
  runtimeGeneralId: string,
  playerId: number,
): GameEvent[] {
  return passiveEntriesOfGeneral(general, runtimeGeneralId, playerId).map(modifier => ({
    type: 'STAT_MODIFY' as const,
    data: {
      op: 'ADD' as const,
      modifier,
      cause: modifier.passive ? 'PASSIVE_ON_FIELD' : 'UNTIL_EXPIRE_ON_FIELD',
    },
  }));
}

/**
 * 2.9.3 刀A「获得技能」补的那一次落笔。文件头那条待办写的是"将来加回归路径时必须
 * 在这里补一次落笔"，而**获得一枚在场技就是同一条路径的第一个实例**：登场那一刻已经
 * 过去了，再不补就是"人拿着技能、账却没有"。
 *
 * 做法是把这一员将的卡面技能清单临时收成"只算刚拿到的这一枚"再走同一个
 * `passiveEntriesOfGeneral`——**不落第二套在场账算术**（那一套算术的唯一落点还是上面）。
 * 拿到的不是在场技⇒返回空数组⇒事件流一字不多。
 */
export function passiveEventsForGainedSkill(
  general: General,
  skill: Skill,
  runtimeGeneralId: string,
  playerId: number,
): GameEvent[] {
  return passiveEventsForDeploy({ ...general, skills: [skill] }, runtimeGeneralId, playerId);
}
