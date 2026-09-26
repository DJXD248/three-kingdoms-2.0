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
  | 'DECK_PLACE';

export interface SkillEffectData {
  type: DataSkillEffectType;
  value?: number;
  target?: 'SELF' | 'ATTACKER' | 'TARGET';
  /** 仅 DECK_PLACE 使用：手牌移到牌堆顶还是底（默认 BOTTOM） */
  dest?: 'TOP' | 'BOTTOM';
  /** v2.6.3 choice 通道：effect 行自带的展示文案（选项 label 的第一来源，
   * 缺省回退技能 description）。编译透传，不参与触发匹配。 */
  description?: string;
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
