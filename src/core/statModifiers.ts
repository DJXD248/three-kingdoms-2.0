/**
 * 数值修正器管线（2.8 刀4＝#25，PROJECT_ARCH_MAP §F「数值修正器管线」十二格表）。
 *
 * 一条规则改一个数字＝账本上一笔账，不是当场改写卡面。账本（EngineState.statModifiers）
 * 是 A 类可回放事实：常驻／重建／回放／录像四路都从同一份账算出同一个读数。
 *
 * 三条来自用户 2026-10-02 裁决的硬口径，逐条都能指回契约表第一节：
 *  - 第 4 条：改数两种形态＝增减（累加）与固定（覆写）。固定优先——有固定生效期间，
 *    该数字上的增减一律不参与（不是删掉，是不被读）；同侧两笔固定按发动先后，后发覆盖先发。
 *  - 第 2/3 条：离场打断一切（与周期写法无关）；回场不续＝新序号一笔。
 *  - 第 12 条：锁定技那笔账**不能被别人移走**，所以全库只留 `revokeModifier` 一个
 *    "移走/改写别人那笔账"的入口，它读 `locked` 并拒绝。生命周期收账（离场、到期）
 *    走 `prune*` 系列，那不是"无效化"，是"人在场"这个前提本身没了。
 */

/** 本刀接线（有真实读数消费）的五格＋已登记但还没接线的格；注册表全貌在契约表§三。 */
export type StatModifierKey =
  | 'MELEE_ATK'
  | 'RANGED_ATK'
  | 'MAX_HP'
  | 'CURRENT_HP'
  | 'DAMAGE_TAKEN'
  | 'DAMAGE_DEALT'
  | 'RANGE';

/** 接线档位＝本刀真的有读数点来读的键（其余键账本收得下，但还没人读）。
 *  `DAMAGE_TAKEN`＝2.8 刀5 接线（读数点=`core/damageTaken.ts`，护甲之前那一格）。
 *  `DAMAGE_DEALT` 照旧只登记：用户 2026-10-03 裁"本刀不接"。
 *  `RANGE`＝v2.9.0 射程刀接线（读数点=`core/attackReach.ts`＝全库唯一一处够得着判据）。 */
export const WIRED_STAT_KEYS: StatModifierKey[] = ['MELEE_ATK', 'RANGED_ATK', 'MAX_HP', 'DAMAGE_TAKEN', 'RANGE'];

export type StatModifierMode = 'delta' | 'set';

/** 周期（数据层那六档回合／离场词汇，＋刀5 那一档一次性）。契约表第 2 条：`untilDeath`
 *  与 `untilLeaveField` 同义，结算侧一律由"离场"这一条总闸负责，这里只保留回合边界那一档。
 *  `thisDamage`＝刀5 的一次性账（本次／下一次受到伤害，用掉即销）：它**不跟回合边界走**
 *  （`TURN_EXPIRES` 里没有它），只被那一刀的消费清单销掉，或随人离场被总闸收走。 */
export type StatExpireCondition =
  | 'untilSelfTurnStart' | 'untilSelfTurnEnd'
  | 'untilOtherTurnStart' | 'untilOtherTurnEnd'
  | 'untilDeath' | 'untilLeaveField'
  | 'thisDamage';

export interface StatModifier {
  /** `sm:<seq>`——纯派生自账本自身的单调号，绝不碰引擎 RNG（零新增随机面）。 */
  id: string;
  /** 发动先后序号：同侧两笔固定打架时比它（后发的赢），不参与任何其它判定。 */
  seq: number;
  key: StatModifierKey;
  mode: StatModifierMode;
  value: number;
  /** 被改的那一员将（runtime card id + 座次）。 */
  targetPlayerId: number;
  targetId: string;
  /** 这笔账是谁的技能产生的（§H7"分来源"的真实含义＝归属标记）。 */
  ownerPlayerId: number;
  ownerGeneralId: string;
  ownerSkillId: string;
  /** 锁定技徽章派生的「不可被移走」位：只有 `revokeModifier` 读它。 */
  locked: boolean;
  /** 在场持续（契约表第 3 条）：它不是发动、不进问窗、不耗"回合限 1 次"。 */
  passive: boolean;
  /** 周期；`passive` 笔不填（它的周期就是"在场"本身）。 */
  expire?: StatExpireCondition;
  /** 显示用（结算提示/面板），不参与判定。 */
  ownerSkillName?: string;
}

export interface StatModifierTarget {
  playerId: number;
  generalId: string;
}

const targetEq = (mod: StatModifier, target: StatModifierTarget): boolean =>
  mod.targetPlayerId === target.playerId && mod.targetId === String(target.generalId);

/** 归属＝(座次, 将领实例) 这一对：将领 id 是运行时实例号，但它跨席位不保证唯一，
 *  比归属必须带座次键（漏了它会把别人席位上同名将的账一并收走）。 */
const ownerEq = (mod: StatModifier, general: StatModifierTarget): boolean =>
  mod.ownerPlayerId === general.playerId && mod.ownerGeneralId === String(general.generalId);

/** 这笔账跟这一员将有关吗——它名下产生的、或落在它身上的，都算（契约表第 2 条：
 *  发起者离场、被改者离场，都当场断）。 */
const touchesGeneral = (mod: StatModifier, general: StatModifierTarget): boolean =>
  ownerEq(mod, general) || targetEq(mod, general);

const touchesPlayer = (mod: StatModifier, playerId: number): boolean =>
  mod.ownerPlayerId === playerId || mod.targetPlayerId === playerId;

/**
 * 覆写先后（"同侧后发覆盖先发"那半条的完整写法）。两段键：先比"是不是当事人自己
 * 那笔"，再比发动序号。
 *
 * 第一段是我 2026-10-02 给用户的**建议（丙案，待裁）**：第三方的固定只能"提议"，
 * 当事人自己那笔永远盖过同侧第三方——否则攻守双方无法主导自己那一侧的数字。
 * 本刀接线的三把钥匙（近战／远程／体力上限）今天**全部是 self 目标**（跨将目标在
 * #28 刀7 才落地），所以第一段对今日所有实例都是平手⇒逐字等于只比 seq⇒两锚不受影响。
 */
function precedenceRank(mod: StatModifier, target: StatModifierTarget): number {
  return ownerEq(mod, target) ? 1 : 0;
}

/** 账本里针对某个数字的某一位将领的笔，按覆写先后排（后者优先）。 */
export function modifiersFor(
  ledger: readonly StatModifier[] | undefined,
  key: StatModifierKey,
  target: StatModifierTarget,
): StatModifier[] {
  if (!ledger || ledger.length === 0) return [];
  return ledger
    .filter(mod => mod.key === key && targetEq(mod, target))
    .sort((a, b) => (precedenceRank(a, target) - precedenceRank(b, target)) || (a.seq - b.seq));
}

/**
 * 读数唯一实现：基础值 + 账本 ⇒ 这一个数字此刻是多少。
 * 增减与固定互斥（固定在场时增减不参与），固定失效后增减自动恢复参与——
 * 因为这里从不删账，只决定读哪一笔。
 */
export function resolveStatNumber(
  ledger: readonly StatModifier[] | undefined,
  key: StatModifierKey,
  target: StatModifierTarget,
  base: number,
): number {
  const mods = modifiersFor(ledger, key, target);
  if (mods.length === 0) return base;
  const sets = mods.filter(mod => mod.mode === 'set');
  if (sets.length > 0) return sets[sets.length - 1].value;
  return mods.reduce((sum, mod) => sum + mod.value, base);
}

/** 下一个序号＝账本里已有最大序号 +1（纯派生，四路同账本⇒同序号）。 */
export function nextModifierSeq(ledger: readonly StatModifier[] | undefined): number {
  if (!ledger || ledger.length === 0) return 1;
  return ledger.reduce((max, mod) => Math.max(max, mod.seq), 0) + 1;
}

export function modifierId(seq: number): string {
  return `sm:${seq}`;
}

/** 发动/在场重推＝往账本上添一笔（纯函数，返回新数组）。 */
export function addModifier(
  ledger: readonly StatModifier[] | undefined,
  entry: Omit<StatModifier, 'id' | 'seq'>,
): StatModifier[] {
  const seq = nextModifierSeq(ledger);
  return [...(ledger ?? []), { ...entry, id: modifierId(seq), seq }];
}

/**
 * 生命周期收账：这一员将**离开场上**时，凡是它名下的、或落在它身上的账一律当场结束
 * （契约表第 2 条"离场打断一切"，与 `expire` 写法、与离场是哪一种都无关）。
 */
export function pruneModifiersOnLeave(
  ledger: readonly StatModifier[] | undefined,
  general: StatModifierTarget,
): StatModifier[] {
  if (!ledger || ledger.length === 0) return ledger ? [...ledger] : [];
  return ledger.filter(mod => !touchesGeneral(mod, general));
}

/** 同一判据的 id 清单版：账本没这笔就没什么可销——发射器要的是"销哪些 id"。 */
export function modifierIdsTouchingGeneral(
  ledger: readonly StatModifier[] | undefined,
  general: StatModifierTarget,
): string[] {
  if (!ledger || ledger.length === 0) return [];
  return ledger.filter(mod => touchesGeneral(mod, general)).map(mod => mod.id);
}

/** 席位阵亡（被击败）＝这个人名下与落在这个人身上的账一律当场结束。 */
export function modifierIdsTouchingPlayer(
  ledger: readonly StatModifier[] | undefined,
  playerId: number,
): string[] {
  if (!ledger || ledger.length === 0) return [];
  return ledger.filter(mod => touchesPlayer(mod, playerId)).map(mod => mod.id);
}

/** 回合边界收账：只有带回合类周期的发动笔会被收走（在场持续笔的周期是"在场"本身）。
 *  "自/他"比的是**这笔账的归属席位**（周期是技能作者写的，与被改的那一位无关）。 */
const TURN_EXPIRES: StatExpireCondition[] = [
  'untilSelfTurnStart', 'untilSelfTurnEnd', 'untilOtherTurnStart', 'untilOtherTurnEnd',
];

export function isExpiredAtTurnBoundary(
  mod: StatModifier,
  boundary: { edge: 'start' | 'end'; playerId: number },
): boolean {
  const expire = mod.expire;
  if (!expire || !TURN_EXPIRES.includes(expire)) return false;
  const isSelf = mod.ownerPlayerId === boundary.playerId;
  if (boundary.edge === 'start') {
    return isSelf ? expire === 'untilSelfTurnStart' : expire === 'untilOtherTurnStart';
  }
  return isSelf ? expire === 'untilSelfTurnEnd' : expire === 'untilOtherTurnEnd';
}

export function modifierIdsExpiredAtTurnBoundary(
  ledger: readonly StatModifier[] | undefined,
  boundary: { edge: 'start' | 'end'; playerId: number },
): string[] {
  if (!ledger || ledger.length === 0) return [];
  return ledger.filter(mod => isExpiredAtTurnBoundary(mod, boundary)).map(mod => mod.id);
}

export function pruneModifiersAtTurnBoundary(
  ledger: readonly StatModifier[] | undefined,
  boundary: { edge: 'start' | 'end'; playerId: number },
): StatModifier[] {
  if (!ledger || ledger.length === 0) return ledger ? [...ledger] : [];
  return ledger.filter(mod => !isExpiredAtTurnBoundary(mod, boundary));
}

/**
 * **全库唯一的"移走/改写别人那笔账"入口**（契约表第 12 条的地基）。
 * 锁定技那一笔拒绝被移走；今日世上还没有能改别人的效果，所以这一路只有探针会走
 * ——它必须现在就在那里，第一个这类技能被写出来的那一刻就自动被挡，不返工。
 */
export interface RevokeResult {
  ledger: StatModifier[];
  /** 被拒的笔 id（空数组＝全部收下）。 */
  refused: string[];
}

export function revokeModifier(
  ledger: readonly StatModifier[] | undefined,
  ids: readonly string[],
): RevokeResult {
  const current = [...(ledger ?? [])];
  const wanted = new Set(ids.map(String));
  const refused = current.filter(mod => wanted.has(mod.id) && mod.locked).map(mod => mod.id);
  const kept = current.filter(mod => !(wanted.has(mod.id) && !mod.locked));
  return { ledger: kept, refused };
}

/**
 * 体力上限的唯一读数写法：卡面打印值（`fg.maxHp`）＋账本 ⇒ 此刻的上限。
 * 补给、护甲上限、治疗封顶、AI 不变量、界面显示一律走这里——"上限被改了但某处还读
 * 打印值"这种分叉就是这一格存在的理由。**它从不写回 `maxHp`**（第 3 条：改数与改卡分开）。
 */
export function effectiveMaxHp(
  ledger: readonly StatModifier[] | undefined,
  target: StatModifierTarget,
  fieldGeneral: { maxHp?: number; general?: { hp?: number | string }; currentHp?: number },
): number {
  const base = Number(
    fieldGeneral?.maxHp ?? fieldGeneral?.general?.hp ?? fieldGeneral?.currentHp ?? 0,
  );
  if (!ledger || ledger.length === 0) return base;
  return resolveStatNumber(ledger, 'MAX_HP', target, base);
}

/** 账本上有没有跟这个人（将领）有关的任何一笔——离场扫描与"今天没有账⇒零事件"闸门用。 */
export function hasModifiersTouched(
  ledger: readonly StatModifier[] | undefined,
  general: StatModifierTarget,
): boolean {
  if (!ledger || ledger.length === 0) return false;
  return ledger.some(mod => touchesGeneral(mod, general));
}
