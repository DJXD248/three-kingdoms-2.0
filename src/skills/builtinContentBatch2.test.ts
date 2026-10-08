/**
 * 2.4.2 batch two — built-in tier-1 skills (Wu+Jin): 21 of the 24 drafted
 * entries carried runtime payloads at landing; 苦肉 is the first built-in
 * with TWO independently-triggered effects (e1 self-damage + e2 draw): the
 * compiler must emit two definitions from one skill. The three onDeploy
 * skills (英慧/拓略/奋勇) were demoted to descriptive tier-4 then — the
 * then-activation probe proved GENERAL_DEPLOYED could not hit the skill
 * registry (registration-order gap; HANDOFF §12-26). v2.5.1 wired the gap;
 * v2.5.2 PROMOTED the three through the four-acceptance gate (recompile +
 * dedicated hotseat E2E + replay rebuild byte-equality + existing timing
 * contracts unregressed) — this file now pins their promoted shape.
 * Full-chain behaviour (incl. the two remaining sentinels — 苦肉 SELF 自伤
 * 路径 and 奋威 chain TARGET resolution — and the onDeploy real-template
 * deploy chains) lives in core/transitionEquivalence.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { allGenerals, type General } from '../data/generals';
import { compileGeneralSkills, type SkillSkip } from './skillCompiler';
import { listTurnEndSkillCandidates } from './turnEndSkills';
import { createInitialEngineState, type EngineState } from '../core/GameState';

const BATCH2: Array<{ owner: string; name: string }> = [
  { owner: 'wu_004', name: '苦肉' },
  { owner: 'wu_005', name: '英姿' },
  { owner: 'wu_016', name: '激昂' },
  { owner: 'wu_018', name: '追忆' },
  { owner: 'wu_020', name: '奋迅' },
  { owner: 'wu_021', name: '补益' },
  { owner: 'jin_003', name: '司敌' },
  { owner: 'jin_004', name: '帷幄' },
  { owner: 'jin_005', name: '慧眼' },
  { owner: 'jin_007', name: '屯田' },
  { owner: 'jin_008', name: '颂威' },
  { owner: 'jin_009', name: '破竹' },
  { owner: 'jin_010', name: '清德' },
  { owner: 'jin_010', name: '垦荒' },
  { owner: 'jin_011', name: '奋威' },
  { owner: 'jin_011', name: '临阵' },
  { owner: 'jin_012', name: '同命' },
  { owner: 'jin_013', name: '戮杀' },
  { owner: 'jin_014', name: '并吞' },
  { owner: 'jin_014', name: '封赏' },
  { owner: 'jin_015', name: '死节' },
];

/** §G tier-1 drafts demoted by the onDeploy probe, PROMOTED in v2.5.2. */
const PROMOTED2: Array<{ owner: string; name: string }> = [
  { owner: 'jin_008', name: '英慧' },
  { owner: 'jin_009', name: '拓略' },
  { owner: 'jin_012', name: '奋勇' },
];

/** Expected compile ids for the whole library after all batches landed. */
const ALL_IDS = [
  // batch one (v2.4.1)
  'wei_001:奸雄:e1', 'wei_003:刚烈:e1', 'wei_015:屯田:e1',
  'shu_009:狂骨:e1', 'shu_018:龙吟:e1', 'shu_019:伏枥:e1',
  'shu_021:烈刃:e1', 'qun_004:肉林:e1', 'qun_010:猛进:e1',
  // batch two (v2.4.2) — 苦肉 carries e1 (self-damage) + e2 (draw);
  // 晋邓艾's 屯田 coexists with 魏邓艾's (batch one) by ownerKey
  'wu_004:苦肉:e1', 'wu_004:苦肉:e2',
  ...BATCH2.filter(b => !(b.owner === 'wu_004' && b.name === '苦肉'))
    .map(b => `${b.owner}:${b.name}:e1`),
  // batch three (v2.5.0) — the first DISCARD-primitive skills (§G tier-2 via new primitive)
  'wei_002:反馈:e1', 'qun_012:断肠:e1',
  // onDeploy promotions (v2.5.2) — gap wired in v2.5.1, promoted after
  // the four-acceptance gate
  'jin_008:英慧:e1', 'jin_009:拓略:e1', 'jin_012:奋勇:e1',
  // batch four (v2.6.0) — the first EQUIP_STRIP-primitive skills (§G 装备区交互行)
  'wei_012:强袭:e1', 'qun_004:崩坏:e1',
  // batch five (v2.6.2) — the first onCardLost-filtered skills（事件源扩面：
  // DISCARD/EQUIP_STRIP 派生 CARD_LOST 后转正的 连营/枭姬）
  'wu_007:连营:e1', 'wu_008:枭姬:e1',
];

function compileAllGenerals() {
  const definitions: Array<ReturnType<typeof compileGeneralSkills>['definitions'][number] & { owner: string }> = [];
  const skipped: Array<SkillSkip & { owner: string }> = [];
  for (const g of allGenerals) {
    const result = compileGeneralSkills(g);
    definitions.push(...result.definitions.map(d => ({ ...d, owner: g.id })));
    skipped.push(...result.skipped.map(s => ({ ...s, owner: g.id })));
  }
  return { definitions, skipped };
}

describe('2.4.2 批量二 · 编译形态（§G 施工图逐字核对）', () => {
  const { definitions, skipped } = compileAllGenerals();

  it('24 条编译入局：全库共 40 条 runtime 定义（含 v2.6.0 EQUIP_STRIP 两条与 v2.6.2 onCardLost 两条）', () => {
    expect(definitions).toHaveLength(40);
    expect(definitions.map(d => d.id).sort()).toEqual([...ALL_IDS].sort());
    expect(skipped).toHaveLength(129);
    expect(skipped.every(s => s.reason === 'NO_RUNTIME_PAYLOAD')).toBe(true);
  });

  it('转正钉死：英慧/拓略/奋勇已带 runtime 载荷入局（v2.5.2 四件验收），不再出现在跳过名单', () => {
    for (const p of PROMOTED2) {
      const skip = skipped.find(s => s.owner === p.owner && s.skillName === p.name);
      expect(skip, `${p.owner}|${p.name}`).toBeUndefined();
      const def = definitions.find(d => d.id === `${p.owner}:${p.name}:e1`);
      expect(def, `${p.owner}|${p.name}`).toBeTruthy();
    }
  });

  it('装配哨兵：批量二在局 21 条零 NO_RUNTIME_PAYLOAD', () => {
    const batchKeys = new Set(BATCH2.map(b => `${b.owner}|${b.name}`));
    expect(batchKeys.size).toBe(21);
    expect(skipped.filter(s => batchKeys.has(`${s.owner}|${s.skillName}`))).toEqual([]);
  });

  it('每条都有面向玩家的中文描述（询问窗/简报可读）', () => {
    for (const d of definitions) {
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it('载荷逐字对表：触发/子滤/效果与 §G 拟载一致', () => {
    const byId = new Map(definitions.map(d => [d.id, d]));
    // 哨兵①数据面：苦肉双效果各自成义
    expect(byId.get('wu_004:苦肉:e1')).toMatchObject({
      trigger: 'onTurnStart', turnSubType: 'selfTurn', effectId: 'e1',
      effects: [{ type: 'DAMAGE', value: 1, target: 'SELF' }],
    });
    expect(byId.get('wu_004:苦肉:e2')).toMatchObject({
      trigger: 'onTurnStart', turnSubType: 'selfTurn', effectId: 'e2',
      effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(byId.get('wu_005:英姿:e1')).toMatchObject({
      trigger: 'onTurnEnd', turnSubType: 'selfTurn',
      effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(byId.get('wu_016:激昂:e1')).toMatchObject({
      trigger: 'onBecomingTarget',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byId.get('wu_018:追忆:e1')).toMatchObject({
      trigger: 'onDeath',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byId.get('wu_020:奋迅:e1')).toMatchObject({
      trigger: 'onTurnStart', turnSubType: 'selfTurn',
      effects: [{ type: 'GAIN_ARMOR', value: 1, target: 'SELF' }],
    });
    expect(byId.get('wu_021:补益:e1')).toMatchObject({
      trigger: 'onDamageTaken', damageTypeFilter: 'attack',
      effects: [{ type: 'HEAL', value: 1, target: 'SELF' }],
    });
    expect(byId.get('jin_003:司敌:e1')).toMatchObject({
      trigger: 'onDamageTaken', damageTypeFilter: 'skill',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byId.get('jin_004:帷幄:e1')).toMatchObject({
      trigger: 'onTurnStart', turnSubType: 'selfTurn',
      effects: [{ type: 'GAIN_ARMOR', value: 1, target: 'SELF' }],
    });
    expect(byId.get('jin_005:慧眼:e1')).toMatchObject({
      trigger: 'onDamageDealt', damageTypeFilter: 'attack',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    // 哨兵③收尾：跨势力重名"屯田"以独立定义并存
    expect(byId.get('jin_007:屯田:e1')).toMatchObject({
      trigger: 'onTurnEnd', turnSubType: 'selfTurn',
      effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(byId.get('jin_008:颂威:e1')).toMatchObject({
      trigger: 'onTurnEnd', turnSubType: 'selfTurn',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byId.get('jin_009:破竹:e1')).toMatchObject({
      trigger: 'onKill',
      effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(byId.get('jin_010:清德:e1')).toMatchObject({
      trigger: 'onTurnStart', turnSubType: 'selfTurn',
      effects: [{ type: 'HEAL', value: 1, target: 'SELF' }],
    });
    expect(byId.get('jin_010:垦荒:e1')).toMatchObject({
      trigger: 'onTurnEnd', turnSubType: 'selfTurn',
      effects: [{ type: 'GAIN_ARMOR', value: 1, target: 'SELF' }],
    });
    // 哨兵②数据面：链式 TARGET 载荷
    expect(byId.get('jin_011:奋威:e1')).toMatchObject({
      trigger: 'onDamageDealt', damageTypeFilter: 'attack',
      effects: [{ type: 'DAMAGE', value: 1, target: 'TARGET' }],
    });
    expect(byId.get('jin_011:临阵:e1')).toMatchObject({
      trigger: 'onDamageTaken', damageTypeFilter: 'attack',
      effects: [{ type: 'GAIN_ARMOR', value: 1, target: 'SELF' }],
    });
    expect(byId.get('jin_012:同命:e1')).toMatchObject({
      trigger: 'onDeath',
      effects: [{ type: 'DAMAGE', value: 1, target: 'ATTACKER' }],
    });
    expect(byId.get('jin_013:戮杀:e1')).toMatchObject({
      trigger: 'onKill',
      effects: [{ type: 'HEAL', value: 1, target: 'SELF' }],
    });
    expect(byId.get('jin_014:并吞:e1')).toMatchObject({
      trigger: 'onKill',
      effects: [{ type: 'GAIN_ARMOR', value: 2, target: 'SELF' }],
    });
    expect(byId.get('jin_014:封赏:e1')).toMatchObject({
      trigger: 'onTurnStart', turnSubType: 'selfTurn',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byId.get('jin_015:死节:e1')).toMatchObject({
      trigger: 'onDeath',
      effects: [{ type: 'DAMAGE', value: 2, target: 'ATTACKER' }],
    });
    // v2.5.2 转正三条：onDeploy 载荷逐字对 §G 拟载施工图
    expect(byId.get('jin_008:英慧:e1')).toMatchObject({
      trigger: 'onDeploy', effectId: 'e1',
      effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(byId.get('jin_009:拓略:e1')).toMatchObject({
      trigger: 'onDeploy', effectId: 'e1',
      effects: [{ type: 'GAIN_ARMOR', value: 2, target: 'SELF' }],
    });
    expect(byId.get('jin_012:奋勇:e1')).toMatchObject({
      trigger: 'onDeploy', effectId: 'e1',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    // v2.6.2 批量五：onCardLost 谓词滤条（连营=最后一张手牌 / 枭姬=装备牌，
    // 编译产物口径 cardFilter: 'lastHand'/'equipment'）
    expect(byId.get('wu_007:连营:e1')).toMatchObject({
      trigger: 'onCardLost', cardFilter: 'lastHand',
      effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(byId.get('wu_008:枭姬:e1')).toMatchObject({
      trigger: 'onCardLost', cardFilter: 'equipment',
      effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
  });

  it('同名"屯田"双实例（魏邓艾/晋邓艾）在同一个将集合里 id 无碰撞', () => {
    const ids = new Set<string>();
    for (const g of allGenerals) {
      for (const d of compileGeneralSkills(g).definitions) {
        expect(ids.has(d.id)).toBe(false);
        ids.add(d.id);
      }
    }
    expect(ids.size).toBe(40); // v2.6.2 连营/枭姬转正后全库定义数（无碰撞）
  });
});

describe('2.4.2 决策型批量二 · 询问窗候选直达 (真实模板)', () => {
  function stateWithField(playerId: number, generals: General[]): EngineState {
    const state = createInitialEngineState();
    state.players = [
      {
        id: playerId, name: 'P' + playerId,
        fieldGenerals: generals.map(g => ({ general: g, ownerId: playerId })),
      },
      { id: playerId === 1 ? 2 : 1, name: 'P-other', fieldGenerals: [] },
    ] as EngineState['players'];
    state.currentPlayerId = playerId;
    return state;
  }

  it('周瑜/晋邓艾/王元姬/羊祜同场时，回合结束询问窗各得真实候选（英姿抽2/屯田抽2/颂威抽1/垦荒+1甲）', () => {
    const clone = (srcId: string, newId: string): General => {
      const copy = JSON.parse(JSON.stringify(allGenerals.find(g => g.id === srcId)!)) as General;
      copy.id = newId;
      return copy;
    };
    const candidates = listTurnEndSkillCandidates(
      stateWithField(1, [
        clone('wu_005', 'g_zhou'), clone('jin_007', 'g_deng2'),
        clone('jin_008', 'g_wang'), clone('jin_010', 'g_yang'),
      ]), 1,
    );
    expect(candidates).toHaveLength(4);
    const bySkill = new Map(candidates.map(c => [c.definition.name, c]));
    expect(bySkill.get('英姿')?.definition).toMatchObject({
      id: 'g_zhou:英姿:e1', effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(bySkill.get('屯田')?.definition).toMatchObject({
      id: 'g_deng2:屯田:e1', effects: [{ type: 'DRAW_CARD', value: 2, target: 'SELF' }],
    });
    expect(bySkill.get('颂威')?.definition).toMatchObject({
      id: 'g_wang:颂威:e1', effects: [{ type: 'DRAW_CARD', value: 1, target: 'SELF' }],
    });
    expect(bySkill.get('垦荒')?.definition).toMatchObject({
      id: 'g_yang:垦荒:e1', effects: [{ type: 'GAIN_ARMOR', value: 1, target: 'SELF' }],
    });
  });
});
