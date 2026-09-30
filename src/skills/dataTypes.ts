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
  | 'onCardGained';

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
  | 'DUEL';

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
