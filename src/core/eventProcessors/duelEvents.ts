import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getAttackValue } from '../attackValue';
import { applyArmorDamage } from '../armorDamage';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';
import { hasReactionListeners } from '../../skills/reactionChain';

/** 双方各三轮＝最多六次计算（§H9 第六轮①），交替进行、先手恒为技能发起方。 */
const DUEL_MAX_ROUNDS = 6;

/**
 * 决斗流程的三个时点标记（§H9 第七轮，v2.8.24 决斗刀 2）。都写在载荷上，所以
 * 每一场决斗的每一个通知在录像里都能自己说清"我是哪一层"：
 *  - `opening`＝开局那一层（成为技能目标）**停下来问过了**，逐轮还没打；
 *  - `settled`＝开局那一层当场没人有得说，逐轮紧跟着就打了；
 *  - `answered`＝开局那一层问完了，这一条 DUEL 就是"现在接着往下打"的令。
 */
export type DuelStage = 'opening' | 'settled' | 'answered';

interface DuelParticipantRef {
  playerId: number;
  generalId: string;
  general: Record<string, any>;
}

function findDuelParticipant(state: EngineState, generalId: unknown): DuelParticipantRef | null {
  if (typeof generalId !== 'string' || generalId === '') return null;
  for (const player of state.players) {
    const fieldGenerals = Array.isArray(player.fieldGenerals)
      ? (player.fieldGenerals as Array<Record<string, any>>)
      : [];
    const found = fieldGenerals.find(fg => getRuntimeCardId(fg?.general as never) === generalId);
    if (found) {
      return { playerId: Number(player.id), generalId, general: found };
    }
  }
  return null;
}

/**
 * 决斗流程的**唯一派生点**。DUEL 本体不改状态（§H7"决斗不附带任何效果"），
 * 它 observable 的全部后果都在这里落成一整块，交给队列整块前置结算
 * （ARCH_MAP §F"DUEL 决斗流程原语"）。
 *
 * 三层的分工（§H9 第七轮，用户口径逐字）：
 *  1. **开局**＝成为技能目标那一声（`BEFORE_DAMAGE`＋`damageType:'skill'`，所以
 *     只喂"成为**技能**目标"的监听、绝不喂"成为攻击目标"那一档）。当场有**任何**
 *     听众（要问人的那一类＋打了「强制发动」自己响的那一类）⇒这一块**只有**这一条
 *     通知，逐轮延到这一层走完（`duelStage:'opening'`）；压根没听众⇒通知标
 *     `settled`、逐轮紧跟（与扩面前"逐轮紧挨"逐字同形）。
 *  2. **逐轮**＝真实扣血，块内绝不唤监听（每"打"带 `duelRound`，扫描器显式排除）。
 *  3. **收官**＝受伤类读**该角色这一场实际掉掉的体力总额**（起点体力−终局体力），
 *     合并成一笔 `DUEL_INJURY` 只结算一次：它不扣血、零状态位移（默认处理器恒等）。
 *     顺序＝受邀者那笔在前、发起者那笔在后（双方都是受伤方⇒优先度最高，受邀者先
 *     受伤⇒优先度比发起者再高一档）；阵亡者那一笔整笔不结算（人不在场，受伤类
 *     不成立——他的遗言型技能与击破补偿抽走的是既有那条派生链，与这里无关）。
 *
 * 逐轮的算术仍复用近战那同一对核心函数（`getAttackValue`＋`applyArmorDamage`），
 * 决斗绝不长出自己的伤害数学；护甲减免不计入累计值（累计只看体力真实下降）。
 */
export function deriveDuelFlow(state: EngineState, event: GameEvent): GameEvent[] {
  const data = asData(event.data);
  const duelKey = duelKeyOf(data);
  // 诚实空转的第一道：任一侧根本指认不出场上那一员⇒整条流程不留任何痕迹。
  // （"成为技能目标"那一声要有个真实的目标可指；指不到人就不是"有人被点了名"，
  //  而是这件事压根没发生。自己对自己不在此列＝§H9 第九轮⑧：那一声照喂。）
  const sideA = findDuelParticipant(state, data.sourceGeneralId);
  const sideB = findDuelParticipant(state, data.targetId);
  if (!sideA || !sideB) return [];
  // 续跑令（开局那一层问完了）：不再立通知，直接落逐轮＋收官那一笔。
  // 读的是**答复落账之后**的状态⇒响应里回复的体力算进决斗起点。
  if (data.duelStage === 'answered') return duelBody(state, event, duelKey);

  const notice = openingNotice(data, duelKey, 'opening');
  if (hasReactionListeners(state, notice)) return [notice];
  return [openingNotice(data, duelKey, 'settled'), ...duelBody(state, event, duelKey)];
}

/**
 * 决斗三层里**有听众的那两层**（v2.8.25 强制发动执法刀）：开局那一声
 * `BEFORE_DAMAGE{duelStage}` 与收官那笔 `DUEL_INJURY`。它们是队列内派生出来的，
 * 压根没经过 dispatch 前的触发链，所以`core/TransitionCore` 的有界重入必须把
 * 这两层喂给触发链——否则打了「强制发动」的受击／受伤技在决斗里结构性听不到
 * 这两声（§12-55 那个"记录在案、结算侧零消费"缺口的最后一处）。
 *
 * 逐轮那些"打"（带 `duelRound`）**绝不**在这一判据里：§H9 第七轮"连续完成、
 * 中间不插入任何流程"。开局的 `settled` 通知在这里算作听众层——那是诚实的：
 * 派生点已经用同一份探针问过"有没有人听"，答"没有"，触发链这一趟同样无人应。
 */
export function isDuelListenerEvent(event: GameEvent): boolean {
  if (event.type === 'DUEL_INJURY') return true;
  if (event.type !== 'BEFORE_DAMAGE') return false;
  const payload = asData(event.data);
  return typeof payload.duelStage === 'string' && typeof payload.duelRound !== 'number';
}

/** 开局那一层的通知：决斗载荷原样带着（双方四个键＝受邀者是谁、发起者是谁），
 *  只多三个标记键。它不改状态（BEFORE_DAMAGE 没有处理器分支＝纯通知）。
 *  `rootEventId` 被剥掉：这枚通知会进响应队列（＝进状态），而那个键是从事件
 *  时间戳派生的进程易变值——留在载荷里就等于把"第二次推导点"写进可重放的状态。 */
function openingNotice(data: Record<string, unknown>, duelKey: string, stage: DuelStage): GameEvent {
  const rest = { ...data };
  delete rest.rootEventId;
  return {
    type: 'BEFORE_DAMAGE',
    data: { ...rest, damageType: 'skill', duelKey, duelStage: stage },
  };
}

/** 逐轮块＋收官块：一场决斗的"打"与"打完那笔账"。 */
function duelBody(state: EngineState, event: GameEvent, duelKey: string): GameEvent[] {
  const { rounds, injuries } = simulateDuel(state, event, duelKey);
  return [...rounds, ...injuries];
}

export function simulateDuel(
  state: EngineState,
  event: GameEvent,
  duelKey: string = duelKeyOf(asData(event.data)),
): { rounds: GameEvent[]; injuries: GameEvent[] } {
  const data = asData(event.data);
  const sideA = findDuelParticipant(state, data.sourceGeneralId);
  const sideB = findDuelParticipant(state, data.targetId);
  // 诚实空转：任一侧不在场、或双方本是同一枚将领（"自己不能和自己决斗"＝§H9 第五轮③）。
  if (!sideA || !sideB || sideA.generalId === sideB.generalId) return { rounds: [], injuries: [] };

  const sides = [
    { ref: sideA, hp: Number(sideA.general.currentHp ?? 0), armor: Number(sideA.general.currentArmor ?? 0) },
    { ref: sideB, hp: Number(sideB.general.currentHp ?? 0), armor: Number(sideB.general.currentArmor ?? 0) },
  ];
  const startHp = [sides[0].hp, sides[1].hp];

  const rounds: GameEvent[] = [];
  for (let index = 0; index < DUEL_MAX_ROUNDS; index += 1) {
    const attacker = sides[index % 2];
    const defender = sides[(index + 1) % 2];
    const rawDamage = getAttackValue(attacker.ref.general, false);
    const hit = applyArmorDamage(defender.hp, defender.armor, rawDamage);
    defender.hp = hit.hp;
    defender.armor = hit.armor;
    rounds.push({
      type: 'DAMAGE',
      data: {
        ...withoutParticipants(data),
        sourcePlayerId: attacker.ref.playerId,
        sourceGeneralId: attacker.ref.generalId,
        targetPlayerId: defender.ref.playerId,
        targetId: defender.ref.generalId,
        damageType: 'skill',
        // 0 及以下伤害照样占一轮并继续轮换（§H5-6）——刻意不随桥接层 DAMAGE 的
        // Math.max(1, …) 钳制，否则"打了但没掉血"会被写成掉了血。
        value: Math.max(0, rawDamage),
        newHp: hit.hp,
        newArmor: hit.armor,
        duelRound: index + 1,
        duelKey,
      },
    });
    // 一旦有一方在计算受到的伤害后体力≤0，立刻终止（死者不再被轮换）。
    if (hit.hp <= 0) break;
  }

  // 收官：受伤者按"这一场实际掉掉的体力"各立一笔，受邀者（B）在前、发起者（A）在后。
  const injuries: GameEvent[] = [];
  for (const victimIndex of [1, 0]) {
    const victim = sides[victimIndex];
    const loss = startHp[victimIndex] - victim.hp;
    if (loss <= 0) continue;
    // 阵亡者那一笔不结算（§H9 第七轮）：体力≤0＝这一场里离场了，受伤类根本不成立。
    if (victim.hp <= 0) continue;
    const opponent = sides[victimIndex === 0 ? 1 : 0];
    injuries.push({
      type: 'DUEL_INJURY',
      data: {
        ...withoutParticipants(data),
        // 这笔账"是谁造成的"＝对手那一位（决斗里双方互有先手后手，逐轮的先后在此合并）。
        sourcePlayerId: opponent.ref.playerId,
        sourceGeneralId: opponent.ref.generalId,
        targetPlayerId: victim.ref.playerId,
        targetId: victim.ref.generalId,
        damageType: 'skill',
        value: loss,
        duelKey,
        duelStage: 'injury',
      },
    });
  }

  return { rounds, injuries };
}

/** 载荷的缺省读法：畸形 DUEL（没有载荷）也走同一条诚实空转路。 */
function asData(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** 决斗载荷里逐轮/收官要重写的键——四个键（受邀者是谁、发起者是谁）之外还有
 *  `rootEventId`（时间戳派生的进程易变值，理由同 `openingNotice`）与 `duelStage`
 *  （时点标记只属于通知本体：续跑令的 `answered` 不该染进每一"打"的载荷，
 *  收官那笔自己写 `injury`）。其余（skillId/skillName/effectType/triggerEventId）
 *  原样带过去，报告与操作日志据此把每一"打"归到那枚技能上。 */
const DUEL_PARTICIPANT_KEYS = ['sourcePlayerId', 'sourceGeneralId', 'targetPlayerId', 'targetId', 'rootEventId', 'duelStage'] as const;

function withoutParticipants(value: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...value };
  for (const key of DUEL_PARTICIPANT_KEYS) delete rest[key];
  return rest;
}

/** 同一场决斗的配对键：DUEL 事件与它派生出的逐轮伤害都带着它，回显时据此把
 * 每一块插回自己那条 DUEL 之后（载荷里没有唯一 id——事件在纯路径上尚未盖戳）。 */
export function duelKeyOf(data: Record<string, unknown> | undefined): string {
  const value = data ?? {};
  return [
    String(value.skillId ?? ''),
    String(value.triggerEventId ?? ''),
    `${String(value.sourceGeneralId ?? '')}>${String(value.targetId ?? '')}`,
  ].join('|');
}

/**
 * 把队列内派生的决斗块回显进事件流（TransitionCore 唯一调用点）。
 *
 * 一块＝这场决斗派生出的**全部**通知与逐轮（开局那一声、逐轮那些"打"、收官那笔
 * 累计受伤），按派生顺序整体插到宿主 `DUEL` 之后。宿主取**最后**一条同键 DUEL：
 * 一次成形的决斗只有一条宿主（逐轮就紧挨它，§H9 第六轮②逐字不变）；被开局问答
 * 延后的那一场，续跑令才是宿主——逐轮排在答复之后，日志/录像才看得出"先问完、
 * 再开打"的真实次序。
 */
export function echoDuelRounds(events: GameEvent[], derived: readonly GameEvent[]): void {
  const blocks = new Map<string, GameEvent[]>();
  for (const event of derived) {
    if (event.type === 'DUEL') continue;
    const key = (event.data as { duelKey?: unknown } | undefined)?.duelKey;
    if (typeof key !== 'string' || !key) continue;
    const block = blocks.get(key);
    if (block) block.push(event);
    else blocks.set(key, [event]);
  }
  if (blocks.size === 0) return;

  const hosts = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.type !== 'DUEL') return;
    hosts.set(duelKeyOf(event.data as Record<string, unknown> | undefined), index);
  });

  const insertions = new Map<number, GameEvent[]>();
  for (const [key, block] of blocks) {
    const host = hosts.get(key);
    // 找不到宿主（不该发生）也不能让轮次消失：追加在末尾。
    const at = host === undefined ? events.length : host + 1;
    const existing = insertions.get(at);
    if (existing) existing.push(...block);
    else insertions.set(at, [...block]);
  }

  const echoed: GameEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    echoed.push(events[index]);
    const block = insertions.get(index + 1);
    if (block) echoed.push(...block);
  }
  // 末位宿主（DUEL 恰是事件流最后一条——续跑路就是这样）在上循环最后一轮已按
  // `index+1 === events.length` 插过块，这里绝不能再补一遍（那是第二次写）。
  events.length = 0;
  events.push(...echoed);
}

/** 决斗本体零状态位移：唯一结算入口仍是 EventProcessor，本函数恒等返回。 */
export function applyDuelEvent(state: EngineState, event: GameEvent): EngineState {
  // "决斗不附带任何效果"（§H7）——事件记下"这枚技能确实响了"，全部后果来自
  // deriveDuelRounds 派生的逐轮伤害块。这里读一次载荷只为让畸形 DUEL 也
  // 落成它本就该有的无害空转（与 applyRevealEvent 同一形状）。
  const data = event.data as { sourceGeneralId?: unknown; targetId?: unknown } | undefined;
  if (typeof data?.sourceGeneralId !== 'string' || typeof data?.targetId !== 'string') return state;
  return state;
}
