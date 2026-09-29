/**
 * v2.8.9 内容时代地基刀4（方案A，ARCH_MAP §H「CI 输入必须能由仓库固定文件完整
 * 重建」）：一批**写死在仓库里的 DIY 将领**，让 AI 自动对战能验证"编辑器造出来
 * 的那类卡＋带 runtime 载荷的技能"真的能编译、能触发、能结算。
 *
 * 三条边界（将来改动前先读）：
 * - 这份样本**不进官方账本**（`src/data/generals.ts` 一行未动）⇒ B10 仍是"官方
 *   池"的意思；它也不是 localStorage 里的玩家内容 ⇒ 不进任何对局存档。它是源
 *   文件，和账本一样可被 CI 重建，只是命名空间不同（`D-fix-*`）。
 * - 卡一律经 `createAuthoredGeneral` 造出（§H1：那是全库唯一的存在入口），
 *   `randomId` 注入固定后缀 ⇒ 号是确定的、可复现的，不是随机 UUID。
 * - `identity` 显式写空（§F 格 8：留空＝**当前无身份**＝此刻不产生锁键；身份是
 *   可编辑字段，日后填上就重新参与锁——不是永久豁免）。手写样本每势力只有几张，
 *   若参与身份锁，两个座位撞同一势力时第二个座位会被锁滤成**空池**。注意契约
 *   豁免的是形状而不是来源：身份写空或写 `DIY` 标记才不锁，编辑器默认路会把身份
 *   落成卡名（`generalProvenance.ts` 的 `?? name`），那种自建卡照样锁。这里如实
 *   取"无身份"形状，而不是绕开规则。
 */
import type { Faction, General, Skill, SkillEffect } from '../../data/generals';
import { createAuthoredGeneral } from '../../domain/generalProvenance';

/** 固定号后缀的命名空间标记（成卡后 id = `D-fix-<key>`）。 */
export const DIY_FIXTURE_ID_TAG = 'fix';
/** 这份样本里每张卡的称号：一眼可辨它不是官方将。 */
const FIXTURE_TITLE = '仓库固定样本';

function effect(
  id: string,
  trigger: SkillEffect['trigger'],
  runtime: SkillEffect['runtime'],
  conditions?: SkillEffect['conditions'],
): SkillEffect {
  return {
    id,
    trigger,
    runtime,
    ...(conditions ? { conditions } : {}),
  };
}

function skill(name: string, description: string, effects: SkillEffect[]): Skill {
  return { name, description, effects };
}

type FixtureSpec = {
  key: string;
  name: string;
  faction: Faction;
  hp: number;
  skills: Skill[];
};

/**
 * 12 张＝魏/蜀/吴 各 4 张。技能只用**编译器已结算的**触发时机与效果类型
 * （`skills/skillCompiler.ts` → `SkillTriggerBridge`），本刀不新增任何玩法语义。
 * 覆盖面：摸牌/伤害/回复/护甲/弃牌/赠牌/拆装备/看顶/放堆顶底/击杀后，外加一条
 * 带「发动门槛」的效果（v2.8.3 录入面产物）与一张双效果技能。
 */
const FIXTURE_SPECS: FixtureSpec[] = [
  {
    key: 'wei1', name: '试作·魏甲', faction: '魏', hp: 4,
    skills: [skill('样·蓄粮', '回合开始时，摸一张牌。', [
      effect('e1', { type: 'onTurnStart', turnSubType: 'selfTurn' }, { type: 'DRAW_CARD', value: 1, target: 'SELF' }),
    ])],
  },
  {
    key: 'wei2', name: '试作·魏乙', faction: '魏', hp: 3,
    skills: [skill('样·回报', '受到攻击伤害后，对伤害来源造成1点技能伤害。', [
      effect('e1', { type: 'onDamageTaken', damageSubType: 'attackDamage' }, { type: 'DAMAGE', value: 1, target: 'ATTACKER' }),
    ])],
  },
  {
    key: 'wei3', name: '试作·魏丙', faction: '魏', hp: 5,
    skills: [skill('样·固守', '成为攻击目标时，获得1点护甲。', [
      effect('e1', { type: 'onBecomingTarget' }, { type: 'GAIN_ARMOR', value: 1, target: 'SELF' }),
    ])],
  },
  {
    key: 'wei4', name: '试作·魏丁', faction: '魏', hp: 4,
    skills: [skill('样·节用', '受到伤害后，若你的手牌不多于1张，摸一张牌。', [
      effect(
        'e1',
        { type: 'onDamageTaken', damageSubType: 'allDamage' },
        { type: 'DRAW_CARD', value: 1, target: 'SELF' },
        [{ metric: 'HAND_COUNT', subject: 'SELF', op: 'LTE', value: 1 }],
      ),
    ])],
  },
  {
    key: 'shu1', name: '试作·蜀甲', faction: '蜀', hp: 4,
    skills: [skill('样·抚伤', '受到伤害后，回复1点体力。', [
      effect('e1', { type: 'onDamageTaken', damageSubType: 'allDamage' }, { type: 'HEAL', value: 1, target: 'SELF' }),
    ])],
  },
  {
    key: 'shu2', name: '试作·蜀乙', faction: '蜀', hp: 3,
    skills: [skill('样·探报', '回合开始时，看牌堆顶1张。', [
      effect('e1', { type: 'onTurnStart', turnSubType: 'selfTurn' }, { type: 'REVEAL', value: 1, target: 'SELF' }),
    ])],
  },
  {
    key: 'shu3', name: '试作·蜀丙', faction: '蜀', hp: 5,
    skills: [skill('样·缴械', '造成攻击伤害后，拆掉目标的一张装备卡。', [
      effect('e1', { type: 'onDamageDealt', damageSubType: 'attackDamage' }, { type: 'EQUIP_STRIP', value: 1, target: 'TARGET' }),
    ])],
  },
  {
    key: 'shu4', name: '试作·蜀丁', faction: '蜀', hp: 4,
    skills: [
      skill('样·双略', '回合开始时获得1点护甲；受到伤害后摸一张牌。', [
        effect('e1', { type: 'onTurnStart', turnSubType: 'selfTurn' }, { type: 'GAIN_ARMOR', value: 1, target: 'SELF' }),
        effect('e2', { type: 'onDamageTaken', damageSubType: 'allDamage' }, { type: 'DRAW_CARD', value: 1, target: 'SELF' }),
      ]),
    ],
  },
  {
    key: 'wu1', name: '试作·吴甲', faction: '吴', hp: 4,
    skills: [skill('样·焚粮', '造成伤害后，弃置目标1张手牌。', [
      effect('e1', { type: 'onDamageDealt', damageSubType: 'attackDamage' }, { type: 'DISCARD', value: 1, target: 'TARGET' }),
    ])],
  },
  {
    key: 'wu2', name: '试作·吴乙', faction: '吴', hp: 3,
    skills: [skill('样·转赠', '受到伤害后，交给伤害来源1张手牌。', [
      effect('e1', { type: 'onDamageTaken', damageSubType: 'allDamage' }, { type: 'GIVE', value: 1, target: 'ATTACKER' }),
    ])],
  },
  {
    key: 'wu3', name: '试作·吴丙', faction: '吴', hp: 5,
    skills: [skill('样·归整', '回合开始时，将1张手牌放回牌堆底。', [
      effect('e1', { type: 'onTurnStart', turnSubType: 'selfTurn' }, { type: 'DECK_PLACE', value: 1, target: 'SELF', dest: 'BOTTOM' }),
    ])],
  },
  {
    key: 'wu4', name: '试作·吴丁', faction: '吴', hp: 4,
    skills: [skill('样·陷阵', '击杀敌方单位时，摸一张牌。', [
      effect('e1', { type: 'onKill' }, { type: 'DRAW_CARD', value: 1, target: 'SELF' }),
    ])],
  },
];

/**
 * The repository-fixed DIY sample the AI battle CLI can be pointed at
 * (`--diy-fixture`). Built through the only creation path there is (§H1), with
 * deterministic id suffixes — a broken spec is a loud module-load error, never
 * a silently skipped card (§12-46①：漏读比读错更危险).
 */
export const DIY_FIXTURE_GENERALS: General[] = FIXTURE_SPECS.map(spec => {
  const made = createAuthoredGeneral(
    { name: spec.name, faction: spec.faction, hp: spec.hp, identity: '', title: FIXTURE_TITLE, skills: spec.skills },
    'DIY',
    () => `${DIY_FIXTURE_ID_TAG}-${spec.key}`,
  );
  if (!made.ok) {
    throw new Error(`DIY 固定样本无法成卡：${spec.name}（${spec.key}）原因＝${made.reason}`);
  }
  return made.general;
});
