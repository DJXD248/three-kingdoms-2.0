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
  readValueCell,
  WHOLE_HAND_LABEL,
  WHOLE_HAND_RUNTIME_TYPES,
  VALUELESS_RUNTIME_TYPES,
  SETTLEABLE_RUNTIME_TYPES,
  LISTENER_SCOPE_HEADER,
  LISTENER_SCOPE_LIST,
  listenerScopeToStr,
  readListenerScopeCell,
  detectEffectGroupWidth,
  detectEffectGroupStart,
  SKILL_GATE_HEADER,
  serializeSkillGate,
  parseSkillGate,
  effectGroupHeaders,
  parseEffectGroup,
  serializeEffectGroup,
  runtimeEffectTypeLabels,
  runtimeTargetLabels,
  RUNTIME_TYPE_LIST,
  RUNTIME_TARGET_LIST,
  SETTLEABLE_RUNTIME_TYPE_LIST,
} from './skillExcelFormat';
import type { SkillCondition, SkillEffect, SkillTriggerConfig } from '../data/generals';
import { allGenerals, listenerScopeLabels } from '../data/generals';
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
    // v2.8.18 裁决第 4 句：界面与表格里这个词统一叫「军备」（牌种本来就只有 粮草/材料/军备）。
    expect(triggerToStr(xiaoji)).toBe('失去手牌时→失去军备牌');
    expect(strToTrigger('失去手牌时→失去军备牌')).toEqual(xiaoji);
    const opts = buildTriggerOptionStrings();
    expect(opts).toContain('失去手牌时→失去军备牌');
    expect(opts).toContain('获得手牌时→获得任意牌');
    expect(opts.some(o => o.includes('装备'))).toBe(false);
  });

  it('旧词「失去装备牌」读入侧仍认，但绝不写出（v2.8.18 词汇收口）', () => {
    // 不认它＝用户手上那份旧 xlsx 导入后 cardSubType 静默丢失，枭姬放宽成"失去任意牌"。
    expect(readTriggerCell('失去手牌时→失去装备牌')).toEqual({
      trigger: { type: 'onCardLost', cardSubType: 'equipmentLost' },
    });
    // 只进不出：写出侧永远用现行词。
    expect(triggerToStr({ type: 'onCardLost', cardSubType: 'equipmentLost' })).not.toContain('装备');
    // 严格性没有被放宽：半截写法照旧交回"看不懂"。
    expect(readTriggerCell('失去手牌时→失去装备')).toEqual({ unreadable: '失去手牌时→失去装备' });
    // 宽松入口 `strToTrigger` 不带这枚别名——它是内部函数，宽窄由 readTriggerCell 唯一收口。
    expect(strToTrigger('失去手牌时→失去装备牌')).toEqual({ type: 'onCardLost' });
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

  it('parses values: 非负整数；0 是引擎的「全部」哨兵，必须原样认回', () => {
    expect(parseRuntimeValue('2')).toBe(2);
    expect(parseRuntimeValue(3)).toBe(3);
    expect(parseRuntimeValue('2.7')).toBe(2);
    // v2.8.12 #48：导出侧会把官方的 value:0（＝弃置全部手牌）原样写进格子。
    // 旧解析器按"最小 1"把 0 判成非法⇒导入自己的导出文件会把「弃置全部」
    // 悄悄改成「弃置 1 张」。0 从此是合法数值，负数仍然非法。
    expect(parseRuntimeValue('0')).toBe(0);
    expect(parseRuntimeValue(0)).toBe(0);
    expect(parseRuntimeValue('-1')).toBeUndefined();
    expect(parseRuntimeValue('abc')).toBeUndefined();
    expect(parseRuntimeValue('无')).toBeUndefined();
  });

  it('#48 断肠整组往返：导出写 0 ⇒ 导入读回 0，一张卡都不被自己改坏', () => {
    const duanchang = allGenerals.find(g => g.id === 'qun_012')!.skills
      .find(s => s.name === '断肠')!.effects![0];
    const cells = serializeEffectGroup(duanchang, 7);
    expect(cells[3]).toBe(0); // 「效果1数值」列原样写着 0
    const back = parseEffectGroup(cells, 0, 7)!;
    expect(back.fields.runtime).toEqual({ type: 'DISCARD', value: 0, target: 'ATTACKER' });
    expect(back.valueNote).toBeUndefined(); // 自己导出的文件回灌自己⇒不该点名
  });
});

describe('skillExcelFormat: 数值格按类型收口（v2.8.13 #49 方案 B＋2）', () => {
  it('弃牌/发放/放回牌堆：0 与「全部」都读成整只手', () => {
    for (const t of ['DISCARD', 'GIVE', 'DECK_PLACE'] as const) {
      expect(readValueCell('0', t)).toEqual({ value: 0 });
      expect(readValueCell('全部', t)).toEqual({ value: 0 });
      expect(readValueCell(WHOLE_HAND_LABEL, t)).toEqual({ value: 0 }); // 照着 GUI 抄也得能用
    }
  });

  it('其余类型填 0：按没填处理，并给出点名用的大白话理由', () => {
    for (const t of ['DRAW_CARD', 'DAMAGE', 'HEAL', 'GAIN_ARMOR', 'EQUIP_STRIP'] as const) {
      const read = readValueCell('0', t);
      expect(read.value).toBeUndefined();
      expect(read.note).toContain('按没填处理');
      expect(read.note).toContain(runtimeEffectTypeLabels[t]);
      expect(read.note).toContain('当成 1');
    }
    // REVEAL 是唯一不被引擎夹成 1 的：0 会真的"一张也不看"，必须单独提醒
    const reveal = readValueCell('0', 'REVEAL');
    expect(reveal.value).toBeUndefined();
    expect(reveal.note).toContain('看 0 张');
    expect(reveal.note).not.toContain('当成 1');
  });

  it('其余类型写「全部」：这个词不归它们管，按没填处理并点名', () => {
    for (const t of SETTLEABLE_RUNTIME_TYPES) {
      if (VALUELESS_RUNTIME_TYPES.includes(t)) continue; // 决斗另有专门一条（根本不读数）
      const read = readValueCell('全部', t);
      if (WHOLE_HAND_RUNTIME_TYPES.includes(t)) {
        expect(read).toEqual({ value: 0 });
      } else {
        expect(read.value).toBeUndefined();
        expect(read.note).toContain('全部');
        expect(read.note).toContain('按没填处理');
      }
    }
  });

  it('决斗（2.8 刀9）：数值格根本不读——填了才点名，「无」仍按没填不作声', () => {
    for (const cell of ['全部', '0', '3', WHOLE_HAND_LABEL]) {
      const read = readValueCell(cell, 'DUEL');
      expect(read.value).toBeUndefined();
      expect(read.note).toContain(runtimeEffectTypeLabels.DUEL);
      expect(read.note).toContain('按没填处理');
    }
    // 沿用其它类型的习惯：看不懂的话与「无」＝空着，不该为一句没填的话报警
    expect(readValueCell('无', 'DUEL')).toEqual({});
    expect(readValueCell('', 'DUEL')).toEqual({});
  });

  it('照旧：正数原样、空/无/非数字不填，负数仍然不当数', () => {
    expect(readValueCell('2', 'DRAW_CARD')).toEqual({ value: 2 });
    expect(readValueCell('无', 'DRAW_CARD')).toEqual({});
    expect(readValueCell('', 'DRAW_CARD')).toEqual({});
    expect(readValueCell('两', 'DRAW_CARD')).toEqual({});
    expect(readValueCell('-1', 'DRAW_CARD')).toEqual({});
    // 效果类型本身没认出来时，数值格无从按类型判⇒沿用旧行为（runtime 整段都不会挂上）
    expect(readValueCell('0', undefined)).toEqual({});
  });

  it('整组读入：三类认「全部」，其它类型的 0 会带出 valueNote', () => {
    const give = parseEffectGroup(['发牌', '无', '发放', '全部', '目标', '把牌给他', '无'], 0, 7)!;
    expect(give.fields.runtime).toEqual({ type: 'GIVE', value: 0, target: 'TARGET' });
    expect(give.valueNote).toBeUndefined();

    const reveal = parseEffectGroup(['窥看', '回合开始时', '看牌堆顶', 0, '自身', '偷看牌堆', '无'], 0, 7)!;
    expect(reveal.fields.runtime).toEqual({ type: 'REVEAL', target: 'SELF' });
    expect(reveal.fields.runtime!.value).toBeUndefined();
    expect(reveal.valueNote).toContain('看 0 张');
  });

  it('方案2「只进不出」：导出永远写数字 0，绝不写「全部」', () => {
    const cells = serializeEffectGroup(
      { id: 'e1', runtime: { type: 'DISCARD', value: 0, target: 'ATTACKER' } }, 7);
    expect(cells[3]).toBe(0);
    expect(cells).not.toContain('全部');
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

  it('builds v4 header cells for group n（v2.8.21 起第 8 列＝我听谁）', () => {
    expect(effectGroupHeaders(2)).toEqual([
      '效果2标注', '效果2触发', '效果2效果类型', '效果2数值', '效果2目标', '效果2描述', '效果2门槛', '效果2我听谁',
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

// v2.8.11 刀2 复算查出的账面缺口：整组门槛的**导出侧**此前只有导入侧的测试。
describe('skillExcelFormat — 「技能门槛」列（v2.8.11 整组门槛，导出侧）', () => {
  it('exports the group gate as one plain-language cell and reads it back identically', () => {
    expect(SKILL_GATE_HEADER).toBe('技能门槛');
    const gate: SkillCondition[] = [{ metric: 'HAND_COUNT', op: 'GTE', value: 9 }];
    const cell = serializeSkillGate(gate);
    expect(cell).toBe('手牌≥9');
    const back = parseSkillGate(cell);
    expect(back.conditions).toEqual(gate);
    expect(back.unknown).toEqual([]);
    // 「写法→结构→写法」往返：读回来的形状再导出必须逐字相同
    expect(serializeSkillGate(back.conditions)).toBe(cell);
  });

  it('exports 无 for an empty gate and parses it as no gate at all', () => {
    expect(serializeSkillGate(undefined)).toBe('无');
    expect(serializeSkillGate([])).toBe('无');
    for (const cell of ['无', '', '   ']) {
      const parsed = parseSkillGate(cell);
      expect(parsed.conditions).toBeUndefined();
      expect(parsed.unknown).toEqual([]);
    }
  });

  it('reports an unparseable clause instead of silently widening the gate', () => {
    const parsed = parseSkillGate('手牌≥9，血气方刚');
    expect(parsed.conditions).toEqual([{ metric: 'HAND_COUNT', op: 'GTE', value: 9 }]);
    expect(parsed.unknown).toEqual(['血气方刚']);
  });

  it('detects the effect-group start from the header, falling back to the legacy 11 columns', () => {
    const v4 = ['将领名称', '势力', '体力', '近战', '远程', '技能名称', '技能标签', '强制发动', '触发时机', '效果模式', '技能描述', SKILL_GATE_HEADER, '效果1标注'];
    expect(detectEffectGroupStart(v4)).toBe(12);
    const v3 = [...v4.slice(0, 11), '效果1标注'];
    expect(detectEffectGroupStart(v3)).toBe(11);
    // 认不出「效果1标注」＝回退 11（旧档逐字行为）
    expect(detectEffectGroupStart(['将领名称', '势力'])).toBe(11);
  });
});

describe('skillExcelFormat: 监听扩面（v2.8.21 「我听谁」＋「成为目标」来源档）', () => {
  it('新的来源档进了下拉，也认得回去', () => {
    const opts = buildTriggerOptionStrings();
    expect(opts).toContain('成为目标时→成为技能目标');
    expect(opts).toContain('成为目标时→成为目标（两种都算）');
    for (const opt of ['成为目标时→成为攻击目标', '成为目标时→成为技能目标', '成为目标时→成为目标（两种都算）']) {
      const read = readTriggerCell(opt);
      expect(read.unreadable).toBeUndefined();
      expect(triggerToStr(read.trigger)).toBe(opt);
    }
  });

  it('半截细分照样不认（绝不替用户放宽自己写下的限制）', () => {
    expect(readTriggerCell('成为目标时→攻击').unreadable).toBe('成为目标时→攻击');
    expect(readTriggerCell('成为目标时→技能').unreadable).toBe('成为目标时→技能');
  });

  it('旧写法「成为攻击目标时」只进不出：读得懂，写出来是现行说法', () => {
    const read = readTriggerCell('成为攻击目标时');
    expect(read.unreadable).toBeUndefined();
    expect(read.trigger).toEqual({ type: 'onBecomingTarget', targetSubType: 'attackTarget' });
    expect(triggerToStr(read.trigger)).toBe('成为目标时→成为攻击目标');
    // 写出面永远不会再产生旧词（单向门，v2.8.4 判据）
    expect(buildTriggerOptionStrings().some(s => s === '成为攻击目标时')).toBe(false);
  });

  it('「我听谁」三档认得、留空＝没填、认不出的原文交回', () => {
    for (const label of Object.values(listenerScopeLabels)) {
      expect(readListenerScopeCell(label).scope).toBeTruthy();
    }
    expect(readListenerScopeCell('无').scope).toBeUndefined();
    expect(readListenerScopeCell('').unknown).toBeUndefined();
    expect(readListenerScopeCell('听全队').unknown).toBe('听全队');
    expect(readListenerScopeCell(undefined).scope).toBeUndefined();
    expect(listenerScopeToStr(undefined)).toBe('无');
    expect(LISTENER_SCOPE_LIST.split(',')).toHaveLength(4);
  });

  it('表头认出 8 列组；旧档 3/6/7 列照常认（新列只在自己导出里出现）', () => {
    const v4Header = ['x', ...effectGroupHeaders(1), ...effectGroupHeaders(2)];
    expect(detectEffectGroupWidth(v4Header)).toBe(8);
    expect(effectGroupHeaders(1)).toHaveLength(8);
    expect(effectGroupHeaders(1)[7]).toBe('效果1' + LISTENER_SCOPE_HEADER);
    expect(detectEffectGroupWidth(['x', '效果1标注', '效果1触发', '效果1效果类型', '效果1数值', '效果1目标', '效果1描述', '效果1门槛'])).toBe(7);
  });

  it('效果组的「我听谁」挂在这一组自己的触发上，导出再导入逐字回来', () => {
    const original: SkillEffect = {
      id: 'e1',
      label: '护院',
      trigger: { type: 'onDamageTaken', listenerScope: 'allySeat' },
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
      description: '己方有人受伤就摸一张',
    };
    const cells = serializeEffectGroup(original, 8);
    expect(cells[7]).toBe('听己方（同一席位）');
    const back = parseEffectGroup(cells, 0, 8)!;
    expect(back.fields.trigger).toEqual(original.trigger);
    expect(back.scopeIgnored).toBeUndefined();
    expect(back.scopeUnknown).toBeUndefined();
    expect(serializeEffectGroup({ ...original, ...back.fields } as SkillEffect, 8)).toEqual(cells);
  });

  it('没细分的触发导出来是「无」，读回去也不带这一维（缺省＝扩面前行为）', () => {
    const plain: SkillEffect = { id: 'e1', label: '奸雄', trigger: { type: 'onDamageTaken' }, runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } };
    const cells = serializeEffectGroup(plain, 8);
    expect(cells[1]).toBe('受到伤害后');
    expect(cells[7]).toBe('无');
    const back = parseEffectGroup(cells, 0, 8)!;
    expect(back.fields.trigger).toEqual({ type: 'onDamageTaken' });
  });

  it('时机不认这一栏：点名退回，不静默收下', () => {
    const parsed = parseEffectGroup(['纯描述', '回合结束时', '摸牌', '1', '自身', '到回合结束摸一张', '无', '听场上（所有玩家）'], 0, 8)!;
    expect(parsed.scopeIgnored).toBe('听场上（所有玩家）');
    expect(parsed.fields.trigger).toEqual({ type: 'onTurnEnd' });
    const unknown = parseEffectGroup(['纯描述', '回合结束时', '摸牌', '1', '自身', '到回合结束摸一张', '无', '听隔壁'], 0, 8)!;
    expect(unknown.scopeUnknown).toBe('听隔壁');
  });

  it('只写了「我听谁」的一组不凭空造效果', () => {
    const parsed = parseEffectGroup(['无', '无', '无', '无', '无', '无', '无', '听场上（所有玩家）'], 0, 8)!;
    expect(parsed.fields).toEqual({});
    expect(parsed.scopeIgnored).toBe('听场上（所有玩家）');
    expect(parseEffectGroup(['无', '无', '无', '无', '无', '无', '无', '无'], 0, 8)).toBeNull();
    expect(serializeEffectGroup(undefined, 8)).toEqual(['无', '无', '无', '无', '无', '无', '无', '无']);
  });
});
