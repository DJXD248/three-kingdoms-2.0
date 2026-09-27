// 三国杀界限突破·标准包武将 + 晋势力武将
// 将领体力上限3点及以下为文将，4点及以上为武将
// 武将默认近战攻击力2远程攻击力1，文将默认近战攻击力1远程攻击力2
// 多势力或可转换势力的将领均视为群势力

export type Faction = '魏' | '蜀' | '吴' | '群' | '晋';

export type SkillTag = '锁定技' | '限定技' | '登场技' | '遗计技' | '觉醒技';

export const allSkillTags: SkillTag[] = ['锁定技', '限定技', '登场技', '遗计技', '觉醒技'];

export const skillTagColors: Record<SkillTag, string> = {
  '锁定技': '#ef4444',
  '限定技': '#f59e0b',
  '登场技': '#22c55e',
  '遗计技': '#8b5cf6',
  '觉醒技': '#ec4899',
};

// ── 技能触发时机系统 ──

export type SkillTriggerType =
  | 'onDeploy'           // 将领登场时
  | 'onOtherDeploy'      // 其他将领登场时
  | 'onTurnStart'        // 回合开始时
  | 'onTurnEnd'          // 回合结束时
  | 'onBecomingTarget'   // 成为攻击目标时
  | 'onDamageTaken'      // 受到伤害后
  | 'onTargetConfirmed'  // 确定攻击目标时（攻击方视角）
  | 'onDamageDealt'      // 造成伤害后
  | 'onKill'             // 击杀将领时
  | 'onDeath'            // 自身被击杀时
  | 'onCardLost'         // 失去手牌时（v2.5.3：事件源首批=GIVE 发放派生）
  | 'onCardGained'       // 获得手牌时（v2.5.3：事件源首批=GIVE 发放派生）
  | 'modifyAttack'       // 攻击结算前修改伤害值
  | 'modifyDefense'      // 受击结算前修改受到的伤害值
  | 'onBaseTargetedAtk'  // 本营成为攻击目标时
  | 'onBaseTargetedSkill'// 本营成为技能目标时
  | 'onBaseDamaged'      // 本营受到伤害时
  | 'onOtherSkillActivated' // 其他将领技能发动时
  | 'activeSelf'         // 己方回合任意发动
  | 'activeOther'        // 其他玩家回合任意发动
  | 'passive'            // 全局生效（在场时持续）
  | 'untilExpire';       // 直到X前生效

// 各触发时机的细分子选项
export type DeploySubType = 'selfDeploy' | 'allyDeploy' | 'enemyDeploy';
export type TurnSubType = 'selfTurn' | 'otherTurn';
export type DamageSubType = 'attackDamage' | 'skillDamage' | 'allDamage';
export type KillSubType = 'killAlly' | 'killEnemy';
/** v2.6.2 onCardLost/onCardGained 细分（事件源扩面刀）：把"失去牌"的
 *  位置（手牌/装备）与时点（是否最后一张手牌）谓词化——连营/枭姬的
 *  原文语义钥匙。anyLost/anyGained 为宽松默认（与扩面前行为一致）。 */
export type CardSubType = 'anyLost' | 'equipmentLost' | 'lastHandLost' | 'handLost' | 'anyGained';
export type ExpireCondition =
  | 'untilSelfTurnStart' | 'untilSelfTurnEnd'
  | 'untilOtherTurnStart' | 'untilOtherTurnEnd'
  | 'untilDeath' | 'untilLeaveField';

export interface SkillTriggerConfig {
  type: SkillTriggerType;
  deploySubType?: DeploySubType;         // onOtherDeploy 细分
  turnSubType?: TurnSubType;             // onTurnStart/onTurnEnd 细分
  damageSubType?: DamageSubType;         // onDamageTaken/onDamageDealt/onBaseDamaged 细分
  killSubType?: KillSubType;             // onKill 细分
  cardSubType?: CardSubType;             // onCardLost/onCardGained 细分（v2.6.2）
  expireCondition?: ExpireCondition;     // untilExpire 细分
}

// 触发时机的中文名称映射
export const triggerTypeLabels: Record<SkillTriggerType, string> = {
  onDeploy: '将领登场时',
  onOtherDeploy: '其他将领登场时',
  onTurnStart: '回合开始时',
  onTurnEnd: '回合结束时',
  onBecomingTarget: '成为攻击目标时',
  onDamageTaken: '受到伤害后',
  onTargetConfirmed: '确定攻击目标时',
  onDamageDealt: '造成伤害后',
  onKill: '击杀将领时',
  onDeath: '自身被击杀时',
  onCardLost: '失去手牌时',
  onCardGained: '获得手牌时',
  modifyAttack: '攻击结算前修改伤害值',
  modifyDefense: '受击结算前修改受到的伤害值',
  onBaseTargetedAtk: '本营成为攻击目标时',
  onBaseTargetedSkill: '本营成为技能目标时',
  onBaseDamaged: '本营受到伤害时',
  onOtherSkillActivated: '其他将领技能发动时',
  activeSelf: '己方回合任意发动',
  activeOther: '其他玩家回合任意发动',
  passive: '全局生效（在场时持续）',
  untilExpire: '直到X前生效',
};

export const allTriggerTypes: SkillTriggerType[] = Object.keys(triggerTypeLabels) as SkillTriggerType[];

// 子选项标签
export const deploySubLabels: Record<DeploySubType, string> = {
  selfDeploy: '自身登场', allyDeploy: '己方其他将领登场', enemyDeploy: '其他玩家将领登场',
};
export const turnSubLabels: Record<TurnSubType, string> = {
  selfTurn: '己方回合', otherTurn: '其他玩家回合',
};
export const damageSubLabels: Record<DamageSubType, string> = {
  attackDamage: '攻击伤害', skillDamage: '技能伤害', allDamage: '所有伤害类型',
};
export const killSubLabels: Record<KillSubType, string> = {
  killAlly: '击杀己方将领', killEnemy: '击杀其他玩家将领',
};
export const cardSubLabels: Record<CardSubType, string> = {
  anyLost: '失去任意牌', equipmentLost: '失去装备牌', lastHandLost: '失去最后一张手牌',
  handLost: '失去手牌', anyGained: '获得任意牌',
};
export const expireLabels: Record<ExpireCondition, string> = {
  untilSelfTurnStart: '到下个己方回合开始前', untilSelfTurnEnd: '到下个己方回合结束前',
  untilOtherTurnStart: '到下个其他玩家回合开始前', untilOtherTurnEnd: '到下个其他玩家回合结束前',
  untilDeath: '直到将领被击杀前', untilLeaveField: '直到将领离开场上前',
};

// 哪些触发类型需要哪些细分选项
export function getTriggerSubOptions(type: SkillTriggerType): 'deploy' | 'turn' | 'damage' | 'kill' | 'card' | 'expire' | null {
  switch (type) {
    case 'onOtherDeploy': return 'deploy';
    case 'onTurnStart': case 'onTurnEnd': return 'turn';
    case 'onDamageTaken': case 'onDamageDealt': case 'onBaseDamaged': return 'damage';
    case 'onKill': return 'kill';
    case 'onCardLost': case 'onCardGained': return 'card';
    case 'untilExpire': return 'expire';
    default: return null;
  }
}

/** 技能内的单个效果 */
/**
 * 发动门槛（条件谓词）——v2.8.3 起是**数据层词汇**（编辑器与 Excel 都能录入），
 * 编译模型层 re-export 同一份（skills/dataTypes.ts），求值单点在
 * skills/skillConditions.ts。条件不是事件也不是状态：它只回答"这一刻该不该响"，
 * 产零事件、写零状态、不吃随机。
 */
export type SkillConditionMetric =
  /** 主体座的手牌张数（本作只有玩家持有手牌，将领不持牌） */
  | 'HAND_COUNT'
  /** 主体在场将领的当前血量 */
  | 'GENERAL_HP'
  /** 主体在场将领的护甲点数 */
  | 'ARMOR_POINTS'
  /** 主体座在场将领数 */
  | 'FIELD_GENERAL_COUNT'
  /** 全局牌堆剩余张数（无主体） */
  | 'DECK_COUNT'
  /** 触发事件已记录的数值 data.value ?? data.count（无主体） */
  | 'EVENT_VALUE';

export type SkillConditionOperator = 'LT' | 'LTE' | 'EQ' | 'GTE' | 'GT';

/** 主体轴：SELF=技能拥有者（缺省）；TARGET/ATTACKER 从触发事件解析，解析不出=失败即闭。 */
export type SkillConditionSubject = 'SELF' | 'TARGET' | 'ATTACKER';

export interface SkillCondition {
  metric: SkillConditionMetric;
  /** 缺省 SELF；DECK_COUNT/EVENT_VALUE 忽略主体。 */
  subject?: SkillConditionSubject;
  op: SkillConditionOperator;
  /** 与常量比较。 */
  value?: number;
  /** 与另一枚已记录事实比较（"比多少"语义）；与 value 同时给时以此为准。 */
  compareTo?: { metric: SkillConditionMetric; subject?: SkillConditionSubject };
}

export interface SkillEffect {
  id: string;                    // 效果唯一ID (如 "e1", "e2")
  label?: string;                // 效果简短标注 (如 "效果一", "伤害触发")
  description?: string;          // 效果描述
  trigger?: SkillTriggerConfig;  // 该效果的触发时机
  /**
   * 发动门槛（v2.8.3 录入面）：挂在**单条效果**上，全部成立才发动（AND）。
   * 缺省=没有门槛。求值唯一实现=skills/skillConditions.ts（失败即闭：判不出
   * 来当作不满足）。文本录入/回显=skills/skillGateText.ts。
   */
  conditions?: SkillCondition[];
  /**
   * 结构化运行时载荷（可选）。只有带此载荷的效果才会被技能编译器
   * 接入唯一运行时（skills/skillCompiler → SkillTriggerBridge → GameEngine）。
   * 内置武将仅保留描述文本，不带载荷即不参与结算——不会凭空产生玩法。
   */
  runtime?: SkillRuntimeEffect;
}

/** 效果的结构化运行时载荷：类型 + 数值 + 目标角色 */
export interface SkillRuntimeEffect {
  type: 'DRAW_CARD' | 'DAMAGE' | 'HEAL' | 'GAIN_ARMOR' | 'DISCARD' | 'GIVE' | 'EQUIP_STRIP' | 'REVEAL' | 'DECK_PLACE';
  value?: number;
  target?: 'SELF' | 'ATTACKER' | 'TARGET';
  /** 仅 DECK_PLACE 使用：手牌移到牌堆顶还是底（默认 BOTTOM） */
  dest?: 'TOP' | 'BOTTOM';
}

/**
 * effectMode:
 *   'all'    — 所有效果独立生效（各自按触发时机生效）
 *   'choice' — 同一触发时刻只能选择其一执行
 */
export type SkillEffectMode = 'all' | 'choice';

export const effectModeLabels: Record<SkillEffectMode, string> = {
  all: '全部生效（各效果独立触发）',
  choice: '选择其一（同时触发时选择一项）',
};

export interface Skill {
  name: string;
  description?: string;
  tag?: SkillTag;
  trigger?: SkillTriggerConfig;       // 单效果技能的触发时机（向后兼容）
  effects?: SkillEffect[];            // 多效果列表
  effectMode?: SkillEffectMode;       // 多效果模式
  forced?: boolean;                   // 强制发动：满足触发条件后自动发动，需满足代价才发动，否则不发动
}

export interface General {
  id: string;
  name: string;
  faction: Faction;
  hp: number;
  type: '武将' | '文将';
  meleeAtk: number;
  rangedAtk: number;
  armor: number;
  skills: Skill[];
  title?: string;
  /** v2.8.0 identity-lock: registry key of this general's 身份.
   *  undefined ⇒ falls back to own name; '' (explicit blank) ⇒ no identity.
   *  Resolve ONLY via identityOf() in domain/identity.ts. */
  identity?: string;
}

function createGeneral(
  id: string,
  name: string,
  faction: Faction,
  hp: number,
  skills: Array<string | Skill>,
  title?: string,
): General {
  const type = hp >= 4 ? '武将' : '文将';
  return {
    id,
    name,
    faction,
    hp,
    type,
    meleeAtk: type === '武将' ? 2 : 1,
    rangedAtk: type === '武将' ? 1 : 2,
    armor: 0,
    skills: skills.map(s => (typeof s === 'string' ? { name: s } : s)),
    title,
  };
}

/**
 * 2.4.1 batch one (v2.4.0 §G tier-1, Wei+Shu+Qun): built-in skills carrying
 * their first real runtime payloads. Semantics are this project's first
 * definition (approximations registered in PROJECT_ARCH_MAP §G); a skill
 * without such a payload stays descriptive and never fires.
 */
const SK_JIANXIONG: Skill = {
  name: '奸雄',
  description: '受到伤害后，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_GANGLIE: Skill = {
  name: '刚烈',
  description: '受到攻击伤害后，对伤害来源造成1点技能伤害。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
    runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' },
  }],
};
const SK_TUNTIAN_WEI: Skill = {
  name: '屯田',
  description: '回合结束时，可摸两张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
    runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
  }],
};
const SK_QIANGXI: Skill = {
  name: '强袭',
  description: '造成攻击伤害后，拆掉目标的一张装备卡（放进弃牌堆，他的护甲值相应减少）。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
    runtime: { type: 'EQUIP_STRIP', value: 1, target: 'TARGET' },
  }],
};
const SK_LIANYING: Skill = {
  name: '连营',
  description: '失去最后一张手牌后，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onCardLost', cardSubType: 'lastHandLost' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_XIAOJI: Skill = {
  name: '枭姬',
  description: '失去一张装备牌后，摸两张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onCardLost', cardSubType: 'equipmentLost' },
    runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
  }],
};
const SK_KUANGGU: Skill = {
  name: '狂骨',
  description: '造成攻击伤害后，回复1点体力。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
    runtime: { type: 'HEAL', value: 1, target: 'SELF' },
  }],
};
const SK_LONGYIN: Skill = {
  name: '龙吟',
  description: '战吼先声：成为攻击目标时，获得1点护甲。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onBecomingTarget' },
    runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' },
  }],
};
const SK_FULI: Skill = {
  name: '伏枥',
  description: '回合结束时，可摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_LIEREN: Skill = {
  name: '烈刃',
  description: '造成攻击伤害后，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_ROULIN: Skill = {
  name: '肉林',
  description: '酒肉养伤：受到技能伤害后，回复1点体力。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageTaken', damageSubType: 'skillDamage' },
    runtime: { type: 'HEAL', value: 1, target: 'SELF' },
  }],
};
const SK_BENGHUAI: Skill = {
  name: '崩坏',
  description: '成为攻击目标时惊惶失据：弃置自己的一张装备卡（伤害结算后落账，不减当次伤害）。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onBecomingTarget' },
    runtime: { type: 'EQUIP_STRIP', value: 1, target: 'SELF' },
  }],
};
const SK_MENGJIN: Skill = {
  name: '猛进',
  description: '被瞄准时迎头痛击：成为攻击目标时，对攻击者造成1点技能伤害。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onBecomingTarget' },
    runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' },
  }],
};

/**
 * 2.4.2 batch two (v2.4.0 §G tier-1, Wu+Jin): 21 of 24 entries landed with
 * runtime payloads; 苦肉 is the first built-in with TWO independently-
 * triggered effects (e1 self-damage + e2 draw — the SELF damage path is
 * empirically accepted by the engine). The three onDeploy skills
 * (英慧/拓略/奋勇) were demoted to descriptive tier-4 at the honest-degrade
 * red line: the activation probe proved GENERAL_DEPLOYED can never hit the
 * skill registry — skills are registered from on-field generals BEFORE a
 * dispatch, so the deploying general's own onDeploy listener doesn't exist
 * yet when the event fires (registration-order gap, HANDOFF §12-26).
 * v2.5.1 WIRED that gap (TransitionCore resyncSkills: post-settlement
 * re-register + replay of the deploy step); v2.5.2 PROMOTED these three
 * after the four-acceptance gate (recompile + dedicated hotseat E2E +
 * replay rebuild byte-equality + existing timing contracts unregressed).
 * Semantics remain this project's first definition (approximations
 * registered in PROJECT_ARCH_MAP §G).
 */
const SK_KUROU: Skill = {
  name: '苦肉',
  description: '自伤诈降：回合开始时，对自己造成1点技能伤害，然后摸两张牌。',
  effects: [
    {
      id: 'e1',
      trigger: { type: 'onTurnStart', turnSubType: 'selfTurn' },
      runtime: { type: 'DAMAGE', value: 1, target: 'SELF' },
    },
    {
      id: 'e2',
      trigger: { type: 'onTurnStart', turnSubType: 'selfTurn' },
      runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
    },
  ],
};
const SK_YINGZI: Skill = {
  name: '英姿',
  description: '回合结束时，可摸两张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
    runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
  }],
};
const SK_JIANG_ANG: Skill = {
  name: '激昂',
  description: '战意蓄势：成为攻击目标时，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onBecomingTarget' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_ZHUIYI: Skill = {
  name: '追忆',
  description: '遗泽追念：被击杀时，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDeath' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_FENXUN: Skill = {
  name: '奋迅',
  description: '冲锋陷阵：回合开始时，获得1点护甲。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnStart', turnSubType: 'selfTurn' },
    runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' },
  }],
};
const SK_BUYI: Skill = {
  name: '补益',
  description: '伤病自养：受到攻击伤害后，回复1点体力。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
    runtime: { type: 'HEAL', value: 1, target: 'SELF' },
  }],
};
const SK_SIDI: Skill = {
  name: '司敌',
  description: '识破术法：受到技能伤害后，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageTaken', damageSubType: 'skillDamage' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_WEIWO: Skill = {
  name: '帷幄',
  description: '运筹帷幄：回合开始时，获得1点护甲。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnStart', turnSubType: 'selfTurn' },
    runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' },
  }],
};
const SK_HUIYAN: Skill = {
  name: '慧眼',
  description: '鉴人于微：造成攻击伤害后，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_TUNTIAN_JIN: Skill = {
  name: '屯田',
  description: '回合结束时，可摸两张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
    runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
  }],
};
const SK_YINGHUI: Skill = {
  name: '英慧',
  description: '识鉴英才：登场时，摸两张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDeploy' },
    runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
  }],
};
const SK_SONGWEI: Skill = {
  name: '颂威',
  description: '母仪劝勉：回合结束时，可摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_TUOLUE: Skill = {
  name: '拓略',
  description: '开疆立垒：登场时，获得2点护甲。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDeploy' },
    runtime: { type: 'GAIN_ARMOR', value: 2, target: 'SELF' },
  }],
};
const SK_POZHU: Skill = {
  name: '破竹',
  description: '势如破竹：击杀后，摸两张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onKill' },
    runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
  }],
};
const SK_QINGDE: Skill = {
  name: '清德',
  description: '德信怀人：回合开始时，回复1点体力。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnStart', turnSubType: 'selfTurn' },
    runtime: { type: 'HEAL', value: 1, target: 'SELF' },
  }],
};
const SK_KENHUANG: Skill = {
  name: '垦荒',
  description: '积谷边备：回合结束时，可获得1点护甲。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnEnd', turnSubType: 'selfTurn' },
    runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' },
  }],
};
const SK_FENWEI: Skill = {
  name: '奋威',
  description: '威震追亡：造成攻击伤害后，对受击目标追加1点技能伤害。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageDealt', damageSubType: 'attackDamage' },
    runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' },
  }],
};
const SK_LINZHEN: Skill = {
  name: '临阵',
  description: '身先士卒：受到攻击伤害后，获得1点护甲。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
    runtime: { type: 'GAIN_ARMOR', value: 1, target: 'SELF' },
  }],
};
const SK_DANQI: Skill = {
  name: '单骑',
  description: '挑枪同命：被击杀时，对击杀者造成1点技能伤害。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDeath' },
    runtime: { type: 'DAMAGE', value: 1, target: 'ATTACKER' },
  }],
};
const SK_FENGYONG: Skill = {
  name: '奋勇',
  description: '敢战先登：登场时，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDeploy' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_LUSHA: Skill = {
  name: '戮杀',
  description: '酷烈自养：击杀后，回复1点体力。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onKill' },
    runtime: { type: 'HEAL', value: 1, target: 'SELF' },
  }],
};
const SK_BINGTUN: Skill = {
  name: '并吞',
  description: '混一六合：击杀后，获得2点护甲。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onKill' },
    runtime: { type: 'GAIN_ARMOR', value: 2, target: 'SELF' },
  }],
};
const SK_FENGSHANG: Skill = {
  name: '封赏',
  description: '开国行赏：回合开始时，摸一张牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onTurnStart', turnSubType: 'selfTurn' },
    runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
  }],
};
const SK_SIJIE: Skill = {
  name: '死节',
  description: '殉城烈怒：被击杀时，对击杀者造成2点技能伤害。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDeath' },
    runtime: { type: 'DAMAGE', value: 2, target: 'ATTACKER' },
  }],
};

/**
 * 2.5.0 batch three (v2.4.0 §G tier-2 via the DISCARD primitive): the first
 * built-in skills that discard cards. Semantics are this project's first
 * definition — approximations and the two honest deferrals (据守/制衡/贞烈
 * stay descriptive; reasons in PROJECT_ARCH_MAP §G batch-three notes).
 * DISCARD value=0 is the whole-hand sentinel (data-layer only — Excel and
 * the editor accept ≥1).
 */
const SK_FANKUI: Skill = {
  name: '反馈',
  description: '受到伤害后，伤害来源弃置一张手牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDamageTaken', damageSubType: 'allDamage' },
    runtime: { type: 'DISCARD', value: 1, target: 'ATTACKER' },
  }],
};
const SK_DUANCHANG: Skill = {
  name: '断肠',
  description: '被击杀时，击杀者弃置全部手牌。',
  effects: [{
    id: 'e1',
    trigger: { type: 'onDeath' },
    runtime: { type: 'DISCARD', value: 0, target: 'ATTACKER' },
  }],
};

// 魏势力 - 界限突破标准包
const weiGenerals: General[] = [
  createGeneral('wei_001', '曹操', '魏', 4, [SK_JIANXIONG, '护驾'], '魏武帝'),
  createGeneral('wei_002', '司马懿', '魏', 3, [SK_FANKUI, '鬼才'], '狼顾之鬼'),
  createGeneral('wei_003', '夏侯惇', '魏', 4, [SK_GANGLIE], '独眼的罗刹'),
  createGeneral('wei_004', '张辽', '魏', 4, ['突袭'], '前将军'),
  createGeneral('wei_005', '许褚', '魏', 4, ['裸衣'], '虎痴'),
  createGeneral('wei_006', '郭嘉', '魏', 3, ['天妒', '遗计'], '早终的先知'),
  createGeneral('wei_007', '甄姬', '魏', 3, ['倾国', '洛神'], '薄幸的美人'),
  createGeneral('wei_008', '夏侯渊', '魏', 4, ['神速'], '疾行的猎豹'),
  createGeneral('wei_009', '张郃', '魏', 4, ['巧变'], '料敌机先'),
  createGeneral('wei_010', '徐晃', '魏', 4, ['断粮'], '周亚夫之风'),
  createGeneral('wei_011', '曹仁', '魏', 4, ['据守'], '大将军'),
  createGeneral('wei_012', '典韦', '魏', 4, [SK_QIANGXI], '古之恶来'),
  createGeneral('wei_013', '荀彧', '魏', 3, ['驱虎', '节命'], '王佐之才'),
  createGeneral('wei_014', '曹丕', '魏', 3, ['行殇', '放逐'], '霸业的继承者'),
  createGeneral('wei_015', '邓艾', '魏', 4, [SK_TUNTIAN_WEI, '凿险'], '矫然的壮士'),
  createGeneral('wei_016', '钟会', '魏', 3, ['权计', '自立'], '桀骜的野心家'),
  createGeneral('wei_017', '王异', '魏', 3, ['贞烈', '秘计'], '决意的巾帼'),
  createGeneral('wei_018', '荀攸', '魏', 3, ['奇策', '智愚'], '曹操的谋主'),
  createGeneral('wei_019', '李典', '魏', 3, ['恂恂', '忘隙'], '愿从谦风'),
  createGeneral('wei_020', '满宠', '魏', 3, ['峻刑', '御策'], '严毅的督军'),
  createGeneral('wei_021', '张春华', '魏', 3, ['绝情', '伤逝'], '冷血皇后'),
];

// 蜀势力 - 界限突破标准包
const shuGenerals: General[] = [
  createGeneral('shu_001', '刘备', '蜀', 4, ['仁德', '激将'], '乱世的枭雄'),
  createGeneral('shu_002', '关羽', '蜀', 4, ['武圣'], '美髯公'),
  createGeneral('shu_003', '张飞', '蜀', 4, ['咆哮'], '万夫不当'),
  createGeneral('shu_004', '诸葛亮', '蜀', 3, ['观星', '空城'], '迟暮的丞相'),
  createGeneral('shu_005', '赵云', '蜀', 4, ['龙胆', '涯角'], '少年将军'),
  createGeneral('shu_006', '马超', '蜀', 4, ['马术', '铁骑'], '一骑当千'),
  createGeneral('shu_007', '黄月英', '蜀', 3, ['集智', '奇才'], '归隐的杰女'),
  createGeneral('shu_008', '黄忠', '蜀', 4, ['烈弓'], '老当益壮'),
  createGeneral('shu_009', '魏延', '蜀', 4, [SK_KUANGGU], '嗜血的独狼'),
  createGeneral('shu_010', '姜维', '蜀', 4, ['挑衅', '志继'], '龙的衣钵'),
  createGeneral('shu_011', '刘禅', '蜀', 3, ['享乐', '放权'], '无为的真命主'),
  createGeneral('shu_012', '卧龙诸葛亮', '蜀', 3, ['八阵', '火计', '看破'], '卧龙'),
  createGeneral('shu_013', '庞统', '蜀', 3, ['连环', '涅槃'], '凤雏'),
  createGeneral('shu_014', '徐庶', '蜀', 3, ['举荐', '无言'], '忠孝的侠士'),
  createGeneral('shu_015', '马谡', '蜀', 3, ['心战', '挥泪'], '言过其实'),
  createGeneral('shu_016', '关兴张苞', '蜀', 4, ['父魂'], '虎父之犬子'),
  createGeneral('shu_017', '刘封', '蜀', 4, ['陷嗣'], '被放逐的继承人'),
  createGeneral('shu_018', '关平', '蜀', 4, [SK_LONGYIN], '忠臣之后'),
  createGeneral('shu_019', '廖化', '蜀', 4, ['当先', SK_FULI], '蜀汉的脊梁'),
  createGeneral('shu_020', '马良', '蜀', 3, ['自书', '白眉'], '眉间的智者'),
  createGeneral('shu_021', '祝融', '蜀', 4, ['巨象', SK_LIEREN], '野性的女王'),
  createGeneral('shu_022', '孟获', '蜀', 4, ['祸首', '再起'], '南蛮王'),
];

// 吴势力 - 界限突破标准包
const wuGenerals: General[] = [
  createGeneral('wu_001', '孙权', '吴', 4, ['制衡', '救援'], '年轻的贤君'),
  createGeneral('wu_002', '甘宁', '吴', 4, ['奇袭'], '锦帆游侠'),
  createGeneral('wu_003', '吕蒙', '吴', 4, ['克己'], '白衣渡江'),
  createGeneral('wu_004', '黄盖', '吴', 4, [SK_KUROU, '诈降'], '轻身为国'),
  createGeneral('wu_005', '周瑜', '吴', 3, [SK_YINGZI, '反间'], '大都督'),
  createGeneral('wu_006', '大乔', '吴', 3, ['国色', '流离'], '矜持之花'),
  createGeneral('wu_007', '陆逊', '吴', 3, ['谦逊', SK_LIANYING], '儒生雄才'),
  createGeneral('wu_008', '孙尚香', '吴', 3, ['结姻', SK_XIAOJI], '弓腰姬'),
  createGeneral('wu_009', '小乔', '吴', 3, ['天香', '红颜'], '矫情之花'),
  createGeneral('wu_010', '太史慈', '吴', 4, ['天义'], '笃烈之士'),
  createGeneral('wu_011', '周泰', '吴', 4, ['不屈', '奋激'], '历战之躯'),
  createGeneral('wu_012', '鲁肃', '吴', 3, ['好施', '缔盟'], '独断的外交家'),
  createGeneral('wu_013', '张昭张纮', '吴', 3, ['直谏', '固政'], '经天纬地'),
  createGeneral('wu_014', '凌统', '吴', 4, ['旋风'], '豪情烈胆'),
  createGeneral('wu_015', '徐盛', '吴', 4, ['破军'], '江东的铁壁'),
  createGeneral('wu_016', '孙策', '吴', 4, [SK_JIANG_ANG, '魂姿'], '江东小霸王'),
  createGeneral('wu_017', '吕范', '吴', 3, ['调度', '典财'], '忠实的管家'),
  createGeneral('wu_018', '步练师', '吴', 3, ['安恤', SK_ZHUIYI], '皇后之仪'),
  createGeneral('wu_019', '诸葛恪', '吴', 3, ['傲才', '名君'], '兴家赤族'),
  createGeneral('wu_020', '丁奉', '吴', 4, ['短兵', SK_FENXUN], '清侧重臣'),
  createGeneral('wu_021', '吴国太', '吴', 3, ['甘露', SK_BUYI], '武烈皇后'),
];

// 群势力 - 仅保留原本势力即为"群"的将领
const qunGenerals: General[] = [
  createGeneral('qun_001', '华佗', '群', 3, ['急救', '青囊'], '神医'),
  createGeneral('qun_002', '吕布', '群', 4, ['无双'], '武的化身'),
  createGeneral('qun_003', '貂蝉', '群', 3, ['离间', '闭月'], '绝世的舞姬'),
  createGeneral('qun_004', '董卓', '群', 4, ['酒池', SK_ROULIN, SK_BENGHUAI], '魔王'),
  createGeneral('qun_005', '袁绍', '群', 4, ['乱击'], '高贵的名门'),
  createGeneral('qun_006', '颜良文丑', '群', 4, ['双雄'], '虎狼兄弟'),
  createGeneral('qun_007', '张角', '群', 3, ['雷公', '鬼道'], '天公将军'),
  createGeneral('qun_008', '于吉', '群', 3, ['蛊惑'], '太平道人'),
  createGeneral('qun_009', '公孙瓒', '群', 4, ['义从'], '白马将军'),
  createGeneral('qun_010', '庞德', '群', 4, ['马术', SK_MENGJIN], '人马一体'),
  createGeneral('qun_011', '袁术', '群', 4, ['妄尊', '同疾'], '仲家帝'),
  createGeneral('qun_012', '蔡文姬', '群', 3, ['悲歌', SK_DUANCHANG], '异乡的孤女'),
  createGeneral('qun_013', '贾诩', '群', 3, ['帷幕', '乱武', '完杀'], '最强的谋士'),
  createGeneral('qun_014', '左慈', '群', 3, ['化身', '新生'], '迷之仙人'),
  createGeneral('qun_015', '陈宫', '群', 3, ['明策', '智迟'], '刚直的谋臣'),
  createGeneral('qun_016', '高顺', '群', 4, ['陷阵', '禁酒'], '攻城拔寨'),
];

// 晋势力
const jinGenerals: General[] = [
  createGeneral('jin_001', '司马懿', '晋', 3, ['巧变', '大权'], '晋宣帝'),
  createGeneral('jin_002', '司马师', '晋', 3, ['鹰视', '夺嫡'], '铁腕摄政'),
  createGeneral('jin_003', '司马昭', '晋', 3, ['赵染', SK_SIDI], '路人皆知'),
  createGeneral('jin_004', '贾充', '晋', 3, [SK_WEIWO, '矫诏'], '弑君的权臣'),
  createGeneral('jin_005', '张春华', '晋', 3, [SK_HUIYAN, '秘置'], '毒辣的国母'),
  createGeneral('jin_006', '钟会', '晋', 3, ['权计', '自立'], '野心的终局'),
  createGeneral('jin_007', '邓艾', '晋', 4, [SK_TUNTIAN_JIN, '凿险'], '偷渡阴平'),
  createGeneral('jin_008', '王元姬', '晋', 3, [SK_YINGHUI, SK_SONGWEI], '贤明的皇后'),
  createGeneral('jin_009', '杜预', '晋', 3, [SK_TUOLUE, SK_POZHU], '文武全才'),
  createGeneral('jin_010', '羊祜', '晋', 3, [SK_QINGDE, SK_KENHUANG], '仁德的将军'),
  createGeneral('jin_011', '乐綝', '晋', 4, [SK_FENWEI, SK_LINZHEN], '威震边疆'),
  createGeneral('jin_012', '文鸯', '晋', 4, [SK_DANQI, SK_FENGYONG], '骁勇的猛将'),
  createGeneral('jin_013', '贾南风', '晋', 3, ['乱政', SK_LUSHA], '毒后'),
  createGeneral('jin_014', '司马炎', '晋', 3, [SK_BINGTUN, SK_FENGSHANG], '晋武帝'),
  createGeneral('jin_015', '诸葛诞', '晋', 4, ['举兵', SK_SIJIE], '忠义的叛将'),
];

export const allGenerals: General[] = [
  ...weiGenerals,
  ...shuGenerals,
  ...wuGenerals,
  ...qunGenerals,
  ...jinGenerals,
];

/** Canonical faction order — shared by the AI battle seat picker and reports. */
export const allFactions: Faction[] = ['魏', '蜀', '吴', '群', '晋'];

export const factionColors: Record<Faction, string> = {
  '魏': '#2563eb', // 蓝色
  '蜀': '#dc2626', // 红色
  '吴': '#16a34a', // 绿色
  '群': '#eab308', // 黄色
  '晋': '#9333ea', // 紫色
};

export const factionBgColors: Record<Faction, string> = {
  '魏': '#1e40af',
  '蜀': '#991b1b',
  '吴': '#166534',
  '群': '#a16207',
  '晋': '#6b21a8',
};

export const factionLightColors: Record<Faction, string> = {
  '魏': '#dbeafe',
  '蜀': '#fee2e2',
  '吴': '#dcfce7',
  '群': '#fef9c3',
  '晋': '#f3e8ff',
};

export function getGeneralsByFaction(faction: Faction): General[] {
  return allGenerals.filter(g => g.faction === faction);
}
