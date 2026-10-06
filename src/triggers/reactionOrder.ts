/**
 * 响应链顺序（#71 响应链执法刀·第一层）——一条**人和 AI 共用**的比较器。
 *
 * 需求原文（用户 2026-09-30 第八／十轮，HANDOFF §12-84/§12-85）：受击方整组先、
 * 组内按座次逐个问，受击组问完后**不是从 1 号位重排**，而是从"受击组最后被问过
 * 的那一席"继续沿座次绕一圈；同一席位内的多名响应者按该席被问到的先后。
 * 档位表（`SkillTriggerBridge.PRIORITY`）在它之上、不被本模块推翻。
 *
 * 「受击方」是**将领那一层**，不是席位那一层：用户的工作例里 B 与挨打的 A 同坐
 * 席 2，B 仍排在绕圈之后（A→C→D→B）。所以分组轴先认"这件事点名打到哪一员"
 * （`victimGenerals`），点名不到具体哪一员（打营地这类）才退到席位
 * （`victimSeats`）。
 *
 * 三条纪律：
 * - 席位内的先后沿用**注册顺序**（＝交刀前的逐字行为）。样本池 300 局里出现过
 *   19 次"同一席位内多名响应者撞在同一件事上"（全在回合开始），本模块一律不动
 *   它们的相对次序，这是 B11 逐字的前提，`reactionOrder.test.ts` 钉住了这条。
 * - 没有受击者（分组轴空或全认不出来）⇒ 座次轴整条不启用，只剩「档位＋注册顺序」，
 *   输出顺序＝输入顺序＝今天的注册顺序。这是"缺省档＝扩面前的行为"的构造，不是碰巧。
 * - **宁可少分不可乱分**：认不出将领也认不出席位的候选不分组，但档位与注册顺序照旧。
 */

import type { GameEvent } from '../core/Event';

/** 一条待排序的响应候选。 */
export interface ReactionCandidate {
  /** 席位 id（`player.id`），不是势力。 */
  ownerId: number | string;
  /** 这条监听属于哪一员将领；没有＝认不出将领那一层（内置触发、旧登记）。 */
  generalId?: string;
  /** 现有档位表的读数，越大越先。 */
  priority: number;
}

export interface ReactionOrderingContext {
  /** 牌桌座次＝`state.players` 的数组顺序。 */
  seatOrder: Array<number | string>;
  /** 这件事点名打到的将领（可空＝没点名，或点名的不是场上任何一员的监听）。 */
  victimGenerals: string[];
  /** 这件事打到的席位（可空＝这件事没有落到某一位玩家身上）。 */
  victimSeats: Array<number | string>;
}

/**
 * 从事件里读出"这件事作用在谁身上"。读不出来就是两个空数组＝这一声没有分组轴，
 * 顺序回落到注册顺序（＝交刀前行为）。猜错受击者会把一次响应的先后排反，漏判只是
 * 退回现状，所以这里**只读结算侧已经写进事件的那个键**，不重新推断伤害是谁引起的。
 */
export function victimRefOf(event: GameEvent): { victimGenerals: string[]; victimSeats: Array<number | string> } {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const victimGenerals: string[] = [];
  const victimSeats: Array<number | string> = [];

  const generalKey = data.targetId ?? data.target;
  if (typeof generalKey === 'string' && generalKey) victimGenerals.push(generalKey);
  if (Array.isArray(data.targetIds)) {
    for (const id of data.targetIds) {
      if (typeof id === 'string' && id && !victimGenerals.includes(id)) victimGenerals.push(id);
    }
  }

  // 只有行序（回合开始的 playerId）不算"被打到"——那是行序，不是受击。
  const seatKey = data.targetPlayerId;
  if (typeof seatKey === 'number' || (typeof seatKey === 'string' && seatKey)) victimSeats.push(seatKey);

  return { victimGenerals, victimSeats };
}

/**
 * 稳定排序：先档位，同档位内"受击组整组先"，组内按座次，非受击组从受击组末席
 * 的后一席开始绕圈。输入顺序（注册顺序）只用来打破"同一席位内"的平手。
 */
export function orderReactionCandidates<T extends ReactionCandidate>(
  candidates: T[],
  ctx: ReactionOrderingContext
): T[] {
  if (candidates.length <= 1) return [...candidates];

  const seatIndexOf = (ownerId: number | string): number =>
    ctx.seatOrder.findIndex(id => String(id) === String(ownerId));
  const generalSet = new Set(ctx.victimGenerals);
  const seatSet = new Set(ctx.victimSeats.map(String));
  // 将领那一层认出来了就以它为准（同席没挨打的那一员算非受击组）；一个都没认出来
  // 才退回席位那一层（打营地：这位玩家的全部监听都是受击方）。
  const generalAxisIsAuthoritative = candidates.some(
    candidate => candidate.generalId && generalSet.has(candidate.generalId)
  );
  const isVictim = (candidate: ReactionCandidate): boolean => {
    if (generalAxisIsAuthoritative) return Boolean(candidate.generalId && generalSet.has(candidate.generalId));
    return seatSet.has(String(candidate.ownerId));
  };

  const ranked = candidates.map((candidate, index) => ({
    candidate,
    index,
    priority: candidate.priority,
    seat: seatIndexOf(candidate.ownerId),
    victim: isVictim(candidate),
  }));

  // 绕圈起点＝受击组里最后一席（座位升序的末席）的后一席。
  const victimSeatIndexes = ranked
    .filter(entry => entry.victim && entry.seat >= 0)
    .map(entry => entry.seat)
    .sort((a, b) => a - b);
  // **没有受击组＝没有座次轴**：整条比较器退化为「档位＋注册顺序」，也就是交刀前的
  // 逐字行为。座次绕圈只在真的有人挨了这一下时才开始数。
  const hasVictimGroup = victimSeatIndexes.length > 0;
  const rotationStart = hasVictimGroup ? victimSeatIndexes[victimSeatIndexes.length - 1] + 1 : 0;
  const seatCount = Math.max(1, ctx.seatOrder.length);
  // 认不出席位的非受击者排在有席位者的末尾，彼此仍按注册顺序；绝不因为"算不出座次"
  // 就抢在整组前面。
  const rotationRank = (seat: number): number =>
    seat < 0 ? seatCount : (seat - rotationStart + seatCount * 2) % seatCount;

  // 档位（大者先）→ 受击组整组先 → 组内座次（非受击组绕圈）→ 注册顺序。
  return [...ranked]
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (!hasVictimGroup) return a.index - b.index;
      if (a.victim !== b.victim) return a.victim ? -1 : 1;
      if (a.victim) {
        // 受击组：座位升序，不做绕圈。
        if (a.seat !== b.seat) return a.seat - b.seat;
      } else {
        const rankA = rotationRank(a.seat);
        const rankB = rotationRank(b.seat);
        if (rankA !== rankB) return rankA - rankB;
      }
      // 同一席位内：注册顺序原样保持（绝不顺手重排）。
      return a.index - b.index;
    })
    .map(entry => entry.candidate);
}
