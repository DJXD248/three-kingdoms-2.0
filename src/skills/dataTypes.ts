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
  /** v2.9.14 营地刀：这一席的**营地**真的掉血了才响。它和 `onDamageTaken` 听的是
   *  同一声 `INJURY`（那一声只在血量真实下降时才发，所以"只有掉血才算受到伤害"
   *  在两侧都是结构性成立）；分开靠的是那一声里的 `isBase` 那一格，不造第二份事件。
   *  判据与两族的分界写在 `skillEventMatch.ts`。 */
  | 'onBaseDamaged'
  /** v2.9.19 营地两格刀·第一格：这一席的**营地被普攻瞄上了**（伤害还没落）。
   *  听的是普攻 declare 那一拍（`core/attackBlow.ts`）——与将领那格「成为目标时」
   *  同一条 `BEFORE_DAMAGE`，分家靠载荷里的 `isBase`，不造第二种事件。
   *  席位归属（"打的是哪家营地"）读的是「我听谁」那五档里的**同一个谓词**
   *  （判据与五档在营地这一身怎么折，全写在 `skillEventMatch.ts`）。 */
  | 'onBaseTargetedAtk'
  /** v2.9.19 营地两格刀·第二格：这一席的**营地被技能瞄上了**（伤害还没落）。
   *  听的是技能要打营地时新补的那一声纯通知（`SkillTriggerBridge`），载荷里
   *  `damageType:'skill'`；与上一格的分界因此也是**同一条已有的一维**，不是新轴。
   *  已知边界（本轮如实登记）：这一声不在普攻那套"延后结算"机制里，所以没打
   *  「强制发动」的这一格要到那笔伤害落完才被问到。 */
  | 'onBaseTargetedSkill'
  /** v2.9.15 乙档刀（「别人使用技能时」）：除自身那一员以外的任何一员将**发动了一次
   *  技能**。听的是 `SKILL_ACTIVATED`（v2.9.15 起三条发动路每次真发动都出这一声；
   *  以前只有带"一局一次"额度的定义才出声＝这一格接不上电的根因）。
   *  两件事写在 `skillEventMatch.ts`：①"什么算别人"读的是「我听谁」五档里 `others`
   *  那一档的**同一个联合谓词**，不另写一份；②带着 `viaActivation` 的那一身不听＝
   *  由这一格引起的发动不再触发这一格（防两员同类将互相喂到牌堆抽干）。
   *  名字里的"其他将领"已经把听谁说清了⇒它**不认**「我听谁」那一栏（界面对它不出现，
   *  判据同 `onBaseDamaged`）。 */
  | 'onOtherSkillActivated'
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
  | 'MODIFY_STAT'
  /** 2.9.3 刀A（#25 之后的新原语）：**改卡面**——给那一员将的卡面技能清单添上一枚技能。
   *  与 MODIFY_STAT 恰好互补：那个只动账本、卡面一个字不改；这个只动卡面（技能清单）、
   *  不预写任何账。名字解析唯一的落点在 `skills/skillNameIndex.ts`（＝查技能表），
   *  编译器查不到就点名跳过；结算点=`core/eventProcessors/generalEvents.ts` 的
   *  `applySkillGainedEvent` 往 `fg.general.skills` 追加（同名不重复落，幂等），
   *  于是下一次重编译就听得见这枚新技能。 */
  | 'GAIN_SKILL';

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
  ListenerScope,
} from '../data/generals';
import type { SkillCondition, ListenerScope } from '../data/generals';

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
  duration?: import('../data/generals').StatModifierDurationType;
  /**
   * 仅 MODIFY_STAT＋钥匙 `DAMAGE_DEALT`：这笔「造成的伤害」账在哪个场合才算数。
   * 录入面与 Excel 今天都没有这一格（它是纯机器侧的东西，见
   * `core/statModifiers.ts::DamageDealtOccasion`），所以这个键**只在真填了时才出现**
   * ——编译产物会进事件流与账本，多一个 `occasion: undefined` 就是逐字节比对的雷。
   */
  occasion?: import('../data/generals').DamageDealtOccasionType;
  /** 仅 GAIN_SKILL：卡上写的那个技能名（录入原样，用于展示与点名）。 */
  skillName?: string;
  /**
   * 仅 GAIN_SKILL：编译器**解析后的那枚技能**（`skillName` 的解析影子）。解析点全库
   * 只有一处＝`skillCompiler.toEffectData` 经 `skills/skillNameIndex.ts` 查技能表；
   * 桥接层与结算侧读的都是这一份，因此不可能出现"编译时认得、发动时不认得"。
   * 解析不出来的名字根本走不到这里——它在编译器就变成一条 `skipped` 了。
   */
  gainedSkill?: import('../data/generals').Skill;
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
   *  手牌／回合开始这类事件本来就挂在玩家身上，那里 `self` 与 `allySeat` 同义。
   *  v2.9.13（甲档）再起两档：`'others'`＝除自身那一员以外、`'enemySeat'`＝别的
   *  席位。词表与判据各只有一份（`data/generals.ts` 的标签表＋
   *  `skills/skillEventMatch.ts` 的联合谓词），这里不再抄字面量。 */
  listenerScope?: ListenerScope;
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
   * **强制发动**（v2.8.22 立、v2.9.16 询问制刀升为全局开关）：满足门槛即自动发动、
   * **任何时机都不停下来问人**。录入面 `Skill.forced` 早就存在（2.4 内容量产），但
   * 结算侧零消费＝"记录而未消费"（§12-55）——v2.8.22 起它是受击／受伤两型的分流开关，
   * v2.9.16（用户 2026-10-20 裁「在场即生效和强制发动不问」）起它是**唯一的**不问开关：
   * 除 `passive`（人在就算，没有"要不要发动"可问）以外，其余每一型到点都要问，
   * 只有打了这一位的定义照旧自动结算。
   * 消费点单点＝`SkillTriggerBridge.defersToReactionQueue`（问答路与自动路同读它）。
   */
  forced?: boolean;
  /**
   * v2.8 刀4（#25）在场即生效的那一型。只在 `trigger==='passive'` 时由编译器落
   * `true`（缺省＝不写这个键，与 v2.8.25 之前的定义逐字同形——同一手"只在真为
   * true 时落键"的写法，为的是不改动任何既有编译产物的键集合）。
   * v2.9.16 询问制刀：这一型**永远不问**（用户 2026-10-20 裁「在场即生效……不问」）
   * ——它不是一次发动，没有"要不要发动"可问；分流开关点名认它，不靠它恰好不在
   * 事件面上这一事实。
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
   * v2.8.32 限定技额度刀·「一局一次」额度的**身份键**（存在＝这枚技能挂着限定技徽章，
   * 值＝`<将领实例>:<技能名>`）。三个要点：
   *  - **按技能计，不按编译定义计**：一枚技能编出多个定义（多效果、不同时机）时它们
   *    共用同一个键，用掉一次整枚技能就见底（用户 2026-10-04 裁决①：每枚技能各一局
   *    一次，一个将两枚限定技就能各用一次）。
   *  - 只在带徽章时落键，其余定义一个键都不多＝既有编译产物逐字不变。
   *  - `passive`（在场即生效）那一型**不落**：持续生效没有"发动一次"这个时刻，额度无
   *    处可消，落键只会假装管住了它。
   * 唯一消费点＝`skills/skillQuota.ts`（判定）＋同文件的 `skillActivatedEvent`（记账）。
   */
  limitKey?: string;
  /**
   * 2.9.3 刀B·「觉醒技」徽章编进定义后的那一枚记录位。编译器从 `tagsOf(skill)` 里认
   * 「觉醒技」，只在这一枚真的编出了定义时落键（其余定义的键集合逐字不变＝两个锚池不动）。
   *  ① 额度：与限定技共用 `limitKey` 那同一本账（用户 2026-10-08 裁「觉醒技和限定技同理，
   *    在同一局中发动过一次就不能再发动」）；真正被结算读的是那一把键，消费点＝
   *    `skills/skillQuota.ts`。
   *  ② 发动方式：v2.9.3 刀B 时它是"除受击／受伤以外第二族要停下来问人的定义"，**v2.9.16
   *    询问制刀起这一位不再参与分流**——问不问只由「强制发动」与「在场即生效」两个徽章
   *    决定（用户 2026-10-20 补裁：「勾选了强制发动的觉醒技不问」），觉醒技听的那一声
   *    和其余每一型一样走同一个开关＝`SkillTriggerBridge.defersToReactionQueue`。
   *    「当场问」那条 2026-10-08 补充裁定（不是拖到回合结束）由"每一型都当场问"这一
   *    普遍规则涵盖，无需本位再出力。
   * 所以今天这一位是**编译器的自证记录**（测试按它钉徽章→定义的映射），不是结算判据。
   */
  awakening?: boolean;
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
  /**
   * v2.8 链式刀·「若…则」：effects 按定义顺序执行，**前一个效果产出了有效事件（有真实目标且不为空操作）
   * 时，后续效果才翻译；前一个失败 ⇒ 从这一位开始全部丢弃**。
   * 缺省 (=undefined) = 逐字不变——所有效果同时翻译、互不干扰。只在编译面落 true 才生效。 */
  effectChain?: boolean;
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
