import type { DataSkillTrigger } from './dataTypes';
import type { GameEvent } from '../core/Event';
import type { ListenerScope } from '../data/generals';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import type { SkillOwnerBinding } from './SkillTriggerBridge';
/**
 * 「这件事是不是发生在我（或我听的那个人）身上」——**唯一**一份实现。
 *
 * 两个消费方必须逐字同意，否则会出现"触发链里响了、问答队列里没候选"（或反
 * 过来）这种最难查的分叉：
 *   ① `SkillTriggerBridge.buildCondition`＝触发链上的自动发动路（只有打了「强制
 *      发动」的定义走这里，v2.9.16 询问制刀）；
 *   ② `skills/reactionChain.ts`＝响应链问答的候选枚举（其余每一型都走这里）。
 *
 * 本文件从 `SkillTriggerBridge.ts` 原样搬出（v2.8.22 响应链执法刀），搬出时**一条
 * 判定都没改**。「我听谁」过去三档（self／allySeat／field），v2.9.13 按需池甲档
 * 扩到五档（补 others／enemySeat）；来源两档（攻击／技能）、
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

  const data = asRecord(event.data);
  /** 某一维的键在不在。缺键的读法各档不同（见上面两段注释），这里只回答"有没有记这一维"。 */
  const hasKey = (key: unknown): boolean => key !== undefined && key !== null;

  /** 「我听谁」的玩家那一层。**档位是参数**：绝大多数时机读定义自己那一档（`scope`），
   *  而「其他将领技能发动时」（v2.9.15）把档位**钉死**成 `others` 传进来——它的名号已经
   *  替玩家选好了听谁，绝不允许再为它另抄一份"什么算别人"。
   *  `field`／`others` 档不比玩家键，但**事件必须带着这个键**：
   *  缺键＝这件事根本没落到某一位玩家身上（v2.9.19 之前"打营地"的那一声就是这种，
   *  所以那一身所有档都不响），那是"没有受击者"，不是"受击者不是我"。
   *  `enemySeat`（敌方角色＝己方玩家外的所有玩家）同样在这一层判：键必须在，
   *  而且必须**不是**我的席位。 */
  const playerMatchesFor = (who: ListenerScope, playerKey: unknown): boolean => {
    const has = hasKey(playerKey);
    switch (who) {
      case 'field':
      case 'others':
        // `others` 的"除自身以外"要连将领那一维一起看，故这里只要求有玩家键，
        // 剩下那一刀在 `generalMatchesFor` 里补（两维分开判会漏掉"同席别的将"这一类）。
        return has;
      case 'enemySeat':
        return has && !idEq(ownerId, playerKey);
      default:
        return idEq(ownerId, playerKey);
    }
  };

  /** 「我听谁」的将领那一层（同样按参数取档，理由见上面那一段）。
   *  `self`：只有认这一层的档（扩面前的逐字行为——知道将Id 时键必须对得上，
   *  缺键＝对不上＝不响）。
   *  `others`（其他角色＝自身以外）＝**席位与将领两维的联合判据**：别的席位那一员
   *  必然不是"我这一员"⇒ 响；同一席位要认将的键——看得见是哪一员、且不是我这员
   *  才算"其他角色"，缺将键或技能本身说不出自己是哪一员＝说不清⇒不响（fail-closed，
   *  与 `self` 档同一口径，绝不把"不知道"读成"是别人"）。
   *  `allySeat`／`enemySeat`／`field`：这一层不比（扩面前 `scope !== 'self'` 就放行，
   *  一字未动）。手牌／回合这类事件的键本来就只有玩家一维（将领不持牌）。 */
  const generalMatchesFor = (who: ListenerScope, generalKey: unknown, playerKey: unknown): boolean => {
    if (who === 'self') return !generalId || idEq(generalId, generalKey);
    if (who === 'others') {
      if (!hasKey(playerKey)) return false;
      if (!idEq(ownerId, playerKey)) return true;
      if (!generalId) return false;
      return hasKey(generalKey) && !idEq(generalId, generalKey);
    }
    return true;
  };

  const playerMatches = (playerKey: unknown): boolean => playerMatchesFor(scope, playerKey);
  const generalMatches = (generalKey: unknown, playerKey: unknown): boolean =>
    generalMatchesFor(scope, generalKey, playerKey);

  /** 「这事是谁引起的」那一维的**唯一**读法（v2.8.21 第二维）：读通知事件**已经记下**
   *  的那个字段，不在这里重新推断伤害数学。缺 `damageType`＝普攻那一刀（`core/attackBlow.ts`
   *  的 declare 那一拍是唯一不带这个字段的生产者）⇒ 记为攻击引起。
   *  技能指定目标的那一档由 #70/#71 的发射器与 v2.9.19 营地那一拍显式带 `damageType:'skill'`。 */
  const sourceKindOf = (eventData: Record<string, unknown>): 'attack' | 'skill' =>
    eventData.damageType === 'skill' ? 'skill' : 'attack';

  const sourceMatches = (eventData: Record<string, unknown>): boolean => {
    if (targetSource === 'any') return true;
    return sourceKindOf(eventData) === targetSource;
  };

  switch (trigger) {
    case 'onTurnStart':
      return playerMatches(data.playerId);
    case 'onDeploy': {
      const deployedId = data.general && typeof data.general === 'object'
        ? getRuntimeCardId(data.general as never)
        : data.general === undefined ? '' : String(data.general);
      if (!playerMatches(data.playerId)) return false;
      if (scope === 'self') {
        // 逐字照旧：`self` 认将这一层，但**缺将键＝放行**（扩面前的写法就是
        // `if (deployedId && deployedId !== …)`）；本刀不碰这一档。
        if (generalId && deployedId && deployedId !== String(generalId)) return false;
        return true;
      }
      // `others` 在这一档才有活干（同席位别的将登场也算）；`allySeat`／`enemySeat`／
      // `field` 的将层不比，与扩面前"非 self 一律放行"逐字一致。
      return generalMatches(deployedId || undefined, data.playerId);
    }
    case 'onDamageTaken': {
      // v2.9.14 营地刀的分界（§12-130）：营地掉血那一身**不是**任何一员将受到伤害。
      // 扩面前这条靠"将键对不上"天然挡住（`base_2` 不等于任何一枚将），但 `others`
      // ／`field`／`enemySeat` 这几档不比将那一层，于是营地那一身会顺着席位层混进来
      // ⇒ 本轮把 `isBase` 显式挡掉，让「受到伤害后」只管人、营地交给新那一格。
      if (data.isBase === true) return false;
      if (!playerMatches(data.targetPlayerId)) return false;
      if (!generalMatches(data.targetId ?? data.target, data.targetPlayerId)) return false;
      if (damageFilter && data.damageType !== damageFilter) return false;
      return true;
    }
    case 'onBaseDamaged': {
      // 营地这一格没有将领层，也**不认**「我听谁」：`supportsListenerScope` 对它＝false
      // （界面上那格下拉压根不出现），编译器另有一道点名拒绝兜住从 Excel／旧存档
      // 塞进来的值（`TRIGGER_SUBTYPE_UNSUPPORTED`）。所以这里只认自家席位的那一声。
      if (data.isBase !== true) return false;
      if (!idEq(ownerId, data.targetPlayerId)) return false;
      if (damageFilter && data.damageType !== damageFilter) return false;
      return true;
    }
    case 'onBaseTargetedAtk':
    case 'onBaseTargetedSkill': {
      // v2.9.19 营地两格刀。四句话，一句一条判据：
      // ①**只认营地那一身**：`isBase` 与上面「营地受到伤害时」用的是同一个键、同一个
      //   写法（发信侧 `core/attackBlow.ts` 的 declare 那一拍与 `SkillTriggerBridge`
      //   补的那一声各写一次，别无出处）。
      // ②**攻击／技能的分界不另立一维**：读的是 `sourceKindOf` 那一份已有的一维
      //   （v2.8.21 的「这事是谁引起的」），两格各认其中一档。
      // ③**席位归属读「我听谁」那五档里的同一个谓词**（`playerMatchesFor`），不给
      //   "哪家营地"再造第二套定语——这是用户 2026-10-24 那句「选B跟「我听谁」那五档
      //   做成同一根轴」的落点。
      // ④**将领那一层在这一身压根不参判**：营地不是任何一员将，事件里也没有将键。
      //   所以 `self` 认将时那句"缺将键＝对不上"在这里会把自家营地也挡掉，那是错的
      //   ⇒ 营地这一身只走玩家那一层。五档因此折成三档读（与 `generals.ts` 里
      //   "手牌／回合挂在玩家身上，`self` 与 `allySeat` 同义"那条同一族事实）：
      //   `self`／`allySeat`＝自家营地，`enemySeat`＝别家营地，`field`＝任意一家；
      //   `others`＝"除自身以外"在营地这一身只能是**别家**（同席位没有第二家营地），
      //   故折到 `enemySeat` 那一档，不新写任何判据。
      if (data.isBase !== true) return false;
      const wantKind = trigger === 'onBaseTargetedSkill' ? 'skill' : 'attack';
      if (sourceKindOf(data) !== wantKind) return false;
      return playerMatchesFor(scope === 'others' ? 'enemySeat' : scope, data.targetPlayerId);
    }
    case 'onOtherSkillActivated': {
      // v2.9.15 乙档刀（「别人使用技能时」）。三条判据，一条一句：
      // ①**防套娃**：这一声如果是"替这一格而响"的（`viaActivation`＝它本身就是由某声
      //   发动公告引起的发动），这一格闭嘴。少了这一句，两员「别人发动技能我就摸牌」
      //   的将能互相喂到牌堆抽干（引擎侧只有深度 32／链上 256 那种兜底闸，不是判据）。
      // ②**"什么算别人"不另写一份**：档位钉死 `others`，与上一刀（v2.9.13）那五档共用
      //   同一个席位＋将领联合谓词——同席位另一员将也算"别人"（用户 2026-10-18 口径
      //   逐字＝「其他角色＝自身以外」）。
      // ③**说不清是谁的发动不算**：那一身只有座次、说不出哪一员（`generalId` 空）时，
      //   `others` 在同席位上判不成"别的将"⇒ fail-closed，与 `self` 档同一口径。
      // 这一格不认「我听谁」那一栏（`supportsListenerScope` 对它＝false⇒界面上不出现），
      // 从 Excel／旧存档硬塞进来的档位由编译器点名拒绝（`TRIGGER_SUBTYPE_UNSUPPORTED`）。
      if (data.viaActivation === true) return false;
      const actorGeneral = typeof data.generalId === 'string' && data.generalId !== ''
        ? data.generalId
        : undefined;
      if (!playerMatchesFor('others', data.playerId)) return false;
      return generalMatchesFor('others', actorGeneral, data.playerId);
    }
    case 'onDamageDealt': {
      const action = asRecord(data.action);
      if (!playerMatches(action.playerId)) return false;
      // 将层：`self` 档没 generalId 时放行（＝扩面前那个 `if (generalId)` 外壳的
      // 同一句话），`others` 档要看"造成这一下的是不是我这一员"。
      const payload = asRecord(action.payload);
      if (!generalMatches(payload.attackerId ?? action.attackerId, action.playerId)) return false;
      // AFTER_DAMAGE is currently emitted only by attack resolution, so a
      // skill-damage filter can never match here (documented engine fact).
      if (damageFilter === 'skill') return false;
      if (damageFilter === 'attack' && data.damageType !== undefined && data.damageType !== 'attack') return false;
      return true;
    }
    case 'onKill': {
      if (!playerMatches(data.attackerPlayerId)) return false;
      if (!generalMatches(data.attackerId, data.attackerPlayerId)) return false;
      return true;
    }
    case 'onDeath': {
      // v2.8 刀4（#25）归零之死分流：体力上限被截到 0 那一类**不响遗言**（用户裁决
      // 第 11 条后半）。同一条 DEATH 上"自家补抽 1"照走（那是派生侧的补偿抽，与本
      // 判断无关）、"不记击杀"照走（那条事件的 `attackerPlayerId` 是 null，上面的
      // `onKill` 分支永远键不上）。
      if (data.deathCause === 'MAX_HP_ZERO') return false;
      if (!playerMatches(data.targetPlayerId)) return false;
      if (!generalMatches(data.targetId, data.targetPlayerId)) return false;
      return true;
    }
    case 'onBecomingTarget': {
      // v2.9.19 营地两格刀：这一挡与上面「受到伤害后」那句是**同一族**的分工——
      // 营地不是任何一员将⇒"哪一员将成为了目标"这一格压根没有主语可认。
      // 扩面前这一条靠"打营地那一声不带席位键"天然不响；今天那一身**带键了**
      // （营地自己那两格要用），所以判据换成显式挡 `isBase`：既有那条"打营地不触发
      // 将领的成为目标技"的事实一字不动，只是从"缺键所以认不出"变成"认出是营地所以
      // 不响"。
      // 证人分工要说清（撤掉这一挡的实测＝**1 红 / 1 文件**）：`listenerScope.test.ts`
      // 与 `skillPipeline.test.ts` 那两条用的是缺省档`self`，而 `self` 还要比将的键
      // （营地那一身没有将键⇒对不上），所以它们挡这一条的**不是这句**、撤了也照样绿；
      // 真证人＝`campTargetTrigger.test.ts` 里钉 `field`／`others` 两档的那一条。
      if (data.isBase === true) return false;
      if (!playerMatches(data.targetPlayerId)) return false;
      if (!generalMatches(data.targetId ?? data.target, data.targetPlayerId)) return false;
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
