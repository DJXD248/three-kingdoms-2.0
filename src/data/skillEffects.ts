/**
 * 技能效果系统
 *
 * 伤害类型区分：
 *   - attack  攻击伤害：将领通过攻击行动（近战/远程）造成的伤害，包括技能增强的攻击
 *   - skill   技能伤害：将领技能直接造成的伤害，不经过攻击行动
 *
 * 技能触发时机：
 *   - onDeploy         登场时
 *   - onTurnStart      回合开始时
 *   - onDamageTaken    受到伤害后（攻击或技能伤害均触发）
 *   - onDamageDealt    造成伤害后
 *   - onKill           击杀敌方将领后
 *   - onDeath          自身被击杀时
 *   - modifyAttack     攻击结算前修改伤害值
 *   - modifyDefense    受击结算前修改受到的伤害值
 *   - modifyBaseDamage 本营受击时修改伤害值
 */

import { FieldGeneral, Player } from '../store/gameStore';

// ── 伤害类型 ──
export type DamageType = 'attack' | 'skill';

// ── 技能触发时机 ──
export type SkillTrigger =
  | 'onDeploy'
  | 'onTurnStart'
  | 'onDamageTaken'
  | 'onDamageDealt'
  | 'onKill'
  | 'onDeath'
  | 'modifyAttack'
  | 'modifyDefense'
  | 'modifyBaseDamage';

// ── 技能通知（用于 UI 弹出提示）──
export interface SkillActivation {
  id: string;            // unique per activation
  generalName: string;
  skillName: string;
  message: string;
  color: string;         // faction color
  timestamp: number;
}

// ── 技能上下文 ──
export interface SkillContext {
  self: FieldGeneral;
  selfOwner: Player;
  damageType?: DamageType;
  damageAmount?: number;
  attackerGeneral?: FieldGeneral;
  targetGeneral?: FieldGeneral;
  isRanged?: boolean;
  allPlayers: Player[];
}

// ── 技能效果结果 ──
export interface SkillResult {
  /** 修改后的伤害值 (用于 modify* 触发器) */
  modifiedDamage?: number;
  /** 给某玩家抽卡 */
  drawCards?: { playerId: number; count: number };
  /** 给某将领回血 */
  healGeneral?: { generalId: string; amount: number };
  /** 技能直接造成伤害 */
  dealDamage?: { targetGeneralId: string; amount: number; damageType: DamageType };
  /** 将领回撤到营地 */
  retreatToCamp?: { generalId: string };
  /** UI 通知消息 */
  activation?: SkillActivation;
}

// ── 技能效果定义 ──
export interface SkillEffectDef {
  /** 匹配的技能名 */
  skillName: string;
  /** 匹配的将领 ID（可选，不填则匹配所有同名技能）*/
  generalId?: string;
  trigger: SkillTrigger;
  /** 返回 null 表示不触发 */
  execute: (ctx: SkillContext) => SkillResult | null;
}

let _activationCounter = 0;
function makeActivation(generalName: string, skillName: string, message: string, color: string): SkillActivation {
  return { id: `sa_${++_activationCounter}_${Date.now()}`, generalName, skillName, message, color, timestamp: Date.now() };
}

// ══════════════════════════════════════════════════════════════
//  技能效果注册表
// ══════════════════════════════════════════════════════════════

export const skillEffectRegistry: SkillEffectDef[] = [

  // ─── 曹操 · 奸雄 ──────────────────────────────────────────
  // 受到伤害后，摸 1 张牌（从牌堆抽取）
  {
    skillName: '奸雄',
    generalId: 'wei_001',
    trigger: 'onDamageTaken',
    execute: (ctx) => {
      return {
        drawCards: { playerId: ctx.selfOwner.id, count: 1 },
        activation: makeActivation(ctx.self.general.name, '奸雄',
          `${ctx.self.general.name} 受到伤害，【奸雄】发动：摸1张牌`,
          '#2563eb'),
      };
    },
  },

  // ─── 曹操 · 护驾 ──────────────────────────────────────────
  // 被动：当本营受到攻击伤害时，若曹操在场，伤害-1（最低0）
  {
    skillName: '护驾',
    generalId: 'wei_001',
    trigger: 'modifyBaseDamage',
    execute: (ctx) => {
      // 只对攻击伤害生效
      if (ctx.damageType !== 'attack') return null;
      if ((ctx.damageAmount ?? 0) <= 0) return null;
      return {
        modifiedDamage: Math.max(0, (ctx.damageAmount ?? 0) - 1),
        activation: makeActivation(ctx.self.general.name, '护驾',
          `${ctx.self.general.name}【护驾】发动：本营攻击伤害-1`,
          '#2563eb'),
      };
    },
  },
];

// ── 查询帮助函数 ──

/** 获取某个将领在某触发时机的所有技能效果 */
export function getEffectsForGeneral(fg: FieldGeneral, trigger: SkillTrigger): SkillEffectDef[] {
  return skillEffectRegistry.filter(def => {
    if (def.trigger !== trigger) return false;
    // 如果指定了 generalId，必须匹配
    if (def.generalId && def.generalId !== fg.general.id) return false;
    // 将领必须拥有该技能名
    return fg.general.skills.some(s => s.name === def.skillName);
  });
}

/** 获取某玩家所有在场将领在某触发时机的效果 */
export function getPlayerEffects(player: Player, trigger: SkillTrigger): { fg: FieldGeneral; def: SkillEffectDef }[] {
  const results: { fg: FieldGeneral; def: SkillEffectDef }[] = [];
  for (const fg of player.fieldGenerals) {
    for (const def of getEffectsForGeneral(fg, trigger)) {
      results.push({ fg, def });
    }
  }
  return results;
}
