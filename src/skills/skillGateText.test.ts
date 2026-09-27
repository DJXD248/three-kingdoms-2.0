import { describe, it, expect } from 'vitest';
import {
  parseGateText, gateConditionsToText, GATE_SYNTAX_HINT,
  GATE_METRIC_LABELS, GATE_SUBJECT_LABELS,
} from './skillGateText';

describe('skillGateText · 门槛文本 -> 结构化条件', () => {
  it('空栏与「无」都是没有门槛', () => {
    for (const raw of ['', '   ', '无', undefined, null]) {
      expect(parseGateText(raw)).toEqual({ conditions: [], unknown: [] });
    }
  });

  it('认得六个度量与五种运算符', () => {
    expect(parseGateText('手牌≤2').conditions).toEqual([{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }]);
    expect(parseGateText('体力=1').conditions).toEqual([{ metric: 'GENERAL_HP', op: 'EQ', value: 1 }]);
    expect(parseGateText('护甲≥3').conditions).toEqual([{ metric: 'ARMOR_POINTS', op: 'GTE', value: 3 }]);
    expect(parseGateText('场上将领>0').conditions).toEqual([{ metric: 'FIELD_GENERAL_COUNT', op: 'GT', value: 0 }]);
    expect(parseGateText('牌堆<5').conditions).toEqual([{ metric: 'DECK_COUNT', op: 'LT', value: 5 }]);
    expect(parseGateText('本次伤害≥2').conditions).toEqual([{ metric: 'EVENT_VALUE', op: 'GTE', value: 2 }]);
  });

  it('汉字数字与中文运算符同样认得', () => {
    expect(parseGateText('手牌不少于两').conditions).toEqual([{ metric: 'HAND_COUNT', op: 'GTE', value: 2 }]);
    expect(parseGateText('手牌小于十').conditions).toEqual([{ metric: 'HAND_COUNT', op: 'LT', value: 10 }]);
    expect(parseGateText('手牌二十以上').unknown).toEqual(['手牌二十以上']);
  });

  it('对象前缀落成 subject；「自身」就是缺省，不额外落字段', () => {
    expect(parseGateText('自身手牌=0').conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 0 }]);
    expect(parseGateText('己方玩家手牌数量为1').conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 1 }]);
    expect(parseGateText('被作用者体力=1').conditions).toEqual([{ metric: 'GENERAL_HP', op: 'EQ', value: 1, subject: 'TARGET' }]);
    expect(parseGateText('伤害来源手牌>0').conditions).toEqual([{ metric: 'HAND_COUNT', op: 'GT', value: 0, subject: 'ATTACKER' }]);
  });

  it('右边可以是另一个量（compareTo）', () => {
    expect(parseGateText('手牌>自身手牌').conditions).toEqual([
      { metric: 'HAND_COUNT', op: 'GT', compareTo: { metric: 'HAND_COUNT' } },
    ]);
    expect(parseGateText('手牌>被作用者手牌').conditions).toEqual([
      { metric: 'HAND_COUNT', op: 'GT', compareTo: { metric: 'HAND_COUNT', subject: 'TARGET' } },
    ]);
  });

  it('「数量/数目/数」这类量词尾巴与赘词「为」不挡路（用户写的是白话不是代码）', () => {
    expect(parseGateText('手牌数量是2').conditions).toEqual([{ metric: 'HAND_COUNT', op: 'EQ', value: 2 }]);
    expect(parseGateText('场上将领数量至少为2').conditions).toEqual([{ metric: 'FIELD_GENERAL_COUNT', op: 'GTE', value: 2 }]);
    expect(parseGateText('牌堆数目不少于三').conditions).toEqual([{ metric: 'DECK_COUNT', op: 'GTE', value: 3 }]);
    expect(parseGateText('护甲数不超过1').conditions).toEqual([{ metric: 'ARMOR_POINTS', op: 'LTE', value: 1 }]);
    expect(parseGateText('手牌数量>自身体力数目').conditions).toEqual([
      { metric: 'HAND_COUNT', op: 'GT', compareTo: { metric: 'GENERAL_HP' } },
    ]);
    // 剥尾巴必须整词才算：「手牌数量2」缺运算符，仍属读不懂
    expect(parseGateText('手牌数量2').unknown).toEqual(['手牌数量2']);
  });

  it('牌堆与本次伤害是全局事实：写了对象也不落对象（评估器本就看不到它，留着是骗人）', () => {
    expect(parseGateText('被作用者牌堆≥5').conditions).toEqual([{ metric: 'DECK_COUNT', op: 'GTE', value: 5 }]);
    expect(parseGateText('伤害来源本次伤害>1').conditions).toEqual([{ metric: 'EVENT_VALUE', op: 'GT', value: 1 }]);
    expect(gateConditionsToText(parseGateText('被作用者牌堆≥5').conditions)).toBe('牌堆≥5');
  });

  it('多条用顿号/逗号/分号/换行分隔，语义是都要满足', () => {
    const { conditions, unknown } = parseGateText('手牌=1，牌堆≥2、体力>1；\n护甲=0');
    expect(unknown).toEqual([]);
    expect(conditions).toEqual([
      { metric: 'HAND_COUNT', op: 'EQ', value: 1 },
      { metric: 'DECK_COUNT', op: 'GTE', value: 2 },
      { metric: 'GENERAL_HP', op: 'GT', value: 1 },
      { metric: 'ARMOR_POINTS', op: 'EQ', value: 0 },
    ]);
  });

  it('读不懂的片段逐条进 unknown，绝不猜、绝不静默丢', () => {
    const { conditions, unknown } = parseGateText('手牌≤2，攻击范围内没有马，牌不够多时看情况');
    expect(conditions).toEqual([{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }]);
    expect(unknown).toEqual(['攻击范围内没有马', '牌不够多时看情况']);
  });

  it('半截话与错度量都不当成条件', () => {
    expect(parseGateText('手牌').unknown).toEqual(['手牌']);
    expect(parseGateText('手气≤2').unknown).toEqual(['手气≤2']);
    expect(parseGateText('手牌≤abc').unknown).toEqual(['手牌≤abc']);
    expect(parseGateText('手牌≤2≤3').unknown).toEqual(['手牌≤2≤3']);
  });
});

describe('skillGateText · 结构化条件 -> 表格文本', () => {
  it('没有条件时回「无」', () => {
    expect(gateConditionsToText(undefined)).toBe('无');
    expect(gateConditionsToText([])).toBe('无');
  });

  it('自身不写前缀，其余对象写出来', () => {
    expect(gateConditionsToText([{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }])).toBe('手牌≤2');
    expect(gateConditionsToText([{ metric: 'GENERAL_HP', op: 'EQ', value: 1, subject: 'ATTACKER' }])).toBe('伤害来源体力=1');
    expect(gateConditionsToText([
      { metric: 'HAND_COUNT', op: 'GT', compareTo: { metric: 'HAND_COUNT', subject: 'TARGET' } },
    ])).toBe('手牌>目标手牌');
  });

  it('写法 -> 结构 -> 写法 再解析一次结果不变（导出/导入往返）', () => {
    const raw = '己方玩家手牌=1，牌堆≥5，本次伤害>1';
    const first = parseGateText(raw);
    expect(first.unknown).toEqual([]);
    const text = gateConditionsToText(first.conditions);
    const second = parseGateText(text);
    expect(second.unknown).toEqual([]);
    expect(second.conditions).toEqual(first.conditions);
  });

  it('提示语存在且与实际能认的词一致（词表＝提示语的唯一来源）', () => {
    expect(GATE_SYNTAX_HINT).toContain('手牌≤2');
    for (const metric of Object.values(GATE_METRIC_LABELS)) {
      expect(parseGateText(`${metric}=1`).conditions).toHaveLength(1);
      expect(GATE_SYNTAX_HINT).toContain(metric);
    }
    for (const [enumKey, label] of Object.entries(GATE_SUBJECT_LABELS)) {
      const got = parseGateText(`${label}体力=1`).conditions;
      expect(got).toHaveLength(1);
      expect(got[0].subject).toBe(enumKey === 'SELF' ? undefined : enumKey);
      expect(GATE_SYNTAX_HINT).toContain(label);
      expect(gateConditionsToText(got)).toBe(`${enumKey === 'SELF' ? '' : label}体力=1`);
    }
  });

  it('旧行话「被作用者」照样读得懂，但写出来一律是「目标」（只接受、不写出）', () => {
    expect(parseGateText('被作用者体力=1').conditions)
      .toEqual(parseGateText('目标体力=1').conditions);
    expect(gateConditionsToText(parseGateText('被作用者体力=1').conditions)).toBe('目标体力=1');
    expect(gateConditionsToText(parseGateText('受击者手牌>自身手牌').conditions)).toBe('目标手牌>手牌');
  });
});
