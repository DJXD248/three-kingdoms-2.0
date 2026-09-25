import { describe, it, expect } from 'vitest';
import {
  cleanCell,
  triggerToStr,
  strToTrigger,
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
} from './skillExcelFormat';
import type { SkillEffect } from '../data/generals';
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
});

describe('skillExcelFormat: runtime field parsers', () => {
  it('parses effect types by Chinese label and raw enum', () => {
    expect(parseRuntimeType('摸牌')).toBe('DRAW_CARD');
    expect(parseRuntimeType('伤害')).toBe('DAMAGE');
    expect(parseRuntimeType('damage')).toBe('DAMAGE');
    expect(parseRuntimeType('回复体力')).toBe('HEAL');
    expect(parseRuntimeType('弃牌')).toBe('DISCARD');
    expect(parseRuntimeType('discard')).toBe('DISCARD');
    expect(parseRuntimeType('无')).toBeUndefined();
    expect(parseRuntimeType('飞行')).toBeUndefined();
  });

  it('parses targets by label and raw enum', () => {
    expect(parseRuntimeTarget('自身')).toBe('SELF');
    expect(parseRuntimeTarget('ATTACKER')).toBe('ATTACKER');
    expect(parseRuntimeTarget('被作用者')).toBe('TARGET');
    expect(parseRuntimeTarget('无')).toBeUndefined();
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

  it('detects group width from the header row', () => {
    expect(detectEffectGroupWidth(v1Header)).toBe(3);
    expect(detectEffectGroupWidth(v2Header)).toBe(6);
  });

  it('builds v2 header cells for group n', () => {
    expect(effectGroupHeaders(2)).toEqual([
      '效果2标注', '效果2触发', '效果2效果类型', '效果2数值', '效果2目标', '效果2描述',
    ]);
  });

  it('parses a blank group as null', () => {
    expect(parseEffectGroup(['无', '无', '无', '无', '无', '无'], 0, 6)).toBeNull();
    expect(parseEffectGroup(['', '', ''], 0, 3)).toBeNull();
  });

  it('parses a legacy v1 group without runtime', () => {
    const fields = parseEffectGroup(['受伤摸牌', '受到伤害后→攻击伤害', '摸一张牌'], 0, 3);
    expect(fields).toEqual({
      label: '受伤摸牌',
      trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      description: '摸一张牌',
    });
    expect(fields?.runtime).toBeUndefined();
  });

  it('parses a v2 group with full runtime payload', () => {
    const row = ['反击', '造成伤害后', '伤害', '2', '被作用者', '对目标造成2点伤害'];
    const fields = parseEffectGroup(row, 0, 6);
    expect(fields).toEqual({
      label: '反击',
      trigger: { type: 'onDamageDealt' },
      description: '对目标造成2点伤害',
      runtime: { type: 'DAMAGE', value: 2, target: 'TARGET' },
    });
  });

  it('drops an unrecognized runtime type but keeps the description', () => {
    const row = ['玄学', '回合开始时', '召唤', '1', '自身', '描述文本'];
    const fields = parseEffectGroup(row, 0, 6);
    expect(fields?.runtime).toBeUndefined();
    expect(fields?.description).toBe('描述文本');
  });

  it('serializes missing effects as all-无 rows', () => {
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
      label: '奸雄',
      trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      description: '受到伤害后摸一张牌',
      runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' },
    });
  });

  it('round-trips an effect without runtime (descriptive)', () => {
    const original: SkillEffect = { id: 'e2', label: '描述技', trigger: { type: 'onKill' }, description: '击杀时...' };
    const parsed = parseEffectGroup(serializeEffectGroup(original, 6), 0, 6);
    expect(parsed?.runtime).toBeUndefined();
    expect(parsed?.description).toBe('击杀时...');
  });
});

describe('skillExcelFormat: Excel-parsed payloads reach the runtime compiler', () => {
  it('a v2-parsed effect compiles into a live DataSkillDefinition', () => {
    const cells = ['武圣', '造成伤害后', '伤害', '1', '被作用者', '造成伤害后追加1点技能伤害'];
    const fields = parseEffectGroup(cells, 0, 6)!;
    const skill = {
      name: '测试技能',
      effects: [{ id: 'e1', ...fields }],
      effectMode: 'all' as const,
    };
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '关羽' }, skill, 'g1_rt');
    expect(skipped).toHaveLength(0);
    expect(definitions).toHaveLength(1);
    expect(definitions[0].trigger).toBe('onDamageDealt');
    expect(definitions[0].effects[0]).toEqual({ type: 'DAMAGE', value: 1, target: 'TARGET' });
    expect(runtimeEffectTypeLabels.DRAW_CARD).toBe('摸牌');
    expect(runtimeTargetLabels.SELF).toBe('自身');
  });

  it('a legacy v1-parsed effect skips with NO_RUNTIME_PAYLOAD (no invented gameplay)', () => {
    const fields = parseEffectGroup(['旧效果', '回合开始时', '纯描述'], 0, 6)!;
    const skill = { name: '旧技能', effects: [{ id: 'e1', ...fields }], effectMode: 'all' as const };
    const { definitions, skipped } = compileSkill({ id: 'g1', name: '测试' }, skill);
    expect(definitions).toHaveLength(0);
    expect(skipped[0].reason).toBe('NO_RUNTIME_PAYLOAD');
  });
});
