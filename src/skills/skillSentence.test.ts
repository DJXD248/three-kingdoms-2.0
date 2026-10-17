/**
 * skillSentence 契约钉（#49 拼积木编辑器，v2.9.8）。
 *
 * 这一档要钉死的是三件事：
 * ① 每块积木都说得出一句完整话（宁缺勿半句：没填可结算效果＝空串）；
 * ② 描述文字为空或"就是上一次生成的那句"时跟着积木走，手改过就不再被覆盖；
 * ③ 词表与运行时预览同源（`runtimeEffectPhrases` 一份，界面两处读它）。
 */
import { describe, it, expect } from 'vitest';
import {
  runtimeEffectPhrases, effectSentence, skillSentence, triggerPhrase, gatePhrase,
  patchEffect, patchSkill, isHandWritten, isSkillHandWritten,
} from './skillSentence';
import {
  runtimeEffectTypeLabels, SETTLEABLE_RUNTIME_TYPES,
} from './skillExcelFormat';
import type { SkillEffect, SkillRuntimeEffect } from '../data/generals';

/** 给每种类型一块最小能说话的例子（值取各档的合法缺省，别拿不合法形态钉句子）。 */
const SAMPLES: Partial<Record<SkillRuntimeEffect['type'], SkillRuntimeEffect>> = {
  DRAW_CARD: { type: 'DRAW_CARD', value: 2, target: 'SELF' },
  DAMAGE: { type: 'DAMAGE', value: 1, target: 'TARGET' },
  HEAL: { type: 'HEAL', value: 1, target: 'SELF' },
  GAIN_ARMOR: { type: 'GAIN_ARMOR', value: 2, target: 'SELF' },
  DISCARD: { type: 'DISCARD', value: 0, target: 'SELF' },
  GIVE: { type: 'GIVE', value: 1, target: 'ATTACKER' },
  EQUIP_STRIP: { type: 'EQUIP_STRIP', value: 1, target: 'TARGET' },
  REVEAL: { type: 'REVEAL', value: 3, target: 'SELF' },
  DECK_PLACE: { type: 'DECK_PLACE', value: 0, target: 'SELF' },
  DUEL: { type: 'DUEL', target: 'TARGET' },
  MODIFY_STAT: { type: 'MODIFY_STAT', value: 1, target: 'SELF', stat: 'RANGED_ATK', modifyMode: 'delta' },
  GAIN_SKILL: { type: 'GAIN_SKILL', target: 'SELF', skillName: '屯田' },
};

describe('①一块积木＝一句完整话', () => {
  it('词表覆盖面：每个效果类型都有话说（新增类型时这条先红，逼着补词）', () => {
    const missing = (Object.keys(runtimeEffectTypeLabels) as SkillRuntimeEffect['type'][])
      .filter(t => typeof runtimeEffectPhrases[t] !== 'function');
    expect(missing).toEqual([]);
  });

  it('十二档类型各出一句，句子里带这块积木的关键事实', () => {
    for (const type of SETTLEABLE_RUNTIME_TYPES) {
      const sample = SAMPLES[type];
      expect(sample, `夹具缺 ${type}`).toBeTruthy();
      const text = effectSentence({ runtime: sample });
      expect(text.endsWith('。'), `${type} 那句没收尾：${text}`).toBe(true);
      expect(text.length).toBeGreaterThan(3);
    }
    expect(effectSentence({ runtime: SAMPLES.DRAW_CARD })).toBe('摸 2 张牌。');
    expect(effectSentence({ runtime: SAMPLES.DISCARD })).toContain('全部');
    expect(effectSentence({ runtime: SAMPLES.DUEL })).toContain('六次');
    expect(effectSentence({ runtime: SAMPLES.MODIFY_STAT })).toContain('远程攻击力');
    expect(effectSentence({ runtime: SAMPLES.GAIN_SKILL })).toContain('「屯田」');
  });

  it('没填可结算积木＝空串，绝不生成半句（只有时机的那半句会把人误导成"这会响"）', () => {
    expect(effectSentence({ trigger: { type: 'onDamageTaken' } })).toBe('');
    expect(skillSentence({ effects: [{ id: 'e1', trigger: { type: 'onDeploy' } }] })).toBe('');
  });

  it('时机／门槛各归各位：顺序＝时机，对谁，要满足…，做什么', () => {
    const eff: SkillEffect = {
      id: 'e1',
      trigger: { type: 'onDamageTaken', damageSubType: 'attackDamage' },
      conditions: [{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }],
      runtime: { type: 'HEAL', value: 3, target: 'ATTACKER' },
    };
    expect(effectSentence(eff)).toBe('受到伤害后（攻击伤害），对伤害来源，要满足手牌≤2，回复 3 点体力。');
    expect(triggerPhrase({ type: 'onDamageTaken' })).toBe('受到伤害后');
    expect(gatePhrase(undefined)).toBe('');
    expect(gatePhrase([{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }])).toBe('要满足手牌≤2');
  });

  it('「对象」那一格只有引擎真读的档位才写出来：默认档（目标）不重复标', () => {
    // 引擎真读对象的这几档，选到"伤害来源/自身"才写出来（选"目标"＝默认，句子照旧）。
    expect(effectSentence({ runtime: { type: 'DAMAGE', value: 1, target: 'SELF' } }))
      .toBe('对自身，造成 1 点技能伤害。');
    expect(effectSentence({ runtime: { type: 'DAMAGE', value: 1, target: 'TARGET' } }))
      .toBe('造成 1 点技能伤害。');
    expect(effectSentence({ runtime: { type: 'GIVE', value: 2, target: 'ATTACKER' } }))
      .toBe('给伤害来源，发放 2 张手牌。');
  });

  it('引擎不读对象的那几档，界面上那个下拉选了也不写进句子（写了就是替引擎说假话）', () => {
    for (const type of ['DRAW_CARD', 'REVEAL', 'DECK_PLACE'] as const) {
      const text = effectSentence({ runtime: { type, value: 1, target: 'ATTACKER' } as SkillRuntimeEffect });
      expect(text, `${type} 不该出现"对谁"：${text}`).not.toContain('伤害来源');
      expect(text).not.toContain('目标');
    }
    // 决斗把对手写在句子自己里，所以也照引擎读的那一格取名。
    expect(effectSentence({ runtime: { type: 'DUEL', target: 'ATTACKER' } }))
      .toBe('与伤害来源将领决斗（双方各三轮，最多六次）。');
  });

  it('总述把每条各说一句接起来；「选择其一」先说明是择一', () => {
    const effects: SkillEffect[] = [
      { id: 'e1', runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } },
      { id: 'e2', runtime: { type: 'GAIN_ARMOR', value: 1, target: 'TARGET' } },
    ];
    expect(skillSentence({ effects })).toBe('摸 1 张牌；获得 1 点护甲。');
    expect(skillSentence({ effects, effectMode: 'choice' })).toBe('以下择一，摸 1 张牌；获得 1 点护甲。');
    expect(skillSentence({ effects, conditions: [{ metric: 'GENERAL_HP', op: 'EQ', value: 1 }] }))
      .toBe('要满足体力=1，摸 1 张牌；获得 1 点护甲。');
  });
});

describe('②手改过的那句，积木不再动它', () => {
  const blocks = { runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } as SkillRuntimeEffect };

  it('描述空 ⇒ 积木替用户把话写出来', () => {
    const next = patchEffect({ id: 'e1' }, { ...blocks, trigger: { type: 'onDeploy' } });
    expect(next.description).toBe('将领登场时，摸 1 张牌。');
  });

  it('描述正是上一次生成的那句 ⇒ 继续跟着积木走', () => {
    const first = patchEffect({ id: 'e1' }, { ...blocks });
    expect(first.description).toBe('摸 1 张牌。');
    const second = patchEffect(first, { runtime: { type: 'DRAW_CARD', value: 2, target: 'SELF' } });
    expect(second.description).toBe('摸 2 张牌。');
  });

  it('手打过一次 ⇒ 从此只按手改的留着，积木再变也不覆盖', () => {
    let eff = patchEffect({ id: 'e1' }, { ...blocks });
    eff = { ...eff, description: '摸一张牌，然后可以额外移动一次。' };
    const after = patchEffect(eff, { runtime: { type: 'DRAW_CARD', value: 5, target: 'SELF' } });
    expect(after.description).toBe('摸一张牌，然后可以额外移动一次。');
    expect(after.runtime?.value).toBe(5);
    expect(isHandWritten(after.description, after)).toBe(true);
  });

  it('手打的字与生成串一模一样 ⇒ 自动接回积木（不需要额外开关）', () => {
    const eff: SkillEffect = { id: 'e1', description: '摸 1 张牌。', ...blocks };
    expect(isHandWritten(eff.description, eff)).toBe(false);
    const after = patchEffect(eff, { runtime: { type: 'DRAW_CARD', value: 4, target: 'SELF' } });
    expect(after.description).toBe('摸 4 张牌。');
  });

  it('用户正在打字（patch 里带 description）⇒ 原样落，绝不被生成句抢回去', () => {
    const typed = patchEffect({ id: 'e1', description: '摸 1 张牌。' }, { description: '摸两张牌' });
    expect(typed.description).toBe('摸两张牌');
  });

  it('积木没拼出可结算效果 ⇒ 不覆盖任何已有文字', () => {
    const eff: SkillEffect = { id: 'e1', description: '出牌阶段限一次，你可以…' };
    expect(patchEffect(eff, { trigger: { type: 'onTurnStart' } }).description)
      .toBe('出牌阶段限一次，你可以…');
  });

  it('总述同理：手改过就留着，改子效果时没手改则跟着变', () => {
    const skill = {
      name: '试', description: '',
      effects: [{ id: 'e1', runtime: { type: 'DRAW_CARD', value: 1, target: 'SELF' } as SkillRuntimeEffect }] as SkillEffect[],
    };
    const followed = patchSkill(skill, {
      effects: [{ id: 'e1', runtime: { type: 'HEAL', value: 2, target: 'TARGET' } }],
    });
    expect(followed.description).toBe('回复 2 点体力。');
    const kept = patchSkill({ ...followed, description: '回复两点体力。' }, {
      effects: [{ id: 'e1', runtime: { type: 'HEAL', value: 3, target: 'TARGET' } }],
    });
    expect(kept.description).toBe('回复两点体力。');
    expect(isSkillHandWritten(kept.description, kept)).toBe(true);
  });
});
