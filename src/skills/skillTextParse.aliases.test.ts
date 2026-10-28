/**
 * v2.9.22 刀5「写法别名档」的证人（用户 2026-10-27 拍板＝「633 条描述走出口①＝补词表/别名」）。
 *
 * 每条别名配**一对**钉子（§12-110⑩ 那条老判据：玩家看得见又能填回引擎的词，同轮必须补钉）：
 * ① 系统自己写的那句话喂进别名函数**一字不变**＝只进不出（别名永不污染生成侧与导出串）；
 * ② 玩家那种写法喂进去**拼得出同一块积木**，且与那一档的原写法解成逐字同一句。
 *
 * 另外钉住三件"故意不收"的：「出场」两读、B 堆那四类（语义会动的降格）、以及别名对
 * 已经是合法串的片段必须是**幂等**的（同一片段过两遍＝过一遍）。
 */

import { describe, expect, it } from 'vitest';
import { allGenerals, statModifierKeyLabels, triggerTypeLabels, allTriggerTypes } from '../data/generals';
import { effectSentence, skillSentence, triggerPhrase } from './skillSentence';
import { parseSkillText, canAdopt, readingAlias } from './skillTextParse';

/** 玩家写法 → 系统那一档的话（别名函数的输出必须正是词表里那一串）。 */
const TRIGGER_PAIRS: [string, keyof typeof triggerTypeLabels][] = [
  ['死亡时', 'onDeath'],
  ['当你阵亡', 'onDeath'],
  ['每回合结束', 'onTurnEnd'],
  ['受到伤害时候', 'onDamageTaken'],
  ['遭受伤害', 'onDamageTaken'],
  ['被攻击时', 'onBecomingTarget'],
  ['成为攻击目标时候', 'onBecomingTarget'],
  ['击杀角色时', 'onKill'],
  ['打死一名敌方武将', 'onKill'],
  ['放置时', 'onDeploy'],
  // 施工图 7~10：这批表里零命中＝替玩家猜的写法，留不留交给我判（判据与理由见 `TRIGGER_ALIASES` 那段注释）。
  // 它们照样得配钉子——"死代码"的解药不是删掉它，是给它一个真实句子的证人。
  ['每回合开始', 'onTurnStart'],
  ['造成伤害时候', 'onDamageDealt'],
  ['打出伤害后', 'onDamageDealt'],
  ['失去全部手牌时', 'onCardLost'],
  ['你失去所有牌', 'onCardLost'],
  ['摸到手牌', 'onCardGained'],
];

describe('刀5 时机别名：整片段才换，且换过去的就是那一档', () => {
  it.each(TRIGGER_PAIRS)('「%s」归一成 %s 那一档的生成串', (raw, type) => {
    const canonical = triggerPhrase({ type } as never);
    expect(readingAlias(raw)).toBe(canonical);
    // 幂等：已经是生成串 ⇒ 再过一遍不动
    expect(readingAlias(canonical)).toBe(canonical);
  });

  it.each(TRIGGER_PAIRS.map(([, type]) => triggerPhrase({ type } as never)))(
    '生成侧那一句「%s」喂进别名函数一字不变＝只进不出', (canonical) => {
      expect(readingAlias(canonical)).toBe(canonical);
    },
  );

  it('别名写法与那一档的原写法解成**逐字同一句**积木（不是像，是同一块）', () => {
    for (const [raw, type] of TRIGGER_PAIRS) {
      const canonical = triggerPhrase({ type } as never);
      const byAlias = parseSkillText(`${raw}，摸一张牌`);
      const byCanonical = parseSkillText(`${canonical}，摸一张牌`);
      expect(byAlias.issues.map(i => `${i.raw} → ${i.reason}`)).toEqual([]);
      expect(byAlias.effects).toHaveLength(1);
      expect(canAdopt(byAlias)).toBe(true);
      expect(effectSentence(byAlias.effects[0])).toBe(effectSentence(byCanonical.effects[0]!));
    }
  });
});

describe('刀5 动词别名与紧凑改数式', () => {
  it('「弃置／丢弃／弃掉 N 张…」都解成同一块弃牌积木（数字与汉字两支都要能吃尾巴）', () => {
    const cases: [string, number][] = [
      ['弃置1张手牌', 1],
      ['弃置两张手牌', 2],
      ['丢弃 3 张牌', 3],
      ['弃掉一张牌', 1],
    ];
    for (const [raw, value] of cases) {
      const draft = parseSkillText(`受到伤害后，${raw}。`);
      expect(draft.issues.map(i => `${i.raw} → ${i.reason}`)).toEqual([]);
      expect(draft.effects).toHaveLength(1);
      expect(draft.effects[0]!.runtime).toMatchObject({ type: 'DISCARD', value });
    }
  });

  it('六把钥匙的紧凑式 `钥匙+ N`／`钥匙- N` 各自归一成「让…增加／减少…」，与手写正体解成同一块', () => {
    for (const label of Object.values(statModifierKeyLabels)) {
      for (const [sign, word] of [['+', '增加'], ['-', '减少']] as const) {
        const compact = readingAlias(`${label}${sign}1`);
        expect(compact).toBe(`让${label}${word}1`);
        const draft = parseSkillText(`在场即生效（不用发动，人在就算），${label}${sign}1。`);
        expect(draft.issues.map(i => `${i.raw} → ${i.reason}`)).toEqual([]);
        expect(draft.effects).toHaveLength(1);
        expect(draft.effects[0]!.runtime?.type).toBe('MODIFY_STAT');
        expect(draft.effects[0]!.runtime?.stat).toBe(
          (Object.entries(statModifierKeyLabels) as [string, string][]).find(([, l]) => l === label)?.[0],
        );
      }
      // 只进不出：正体那一句过别名函数不动
      expect(readingAlias(`让${label}增加 1`)).toBe(`让${label}增加 1`);
    }
  });

  it('带前缀的紧凑式同样收（你的／自身／每／当…），但**绝不碰带别的词的整句**', () => {
    expect(readingAlias('你的近战攻击力+2')).toBe('让近战攻击力增加2');
    expect(readingAlias('自身远程攻击力-1')).toBe('让远程攻击力减少1');
    // 片段里还有别的东西⇒不是整片段相等，不换（子串替换会吃掉分隔符）
    expect(readingAlias('近战攻击力+1，摸一张牌')).toBe('近战攻击力+1，摸一张牌');
    expect(readingAlias('受到伤害时候摸一张牌')).toBe('受到伤害时候摸一张牌');
  });
});

describe('刀5 故意不收的那些（收了就是把卡做错）', () => {
  it('「出场」两读＝登场还是进池，不收；照样逐段点名', () => {
    expect(readingAlias('出场时')).toBe('出场时');
    const draft = parseSkillText('出场时，摸一张牌');
    expect(draft.effects).toHaveLength(0);
    expect(draft.issues.map(i => i.raw)).toContain('出场时');
  });

  it('词表已经认得的时机串一个字都不动——「自身登场时」的"听谁"那一格不许被别名归一掉', () => {
    expect(readingAlias('自身登场时')).toBe('自身登场时');
    expect(parseSkillText('自身登场时，摸一张牌').effects[0]!.trigger)
      .toEqual({ type: 'onDeploy', listenerScope: 'self' });
    expect(readingAlias('其他角色登场时')).toBe('其他角色登场时');
  });

  it.each(['近战伤害+1', '远程伤害-1', '受到近战伤害-1', '生命上限为3', '回复1点生命'])(
    'B 堆那类语义会动的写法**一条都不自动归一**：「%s」原样退回', (raw) => {
      expect(readingAlias(raw)).toBe(raw);
      const draft = parseSkillText(raw);
      expect(canAdopt(draft)).toBe(false);
      expect(draft.issues.length).toBeGreaterThan(0);
    },
  );

});

describe('刀5 四条零命中的写法：留不留由我判⇒留了就得每条都认档', () => {
  it('收的理由与判据都在 `TRIGGER_ALIASES` 那段注释里；这条钉子只负责一件事', () => {
    // 只要有人把哪一档改名或删掉，别名函数必须**拒绝改写**（回到逐段点名），而不是悄悄换成别的档。
    for (const [raw, type] of [['回合开始', 'onTurnStart'], ['造成伤害时候', 'onDamageDealt'],
      ['失去全部手牌', 'onCardLost'], ['获得所有手牌时', 'onCardGained']] as const) {
      expect(readingAlias(raw)).toBe(triggerPhrase({ type } as never));
      const draft = parseSkillText(`${raw}，摸一张牌`);
      expect(draft.issues.map(i => i.raw)).toEqual([]);
      expect(draft.effects).toHaveLength(1);
    }
  });
});

describe('刀5 列表编号那类脏片段（施工图 13）', () => {
  it('裸数字片段不再算"读不懂的动作"，走忽略回显、绝不冒充读过了', () => {
    const draft = parseSkillText('1、受到伤害后，摸一张牌');
    expect(draft.effects).toHaveLength(1);
    expect(draft.issues.map(i => i.raw)).toEqual([]);
    expect(draft.ignored).toContain('1');
    expect(canAdopt(draft)).toBe(true);
    // 只有编号、没别的⇒仍然不能采纳（忽略不等于生成）
    expect(parseSkillText('1、2、3').effects).toHaveLength(0);
  });
});

describe('刀5 全库只进不出钉（§12-110⑩：别名是只进的读入词，永不改写生成侧）', () => {
  it('名册里每一条生成出来的卡面话，逐片段过别名函数＝一字不变', () => {
    let fragments = 0;
    const touched: string[] = [];
    for (const general of allGenerals) {
      for (const skill of general.skills ?? []) {
        const sentence = skillSentence(skill);
        const parts = `${sentence}`.split(/[，。；、]/);
        for (const part of parts) {
          const piece = part.trim();
          if (!piece) continue;
          fragments++;
          if (readingAlias(piece) !== piece) touched.push(`${general.name}/${skill.name}: ${piece} → ${readingAlias(piece)}`);
        }
      }
    }
    expect(touched).toEqual([]);
    // 现场量的语料形状（不是估的）：名册 96 张 → 170 个技能格，其中 128 格生成出来是空句，
    // 剩下 42 格切成 114 个片段（去重 33 段）。⇒ 这条钉覆盖面有限，但每一条都得是一字不变。
    expect(fragments).toBeGreaterThanOrEqual(100);
  });

  it('全部时机档位名（词源现场枚举）过别名函数一字不变', () => {
    for (const type of allTriggerTypes) {
      const phrase = triggerPhrase({ type } as never);
      if (!phrase) continue;
      expect(readingAlias(phrase)).toBe(phrase);
    }
  });
});
