import { describe, it, expect } from 'vitest';
import {
  cleanCell,
  triggerToStr,
  strToTrigger,
  readTriggerCell,
  buildTriggerOptionStrings,
  parseRuntimeType,
  parseRuntimeTarget,
  parseRuntimeValue,
  detectEffectGroupWidth,
  effectGroupHeaders,
  parseEffectGroup,
  serializeEffectGroup,
  runtimeEffectTypeLabels,
  runtimeTargetLabels,
  RUNTIME_TYPE_LIST,
  RUNTIME_TARGET_LIST,
  SETTLEABLE_RUNTIME_TYPE_LIST,
} from './skillExcelFormat';
import type { SkillEffect, SkillTriggerConfig } from '../data/generals';
import { compileSkill } from './skillCompiler';

describe('skillExcelFormat: cell cleaning', () => {
  it('normalizes blanks and the 无 placeholder', () => {
    expect(cleanCell('  ')).toBe('');
    expect(cleanCell('无')).toBe('');
    expect(cleanCell(undefined)).toBe('');
    expect(cleanCell(5)).toBe('5');
    expect(cleanCell('奸雄')).toBe('奸雄');
  });
});

describe('skillExcelFormat: trigger round-trip', () => {
  it('formats undefined/无 both ways', () => {
    expect(triggerToStr(undefined)).toBe('无');
    expect(strToTrigger('无')).toBeUndefined();
    expect(strToTrigger('')).toBeUndefined();
    expect(strToTrigger('不存在的触发')).toBeUndefined();
  });

  it('round-trips a plain trigger', () => {
    expect(triggerToStr({ type: 'onDeploy' })).toBe('将领登场时');
    expect(strToTrigger('将领登场时')).toEqual({ type: 'onDeploy' });
  });

  it('round-trips triggers with sub-options', () => {
    const t = { type: 'onDamageTaken', damageSubType: 'skillDamage' } as const;
    const s = triggerToStr(t);
    expect(s).toContain('→');
    expect(strToTrigger(s)).toEqual({ type: 'onDamageTaken', damageSubType: 'skillDamage' });
  });

  it('dropdown option list contains every round-trippable label', () => {
    const opts = buildTriggerOptionStrings();
    expect(opts[0]).toBe('无');
    expect(opts).toContain('将领登场时');
    expect(opts).toContain('击杀将领时→击杀其他玩家将领');
    // every generated option must parse back to a trigger
    for (const o of opts.slice(1)) {
      expect(strToTrigger(o)?.type).toBeTruthy();
    }
  });

  it('严格读法只认与下拉逐字相同的写法：半截细分交回"没看懂"，绝不放宽成所有伤害', () => {
    expect(readTriggerCell('受到伤害后→攻击伤害')).toEqual({ trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' } });
    // 宽松读法会把这句读成"未选细分＝所有伤害"——那是替用户放宽了他自己写的限制
    expect(strToTrigger('受到伤害后→攻击')).toEqual({ type: 'onDamageTaken' });
    expect(readTriggerCell('受到伤害后→攻击')).toEqual({ unreadable: '受到伤害后→攻击' });
    expect(readTriggerCell('不存在的触发')).toEqual({ unreadable: '不存在的触发' });
    expect(readTriggerCell('无')).toEqual({});
    expect(readTriggerCell('')).toEqual({});
    expect(readTriggerCell(undefined)).toEqual({});
    // 下拉里每一个选项都必须能过严格读法（否则录入面自相矛盾）
    for (const o of buildTriggerOptionStrings().slice(1)) {
      expect(readTriggerCell(o).trigger).toBeTruthy();
    }
  });
  it('round-trips the 2.5.3 card-loss/gain triggers（v2.6.2 起带 card 子选项）', () => {
    expect(triggerToStr({ type: 'onCardLost' })).toBe('失去手牌时');
    expect(strToTrigger('失去手牌时')).toEqual({ type: 'onCardLost' });
    expect(triggerToStr({ type: 'onCardGained' })).toBe('获得手牌时');
    expect(strToTrigger('获得手牌时')).toEqual({ type: 'onCardGained' });
    // v2.6.2：card 子谓词全链往返（连营/枭姬施工图口径）
    const lianying: SkillTriggerConfig = { type: 'onCardLost', cardSubType: 'lastHandLost' };
    expect(triggerToStr(lianying)).toBe('失去手牌时→失去最后一张手牌');
    expect(strToTrigger('失去手牌时→失去最后一张手牌')).toEqual(lianying);
    const xiaoji: SkillTriggerConfig = { type: 'onCardLost', cardSubType: 'equipmentLost' };
    expect(triggerToStr(xiaoji)).toBe('失去手牌时→失去装备牌');
    expect(strToTrigger('失去手牌时→失去装备牌')).toEqual(xiaoji);
    const opts = buildTriggerOptionStrings();
    expect(opts).toContain('失去手牌时→失去装备牌');
    expect(opts).toContain('获得手牌时→获得任意牌');
  });
});

describe('skillExcelFormat: runtime field parsers', () => {
  it('parses effect types by Chinese label and raw enum', () => {
    expect(parseRuntimeType('摸牌')).toBe('DRAW_CARD');
    expect(parseRuntimeType('伤害')).toBe('DAMAGE');
    expect(parseRuntimeType('damage')).toBe('DAMAGE');
    expect(parseRuntimeType('发放')).toBe('GIVE');
    expect(parseRuntimeType('give')).toBe('GIVE');
    expect(parseRuntimeType('回复体力')).toBe('HEAL');
    expect(parseRuntimeType('弃牌')).toBe('DISCARD');
    expect(parseRuntimeType('discard')).toBe('DISCARD');
    expect(parseRuntimeType('拆掉装备')).toBe('EQUIP_STRIP');
    expect(parseRuntimeType('剥离装备')).toBe('EQUIP_STRIP');
    expect(parseRuntimeType('equip_strip')).toBe('EQUIP_STRIP');
    expect(parseRuntimeType('看牌堆顶')).toBe('REVEAL');
    expect(parseRuntimeType('观顶')).toBe('REVEAL');
    expect(parseRuntimeType('reveal')).toBe('REVEAL');
    expect(parseRuntimeType('放回牌堆')).toBe('DECK_PLACE');
    expect(parseRuntimeType('置牌入堆')).toBe('DECK_PLACE');
    expect(parseRuntimeType('deck_place')).toBe('DECK_PLACE');
    expect(parseRuntimeType('无')).toBeUndefined();
    expect(parseRuntimeType('飞行')).toBeUndefined();
  });

  it('parses targets by label and raw enum', () => {
    expect(parseRuntimeTarget('自身')).toBe('SELF');
    expect(parseRuntimeTarget('ATTACKER')).toBe('ATTACKER');
    expect(parseRuntimeTarget('目标')).toBe('TARGET');
    expect(parseRuntimeTarget('被作用者')).toBe('TARGET');
    expect(parseRuntimeTarget('无')).toBeUndefined();
  });

  it('v2.8.4 词汇替换：旧行话只进不出——写出的永远是大白话', () => {
    const written = [...Object.values(runtimeEffectTypeLabels), ...Object.values(runtimeTargetLabels)];
    expect(written).toEqual(expect.arrayContaining(['拆掉装备', '看牌堆顶', '放回牌堆', '目标']));
    for (const legacy of ['剥离装备', '观顶', '置牌入堆', '被作用者']) {
      expect(written).not.toContain(legacy);
      expect(SETTLEABLE_RUNTIME_TYPE_LIST).not.toContain(legacy);
      expect(RUNTIME_TARGET_LIST).not.toContain(legacy);
    }
    // 下拉里每一个选项都必须被自家解析器认得（与触发栏严格读法同款纪律）
    for (const label of RUNTIME_TYPE_LIST.split(',')) expect(parseRuntimeType(label)).toBeDefined();
    for (const label of SETTLEABLE_RUNTIME_TYPE_LIST.split(',')) expect(parseRuntimeType(label)).toBeDefined();
    for (const label of RUNTIME_TARGET_LIST.split(',')) expect(parseRuntimeTarget(label)).toBeDefined();
  });

  it('parses values: positive integers only', () => {
    expect(parseRuntimeValue('2')).toBe(2);
    expect(parseRuntimeValue(3)).toBe(3);
    expect(parseRuntimeValue('2.7')).toBe(2);
    expect(parseRuntimeValue('0')).toBeUndefined();
    expect(parseRuntimeValue('-1')).toBeUndefined();
    expect(parseRuntimeValue('abc')).toBeUndefined();
    expect(parseRuntimeValue('无')).toBeUndefined();
  });
});

describe('skillExcelFormat: effect column groups', () => {
  const v1Header = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动', '触发时机', '效果模式', '技能描述',
    '效果1标注', '效果1触发', '效果1描述', '设定备注'];
  const v2Header = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动', '触发时机', '效果模式', '技能描述',
    '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '设定备注'];
  const v3Header = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动', '触发时机', '效果模式', '技能描述',
    '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛', '设定备注'];

  it('detects group width from the header row', () => {
    expect(detectEffectGroupWidth(v1Header)).toBe(3);
    expect(detectEffectGroupWidth(v2Header)).toBe(6);
    expect(detectEffectGroupWidth(v3Header)).toBe(7);
  });

  it('builds v3 header cells for group n', () => {
    expect(effectGroupHeaders(2)).toEqual([
      '效果2标注', '效果2触发', '效果2效果类型', '效果2数值', '效果2目标', '效果2描述', '效果2门槛',
    ]);
  });

  it('parses a blank group as null', () => {
    expect(parseEffectGroup(['无', '无', '无', '无', '无', '无', '无'], 0, 7)).toBeNull();
    expect(parseEffectGroup(['无', '无', '无', '无', '无', '无'], 0, 6)).toBeNull();
    expect(parseEffectGroup(['', '', ''], 0, 3)).toBeNull();
  });

  it('parses a legacy v1 group without runtime', () => {
    const { fields } = parseEffectGroup(['受伤摸牌', '受到伤害后→攻击伤害', '摸一张牌'], 0, 3)!;
    expect(fields).toEqual({
      label: '受伤摸牌',
      trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      description: '摸一张牌',
    });
    expect(fields.runtime).toBeUndefined();
  });

  it('parses a v2 group with full runtime payload', () => {
    const row = ['反击', '造成伤害后', '伤害', '2', '被作用者', '对目标造成2点伤害'];
    const { fields } = parseEffectGroup(row, 0, 6)!;
    expect(fields).toEqual({
      label: '反击',
      trigger: { type: 'onDamageDealt' },
      description: '对目标造成2点伤害',
      runtime: { type: 'DAMAGE', value: 2, target: 'TARGET' },
    });
  });

  it('drops an unrecognized runtime type but keeps the description', () => {
    const row = ['玄学', '回合开始时', '召唤', '1', '自身', '描述文本'];
    const { fields } = parseEffectGroup(row, 0, 6)!;
    expect(fields.runtime).toBeUndefined();
    expect(fields.description).toBe('描述文本');
  });

  it('parses the v3 门槛 column into structured conditions', () => {
    const row = ['罪论一', '回合结束时', '回复体力', '1', '自身', '手牌为1时回复1点体力', '手牌=1'];
    const parsed = parseEffectGroup(row, 0, 7)!;
    expect(parsed.fields.conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }]);
    expect(parsed.gateUnknown).toEqual([]);
  });

  it('只写门槛、没写是哪个效果的组：不凭空造效果，原文交回导入面；无＝没有门槛', () => {
    const row = ['无', '无', '无', '无', '无', '无', '手牌≤2'];
    const parsed = parseEffectGroup(row, 0, 7)!;
    expect(parsed.fields).toEqual({});          // 一个效果都不成立
    expect(parsed.orphanGate).toBe('手牌≤2');    // 原文仍在，报告要说清楚
    expect(parseEffectGroup(['无', '无', '无', '无', '无', '无', '无'], 0, 7)).toBeNull();
  });

  it('reports unreadable gate fragments instead of silently dropping them', () => {
    const row = ['玄学', '无', '摸牌', '1', '自身', '描述', '牌不够多时先看有没有马'];
    const parsed = parseEffectGroup(row, 0, 7)!;
    expect(parsed.fields.conditions).toBeUndefined();
    expect(parsed.gateUnknown).toEqual(['牌不够多时先看有没有马']);
  });

  it('serializes missing effects as all-无 rows', () => {
    expect(serializeEffectGroup(undefined, 7)).toEqual(['无', '无', '无', '无', '无', '无', '无']);
    expect(serializeEffectGroup(undefined, 6)).toEqual(['无', '无', '无', '无', '无', '无']);
    expect(serializeEffectGroup(undefined, 3)).toEqual(['无', '无', '无']);
  });

  it('round-trips an effect through serialize(v2) -> parse(v2)', () => {
    const original: SkillEffect = {
      id: 'e1',
      label: '奸雄',
      trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      description: '受到伤害后摸一张牌',
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    };
    const cells = serializeEffectGroup(original, 6);
    const parsed = parseEffectGroup(cells, 0, 6);
    expect(parsed).toEqual({
      fields: {
        label: '奸雄',
        trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
        description: '受到伤害后摸一张牌',
        runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      },
      gateUnknown: [],
    });
  });

  it('round-trips an effect through serialize(v3) -> parse(v3) incl. gates', () => {
    const original: SkillEffect = {
      id: 'e3',
      label: '父荫',
      trigger: { type: 'onDamageTaken' },
      description: '己方有手牌则本次伤害-1',
      runtime: { type: 'DAMAGE', value: 1, target: 'SELF' },
      conditions: [
        { metric: 'HAND_COUNT', op: 'GTE', value: 1 },
        { metric: 'HAND_COUNT', op: 'GT', compareTo: { metric: 'HAND_COUNT', subject: 'ATTACKER' } },
      ],
    };
    const cells = serializeEffectGroup(original, 7);
    expect(cells[6]).toBe('手牌≥1，手牌>伤害来源手牌');
    const parsed = parseEffectGroup(cells, 0, 7)!;
    expect(parsed.fields.conditions).toEqual(original.conditions);
    expect(parsed.gateUnknown).toEqual([]);
  });

  it('round-trips an effect without runtime (descriptive)', () => {
    const original: SkillEffect = { id: 'e2', label: '描述技', trigger: { type: 'onKill' }, description: '击杀时...' };
    const { fields } = parseEffectGroup(serializeEffectGroup(original, 6), 0, 6)!;
    expect(fields.runtime).toBeUndefined();
    expect(fields.description).toBe('击杀时...');
  });
});

describe('skillExcelFormat: Excel-parsed payloads reach the runtime compiler', () => {
  it('a v2-parsed effect compiles into a live DataSkillDefinition', () => {
    const cells = ['武圣', '造成伤害后', '伤害', '1', '被作用者', '造成伤害后追加1点技能伤害'];
    const { fields } = parseEffectGroup(cells, 0, 6)!;
    const skill = {
      name: '测试技能',
      effects: [{ id: 'e1', ...fields }],
      effectMode: 'all' as const,
    };
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '关羽' }, skill, 'g1_rt');
    expect(skipped).toHaveLength(0);
    expect(definitions).toHaveLength(1);
    expect(definitions[0].trigger).toBe('onDamageDealt');
    // 2.6.3：编译透传 description（choice 选项 label 第一来源），事件字节不受影响
    expect(definitions[0].effects[0]).toEqual({
      type: 'DAMAGE', value: 1, target: 'TARGET', description: '造成伤害后追加1点技能伤害',
    });
    expect(runtimeEffectTypeLabels.DRAW_CARD).toBe('摸牌');
    expect(runtimeTargetLabels.SELF).toBe('自身');
  });

  it('a v3-parsed effect carries its gate onto the definition', () => {
    const cells = ['罪论', '回合结束时', '回复体力', '1', '自身', '手牌为1时回复1点体力', '手牌=1'];
    const { fields } = parseEffectGroup(cells, 0, 7)!;
    const skill = { name: '罪论', effects: [{ id: 'e1', ...fields }], effectMode: 'all' as const };
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '诸葛瞻' }, skill);
    expect(skipped).toHaveLength(0);
    expect(definitions[0].conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }]);
  });

  it('a legacy v1-parsed effect skips with NO_RUNTIME_PAYLOAD (no invented gameplay)', () => {
    const { fields } = parseEffectGroup(['旧效果', '回合开始时', '纯描述'], 0, 6)!;
    const skill = { name: '旧技能', effects: [{ id: 'e1', ...fields }], effectMode: 'all' as const };
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '测试' }, skill);
    expect(definitions).toHaveLength(0);
    expect(skipped[0].reason).toBe('NO_RUNTIME_PAYLOAD');
  });
});
