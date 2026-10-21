/**
 * 响应链问答队列（v2.8.22 响应链执法刀＝#71；§H9 第八轮顺序规则＋第九轮三类
 * 分流/问窗/⑨重开＋第十轮两条工作例；v2.9.16 询问制刀＝问不问改由技能自己说）。
 *
 * 一句话形态：**把"到点自动响"换成"停下来按规矩问"**，问法与回合结束技能
 * 完全同源——候选从 EngineState 现算（编译→身份→门槛→扣台账），发动走
 * canonical `ACTIVATE_SKILL`，不发动走 canonical `SKIP_REACTION`。人 and AI 走
 * 同一套（用户 2026-09-30 口径"基础游戏规则不应该区分开人和 AI"）：AI 座位的
 * 应答也是从 `legalActions` 里由它自己的策略挑，没有第二条决策路。
 *
 * **哪一声该问人**（v2.9.16 用户 2026-10-20 裁决）：不再由"时机"划族，而由
 * **这一枚技能自己**决定——只有两样不问：「在场即生效」（passive：人在就算，压根
 * 不是一次发动，没有"要不要发动"可问）与打了「强制发动」的定义（含勾了强制的
 * 觉醒技）。其余每一型、每一声都停下来问。所以本模块的候选枚举**不认时机族**，
 * 只认 `eventsHeardBy(定义.触发型)` 有没有声＋这一声是不是正好落进来。
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
 *  - **绝不既自动响又问**：分流开关只有 `SkillTriggerBridge.defersToReactionQueue`
 *    一处——它为真时这枚定义**根本不注册**进触发链，为假时才走自动路。两条路读的
 *    是同一次判定，结构上不存在"同一枚技能既响又被问"。
 *
 * 一句话把闸的分工钉死：**开不开格只看"这一格有没有候选"**（`mayOpenReactionCell`
 * 只是把事件面上压根没时机听得懂的那些声先挡掉，是性能闸不是判据），所以"这一刻
 * 到底有没有人该表态"永远只有 `syncReactionQueue` 一处说了算。
 */
import type { General } from '../data/generals';
import type { EngineState, PendingReaction, ReactionNode } from '../core/GameState';
import type { GameEvent, GameEventType, ReactionAnsweredData } from '../core/Event';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { compileGeneralSkills } from './skillCompiler';
import { evaluateSkillConditions } from './skillConditions';
import { matchesSkillEvent } from './skillEventMatch';
import { limitedQuotaAvailable } from './skillQuota';
import { PRIORITY, SkillTriggerBridge, defersToReactionQueue } from './SkillTriggerBridge';
import type { DataSkillDefinition, DataSkillTrigger } from './dataTypes';
import { ANY_TRIGGER_EVENT_TYPES, eventsHeardBy } from './reactionTriggers';
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
  /** ACTIVATE_SKILL 的寻址键＝这一枚技能**头一个效果**的编译定义 id（`<将>:<技能>:<效果>`）。
   *  一个按钮＝**一枚技能**（见 `groupSubjectOptions`），点这一下把这一枚在这一刻的全部
   *  定义一起结，所以寻址只需头一枚。 */
  skillId: string;
  generalId: string;
  skillName: string;
  /** 玩家看到的那一句（技能描述），与触发路上展示的是同一个字段。 */
  label: string;
  /** 这一枚技能在**这一刻**的全部编译定义，按效果顺序，头一枚就是 `skillId` 那一枚。 */
  definitions: DataSkillDefinition[];
}

export interface ReactionAsk {
  nodeKey: string;
  /** 这一格在回应的那一声（已记录的事实，效果翻译按它解 TARGET/ATTACKER）。 */
  sourceEvent: GameEvent;
  /** 这一刻唯一可以表态的那一席（冻结世界门认它）。 */
  playerId: number;
  generalId: string;
  generalName: string;
  /** 这一格问的是**哪一种时机**（v2.9.16 询问制刀）。以前界面只认两声、把措辞写死在
   *  组件里（`BEFORE_DAMAGE ? '成为目标时' : '受到伤害后'`）；反转后队列里会出现九种
   *  时机，那句写死的 ternary 会把"回合开始时"念成"受到伤害后"⇒ 措辞改由**这一格自己的
   *  时机**去词源（`data/generals.ts` 的 `triggerTypeLabels`）取，界面不再自己猜。
   *  取的是这一组（同一席同一员）头一枚候选的时机——表态单位按"这一席这一员"成组，
   *  一组里若混了两种时机（一声被两型共听时可能），措辞念头那一枚。 */
  trigger: DataSkillTrigger;
  /** 同一将领身上全部可响应**技能**（一技能一按钮，见 `groupSubjectOptions`），
   *  ＋恒常存在的「跳过」出口（§12-61）。 */
  options: ReactionOption[];
}

function fieldGeneralsOf(player: EngineState['players'][number]) {
  return Array.isArray(player.fieldGenerals)
    ? (player.fieldGenerals as Array<Record<string, unknown>>)
    : [];
}

/** 某一席的坟场（离场的那一员将连同它的卡面一起留在这里＝`damageEvents` 与
 *  `statModifierEvents` 两处的写法）。只有「自身被击杀时」那一格会去读它。 */
function graveyardOf(player: EngineState['players'][number]): General[] {
  return Array.isArray(player.graveyard) ? player.graveyard as General[] : [];
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
 * 两条路共用的那一次遍历（v2.8.25 强制发动执法刀）。
 *
 * `accept` 只决定"这一枚定义算哪一类听众"，**身份（`matchesSkillEvent`）与门槛
 * （`evaluateSkillConditions`）两层判定两类共用**——分开写两份迟早分叉，而这一族
 * 分叉的表征是"自动路响了、问答路没候选"或反过来，最难查。
 *
 * **v2.9.16 询问制刀补的那一半＝阵亡那一格要看得见死者**：常规只扫 `fieldGenerals`，
 * 而「自身被击杀时」（遗言族，官方账里四张将在用）的主人**按定义就在离场那一刻响**——
 * 反转前它走自动路（注册在席位上、`ownerCanActivate` 对 `onDeath` 有豁免），所以看得见；
 * 反转后它要进问答路，若仍只扫在场将，这四张卡会**一声不响地消失**（既不自动响、也没人问）。
 * 死亡处理器把死者放进它自己的 `graveyard`（`damageEvents`／`statModifierEvents` 两处），
 * 所以这一格的候选人另取一路：**只取这一声死掉的那一员**，别的时机一律不看坟场——
 * 「阵亡者不结算受伤类」（§H9 第七轮）那条事实原样保住。
 */
function collectListeners(
  state: EngineState,
  node: ReactionNode,
  accept: (definition: DataSkillDefinition, nodeType: GameEventType) => boolean,
): RankedReactionCandidate[] {
  const sourceEvent = sourceEventOf(node);
  const seatOrder = state.players.map(player => player.id);
  const candidates: RankedReactionCandidate[] = [];
  const deadVictimId = sourceEvent.type === 'DEATH'
    ? String((sourceEvent.data as { targetId?: unknown })?.targetId ?? '')
    : '';

  const scanGeneral = (playerId: number, general: General): void => {
    if (!Array.isArray(general.skills) || general.skills.length === 0) return;
    const runtimeId = getRuntimeCardId(general as never) || general.id;
    const { definitions } = compileGeneralSkills(general, runtimeId);
    for (const definition of definitions) {
      if (!accept(definition, node.sourceEvent.type)) continue;
      if (!matchesSkillEvent(definition.trigger, { ownerId: playerId, skill: definition }, sourceEvent)) continue;
      if (!evaluateSkillConditions(definition.conditions, {
        state,
        ownerId: playerId,
        sourceGeneralId: definition.sourceGeneralId,
        event: sourceEvent,
      })) continue;
      // v2.8.32 限定技额度：额度用尽＝这一枚不再是候选（与上面门槛不过同一处置：
      // 问答路没有"置灰列出"的形状，能列的就是能答的）。这一路不需要触发链那份
      // 链内集合——每一次表态都是一次独立 dispatch，两次之间账已经落了。
      if (!limitedQuotaAvailable(state, definition)) continue;
      candidates.push({
        ownerId: playerId,
        generalId: definition.sourceGeneralId === undefined ? '' : String(definition.sourceGeneralId),
        priority: PRIORITY[definition.trigger] ?? 0,
        definition,
      });
    }
  };

  for (const player of state.players) {
    if (player.isAlive === false) continue;
    for (const fg of fieldGeneralsOf(player)) {
      const general = fg?.general as General | undefined;
      if (!general) continue;
      scanGeneral(player.id, general);
    }
    // 死者那一员只在"这一声就是它死掉"的那一格参评（判据＝坟场里那一张的实例 id
    // 与事件载荷的 `targetId` 对上；对不上＝这一声死的不是它，照旧不看）。
    if (!deadVictimId) continue;
    const victim = graveyardOf(player).find(general =>
      (getRuntimeCardId(general as never) || String(general.id ?? '')) === deadVictimId);
    if (victim) scanGeneral(player.id, victim);
  }

  return orderReactionCandidates(candidates, {
    seatOrder,
    ...victimRefOf(sourceEvent),
  });
}

/** 这一枚定义听得懂这一声吗（唯一读那份事件表的地方，两条路同判据）。 */
function listenedBy(definition: DataSkillDefinition, nodeType: GameEventType): boolean {
  return eventsHeardBy(definition.trigger).includes(nodeType);
}

/**
 * 要停下来问人的那一类：分流开关把它搬进了问答路（没打「强制发动」、不是「在场
 * 即生效」），且它自己那一型听得懂这一声。v2.9.16 起这里**不再认时机族**——判据全
 * 在 `defersToReactionQueue` 那一句里，这里只补"听得懂这一声吗"。
 */
function askAccepted(definition: DataSkillDefinition, nodeType: GameEventType): boolean {
  return defersToReactionQueue(definition) && listenedBy(definition, nodeType);
}

/**
 * 某一格的**全部**可响应候选（要问人的那一类），已按比较器排好序（不过滤台账）。
 * 与触发链同一条判定链：编译→时机对得上→身份（`matchesSkillEvent` 单点）→
 * 门槛（`evaluateSkillConditions`）→额度→比较器。
 *
 * 阵亡者只有一格能看见：**「自身被击杀时」那一声**（走 `graveyard` 那一路，见
 * `collectListeners` 的注释）。其余时机照旧不看坟场，所以"阵亡者不结算受伤类"
 * （§H9 第七轮）那条事实原样保住。
 */
export function listReactionCandidates(
  state: EngineState,
  node: ReactionNode,
): RankedReactionCandidate[] {
  return collectListeners(state, node, askAccepted);
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
 * 把"同一席同一员"的全部候选并成**一技能一按钮**。
 *
 * 为什么必须并：`compileGeneralSkills` 是**按效果**编的（一枚技能的每个可结算效果＝
 * 一条定义，id 形如 `<将>:<技能>:e1`／`e2`），而问答路的表态单位是"某一席的某一员将"
 * （§H9 第九轮⑤，台账键＝`reactionSubjectKey`）。两条规则撞在一起＝按钮按效果开、
 * 点下去却吃掉整格：黄盖「苦肉」那两个效果（自伤 1 点＋摸两张）在问窗里排成两个
 * 「发动苦肉」，玩家点第一个只拿到自伤，**摸两张那一半永远没机会响**——既不会再问一次
 * （台账已记这一格），也不会自动补。这是 v2.9.16 询问制刀现场跑出来的真缺陷（旧口径
 * 下这两条定义都在自动路，各自随那一声响，所以看不见）。全库官方卡普查命中的只有
 * 这一张：其余多效果技能要么挂在不同时机上，要么编成 choice／chain 一条定义。
 *
 * 「一次表态吃掉整格」那条**没有改**：同一员将身上**不同技能**仍并排列着、玩家择一
 * （§H9 第九轮⑤）。分组键取技能名——同一员将身上同名两枚技能、内容不同那种数据今天
 * 不存在，真出现时 `skills/skillNameIndex.ts` 会按 `GAIN_SKILL_AMBIGUOUS_NAME` 点名，
 * 那是另立的一条待裁，这里不替它猜。
 */
function groupSubjectOptions(candidates: RankedReactionCandidate[]): ReactionOption[] {
  const groups: Array<{ head: RankedReactionCandidate; definitions: DataSkillDefinition[] }> = [];
  for (const candidate of candidates) {
    const group = groups.find(entry => entry.head.definition.name === candidate.definition.name);
    if (group) group.definitions.push(candidate.definition);
    else groups.push({ head: candidate, definitions: [candidate.definition] });
  }
  return groups.map(({ head, definitions }) => ({
    skillId: head.definition.id,
    generalId: head.generalId,
    skillName: head.definition.name,
    label: head.definition.description || head.definition.name,
    definitions,
  }));
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
      trigger: head.definition.trigger,
      options: groupSubjectOptions(sameSubject),
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
  // v2.9.16 询问制刀：「自身被击杀时」那一格的将领**已经不在场**——候选是从坟场捞的
  // （`collectListeners` 走 `graveyardOf`），问句却只认在场名单，于是问窗把内部运行时
  // id（`du_vic`）当名字念给玩家看。补同一条路的第二次查找：认坟场那一份卡面。
  for (const general of graveyardOf(player ?? state.players[0])) {
    const runtimeId = getRuntimeCardId(general as never) || general.id;
    if (String(runtimeId) === generalId) return String(general.name ?? generalId);
  }
  return generalId;
}

/** 效果翻译的唯一入口：响应链与触发链共用桥接层那一份静态翻译，绝不第二份。
 *  一次表态＝这一枚技能这一刻的**全部**定义按效果顺序各翻一遍（见 `groupSubjectOptions`）。 */
export function reactionEffectEvents(ask: ReactionAsk, state: EngineState, option: ReactionOption): GameEvent[] {
  return option.definitions.flatMap(definition => SkillTriggerBridge.createSkillEvents(
    { ownerId: ask.playerId, skill: definition },
    state,
    ask.sourceEvent,
  ));
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

/**
 * 决斗那两条排除（v2.8.24 决斗刀 2；v2.8.25 起两类听众共用这一份，绝不第二处判）。
 *  - 决斗**逐轮**那些"打"（带 `duelRound`）不唤任何监听：那一整块在队列里一次
 *    结算完，中间绝不停下来问人（"决斗连续完成、中间不插入任何流程"）。
 *  - 决斗开局的**通知**在"当场没人有得说"时标 `duelStage:'settled'`：那一声已经
 *    由派生点（`core/eventProcessors/duelEvents.ts`）问过一遍候选并得到"没有"，
 *    扫描器认同一个标记就不再问第二遍——两档读的是同一条事实，不开第二条推导。
 *
 * v2.9.16 询问制刀：这两条原先挂在 `isReactionSourceEvent` 里（那时只有受击／受伤两型
 *  算候选源）。反转后"哪一型该问"不再由时机名单决定⇒那一层整个删除，这两条**原样**
 *  留下，改由开格闸直接判（决斗那两层与"问不问"是两件事，一条没丢）。
 */
function excludedByDuel(event: GameEvent): boolean {
  const payload = event.data as { duelRound?: unknown; duelStage?: unknown } | undefined;
  if (typeof payload?.duelRound === 'number') return true;
  return event.type === 'BEFORE_DAMAGE' && payload?.duelStage === 'settled';
}

/**
 * 这一声**有可能**开出一格待答问答吗（扫描器与 `core/TransitionCore` 的免费闸同读这一句）。
 *
 * v2.9.16 询问制刀把这一句缩成两条：**这一声在触发面上**（`ANY_TRIGGER_EVENT_TYPES`
 * 由 `TRIGGER_EVENTS` 派生⇒新加一型自动进这一集，两处不会分叉）**且不属于决斗那两层**。
 * 以前这里还有第三条例外——"不是受击／受伤两型时，只有场上挂着觉醒技徽章才值得一扫"
 * （2.9.3 刀B 的免费闸）；反转后每一型都可能要问，那一道徽章预筛就成了**漏问的来源**，
 * 所以整条删除。"到底问不问"仍然只有一句＝`syncReactionQueue` 里那句**这一格有没有候选**。
 */
export function mayOpenReactionCell(event: GameEvent): boolean {
  if (excludedByDuel(event)) return false;
  return ANY_TRIGGER_EVENT_TYPES.has(event.type);
}

/**
 * 决斗开局层的**探针**（v2.8.24 决斗刀 2；v2.8.25 强制发动执法刀扩到两类听众）：
 * 这一场决斗开局那一刻，场上还有没有**任何**东西要在这层响？
 *  - 要停下来问人的那一类（这一型听得懂这一声、且没打「强制发动」）；
 *  - 到点自己响的那一类（打了「强制发动」的，以及择一类——它开自己的选择账）。
 *
 * 派生点（`core/eventProcessors/duelEvents.ts`）拿它决定"先把逐轮打完、还是停下
 * 来把这一层走完"，用的就是扫描器同一份候选遍历＋同一个身份判定＋同一个门槛判定
 * ⇒"有没有听众"这件事全库只有一个推导点，不可能派生侧说有、扫描侧说没有。
 *
 * 为什么两类都要算（本刀的实质）：只算问答类时，场上只有强制监听的那一格会被标
 * `settled`、逐轮紧跟着就打完⇒那一声压根没喂给自动路，强制发动在这层**结构性
 * 不可达**（§12-55 那个"记录在案、结算侧零消费"的缺口，最后就剩这一处）。
 */
export function hasReactionListeners(state: EngineState, sourceEvent: GameEvent): boolean {
  const node: ReactionNode = {
    key: 'probe',
    sourceEvent: { type: sourceEvent.type, data: sourceEvent.data },
    answered: [],
  };
  return collectListeners(state, node, listenedBy).length > 0;
}

function openingDuelKeyOf(event: GameEvent): string | null {
  const payload = event.data as { duelStage?: unknown; duelKey?: unknown } | undefined;
  if (payload?.duelStage !== 'opening') return null;
  return typeof payload.duelKey === 'string' && payload.duelKey ? payload.duelKey : null;
}

function openingDuelKeyOfNode(node: ReactionNode): string | null {
  if (node.sourceEvent.type !== 'BEFORE_DAMAGE') return null;
  return openingDuelKeyOf(node.sourceEvent);
}

/**
 * 延后那一拍的普攻（v2.8.31 定义封口刀）：认法只有一处——`attackStage:'declare'`
 * 那一身带 `attackKey` 的通知（发信侧 `core/attackBlow.ts` 是唯一写它的地方）。
 * 续跑环的去重也读这里，"哪一刀是同一刀"因此没有第二个推导点。
 */
export function attackResumeKeyOf(event: GameEvent): string | null {
  const payload = event.data as { attackStage?: unknown; attackKey?: unknown } | undefined;
  if (payload?.attackStage !== 'declare') return null;
  return typeof payload.attackKey === 'string' && payload.attackKey ? payload.attackKey : null;
}

function declaredAttackKeyOfNode(node: ReactionNode): string | null {
  if (node.sourceEvent.type !== 'BEFORE_DAMAGE') return null;
  return attackResumeKeyOf(node.sourceEvent);
}

/**
 * 普攻续跑清单（§12-102 两拍形状："受击那一层走完 ⇒ 这一刀的 `damage` 那一拍该落了"）。
 *
 * 判据与上面那份决斗续跑**同源、同两条**（纯 from 本次 dispatch 的事件序列＋扫描前后的
 * 队列，故常驻/重建/回放三路同果）：
 *  - 本次刚发的declare 通知在队列里没有活着的格＝当场没人要说（只有自动路的听众）／
 *    刚问完；
 *  - 扫描前挂着、扫描后消失的 declare 格＝这一格刚刚被答完。
 * 每一刀只回一条，回的是那条**通知本身**（载荷原样带着 `action`＝续跑重瞄的原料）；
 * 它是已经记过账的事实，`core/TransitionCore` 的续跑只读它、绝不把它再写进事件流第二遍。
 *
 * 与决斗那份的唯一差别（第二条判据上的 `turn` 闸）：队列在换回合时整格丢弃，而一条
 * 丢弃的格若被认成"刚答完"，就会在**若干个回合之后**把那一刀重新落一次——决斗那层
 * 掉的是自己的逐轮，普攻这一刀掉的是一次真实的伤害与 possibly 一次阵亡，所以这里
 * 只认"还属于本回合的那副队列"。真实牌局走不到这条闸（响应格挂着时世界是冻结的）。
 */
export function findResumedAttacks(
  turn: number,
  dispatchEvents: readonly GameEvent[],
  before: PendingReaction | null,
  after: PendingReaction | null,
): GameEvent[] {
  const live = new Set<string>();
  for (const node of after?.nodes ?? []) {
    const key = declaredAttackKeyOfNode(node);
    if (key) live.add(key);
  }

  const resumed: GameEvent[] = [];
  const seen = new Set<string>();
  const collect = (sourceEvent: GameEvent, key: string | null): void => {
    if (!key || live.has(key) || seen.has(key)) return;
    seen.add(key);
    resumed.push({ type: 'BEFORE_DAMAGE', data: sourceEvent.data });
  };
  for (const event of dispatchEvents) {
    if (event.type !== 'BEFORE_DAMAGE') continue;
    collect(event, attackResumeKeyOf(event));
  }
  if (before?.turn === turn) {
    for (const node of before.nodes) {
      const key = declaredAttackKeyOfNode(node);
      if (key === null) continue;
      collect(node.sourceEvent, key);
    }
  }
  return resumed;
}

/**
 * 决斗续跑清单（§H9 第七轮开局格："这一层全部响完，决斗才开始"）。
 *
 * 一句话：**开局那一格不再挂着了 ⇒ 这一场决斗该往下打了**。判据纯 from
 * （本次 dispatch 的事件序列，扫描前的队列，扫描后的队列），三路同果：
 *  - 本次刚立的通知（`duelStage:'opening'`）在队列里没有活着的格＝当场没人要说／
 *    刚问完；
 *  - 扫描前挂着、扫描后消失的开局格＝这一句刚刚被答完。
 * 每一场只回一条 `DUEL{duelStage:'answered'}`：逐轮伤害与收官那笔累计受伤由派生点
 * 在这一条上再算（它读的是**答复落账之后**的状态⇒响应里回复的体力算进决斗起点）。
 */
export function findResumedDuels(
  dispatchEvents: readonly GameEvent[],
  before: PendingReaction | null,
  after: PendingReaction | null,
): GameEvent[] {
  const live = new Set<string>();
  for (const node of after?.nodes ?? []) {
    const key = openingDuelKeyOfNode(node);
    if (key) live.add(key);
  }

  const resumed: GameEvent[] = [];
  const seen = new Set<string>();
  const collect = (data: Record<string, unknown> | undefined, key: string | null) => {
    if (!key || live.has(key) || seen.has(key)) return;
    seen.add(key);
    resumed.push({ type: 'DUEL', data: { ...data, duelKey: key, duelStage: 'answered' } });
  };
  for (const event of dispatchEvents) {
    if (event.type !== 'BEFORE_DAMAGE') continue;
    collect(event.data as Record<string, unknown> | undefined, openingDuelKeyOf(event));
  }
  for (const node of before?.nodes ?? []) {
    if (openingDuelKeyOfNode(node) === null) continue;
    collect(node.sourceEvent.data as Record<string, unknown> | undefined, openingDuelKeyOfNode(node));
  }
  return resumed;
}

/**
 * 结算后的扫描：收掉问完的格，把**本次结算里新出现的**该问的那些声开成新格
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
    if (!mayOpenReactionCell(event)) continue;
    const node: ReactionNode = {
      key: `rn:${turn}:${serial}`,
      sourceEvent: { type: event.type, data: event.data },
      answered: [],
    };
    // 没有候选＝这一刻没人有得响应，不开格（也不留空台账）。放在限量之前：
    // `overflow` 只记"本来该问却被封顶丢掉"的格数，真实对局恒为 0。
    // v2.9.16 询问制刀把这一句的地位抬成了**唯一判据**：分流开关决定"这一枚要不要
    // 问"，而"这一声到底有没有人要表态"只看这里数出来的候选——哪一声该开格从不
    // 另立名单，所以界面上不会出现"问了个空"。
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
