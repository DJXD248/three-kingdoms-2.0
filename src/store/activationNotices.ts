/**
 * 发动通知（v2.9.17「强制发动·全覆盖」刀，用户 2026-10-21 裁决原文后半句＝
 * 「强制发动永远是强制发动，无论什么节点，**但是一定要通知玩家有什么技能发动了**」）。
 *
 * 为什么这一刀要把它搬进事件流：v2.9.16 之前只有"停下来问、人点头"那两路各手写一条
 * 提示，到点自己响那一路一声不吭；而"强制发动"从今天起在任何一格走的都正是那一路⇒
 * 不问可以，看不见不行。判据因此只剩一句＝**这一次 dispatch 的事件流里有没有
 * `SKILL_ACTIVATED` 那一身**，而那一身三条发动路（自动／问答／回合结束）本来就都从
 * `skills/skillQuota.ts` 的同一个生产点出声⇒界面只需这一处，也不需要知道它是哪条路。
 *
 * B 类展示事实：不进 EngineState、不进录像、不参与合法性——与响应窗容器同一档
 * （§12-61「窗口可以不录；窗口里的游戏决策不能不录」）。
 */
import type { GameEvent, SkillActivationEventData } from '../core/Event';
import type { EngineState } from '../core/GameState';
import type { SkillActivation } from '../skills/dataTypes';
import { generalCardOf } from '../skills/reactionChain';

/** 三族共用一个颜色：判据只有一条（真的发动了一次），展示层的分支数就必须等于它。 */
const NOTICE_COLOR = '#f59e0b';

export function activationNoticesFrom(
  events: GameEvent[],
  state: EngineState,
): SkillActivation[] {
  const notices: SkillActivation[] = [];
  events.forEach((event, index) => {
    if (event.type !== 'SKILL_ACTIVATED') return;
    const data = event.data as SkillActivationEventData;
    const general = generalCardOf(state, Number(data.playerId), String(data.generalId));
    const generalName = general ? String(general.name ?? data.generalId) : String(data.generalId);
    const skillName = String(data.skillName ?? '');
    const description = general?.skills?.find(skill => skill.name === skillName)?.description;
    notices.push({
      // 带额度的那一身有 `stableId`＝天然唯一；纯通知那一身没有，按这一次 dispatch 的
      // 位置发号（同一批里两声同名也不能撞，撞了 React 就少画一条）。
      id: data.stableId ?? `act:${state.turn}:${data.generalId}:${data.skillId}:${index}`,
      generalName,
      skillName,
      message: description || `${skillName}发动了`,
      color: NOTICE_COLOR,
      timestamp: Date.now(),
    });
  });
  return notices;
}
