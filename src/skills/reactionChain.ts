/**
 * 响应链问答队列（v2.8.22 响应链执法刀＝#71；§H9 第八轮顺序规则＋第九轮三类
 * 分流/问窗/⑨重开＋第十轮两条工作例）。
 *
 * 一句话形态：**把"到点自动响"换成"停下来按规矩问"**，问法与回合结束技能
 * 完全同源——候选从 EngineState 现算（编译→身份→门槛→扣台账），发动走
 * canonical `ACTIVATE_SKILL`，不发动走 canonical `SKIP_REACTION`。人 and AI 走
 * 同一套（用户 2026-09-30 口径"基础游戏规则不应该区分开人和 AI"）：AI 座位的
 * 应答也是从 `legalActions` 里由它自己的策略挑，没有第二条决策路。
 *
 * 本模块是"此刻该问谁、他能选什么"的**唯一推导点**（§12-79）。消费者：
 *   ① `core/TransitionCore` 结算后的扫描（开格／收格）
 *   ② `rules/ActionValidator` 冻结世界门
 *   ③ `rules/legalActions` 枚举
 *   ④ `action/resolvers` 的 ACTIVATE_SKILL 响应分支与 SKIP_REACTION 解析器
 *   ⑤ store 的 HUD 与 AI 司机、`ai/battleRunner` 的 actor 选择
 * 它们全部读同一个 `getReactionAsk`，所以现场、常驻/重建两路、录像回放对
 * "现在轮到谁表态"不可能各执一词。
 *
 * 三条纪律：
 *  - **顺序**＝`triggers/reactionOrder.ts` 那一套比较器（受击方整组先→组内座次
 *    →非受击组从受击末席绕圈→同席位内注册顺序）。这里不重排、不另算。
 *  - **不插队**（§H9 第九轮⑨）：应答产生的新事件只在**扫描时排到队尾**，
 *    当前这一格问完才轮到它——所以新格永远 append，绝不 insert。
 *  - **绝不既自动响又问**：分流开关在 `SkillTriggerBridge.defersToReactionQueue`，
 *    非 forced 的受击／受伤定义压根不进触发链。
 */
import type { General } from '../data/generals';
import type { EngineState, PendingReaction, ReactionNode } from '../core/GameState';
import type { GameEvent, ReactionAnsweredData } from '../core/Event';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { compileGeneralSkills } from './skillCompiler';
import { evaluateSkillConditions } from './skillConditions';
import { matchesSkillEvent } from './skillEventMatch';
import { PRIORITY, SkillTriggerBridge } from './SkillTriggerBridge';
import type { DataSkillDefinition } from './dataTypes';
import { REACTION_EVENT_TYPE, isReactionTrigger, reactionTriggerOfEvent } from './reactionTriggers';
import { orderReactionCandidates, victimRefOf, type ReactionCandidate } from '../triggers/reactionOrder';

/**
 * 一个"表态单位"＝**某一席的某一员将领**（§H9 第九轮⑤：同一将领身上多枚可响应
 * 被动＝玩家自选，问窗给「发动A」「发动B」「跳过」三键＝一次表态）。
 * 台账记这一键，不记单枚技能——问过的将领不在同一格里被问第二次。
 */
export function reactionSubjectKey(playerId: number, generalId: string): string {
  return `${playerId}:${generalId}`;
}

/** 队列里一格能问到的最大格数（跑飞防护，与 `MAX_TRIGGER_REENTRY_ROUNDS` 同源
 *  思路）。如实账：真实终止性来自"伤害会打死人"，这条只是把最坏情况的格数
 *  钉成一个可解释的数，超限后不再开新格并在事件流里留一条 CUSTOM 标记。 */
export const MAX_REACTION_NODES_PER_TURN = 32;

export interface ReactionOption {
  /** ACTIVATE_SKILL 的寻址键（编译定义 id＝`<将>:<技能>:<效果>`）。 */
  skillId: string;
  generalId: string;
  skillName: string;
  /** 玩家看到的那一句（技能描述），与触发路上展示的是同一个字段。 */
  label: string;
  definition: DataSkillDefinition;
}

export interface ReactionAsk {
  nodeKey: string;
  /** 这一格在回应的那一声（已记录的事实，效果翻译按它解 TARGET/ATTACKER）。 */
  sourceEvent: GameEvent;
  /** 这一刻唯一可以表态的那一席（冻结世界门认它）。 */
  playerId: number;
  generalId: string;
  generalName: string;
  /** 同一将领的全部可响应被动（＋恒常存在的「跳过」出口，§12-61）。 */
  options: ReactionOption[];
}

function fieldGeneralsOf(player: EngineState['players'][number]) {
  return Array.isArray(player.fieldGenerals)
    ? (player.fieldGenerals as Array<Record<string, unknown>>)
    : [];
}

/** 把记录在状态里的那一声事件还原成桥接层读得到的事件形状。 */
function sourceEventOf(node: ReactionNode): GameEvent {
  return { type: node.sourceEvent.type, data: node.sourceEvent.data };
}

interface RankedReactionCandidate extends Omit<ReactionCandidate, 'generalId'> {
  ownerId: number;
  /** 编译定义恒钉 `sourceGeneralId`，所以这里比比较器的可选形状更窄：一定有值
   *  （认不出将领的那些也是空串，比较器按席位退回）。窄一层下游才不必到处 `??`。 */
  generalId: string;
  definition: DataSkillDefinition;
}

/**
 * 某一格的**全部**可响应候选，已按比较器排好序（不过滤台账）。
 * 与触发链同一条判定链：编译→时机对得上→身份（`matchesSkillEvent` 单点）→
 * 门槛（`evaluateSkillConditions`）→比较器。
 *
 * 一条免费得来的规则：`onDeath`/阵亡者不算候选——离场的将领不在
 * `fieldGenerals` 里，压根不参评（§H9 第七轮"阵亡者不结算受伤类"）。
 */
export function listReactionCandidates(
  state: EngineState,
  node: ReactionNode,
): RankedReactionCandidate[] {
  const trigger = reactionTriggerOfEvent(node.sourceEvent.type);
  if (!trigger) return [];
  const sourceEvent = sourceEventOf(node);
  const seatOrder = state.players.map(player => player.id);
  const candidates: RankedReactionCandidate[] = [];

  for (const player of state.players) {
    if (player.isAlive === false) continue;
    for (const fg of fieldGeneralsOf(player)) {
      const general = fg?.general as General | undefined;
      if (!general || !Array.isArray(general.skills) || general.skills.length === 0) continue;
      const runtimeId = getRuntimeCardId(general as never) || general.id;
      const { definitions } = compileGeneralSkills(general, runtimeId);
      for (const definition of definitions) {
        // 三类分流：只有"不强制"的受击／受伤两型进这一格问答。
        if (!isReactionTrigger(definition.trigger) || definition.forced === true) continue;
        // choiceMode 技能不进反应队列，直接开选择账
        if ((definition as unknown as Record<string, unknown>).choiceMode === true) continue;
        if (REACTION_EVENT_TYPE[definition.trigger] !== node.sourceEvent.type) continue;
        const binding = { ownerId: player.id, skill: definition };
        if (!matchesSkillEvent(definition.trigger, binding, sourceEvent)) continue;
        if (!evaluateSkillConditions(definition.conditions, {
          state,
          ownerId: player.id,
          sourceGeneralId: definition.sourceGeneralId,
          event: sourceEvent,
        })) continue;
        candidates.push({
          ownerId: player.id,
          generalId: definition.sourceGeneralId === undefined ? '' : String(definition.sourceGeneralId),
          priority: PRIORITY[definition.trigger] ?? 0,
          definition,
        });
      }
    }
  }

  return orderReactionCandidates(candidates, {
    seatOrder,
    ...victimRefOf(sourceEvent),
  });
}

/** 这一格还剩没表态的候选吗（收格判据＝`orderReactionCandidates` 的整个输出
 *  都被台账吃掉）。 */
export function hasPendingReactionCandidate(state: EngineState, node: ReactionNode): boolean {
  const answered = new Set(node.answered);
  return listReactionCandidates(state, node).some(
    candidate => !answered.has(reactionSubjectKey(candidate.ownerId, candidate.generalId)),
  );
}

/**
 * 此刻该问谁（唯一推导点）。队列里**先开先问**：第 0 格还没问完就不会跳到
 * 第 1 格——这就是"本轮处理完才重开新队列"（§H9 第九轮⑨）。
 */
export function getReactionAsk(state: EngineState): ReactionAsk | null {
  const queue = state.pendingReaction;
  if (!queue || queue.nodes.length === 0) return null;
  for (const node of queue.nodes) {
    const answered = new Set(node.answered);
    const remaining = listReactionCandidates(state, node).filter(
      candidate => !answered.has(reactionSubjectKey(candidate.ownerId, candidate.generalId)),
    );
    const head = remaining[0];
    if (!head) continue; // 这一格问完了（扫描会收掉它）
    const sameSubject = remaining.filter(candidate =>
      candidate.ownerId === head.ownerId && candidate.generalId === head.generalId);
    const generalName = generalNameOf(state, head.ownerId, head.generalId);
    return {
      nodeKey: node.key,
      sourceEvent: sourceEventOf(node),
      playerId: head.ownerId,
      generalId: head.generalId,
      generalName,
      options: sameSubject.map(candidate => ({
        skillId: candidate.definition.id,
        generalId: candidate.generalId,
        skillName: candidate.definition.name,
        label: candidate.definition.description || candidate.definition.name,
        definition: candidate.definition,
      })),
    };
  }
  return null;
}

function generalNameOf(state: EngineState, playerId: number, generalId: string): string {
  const player = state.players.find(p => p.id === playerId);
  for (const fg of fieldGeneralsOf(player ?? state.players[0])) {
    const general = fg?.general as General | undefined;
    if (!general) continue;
    const runtimeId = getRuntimeCardId(general as never) || general.id;
    if (String(runtimeId) === generalId) return String(general.name ?? generalId);
  }
  return generalId;
}

/** 效果翻译的唯一入口：响应链与触发链共用桥接层那一份静态翻译，绝不第二份。 */
export function reactionEffectEvents(ask: ReactionAsk, state: EngineState, option: ReactionOption): GameEvent[] {
  return SkillTriggerBridge.createSkillEvents(
    { ownerId: ask.playerId, skill: option.definition },
    state,
    ask.sourceEvent,
  );
}

/**
 * 一句表态的事件载荷（发动与跳过共用一个形状，`option===null`＝跳过）。
 * 两个解析器都从这里取，"表态单位怎么拼"因此只有一处写法。
 */
export function reactionAnsweredOf(ask: ReactionAsk, option: ReactionOption | null): ReactionAnsweredData {
  return {
    nodeKey: ask.nodeKey,
    subjectKey: reactionSubjectKey(ask.playerId, ask.generalId),
    playerId: ask.playerId,
    generalId: ask.generalId,
    generalName: ask.generalName,
    skillId: option?.skillId ?? null,
    skillName: option?.skillName ?? null,
  };
}

/** 这一声是不是响应链的候选源（受击／受伤两型），并且**不是**决斗的逐轮伤害。 */
export function isReactionSourceEvent(event: GameEvent): boolean {
  if (!reactionTriggerOfEvent(event.type)) return false;
  // 决斗逐轮不唤监听（§H5-6"决斗连续完成、中间不插入任何流程"＋§H9 第七轮
  // "逐轮不响"）：那一声的每"打"带 `duelRound`，整块在队列里一次结算完，中间
  // 绝不停下来问人。#70 决斗刀 2 会把这条显式重钉一遍。
  const payload = event.data as { duelRound?: unknown } | undefined;
  return typeof payload?.duelRound !== 'number';
}

/**
 * 结算后的扫描：收掉问完的格，把**本次结算里新出现的**受击／受伤事件开成新格
 * 排到队尾（不插队）。返回 null＝没有待答问答（状态槽清干净）。
 *
 * 纯函数 of（已结算的 state，本次 dispatch 的事件序列）⇒ 常驻/重建/回放三路
 * 逐字同果。不开窗的情况照旧"没有候选就不开格"（与桥接层不造空窗同一契约）。
 */
export function syncReactionQueue(
  state: EngineState,
  dispatchEvents: readonly GameEvent[],
): { queue: PendingReaction | null; overflow: number } {
  const current = state.pendingReaction;
  const turn = state.turn ?? 0;
  const carried = current && current.turn === turn
    ? current.nodes.filter(node => hasPendingReactionCandidate(state, node))
    : [];
  let serial = current && current.turn === turn ? current.serial : 0;
  const opened: ReactionNode[] = [];
  let overflow = 0;

  for (const event of dispatchEvents) {
    if (!isReactionSourceEvent(event)) continue;
    const node: ReactionNode = {
      key: `rn:${turn}:${serial}`,
      sourceEvent: { type: event.type, data: event.data },
      answered: [],
    };
    // 没有候选＝这一刻没人有得响应，不开格（也不留空台账）。放在限量之前：
    // `overflow` 只记"本来该问却被封顶丢掉"的格数，真实对局恒为 0。
    if (listReactionCandidates(state, node).length === 0) continue;
    serial += 1;
    if (serial > MAX_REACTION_NODES_PER_TURN) {
      overflow += 1;
      continue;
    }
    opened.push(node);
  }

  const nodes = [...carried, ...opened];
  if (nodes.length === 0) return { queue: null, overflow };
  return { queue: { turn, serial, nodes }, overflow };
}

/**
 * 队列指纹：回合、格号源、每一格的键与其台账。调用点（`core/TransitionCore` 的
 * 结算后扫描）据此判断"这一趟到底改变了什么"——队列里键唯一，每一格在回应的那
 * 一声是键的函数，所以不必比它。
 *
 * 一格表态后的台账写入不在这里：状态突变的唯一入口是 EventProcessor
 * （`core/eventProcessors/reactionEvents.ts`）。
 */
export function reactionQueueFingerprint(queue: PendingReaction | null): string {
  if (!queue) return '';
  const nodes = queue.nodes.map(node => `${node.key}#${node.answered.join(',')}`).join(';');
  return `${queue.turn}|${queue.serial}|${nodes}`;
}
