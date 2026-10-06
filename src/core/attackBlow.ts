/**
 * 一次普攻的**两拍形状**（v2.8.31 受击/受伤定义封口刀）。
 *
 * 用户 2026-10-04 定稿的定义（原文＝`PROJECT_HANDOFF.md` §12-102）：
 *  ‧ **受击＝成为目标**：这一型**在伤害计算之前**发动，和这一刀实际打多少、主人会不会
 *    被这一刀砍死**无关**⇒被砍死的那一刀里它照样发动。
 *  ‧ **受伤＝受到伤害**：这一型必须真的掉了血才成立，所以它在**伤害计算之后**发动，
 *    与这一刀的实伤、主人存活与否有关⇒主人死在这一刀里就不发动。
 *  ‧ **强制发动与手动发动同一条规矩**，区别只在"需不需要玩家自行响应"。
 *  ‧ 追加裁决（甲）：受击那一拍的反击若先把出手的那位扎死，**这一刀跟着取消**
 *    ⇒被攻击的那一位靠反伤自救成功。
 *
 * 要让上面这四句同时成立，一次攻击不能像 2.3.0 那样"一次算完再整块落账"，必须分两拍：
 *  1. **declare**＝只记下"这一刀瞄上了谁"（`BEFORE_DAMAGE` 那一声，伤害数字**还没算死**），
 *     然后把这一拍交给受击那一层走完：自动发动路当场响（效果排在流里、先落账），
 *     要问人的那一类开一格问答、把世界冻在这里（`pendingReaction`）。
 *  2. **damage**＝受击那一层走完后，**对着此刻的状态**重算伤害数学并落这一刀
 *     （`DAMAGE`→`DEATH`→`ATTACK_RESOLVED`→`AFTER_DAMAGE`）。出手的那位（或挨打的那位）
 *     已经不成立⇒这一笔整笔取消、不落任何事件。
 *
 * 这两拍**共用下面这一份算术**：declare 与 damage 都由本文件产出，`AttackResolver` 只是
 * 它的正身入口，`core/TransitionCore` 的续跑只是它的**时刻表**。全库没有第二份伤害数学，
 * 也没有第二条状态转移路径——与决斗那两层（`eventProcessors/duelEvents.ts`）同一个形状。
 *
 * **没有听众就不延后**：declare 那一拍先问一次"这一声有没有人听"（受击那一型的
 * **两条路**共用 `skills/reactionChain.hasReactionListeners` 那一个推导点）。没人听⇒
 * 两拍紧挨着一次走完、事件流与 2.3.0 以来逐字相同；有人听⇒只发 declare 那一拍，
 * `damage` 留到那一层走完再发。这条免费闸是"旧对局零扰动"的构造保证，不是优化。
 */
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from './GameState';
import type { GameEvent } from './Event';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { applyArmorDamage } from './armorDamage';
import { capDamageToBase } from './baseDamage';
import { resolveDamageTaken } from './damageTaken';
import { getAttackValue } from './attackValue';
import { hasReactionListeners } from '../skills/reactionChain';

interface Position {
  zone: 'camp' | 'front' | 'battle';
  slot: number;
  areaOwnerId: number | null;
}

interface AttackPayload {
  attackerId: string;
  targetId: string;
  ranged: boolean;
  consumeCard?: any | null;
}

function findFieldGeneral(state: EngineState, generalId: string) {
  for (const player of state.players) {
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    const found = fieldGenerals.find(fg => getRuntimeCardId(fg?.general as any) === String(generalId));
    if (found) return { player, general: found as any };
  }
  return null;
}

function sameArea(a: Position, b: Position) {
  return a.zone === b.zone && a.areaOwnerId === b.areaOwnerId;
}

function isAttackInRange(attacker: any, target: any, ranged: boolean) {
  const a = attacker?.position as Position | undefined;
  const t = target?.position as Position | undefined;
  if (!a || !t) return false;

  if (ranged) {
    if (a.zone === 'camp') return t.zone === 'battle';
    if (a.zone === 'front') return t.zone === 'front' && t.areaOwnerId !== a.areaOwnerId;
    if (a.zone === 'battle') return t.zone === 'camp';
    return false;
  }

  if (sameArea(a, t)) return true;
  if (a.zone === 'camp' && t.zone === 'front' && t.areaOwnerId === a.areaOwnerId) return true;
  if (a.zone === 'front' && t.zone === 'battle') return true;
  if (a.zone === 'battle' && t.zone === 'front') return true;
  if (a.zone === 'front' && t.zone === 'camp' && t.areaOwnerId === a.areaOwnerId) return true;
  return false;
}

function canTargetBase(attacker: any, targetPlayerId: number, attackerPlayerId: number, ranged: boolean) {
  const p = attacker?.position as Position | undefined;
  if (!p || targetPlayerId === attackerPlayerId) return false;
  if (ranged) return p.zone === 'battle';
  // Melee can hit the enemy base from its front or its camp.
  return (p.zone === 'front' || p.zone === 'camp') && p.areaOwnerId === targetPlayerId;
}

// Both halves of the attack damage math now live in the core layer as the
// single canonical implementations, shared with skill damage settlement and
// the duel flow: applyArmorDamage (core/armorDamage.ts) and getAttackValue
// (core/attackValue.ts).

/**
 * 一次攻击的**瞄准**那一层：所有合法性判据＋当刻读出的基础攻击力。
 * 延后落那一拍时**重新走一遍**（读的是答复落账之后的状态）⇒甲案那条"出手的人已经
 * 不在场了，这一刀跟着取消"是结构性成立，不需要任何一处专门判断"他死没死"。
 */
type AttackAim =
  | { readonly status: 'rejected'; readonly reason: string }
  | {
    readonly status: 'aimed';
    readonly attackerPlayerId: number;
    readonly attackerId: string;
    readonly targetId: string;
    readonly ranged: boolean;
    readonly consumeCard: any;
    readonly baseDamage: number;
    /** 打的是营地（`base_<座次>`）：那一型压根没有"哪一员将成为了目标"⇒受击那一层
     *  结构性无人可听（`matchesSkillEvent` 缺受击者键⇒三档都不响），也就永不延后。 */
    readonly isBase: boolean;
    readonly targetPlayerId: number;
    readonly targetGeneral: any | null;
  };

function aimAttack(state: EngineState, action: GameAction<AttackPayload>): AttackAim {
  const payload = action.payload;
  if (!payload?.attackerId || !payload.targetId || typeof payload.ranged !== 'boolean') {
    return { status: 'rejected', reason: 'INVALID_ATTACK_PAYLOAD' };
  }

  const attackerResult = findFieldGeneral(state, payload.attackerId);
  if (!attackerResult || attackerResult.player.id !== action.playerId) {
    return { status: 'rejected', reason: 'ATTACKER_NOT_CONTROLLED' };
  }

  const attacker = attackerResult.general;
  if (attacker.isArming) {
    return { status: 'rejected', reason: 'GENERAL_IS_ARMING' };
  }
  if (attacker.hasAttacked) {
    return { status: 'rejected', reason: 'GENERAL_ALREADY_ATTACKED' };
  }

  const hand = Array.isArray(attackerResult.player.hand) ? attackerResult.player.hand as any[] : [];
  if (!payload.consumeCard) {
    return { status: 'rejected', reason: 'ATTACK_REQUIRES_CARD_COST' };
  }
  const consumeId = getRuntimeCardId(payload.consumeCard as any);
  const consumedCard = hand.find(card => getRuntimeCardId(card as any) === consumeId);
  if (!consumeId || !consumedCard) {
    return { status: 'rejected', reason: 'ATTACK_COST_CARD_NOT_IN_HAND' };
  }

  const baseDamage = getAttackValue(attacker, payload.ranged, {
    ledger: state.statModifiers,
    target: { playerId: action.playerId, generalId: String(payload.attackerId) },
  });
  const common = {
    attackerPlayerId: action.playerId,
    attackerId: payload.attackerId,
    targetId: payload.targetId,
    ranged: payload.ranged,
    consumeCard: consumedCard,
    baseDamage,
  };

  const targetBaseMatch = /^base_(\d+)$/.exec(String(payload.targetId));
  if (targetBaseMatch) {
    const targetPlayerId = Number(targetBaseMatch[1]);
    const targetPlayer = state.players.find(player => player.id === targetPlayerId);
    if (!targetPlayer || targetPlayer.isAlive === false || !canTargetBase(attacker, targetPlayerId, action.playerId, payload.ranged)) {
      return { status: 'rejected', reason: 'INVALID_ATTACK_TARGET' };
    }
    return { ...common, status: 'aimed', isBase: true, targetPlayerId, targetGeneral: null };
  }

  const targetResult = findFieldGeneral(state, payload.targetId);
  if (!targetResult || targetResult.player.id === action.playerId || targetResult.player.isAlive === false) {
    return { status: 'rejected', reason: 'INVALID_ATTACK_TARGET' };
  }
  if (getRuntimeCardId(targetResult.general?.general as any) === String(payload.attackerId)) {
    return { status: 'rejected', reason: 'CANNOT_ATTACK_SELF' };
  }
  if (!isAttackInRange(attacker, targetResult.general, payload.ranged)) {
    return { status: 'rejected', reason: 'TARGET_OUT_OF_RANGE' };
  }
  return {
    ...common,
    status: 'aimed',
    isBase: false,
    targetPlayerId: targetResult.player.id,
    targetGeneral: targetResult.general,
  };
}

/** declare 那一拍的载荷：只记下"这一刀瞄上了谁"，伤害数字还没算死。
 *  键与 2.3.0 以来逐字相同（`targetPlayerId` 只有打将领那一型带着）。 */
function declareNotice(
  aim: Extract<AttackAim, { status: 'aimed' }>,
  action: GameAction,
): Record<string, unknown> {
  return {
    action,
    attackerId: aim.attackerId,
    targetId: aim.targetId,
    ranged: aim.ranged,
    baseDamage: aim.baseDamage,
    ...(aim.isBase ? {} : { targetPlayerId: aim.targetPlayerId }),
  };
}

/**
 * 延后标记（只有真要延后的那一拍才带）：
 *  - `attackStage:'declare'`＝"这一刀还没落，等受击那一层走完"；
 *  - `attackKey`＝同一场续跑的配对键（与决斗的 `duelKey` 同一手法：纯 from 状态与
 *    载荷、零随机；续跑扫描据此去重，绝不把同一刀落两次）。
 */
function declareKey(state: EngineState, aim: Extract<AttackAim, { status: 'aimed' }>): string {
  return `at:${state.turn ?? 0}:${state.round ?? 0}:${aim.attackerId}>${aim.targetId}`;
}

/**
 * damage 那一拍：这一刀的实际伤害、死亡、后序那一声。
 * 算术自 2.3.0 以来一字未动，只是**什么时候算**由受击那一层说了算。
 */
function damagePhase(state: EngineState, aim: Extract<AttackAim, { status: 'aimed' }>, action: GameAction): GameEvent[] {
  if (aim.isBase) {
    // 营地单次最多 1 点＝发射点的规则常量（`core/baseDamage.ts`），技能伤害那条
    // 发射路（`SkillTriggerBridge`）取的是同一个数。
    const damage = capDamageToBase(aim.baseDamage);
    return [
      {
        type: 'DAMAGE',
        data: {
          sourcePlayerId: aim.attackerPlayerId,
          sourceGeneralId: aim.attackerId,
          targetPlayerId: aim.targetPlayerId,
          target: aim.targetId,
          targetId: aim.targetId,
          damageType: 'attack',
          value: damage,
          hpLost: damage,
          armorLost: 0,
          consumeCard: aim.consumeCard,
          attackerId: aim.attackerId,
          ranged: aim.ranged,
          isBase: true,
        },
      },
      { type: 'ATTACK_RESOLVED', data: { action, attackerId: aim.attackerId, targetId: aim.targetId, ranged: aim.ranged, damage } },
      { type: 'AFTER_DAMAGE', data: { action, targetId: aim.targetId, value: damage } },
    ];
  }

  // 2.8 刀5：护甲**之前**先过"受到的伤害"那一格（`core/damageTaken.ts`＝唯一算术）。
  // 账本为空时它逐字返回原数⇒今日所有对局的事件流与接线前逐字相同。
  const taken = resolveDamageTaken(
    state.statModifiers,
    { playerId: aim.targetPlayerId, generalId: String(aim.targetId) },
    aim.baseDamage,
  );
  const target = aim.targetGeneral;
  const armorResult = applyArmorDamage(
    Number(target?.currentHp ?? 0),
    Number(target?.currentArmor ?? 0),
    taken.damage,
  );
  const defeated = armorResult.hp <= 0;
  const attachedArmor = Array.isArray(target?.armorCards) ? target.armorCards as any[] : [];
  const destroyedArmorCardIds = attachedArmor
    .slice(0, armorResult.armorLost)
    .map(card => getRuntimeCardId(card as any))
    .filter(Boolean);

  const events: GameEvent[] = [
    {
      type: 'DAMAGE',
      data: {
        sourcePlayerId: aim.attackerPlayerId,
        sourceGeneralId: aim.attackerId,
        targetPlayerId: aim.targetPlayerId,
        target: aim.targetId,
        targetId: aim.targetId,
        damageType: 'attack',
        value: aim.baseDamage,
        // 护甲之前那一格的读数（账本为空时＝`value`）：显示层/探针用它，算术不回头读它。
        damageTaken: taken.damage,
        hpLost: armorResult.hpLost,
        armorLost: armorResult.armorLost,
        actualDamage: armorResult.actualDamage,
        newHp: armorResult.hp,
        newArmor: armorResult.armor,
        destroyedArmorCardIds,
        consumeCard: aim.consumeCard,
        attackerId: aim.attackerId,
        ranged: aim.ranged,
        defeated,
      },
    },
  ];

  // 一次性「受到的伤害」账被这一刀用掉了⇒当场销账（canonical `STAT_MODIFY`，与在场
  // 落笔／生命周期收账同一个入口；DAMAGE 处理器自己不碰账本）。位置紧跟这一"刀"，
  // 因为决斗那一整块要逐轮线程同一本账——销账晚一轮＝同一笔账用两次。
  if (taken.consumedIds.length > 0) {
    events.push({
      type: 'STAT_MODIFY',
      data: { op: 'REMOVE', ids: taken.consumedIds, cause: 'DAMAGE_TAKEN' },
    });
  }

  if (defeated) {
    events.push({
      type: 'DEATH',
      data: {
        targetPlayerId: aim.targetPlayerId,
        targetId: aim.targetId,
        attackerPlayerId: aim.attackerPlayerId,
        attackerId: aim.attackerId,
      },
    });
  }

  events.push({ type: 'ATTACK_RESOLVED', data: { action, attackerId: aim.attackerId, targetId: aim.targetId, ranged: aim.ranged, damage: armorResult.hpLost + armorResult.armorLost, defeated } });
  events.push({ type: 'AFTER_DAMAGE', data: { action, targetId: aim.targetId, value: aim.baseDamage } });
  return events;
}

function rejected(action: GameAction, reason: string): GameEvent {
  return { type: 'ACTION_REJECTED', data: { action, reason } };
}

/**
 * 一次攻击的**正身入口**（`AttackResolver` 唯一调用点）：
 *  ‧ 瞄不上＝`ACTION_REJECTED`，理由与 2.3.0 以来逐字相同；
 *  ‧ 受击那一层没人听＝两拍一次走完（`BEFORE_DAMAGE` 紧跟 `DAMAGE`，事件流逐字不变）；
 *  ‧ 有人听＝**只发 declare 那一拍**，`damage` 那一拍由 `core/TransitionCore` 的续跑环
 *    在受击那一层走完后发（自动路＝同一趟之内；问人路＝答复落账之后）。
 */
export function resolveAttackBlow(state: EngineState, action: GameAction): GameEvent[] {
  const aim = aimAttack(state, action as GameAction<AttackPayload>);
  if (aim.status === 'rejected') return [rejected(action, aim.reason)];

  const noticeData = declareNotice(aim, action);
  const notice: GameEvent = { type: 'BEFORE_DAMAGE', data: noticeData };
  if (!hasReactionListeners(state, notice)) return [notice, ...damagePhase(state, aim, action)];
  return [{ type: 'BEFORE_DAMAGE', data: { ...noticeData, attackStage: 'declare', attackKey: declareKey(state, aim) } }];
}

/**
 * 延后那一拍的**续跑**（`core/TransitionCore` 唯一调用点）：重新瞄一次，
 * 读的是受击那一层走完之后的状态。瞄不上＝这一刀不成立⇒**返回空数组、一个事件都不造**
 * （甲案：出手的那位已经被反伤扎死⇒他这一刀跟着取消；挨打的那位不在场了同理）。
 */
export function resumeAttackBlow(state: EngineState, action: GameAction): GameEvent[] {
  const aim = aimAttack(state, action as GameAction<AttackPayload>);
  if (aim.status === 'rejected') return [];
  return damagePhase(state, aim, action);
}
