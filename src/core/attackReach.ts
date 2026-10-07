/**
 * 攻击「够不够得着」的唯一判据（v2.9.0 射程刀＝ARCH_MAP §三 `RANGE` 那一行落地）。
 *
 * 这一刀之前，同一个判断在库里住着三处（`core/attackBlow.ts` 的闸、
 * `rules/battlefieldRules.ts` 的界面名单、`domain/combatRules.ts` 的无人调用旧拷贝），
 * 每处各自硬编码同一张"谁够得着谁"的表。三张表今天逐格同果，但**没有任何一条测试
 * 规定它们必须同果**——射程一旦可变，"界面列出来的"与"引擎肯收的"就会当场分叉，
 * 那正是 v2.8.40 那条判据（§12-111⑩：界面拦但清单还留着）的镜像事故。
 * 所以这一档把三处合成一处，另外两处只剩"问它"。
 *
 * 距离怎么数（用户 2026-10-07 认可的"由近到远"，原文见 HANDOFF 本轮条）：
 * 战场上的路是一条直线——自家营地 — 自家前线 — 战场 — 敌前线 — 敌营地（营地与那一席
 * 的营地同档）。以"出手的这一员自己踩的那片区域"为原点给五格编号，两位的编号差
 * 就是隔着几格：
 *   档 0＝同一片区域的同一档，档 1＝紧挨着，档 2＝隔一块，档 3＝再往外，档 4＝对面那一头
 * 于是两张旧表塌成一句话，而且这句与原表**逐格等价**（证人＝`attackReach.test.ts`
 * 把旧表原样抄下来做全组合对照）：
 *   ‧ 近战＝档 ≤ 1（挨得着）
 *   ‧ 远程＝档 ≥ 2 且 ≤ 射程上限（默认上限＝2 ⇒ 与旧表一字不差）
 *
 * `RANGE`（射程）改的是**上限**，而且只往外推：下限那个"档 ≥ 2"不动，所以射程再高
 * 也不会把身边那一档让给远程——近处永远是近战的活儿（用户 2026-09-28 那条"只往外推、
 * 不把近处也一并放开"）。今日世上零张卡挂射程 ⇒ 默认上限恒为 2 ⇒ 既有对局一字不改。
 */
import type { StatModifier, StatModifierTarget } from './statModifiers';
import { resolveStatNumber } from './statModifiers';

export type ReachZone = 'camp' | 'front' | 'battle';

/** 只需要区域身份的两个键（`slot` 与够不够得着无关，故不进这一档的参数类型）。 */
export interface ReachPosition {
  zone: ReachZone;
  areaOwnerId: number | null;
}

/** 没有射程账时的上限＝旧表"远程"那三格所在的位置差。 */
export const BASE_ATTACK_RANGE = 2;
/** 近战永远只到紧挨着那一档：射程动不了它。 */
export const MELEE_MAX_DISTANCE = 1;

const ZONE_RANK: Record<'camp' | 'front', number> = { camp: 0, front: 1 };
/** 战场永远在正中间。 */
const BATTLE_RANK = 2;
/** 直线总长：自家营地 0 → 对面营地 4。 */
const FAR_SIDE_OFFSET = 4;

/**
 * 以 `referenceArea`（＝出手者自己踩的那片区域归谁）为原点，数这一格排在第几档。
 * 不属于原点那一侧的一律按"对面"镜像（`camp` 与 `front` 互换），所以三席以上也
 * 不需要额外分支：第三方那片区域就是"对面"，与旧表里"没有一条规则匹配它"同果。
 */
export function reachRank(pos: ReachPosition, referenceArea: number): number {
  if (pos.zone === 'battle') return BATTLE_RANK;
  return pos.areaOwnerId === referenceArea
    ? ZONE_RANK[pos.zone]
    : FAR_SIDE_OFFSET - ZONE_RANK[pos.zone];
}

/** 原点：站在战场上时没有"这片区域归谁"，退回这一员将自己的席位。 */
export function reachReference(attacker: { position: ReachPosition; ownerId: number }): number {
  return attacker.position.areaOwnerId ?? attacker.ownerId;
}

export function distanceBetween(
  reference: number,
  from: ReachPosition,
  to: ReachPosition,
): number {
  return Math.abs(reachRank(from, reference) - reachRank(to, reference));
}

/**
 * 够不够得着——唯一判据。
 * `maxRange` 只出现在远程那一支；近战那一支不读它，所以射程对近战结构性无效。
 */
export function isReachable(
  distance: number,
  ranged: boolean,
  maxRange: number,
): boolean {
  if (!ranged) return distance <= MELEE_MAX_DISTANCE;
  return distance >= 2 && distance <= maxRange;
}

export function canReach(
  reference: number,
  from: ReachPosition,
  to: ReachPosition,
  ranged: boolean,
  maxRange: number,
): boolean {
  return isReachable(distanceBetween(reference, from, to), ranged, maxRange);
}

/** 营地与那一席的营地同档：打营地用的就是这一格的位置。 */
export function basePosition(playerId: number): ReachPosition {
  return { zone: 'camp', areaOwnerId: playerId };
}

/**
 * 射程上限的唯一读数点：账本 ⇒ 这一员将此刻的远程最远档数。
 * 形状照 `effectiveMaxHp`（刀4）——卡面不写死、改数不落回卡面，缺账即基础值。
 * 增减/固定/后发覆盖的裁决全部走 `resolveStatNumber`，这一档不自己发明第二轮规矩。
 * 上限被摁成 0 或 1（或减成负数）时远程那一支的下限 2 > 上限 ⇒ 射程为空＝远程永远
 * 够不着，近战不受影响；这不是特例，是同一句话的自然读数，所以不额外夹一层。
 */
export function effectiveAttackRange(
  ledger: readonly StatModifier[] | undefined,
  target: StatModifierTarget,
): number {
  if (!ledger || ledger.length === 0) return BASE_ATTACK_RANGE;
  return resolveStatNumber(ledger, 'RANGE', target, BASE_ATTACK_RANGE);
}
