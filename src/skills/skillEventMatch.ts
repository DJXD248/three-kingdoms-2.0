import type { DataSkillTrigger } from './dataTypes';
import type { GameEvent } from '../core/Event';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import type { SkillOwnerBinding } from './SkillTriggerBridge';
/**
 * 「这件事是不是发生在我（或我听的那个人）身上」——**唯一**一份实现。
 *
 * 两个消费方必须逐字同意，否则会出现"触发链里响了、问答队列里没候选"（或反
 * 过来）这种最难查的分叉：
 *   ① `SkillTriggerBridge.buildCondition`＝触发链上的自动发动路（forced 与
 *      其余全部触发型走这里）；
 *   ② `skills/reactionChain.ts`＝响应链问答的候选枚举（受击／受伤两型走这里）。
 *
 * 本文件从 `SkillTriggerBridge.ts` 原样搬出（v2.8.22 响应链执法刀），**一条判
 * 定都没改**：三档「我听谁」（self／allySeat／field）、来源两档（攻击／技能）、
 * `damageTypeFilter`、`cardFilter` 的 via/remainingHand 事实读法全部逐字。
 * 门槛谓词（`conditions`）不在这里——它要读 state，由两个消费方各自在同一点
 * 之后调用同一个 `evaluateSkillConditions`（先身份、再门槛，顺序也不变）。
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function idEq(ownerId: number | string, candidate: unknown): boolean {
  return candidate !== undefined && candidate !== null && String(candidate) === String(ownerId);
}

/** 某型监听听得懂的那一声事件（缺省＝这型根本不在触发面上，绝不响）。 */

export function matchesSkillEvent(
  trigger: DataSkillTrigger,
  binding: SkillOwnerBinding,
  event: GameEvent,
): boolean {
  const { ownerId, skill } = binding;
  const generalId = skill.sourceGeneralId;
  const damageFilter = skill.damageTypeFilter;
  // v2.8.21 监听扩面刀：两维的缺省值都必须等于扩面前的逐字行为——
  // 不听别人的事（self）、只听攻击引起的目标（attack）。
  const scope = skill.listenerScope ?? 'self';
  const targetSource = skill.targetSource ?? 'attack';

  /** 「我听谁」的玩家那一层。`field` 档不比玩家键，但**事件必须带着这个键**：
   *  缺键＝这件事根本没落到某一位玩家身上（打本营的 BEFORE_DAMAGE 就是这种），
   *  那是"没有受击者"，不是"受击者不是我"⇒ 三档都不响。这条保住了扩面前
   *  "打本营不会触发将领的受击类技能"那一既有事实。 */
  const playerMatches = (playerKey: unknown): boolean =>
    scope === 'field'
      ? playerKey !== undefined && playerKey !== null
      : idEq(ownerId, playerKey);

  /** 「我听谁」的将领那一层：只有 `self` 档认这一层（扩面门的严格写法——
   *  知道将Id 时键必须对得上，缺键＝对不上＝不响）。手牌／回合开始这类事件的键
   *  本来就只有玩家一维（将领不持牌），那里 `self` 与 `allySeat` 是同一件事。 */
  const generalMatches = (generalKey: unknown): boolean =>
    scope !== 'self' || !generalId || idEq(generalId, generalKey);

  /** 「这事是谁引起的」（v2.8.21 第二维）：读通知事件**已经记下**的那个字段，
   *  不在这里重新推断伤害数学。缺 `damageType`＝攻击结算那一条路（今日
   *  `BEFORE_DAMAGE` 的唯一生产者=`AttackResolver`，它不带这个字段）⇒ 记为攻击
   *  引起。技能指定目标的那一档由 #70/#71 的发射器显式带 `damageType:'skill'`。 */
  const sourceMatches = (data: Record<string, unknown>): boolean => {
    if (targetSource === 'any') return true;
    const kind = data.damageType === 'skill' ? 'skill' : 'attack';
    return kind === targetSource;
  };

  const data = asRecord(event.data);
  switch (trigger) {
    case 'onTurnStart':
      return playerMatches(data.playerId);
    case 'onDeploy': {
      if (!playerMatches(data.playerId)) return false;
      if (generalId && scope === 'self') {
        const deployedId = data.general && typeof data.general === 'object'
          ? getRuntimeCardId(data.general as never)
          : data.general === undefined ? '' : String(data.general);
        if (deployedId && deployedId !== String(generalId)) return false;
      }
      return true;
    }
    case 'onDamageTaken': {
      if (!playerMatches(data.targetPlayerId)) return false;
      if (!generalMatches(data.targetId ?? data.target)) return false;
      if (damageFilter && data.damageType !== damageFilter) return false;
      return true;
    }
    case 'onDamageDealt': {
      const action = asRecord(data.action);
      if (!playerMatches(action.playerId)) return false;
      if (generalId) {
        const payload = asRecord(action.payload);
        if (!generalMatches(payload.attackerId ?? action.attackerId)) return false;
      }
      // AFTER_DAMAGE is currently emitted only by attack resolution, so a
      // skill-damage filter can never match here (documented engine fact).
      if (damageFilter === 'skill') return false;
      if (damageFilter === 'attack' && data.damageType !== undefined && data.damageType !== 'attack') return false;
      return true;
    }
    case 'onKill': {
      if (!playerMatches(data.attackerPlayerId)) return false;
      if (!generalMatches(data.attackerId)) return false;
      return true;
    }
    case 'onDeath': {
      // v2.8 刀4（#25）归零之死分流：体力上限被截到 0 那一类**不响遗言**（用户裁决
      // 第 11 条后半）。同一条 DEATH 上"自家补抽 1"照走（那是派生侧的补偿抽，与本
      // 判断无关）、"不记击杀"照走（那条事件的 `attackerPlayerId` 是 null，上面的
      // `onKill` 分支永远键不上）。
      if (data.deathCause === 'MAX_HP_ZERO') return false;
      if (!playerMatches(data.targetPlayerId)) return false;
      if (!generalMatches(data.targetId)) return false;
      return true;
    }
    case 'onBecomingTarget': {
      // BEFORE_DAMAGE for a base attack carries no targetPlayerId, so the
      // owner check below legitimately never matches — being attacked as a
      // base is not "a general becoming a target"（`field` 档同样不响：那里
      // 缺的是"受击者"这个人，不是"受击者不是我"）。
      if (!playerMatches(data.targetPlayerId)) return false;
      if (!generalMatches(data.targetId ?? data.target)) return false;
      return sourceMatches(data);
    }
    case 'onCardLost':
    case 'onCardGained': {
      // Hands live on players, not general instances (same keying lesson
      // as DISCARD, 2.5.0): CARD_* keys the losing/gaining PLAYER only.
      // sourceGeneralId never narrows these triggers.
      if (!playerMatches(data.playerId)) return false;
      if (trigger === 'onCardLost' && skill.cardFilter && skill.cardFilter !== 'any') {
        // v2.6.2 emission-source predicates. The via/remainingHand facts
        // are recorded by the derivation itself (chainedConsequences), so the
        // condition reads settled truth rather than re-deriving it.
        const via = typeof data.via === 'string' ? data.via : '';
        if (skill.cardFilter === 'equipment') return via === 'EQUIP';
        if (!via || via === 'EQUIP') return false;
        if (skill.cardFilter === 'lastHand') {
          return typeof data.remainingHand === 'number' && data.remainingHand === 0;
        }
      }
      return true;
    }
    default:
      return false;
  }
}
