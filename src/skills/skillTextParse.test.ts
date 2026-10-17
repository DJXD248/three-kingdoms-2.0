/**
 * skillTextParse（v2.9.9「玩家自己写一句效果 → 反推成积木」）的证人。
 *
 * 最有分量的那一条是**往返钉**：把积木生成出来的那句话再解回积木、再生成一次，
 * 必须逐字回到原句。这一条同时钉住两侧——生成侧漏说一个字段（反解就拿不到），
 * 解析侧少接一种写法（解不回去），两边任何一边漂了都会红。
 *
 * 第二条硬规矩＝**读不懂的必须逐段点名**：任何一段没吃下去，`issues` 里要能看见
 * 那一段自己的原文与一句能照着改的理由；绝不静默丢、绝不猜一个像的出来。
 */

import { describe, expect, it } from 'vitest';
import { allGenerals, General, Skill, SkillEffect } from '../data/generals';
import { effectSentence, skillSentence } from './skillSentence';
import { parseSkillText, canAdopt } from './skillTextParse';
import { compileGeneralSkills } from './skillCompiler';

/** 往返：原积木 → 那句卡面话 → 再解回积木 → 再生成 ⇒ 逐字同一句，且零退回。 */
function expectRoundTrip(effect: SkillEffect) {
  const sentence = effectSentence(effect);
  expect(sentence).not.toBe('');
  const draft = parseSkillText(sentence);
  expect(draft.issues.map(i => `${i.raw} → ${i.reason}`)).toEqual([]);
  expect(draft.effects).toHaveLength(1);
  expect(effectSentence(draft.effects[0])).toBe(sentence);
  return draft.effects[0];
}

const T = { type: 'onDamageDealt' } as const;

describe('skillTextParse：生成出来的那句话必须能原样解回来', () => {
  it('十二档效果各自往返一次，含数值 0＝整只手、牌堆顶／底、场合与周期', () => {
    const cases: SkillEffect[] = [
      { id: 'e1', trigger: T, runtime: { type: 'DRAW_CARD', value: 2 } },
      { id: 'e2', trigger: T, runtime: { type: 'DRAW_CARD', value: 0 } },
      { id: 'e3', trigger: T, runtime: { type: 'DAMAGE', value: 1 } },
      { id: 'e4', trigger: T, runtime: { type: 'HEAL', value: 3 } },
      { id: 'e5', trigger: T, runtime: { type: 'GAIN_ARMOR', value: 2 } },
      { id: 'e6', trigger: T, runtime: { type: 'DISCARD', value: 0 } },
      { id: 'e7', trigger: T, runtime: { type: 'GIVE', value: 1, target: 'SELF' } },
      { id: 'e8', trigger: T, runtime: { type: 'EQUIP_STRIP', value: 1, target: 'ATTACKER' } },
      { id: 'e9', trigger: T, runtime: { type: 'REVEAL', value: 3 } },
      { id: 'e10', trigger: T, runtime: { type: 'DECK_PLACE', value: 1, dest: 'TOP' } },
      { id: 'e11', trigger: T, runtime: { type: 'DECK_PLACE', value: 0 } },
      { id: 'e12', trigger: T, runtime: { type: 'DUEL' } },
      { id: 'e13', trigger: T, runtime: { type: 'DUEL', target: 'SELF' } },
      { id: 'e14', trigger: T, runtime: { type: 'GAIN_SKILL', skillName: '怒斩' } },
    ];
    for (const effect of cases) expectRoundTrip(effect);
  });

  it('改数那一档把钥匙、增减／摁成、场合、周期四样都说得出、也解得回', () => {
    const cases: SkillEffect[] = [
      { id: 'm1', trigger: T, runtime: { type: 'MODIFY_STAT', stat: 'RANGE', modifyMode: 'delta', value: 1 } },
      { id: 'm2', trigger: T, runtime: { type: 'MODIFY_STAT', stat: 'MELEE_ATK', modifyMode: 'delta', value: -2 } },
      { id: 'm3', trigger: T, runtime: { type: 'MODIFY_STAT', stat: 'MAX_HP', modifyMode: 'set', value: 3 } },
      { id: 'm4', trigger: T, runtime: { type: 'MODIFY_STAT', stat: 'DAMAGE_DEALT', modifyMode: 'delta', value: 1, occasion: 'duel' } },
      { id: 'm5', trigger: T, runtime: { type: 'MODIFY_STAT', stat: 'DAMAGE_DEALT', modifyMode: 'delta', value: 1, occasion: 'meleeVsArmored' } },
      { id: 'm6', trigger: T, runtime: { type: 'MODIFY_STAT', stat: 'RANGED_ATK', modifyMode: 'delta', value: 1, duration: 'untilSelfTurnEnd' } },
      { id: 'm7', trigger: T, runtime: { type: 'MODIFY_STAT', stat: 'DAMAGE_TAKEN', modifyMode: 'set', value: 0, duration: 'untilOtherTurnEnd' } },
      { id: 'm8', trigger: T, runtime: { type: 'MODIFY_STAT', stat: 'DAMAGE_DEALT', modifyMode: 'delta', value: 1, occasion: 'duel', duration: 'thisDamage' } },
    ];
    for (const effect of cases) expectRoundTrip(effect);
  });

  it('时机（含细分与"我听谁"）、逐项门槛都能往返', () => {
    const cases: SkillEffect[] = [
      { id: 't1', trigger: { type: 'onOtherDeploy', deploySubType: 'enemyDeploy' }, runtime: { type: 'DRAW_CARD', value: 1 } },
      { id: 't2', trigger: { type: 'onDamageTaken', damageSubType: 'skillDamage', listenerScope: 'field' }, runtime: { type: 'GAIN_ARMOR', value: 1 } },
      { id: 't3', trigger: { type: 'onBecomingTarget' }, runtime: { type: 'DAMAGE', value: 1 } },
      { id: 't4', trigger: { type: 'onBecomingTarget', targetSubType: 'anyTarget' }, runtime: { type: 'DAMAGE', value: 1 } },
      { id: 't5', trigger: { type: 'untilExpire', expireCondition: 'untilDeath' }, runtime: { type: 'MODIFY_STAT', stat: 'RANGE', modifyMode: 'delta', value: 1 } },
      { id: 't6', trigger: { type: 'onTurnStart' }, conditions: [{ metric: 'HAND_COUNT', op: 'LTE', value: 2 }], runtime: { type: 'HEAL', value: 1 } },
      { id: 't7', trigger: { type: 'onTurnStart' }, conditions: [{ metric: 'HAND_COUNT', op: 'GTE', value: 1 }, { metric: 'DECK_COUNT', op: 'GTE', value: 5 }], runtime: { type: 'DRAW_CARD', value: 1 } },
    ];
    for (const effect of cases) {
      const parsed = expectRoundTrip(effect);
      expect(parsed.conditions ?? []).toEqual(effect.conditions ?? []);
    }
  });

  it('整条技能（多块积木＋择一／依次两种模式）也能整句往返', () => {
    const skill = {
      effectMode: 'chain' as const,
      conditions: [{ metric: 'HAND_COUNT' as const, op: 'LTE' as const, value: 1 }],
      effects: [
        { id: 'e1', trigger: { type: 'onTurnStart' as const }, runtime: { type: 'DRAW_CARD' as const, value: 1 } },
        { id: 'e2', trigger: { type: 'onTurnStart' as const }, runtime: { type: 'HEAL' as const, value: 1 } },
      ],
    };
    const text = skillSentence(skill);
    expect(text.startsWith('以下依次生效，')).toBe(true);
    const draft = parseSkillText(text);
    expect(draft.issues).toEqual([]);
    expect(draft.effectMode).toBe('chain');
    expect(draft.conditions).toEqual(skill.conditions);
    expect(draft.effects.map(e => effectSentence(e))).toEqual(
      skill.effects.map(e => effectSentence(e)),
    );
  });

  it('「以下择一」与「以下依次生效」是两种不同的解，不会糊成同一个', () => {
    const two = (head: string) => parseSkillText(
      `${head}，受到伤害后，回复 1 点体力；受到伤害后，获得 2 点护甲。`,
    );
    expect(two('以下择一').effectMode).toBe('choice');
    expect(two('以下依次生效').effectMode).toBe('chain');
    expect(two('').effectMode).toBeUndefined();
    expect(two('').effects).toHaveLength(2);
  });
});

describe('skillTextParse：读不懂的一律逐段点名，绝不猜', () => {
  it('要作用在"别人"身上 ⇒ 点名退回，并说明那一格是留给未来的', () => {
    const draft = parseSkillText('其他角色摸两张牌。');
    expect(draft.effects).toHaveLength(0);
    expect(draft.issues).toHaveLength(1);
    expect(draft.issues[0].raw).toContain('其他角色摸两张牌');
    expect(draft.issues[0].reason).toContain('还没做');
  });

  it('一句里面"动作"认识、"对谁"不认识 ⇒ 整段退回，不做半条积木', () => {
    const draft = parseSkillText('对场上所有人，造成 1 点技能伤害。');
    expect(draft.effects).toHaveLength(0);
    expect(draft.issues.map(i => i.raw).join('')).toContain('对场上所有人');
  });

  it('「若…则…」这种链式手打写法 ⇒ 教他改用哪一句', () => {
    const draft = parseSkillText('若摸牌则回复 1 点体力。');
    expect(draft.effects).toHaveLength(0);
    expect(draft.issues[0].reason).toContain('以下依次生效');
  });

  it('徽章词写在效果句里 ⇒ 指出它归徽章那一格管', () => {
    const draft = parseSkillText('限定技，回复 1 点体力。');
    expect(draft.effects).toHaveLength(1);
    expect(draft.issues[0].reason).toContain('徽章');
  });

  it('数字读不出、钥匙不在名册、场合挂错钥匙 ⇒ 三种理由各写各的', () => {
    expect(parseSkillText('造成 abc 点技能伤害。').issues[0].reason).toContain('数量');
    expect(parseSkillText('让护甲增加 1。').issues[0].reason).toContain('近战攻击力');
    const wrongKey = parseSkillText('让射程增加 1（决斗时）。');
    expect(wrongKey.issues[0].reason).toContain('只有钥匙「造成的伤害」');
  });

  it('门槛写法不对 ⇒ 门槛那一段单独退回，动作照旧收', () => {
    const draft = parseSkillText('受到伤害后，要满足我很强，造成 1 点技能伤害。');
    expect(draft.effects).toHaveLength(1);
    expect(draft.effects[0].conditions ?? []).toEqual([]);
    expect(draft.issues[0].raw).toContain('我很强');
  });

  it('读不懂的一段排在动作**后面** ⇒ 前面那件照做，那一段单独点名（不是整句作废）', () => {
    // 2026-10-17 浏览器实测踩到的那句：玩家写了一半能懂的、一半还没做的。
    const draft = parseSkillText('回合开始时，摸 2 张牌，然后跳过他的判定阶段。');
    expect(draft.effects).toHaveLength(1);
    expect(effectSentence(draft.effects[0])).toBe('回合开始时，摸 2 张牌。');
    expect(draft.issues.map(i => i.raw)).toContain('跳过他的判定阶段');
    expect(draft.issues[0].reason).toContain('另起一句');
    expect(draft.ignored).toContain('然后');
  });

  it('一段里写了两件事 ⇒ 留住第一件，第二件点名让他另起一句（绝不悄悄顶掉）', () => {
    const draft = parseSkillText('受到伤害后，摸 2 张牌，回复 1 点体力。');
    expect(draft.effects).toHaveLength(1);
    expect(draft.effects[0].runtime).toEqual({ type: 'DRAW_CARD', value: 2 });
    expect(draft.issues[0].raw).toBe('回复 1 点体力');
    expect(draft.issues[0].reason).toContain('一段只认一件事');
  });

  it('空话、纯标点 ⇒ 一块积木也没有，也不报错', () => {
    for (const text of ['', '  ', '。。。', '。；']) {
      const draft = parseSkillText(text);
      expect(draft.effects).toEqual([]);
      expect(draft.issues).toEqual([]);
      expect(canAdopt(draft)).toBe(false);
    }
  });
});

describe('skillTextParse：手打的写法与生成串一视同仁', () => {
  it('空格、连接词、"点伤害"没写"技能"两字都认', () => {
    const draft = parseSkillText('受到伤害后，你可以造成1点伤害。');
    expect(draft.effects).toHaveLength(1);
    expect(draft.issues).toEqual([]);
    expect(draft.ignored).toContain('你可以');
    expect(effectSentence(draft.effects[0])).toBe('受到伤害后，造成 1 点技能伤害。');
  });

  it('中文数词与阿拉伯数字同解', () => {
    expect(parseSkillText('摸两张牌').effects[0].runtime).toEqual({ type: 'DRAW_CARD', value: 2 });
    expect(parseSkillText('摸2张牌').effects[0].runtime).toEqual({ type: 'DRAW_CARD', value: 2 });
    expect(parseSkillText('摸十二张牌').effects[0].runtime).toEqual({ type: 'DRAW_CARD', value: 12 });
  });

  it('旧行话（观顶、拆掉装备）只进不出：这里照样读得懂', () => {
    expect(parseSkillText('观顶3张').effects[0].runtime).toEqual({ type: 'REVEAL', value: 3 });
    expect(parseSkillText('拆掉 1 张装备卡').effects[0].runtime).toEqual({ type: 'EQUIP_STRIP', value: 1 });
  });

  it('一段公用时机＋分号并列两件事 ⇒ 两块积木各带这个时机', () => {
    const draft = parseSkillText('造成伤害后。对目标，弃 1 张手牌；摸 1 张牌。');
    expect(draft.effects).toHaveLength(2);
    expect(draft.trigger?.type).toBe('onDamageDealt');
    expect(draft.effects[0].runtime).toEqual({ type: 'DISCARD', value: 1, target: 'TARGET' });
    expect(draft.effects[1].runtime).toEqual({ type: 'DRAW_CARD', value: 1 });
  });

  it('采用之前先给玩家看"这句系统会怎么说"⇒描述＝生成串，采用后还跟积木走', () => {
    const draft = parseSkillText('受到伤害后，对伤害来源，获得 2 点护甲。');
    const effect = draft.effects[0];
    expect(effect.description).toBe(effectSentence(effect));
    expect(effect.runtime).toEqual({ type: 'GAIN_ARMOR', value: 2, target: 'ATTACKER' });
  });
});

describe('skillTextParse 的产物进了真编译路（不是只有形状对）', () => {
  /** 把解析产物挂到一员真将身上，交给编译器——编译器认不认这块积木？ */
  function compileParsed(text: string): { ok: boolean; detail: string } {
    const draft = parseSkillText(text);
    const base = allGenerals.find(g => (g.skills.length ?? 0) > 0)!;
    const skill: Skill = { name: '手书测试', effects: draft.effects, effectMode: draft.effectMode ?? 'all' };
    const general: General = { ...base, skills: [skill] };
    const { definitions, skipped } = compileGeneralSkills(general);
    return {
      ok: definitions.length === draft.effects.length && draft.effects.length > 0,
      detail: JSON.stringify({ parsed: draft.effects.length, definitions: definitions.map(d => d.id), skipped }),
    };
  }

  it('五种代表性积木都编得出技能（伤害／改数／摸牌／决斗／放回牌堆底）', () => {
    for (const text of [
      '受到伤害后，对目标，造成 1 点技能伤害。',
      '在场即生效（不用发动，人在就算），让近战攻击力增加 1（在场期间）。',
      '回合开始时，摸 2 张牌。',
      '造成伤害后，与目标将领决斗（双方各三轮，最多六次）。',
      '受到伤害后，把 1 张手牌放回牌堆底。',
    ]) {
      const r = compileParsed(text);
      expect(r.ok, `${text} ⇒ ${r.detail}`).toBe(true);
      expect(parseSkillText(text).notices, text).toEqual([]);
    }
  });

  it('下拉里有、结算还没接线的时机 ⇒ 积木照样给，但当场说一句"今天还不响"', () => {
    const draft = parseSkillText('回合开始时（其他玩家回合），摸 1 张牌。');
    expect(draft.effects).toHaveLength(1);
    expect(draft.issues).toEqual([]);
    expect(draft.notices[0].reason).toContain('不会响');
    expect(canAdopt(draft)).toBe(true);
    // 另一种"还没接线"：整个时机都没上结算事件面（编译器 `TRIGGER_UNSUPPORTED` 那一档）。
    const unwired = parseSkillText('其他将领登场时（其他玩家将领登场），摸 1 张牌。');
    expect(unwired.effects).toHaveLength(1);
    expect(unwired.notices[0].reason).toContain('还不会响');
  });

  it('反解出来的"决斗"仍不读数值格（与录入面同一口径，不多造一个能填的死格子）', () => {
    const draft = parseSkillText('与伤害来源将领决斗');
    expect(draft.effects[0].runtime).toEqual({ type: 'DUEL', target: 'ATTACKER' });
    expect(draft.effects[0].runtime!.value).toBeUndefined();
  });
});
