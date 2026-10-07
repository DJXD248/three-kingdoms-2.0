/**
 * 「射程」这把钥匙的**录入面**证人（v2.9.0 射程刀）。
 *
 * 这一档不动结算数学（那是 `core/attackReach.test.ts` 与
 * `rules/battlefieldRules.test.ts`）。它钉的是"玩家看得见、又能填回引擎的词"这条纪律
 * （§12-110）在射程这一格上成立：
 *  ① 下拉里出现的每一把钥匙都必须有**真实读数点**（`WIRED_STAT_KEYS`）——选了没接线的
 *    钥匙＝"看起来能响其实不响"，本项目明令禁止的第三种谎。
 *  ② 大白话「射程」与原枚举名 `RANGE` 都能读进来；读不进的词交回原文点名，绝不静默丢。
 *  ③ 写出面**只产生新词**：`射程` 落进 Excel 再读回来逐字相同，旧形状（8 列）照旧能导入。
 *  ④ 一次性那档（用掉就销）不配射程：编译器那条白名单只放行「受到的伤害」，射程挂上去
 *    必须被点名跳过，不能悄悄落一笔没人销的账。
 */
import { describe, it, expect } from 'vitest';
import {
  STAT_KEY_HEADER,
  STAT_KEY_LIST,
  parseEffectGroup,
  readStatKeyCell,
  serializeEffectGroup,
  statKeyToStr,
  runtimeEffectTypeLabels,
  runtimeTargetLabels,
} from './skillExcelFormat';
import {
  statModifierKeyLabels,
  statModifyModeLabels,
} from '../data/generals';
import type { SkillEffect } from '../data/generals';
import { WIRED_STAT_KEYS } from '../core/statModifiers';
import { compileSkill } from './skillCompiler';

const RANGE = statModifierKeyLabels.RANGE;
const DELTA = statModifyModeLabels.delta;
const SET = statModifyModeLabels.set;

describe('射程 · 录入面（下拉词表与注册表）', () => {
  it('词表里多出来的那一个词就是「射程」，而且全库只有这一把钥匙叫它', () => {
    expect(RANGE).toBe('射程');
    expect(STAT_KEY_HEADER).toBe('改哪个数');
    const labels = Object.values(statModifierKeyLabels);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter(l => l === '射程')).toHaveLength(1);
    expect(STAT_KEY_LIST.split(',')).toEqual(['无', ...labels]);
  });

  it('下拉里每一把钥匙都有真实读数点（登记与接线不许分家）', () => {
    // 读数点：近战/远程攻击力＝`core/attackValue.ts`；体力上限＝`core/statModifiers.ts`
    // 的 effectiveMaxHp；受到的伤害＝`core/damageTaken.ts`；射程＝`core/attackReach.ts`。
    expect([...WIRED_STAT_KEYS].sort()).toEqual(Object.keys(statModifierKeyLabels).sort());
    expect(WIRED_STAT_KEYS).toContain('RANGE');
  });
});

describe('射程 · 读法与写法严格往返', () => {
  it('大白话与原枚举名都认；认不出的交回原文', () => {
    expect(readStatKeyCell('射程').value).toBe('RANGE');
    expect(readStatKeyCell('range').value).toBe('RANGE');
    expect(readStatKeyCell('RANGE').value).toBe('RANGE');
    expect(statKeyToStr('RANGE')).toBe('射程');
    expect(statKeyToStr(undefined)).toBe('无');
    // 「距离」「范围」这类近义词今天不在词表里：交回原文点名，绝不猜成射程。
    expect(readStatKeyCell('距离').unknown).toBe('距离');
    expect(readStatKeyCell('攻击范围').unknown).toBe('攻击范围');
  });

  it('一行射程账：序列化→读回→再序列化逐字相同', () => {
    const original: SkillEffect = {
      id: 'e1',
      label: '远射',
      trigger: { type: 'passive' },
      description: '射程加一',
      runtime: {
        type: 'MODIFY_STAT', stat: 'RANGE', modifyMode: 'delta', value: 1, target: 'SELF',
      },
    };
    const cells = serializeEffectGroup(original, 11);
    expect(cells.slice(8)).toEqual([RANGE, DELTA, '无']);
    const back = parseEffectGroup(cells, 0, 11)!;
    expect(back.statIssues).toEqual([]);
    expect(back.fields.runtime).toEqual(original.runtime);
    expect(serializeEffectGroup({ ...original, ...back.fields } as SkillEffect, 11)).toEqual(cells);
    expect(back.fields.runtime!.stat).toBe('RANGE');
  });

  it('固定形态与增减同格读写（射程也能被摁成某个档数）', () => {
    const cells = serializeEffectGroup({
      id: 'e1', label: '强弩', trigger: { type: 'passive' }, description: '射程固定为 3',
      runtime: { type: 'MODIFY_STAT', stat: 'RANGE', modifyMode: 'set', value: 3, target: 'SELF' },
    } as SkillEffect, 11);
    expect(cells.slice(8)).toEqual([RANGE, SET, '无']);
    expect(parseEffectGroup(cells, 0, 11)!.fields.runtime).toMatchObject({
      stat: 'RANGE', modifyMode: 'set', value: 3,
    });
  });

  it('旧形状（8 列）不含这三格：老文件照样导入，不凭空长出射程账', () => {
    const legacy = parseEffectGroup(
      ['远射', '无', runtimeEffectTypeLabels.MODIFY_STAT, '1', runtimeTargetLabels.SELF, '射程加一', '无', '无'],
      0, 8,
    )!;
    expect(legacy.fields.runtime!.stat).toBeUndefined();
    expect(legacy.statIssues.length).toBeGreaterThan(0);
  });
});

describe('射程 · 编译器纪律（不该收的账点名跳过）', () => {
  const owner = { id: 'g-range', name: '射程试将' };

  it('射程挂「用掉就销」＝点名跳过（一次性那档只有受到的伤害存在"用掉的那一刻"）', () => {
    const result = compileSkill(owner, {
      name: '样·一次性射程',
      description: '下一次远程攻击射程加一。',
      effects: [{
        id: 'e1',
        trigger: { type: 'onTurnStart', turnSubType: 'selfTurn' },
        runtime: {
          type: 'MODIFY_STAT', stat: 'RANGE', modifyMode: 'delta', value: 1,
          target: 'SELF', duration: 'thisDamage',
        },
      }],
    } as any);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: 'MODIFY_STAT_ONESHOT_KEY_UNSUPPORTED' }),
    ]);
    expect(result.definitions).toEqual([]);
  });

  it('在场常驻那一支照常编译（射程这笔账落在被动定义里）', () => {
    const result = compileSkill(owner, {
      name: '样·远射',
      description: '你的远程攻击多够得着一块区域。',
      effects: [{
        id: 'e1',
        trigger: { type: 'passive' },
        runtime: { type: 'MODIFY_STAT', stat: 'RANGE', modifyMode: 'delta', value: 1, target: 'SELF' },
      }],
    } as any);
    expect(result.skipped).toEqual([]);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]).toMatchObject({ passive: true });
    expect(result.definitions[0].effects[0]).toMatchObject({ type: 'MODIFY_STAT', stat: 'RANGE', value: 1 });
  });
});
