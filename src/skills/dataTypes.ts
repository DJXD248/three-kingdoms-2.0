/**
 * Canonical data model for the skill runtime (Phase 5 convergence).
 *
 * The only skill pipeline in this project is:
 *   SkillDefinition → Trigger → Condition → Effect → Event → EngineState
 * implemented by skills/skillCompiler + skills/SkillTriggerBridge and executed
 * inside core/GameEngine (TriggerEngine). Legacy parallel stacks (imperative
 * SkillEngine/EffectResolver and the hardcoded data/skillEffects registry)
 * were removed in the uniqueness convergence pass — do not re-add them.
 */

export type DataSkillTrigger =
  | 'onDeploy'
  | 'onTurnStart'
  | 'onTurnEnd'
  | 'onDamageTaken'
  | 'onDamageDealt'
  | 'onKill'
  | 'onDeath'
  | 'onBecomingTarget'
  | 'onCardLost'
  | 'onCardGained'
  /** v2.8 刀4（#25）在场即生效：它**不是发动**，所以不监听任何事件、不进问窗、
   *  不耗"回合限 1 次"、也不依赖 `forced`。它的账由登场那一刻的
   *  `skills/passiveModifiers.ts` 单点落笔、离场单点销笔（§H5-2 第 3 条）。
   *  刻意不进 `SkillTriggerBridge` 的事件面——`matchesSkillEvent` 对它
   *  `default: return false`，触发链结构上听不懂这一型。 */
  | 'passive';

export type DataSkillEffectType =
  | 'DRAW_CARD'
  | 'DAMAGE'
  | 'HEAL'
  | 'GAIN_ARMOR'
  | 'DISCARD'
  | 'GIVE'
  | 'EQUIP_STRIP'
  | 'REVEAL'
  | 'DECK_PLACE'
  | 'DUEL'
  /** 改一个数字＝往账本落一笔（core/statModifiers.ts），**不改卡面**。 */
  | 'MODIFY_STAT';

/** v2.7.3 自定义条件门槛谓词（§G 建议书第 4 项，十二格表见 ARCH_MAP F 节）。
 * 条件不是事件也不是状态：它只决定"这条监听要不要响"，产零事件、写零状态。
 * v2.8.3（刀 B）起类型本体归数据层（data/generals.ts），因为门槛已经开放录入：
 * SkillEditor 每个效果一个门槛框 + Excel 效果组第 7 列「门槛」。这里只做
 * re-export，消费方（skillConditions / SkillTriggerBridge / turnEndSkills）
 * 的 import 路径一字未动。 */
export type {
  SkillCondition,
  SkillConditionMetric,
  SkillConditionOperator,
  SkillConditionSubject,
} from '../data/generals';
import type { SkillCondition } from '../data/generals';

export interface SkillEffectData {
  type: DataSkillEffectType;
  value?: number;
  target?: 'SELF' | 'ATTACKER' | 'TARGET';
  /** 仅 DECK_PLACE 使用：手牌移到牌堆顶还是底（默认 BOTTOM） */
  dest?: 'TOP' | 'BOTTOM';
  /** v2.6.3 choice 通道：effect 行自带的展示文案（选项 label 的第一来源，
   * 缺省回退技能 description）。编译透传，不参与触发匹配。 */
  description?: string;
  /**
   * v2.8.11 刀2「选择其一」的门槛：**逐项门槛**（整组门槛挂在定义级
   * `DataSkillDefinition.conditions`，两级顺序=先整组后逐项）。只在 choice
   * 路线上被求值——抉择窗据此把不过门槛的分支置灰并注明原因。
   * 非 choice 定义的门槛仍走定义级那一条路（v2.7.3/v2.8.3 行为逐字不变），
   * 编译时单效果定义的 conditions 就是它自己的门槛。
   */
  conditions?: SkillCondition[];
  /** 仅 MODIFY_STAT：改哪个数字／增减还是固定／有效周期。三者缺一即编译器点名跳过。 */
  stat?: import('../data/generals').StatModifierKeyType;
  modifyMode?: import('../data/generals').StatModifyModeType;
  duration?: Exclude<import('../data/generals').ExpireCondition, 'untilDeath' | 'untilLeaveField'>;
}

export interface DataSkillDefinition {
  id: string;
  name: string;
  trigger: DataSkillTrigger;
  description: string;
  effects: SkillEffectData[];
  /**
   * Runtime card-instance id of the general that owns this skill.
   * When present, condition matching narrows from player level to that
   * specific general (e.g. "when THIS general is damaged").
   */
  sourceGeneralId?: string;
  /** Restrict damage triggers to a single damage source category. */
  damageTypeFilter?: 'attack' | 'skill';
  /** v2.8.21 监听扩面刀·来源档（只挂在 `onBecomingTarget` 上）：这一下"被指定为
   *  目标"是攻击引起的还是技能引起的。缺省 `'attack'`＝扩面前的逐字行为（通知
   *  事件今天唯一的生产者是攻击结算），与官方四条＋DIY 夹具那条的描述一致⇒
   *  两个锚池结构上不动。求值点=`SkillTriggerBridge` 的 identityCheck。
   *  如实账：`'skill'`／`'any'` 两档**今日无发射器**（技能指定目标不发通知），
   *  发射器在 #70/#71——本刀交付的是"读得到、且只按记录的事实判"的消费面。 */
  targetSource?: 'attack' | 'skill' | 'any';
  /** v2.8.21 监听扩面刀·「我听谁」：发生在别人身上的事算不算我的触发。
   *  缺省 `'self'`＝扩面前行为（只认自己身上）。`'allySeat'`＝同一玩家席位的
   *  全部将领（§H9 第七轮②的"己方"＝席位，不是势力）；`'field'`＝全场任一席。
   *  手牌／回合开始这类事件本来就挂在玩家身上，那里 `self` 与 `allySeat` 同义。 */
  listenerScope?: 'self' | 'allySeat' | 'field';
  /** v2.6.2: restrict onCardLost triggers to an emission-source predicate
   * (equipment strip / hand paths with a remainingHand fact / any source).
   * CARD_GAINED has no source variety yet — the filter never narrows it. */
  cardFilter?: 'any' | 'equipment' | 'lastHand' | 'hand';
  /** Source SkillEffect id, kept for the explicit-activation path (2.3.1:
   * ACTIVATE_SKILL addresses a definition as generalId + skillName + effectId
   * so the payload stays human-readable and stable across recompiles). */
  effectId?: string;
  /** onTurnStart/onTurnEnd sub-timing carried through compilation (2.3.1):
   * the turn-end ask window only offers selfTurn candidates. */
  turnSubType?: 'selfTurn' | 'otherTurn';
  /** v2.6.3 choice 通道：源技能 effectMode==='choice'（选择其一）且同触发
   * 签名下有 ≥2 个带 runtime 的效果时，编译成一张多效果定义——触发时由
   * SkillTriggerBridge 译成 CHOICE_REQUIRED（options=effects 逐项），玩家经
   * canonical CHOOSE_OPTION 择定后才结算。孤效果照常走独立定义（零开销）。 */
  choiceMode?: boolean;
  /** v2.7.3 自定义条件门槛谓词（AND 语义：全部成立才响）。缺省=undefined
   *  ⇒ v2.7.2 之前的行为逐字不变。求值=skills/skillConditions.ts 单点纯函数，
   *  触发路与 ACTIVATE_SKILL 决策路消费同一实现。 */
  conditions?: SkillCondition[];
  /**
   * v2.8.22 响应链执法刀·**强制发动**（§H9 第九轮 a/c 三类分流的第二档）：
   * 满足门槛即自动发动、不进问答队列。录入面 `Skill.forced` 早就存在（2.4 内容
   * 量产），但结算侧零消费＝"记录而未消费"（§12-55）——本刀起它成为**唯一的
   * 自动发动开关**：受击/受伤两型（`onBecomingTarget`／`onDamageTaken`）的非
   * forced 定义搬到响应链问答（人和 AI 同一队列、同一扇窗），forced 定义与
   * 其余全部触发型照旧自动结算，逐字不变。
   * 消费点单点=`skills/reactionChain.ts` 的 `isReactionTrigger`＋`autoFires`。
   */
  forced?: boolean;
  /**
   * v2.8 刀4（#25）在场即生效的那一型。只在 `trigger==='passive'` 时由编译器落
   * `true`（缺省＝不写这个键，与 v2.8.25 之前的定义逐字同形——同一手"只在真为
   * true 时落键"的写法，为的是不改动任何既有编译产物的键集合）。
   */
  passive?: boolean;
  /**
   * v2.8 刀4（#25）**锁定技徽章第一次被结算读到**：编译器从 `tagsOf(skill)` 里
   * 认「锁定技」，且**只在这条定义真的会往账本上落笔时**（含 MODIFY_STAT 效果）
   * 才落键——其余定义一个键都不多，既有编译产物逐字不变。唯一的消费方是修正器
   * 账本：锁定技那笔 `locked:true`，别的技能移不走它（全库唯一的"移走别人的账"
   * 入口 `statModifiers.revokeModifier` 拒掉）。徽章语义本身（"不能被无效、不能
   * 被改变"）在其余结算路上今天仍然无人读——账本是目前唯一一处它管得着的地方。
   */
  locked?: boolean;
  /**
   * v2.7.2 choice 生产者面（GPT 三检 Q5 最小验证刀）：候选从哪里枚举。
   * 缺省（undefined）=v2.6.3 行为=逐效果预译分支，一字未动。
   * 'TARGET' = 场上将领候选（模板效果逐候选填 targetId）；
   * 'HAND_CARD' = 欠债玩家手牌候选（模板效果逐候选填 cardKeys）。
   * 只在编译模型层：数据层 Skill 类型 / SkillEditor / Excel 效果列组均无录入面，
   * 唯一入口是 engine.registerPlayerSkills（"接线≠可配"第四次预防针）。
   */
  choiceSource?: 'TARGET' | 'HAND_CARD';
  /** choiceSource='TARGET' 的候选域，缺省 ENEMY_FIELD（以技能拥有者为轴）。 */
  choiceTargetScope?: 'ENEMY_FIELD' | 'ALL_FIELD' | 'SELF_FIELD';
}

/**
 * UI notification emitted when a skill activates (toast channel in the store).
 * Formerly lived in data/skillEffects.ts (legacy); moved here as part of the
 * skill-system uniqueness convergence.
 */
export interface SkillActivation {
  id: string;
  generalName: string;
  skillName: string;
  message: string;
  color: string;
  timestamp: number;
}
