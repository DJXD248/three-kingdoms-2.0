/**
 * v2.9.24 刀2「一句话生成将领」＝把玩家那句**话**读成 name／faction／hp／meleeAtk／
 * rangedAtk／skillNames。离线词表，无网络无模型（同 `skillTextParse` 那一套纪律）。
 *
 * 这七组钉子逐条对着 §12-140⑨㈡ 那句裁决钉：
 * ① 认得出的写法都认得（含汉字数目字与两种语序）；
 * ② 五格里**只有体力能兜底**，其余四格读不出来就留空、绝不猜；
 * ③ 势力／近战／远程**不兜底**：势力不在五档里就是不认识；
 * ④ 只写「攻击力」＝近战与远程两个数没写清，不替玩家挑哪一个；
 * ⑤ 技能**只记名**，那句效果退回第②步去拼（这里不收效果载荷）；
 * ⑥ 读不懂的片段逐条点名、带原文；连接词被忽略也要回显；
 * ⑦ 兜底那一个数与 Excel 导入侧同一枚常量（判据只有一份）。
 */
import { describe, it, expect } from 'vitest';
import {
  canAdoptGeneral, describeGeneralDraft, hpWasDefaulted, missingRequiredFields, parseGeneralText,
} from './generalTextParse';
import { DEFAULT_HP_WHEN_MISSING } from '../../domain/generalProvenance';

describe('一句话 → 名册字段：认得出的写法', () => {
  it('「张辽，势力魏，体力4，技能：突袭和骁果」六格都读到了', () => {
    const d = parseGeneralText('张辽，势力魏，体力4，技能：突袭和骁果');
    expect(d.name).toBe('张辽');
    expect(d.faction).toBe('魏');
    expect(d.hp).toBe(4);
    expect(d.skillNames).toEqual(['突袭', '骁果']);
    expect(d.issues).toEqual([]);
  });

  it('带前缀的写法与裸汉字同一格：「名：赵云／蜀／4点体力／近战1／远程2」', () => {
    const d = parseGeneralText('名：赵云，蜀，4点体力，近战1，远程2');
    expect(d.name).toBe('赵云');
    expect(d.faction).toBe('蜀');
    expect(d.hp).toBe(4);
    expect(d.meleeAtk).toBe(1);
    expect(d.rangedAtk).toBe(2);
    expect(d.issues).toEqual([]);
  });

  it('汉字数目字与阿拉伯数字同一把尺（数词只有 `parseCountNumber` 那一份）', () => {
    expect(parseGeneralText('名：吕布，群，三点体力，近战三').hp).toBe(3);
    expect(parseGeneralText('名：吕布，群，3点体力，近战3').meleeAtk).toBe(3);
    // 大写数目字**不在**那一把尺里（全库只许一套数词读法⇒这里不另加一份）
    const d = parseGeneralText('名：吕布，群，近战叁');
    expect(d.meleeAtk).toBeUndefined();
    expect(d.issues[0].reason).toContain('读不出数');
  });

  it('「吴国」这种带国字的势力＝同一个势力；括号里的顿号属于技能名内部、没被切开', () => {
    const d = parseGeneralText('名：周瑜，吴国，技能：「英姿、反间」');
    expect(d.faction).toBe('吴');
    expect(d.skillNames).toEqual(['英姿', '反间']);
    expect(d.issues).toEqual([]);
  });

  it('没写「名：」时按第一句的裸汉字收为将名，回显里必须把这一笔说出来', () => {
    const d = parseGeneralText('张飞，蜀，体力4');
    expect(d.name).toBe('张飞');
    expect(d.nameFromPosition).toBe(true);
    expect(describeGeneralDraft(d).some(l => l.includes('我按第一句的位置取的'))).toBe(true);
  });
});

describe('五格里只有体力能兜底', () => {
  it('这句话没点体力＝留空，由采用那一步交 `hpOrDefault`；回显把缺省数写出来', () => {
    const d = parseGeneralText('名：黄忠，蜀');
    expect(d.hp).toBeUndefined();
    expect(hpWasDefaulted(d)).toBe(true);
    expect(describeGeneralDraft(d).some(l => l.includes(`按缺省 ${DEFAULT_HP_WHEN_MISSING} 建`))).toBe(true);
  });

  it('势力读不出来＝这一格空着，且逐段点名说它不在那五档里', () => {
    const d = parseGeneralText('名：徐庶，势力：徐');
    expect(d.faction).toBeUndefined();
    expect(missingRequiredFields(d)).toEqual(['势力']);
    expect(canAdoptGeneral(d)).toBe(false);
    expect(d.issues[0].raw).toBe('势力：徐');
    expect(d.issues[0].reason).toContain('不在这五个里');
  });

  it('「体力：强」＝数读不出来就退回点名，绝不兜底成一个像样的数', () => {
    const d = parseGeneralText('名：关羽，蜀，体力：强');
    expect(d.hp).toBeUndefined();
    expect(d.issues[0].reason).toContain('读不出数');
  });

  it('只写「攻击力3」＝近战与远程两个数，不替玩家挑哪一个', () => {
    const d = parseGeneralText('名：马超，蜀，攻击力3');
    expect(d.meleeAtk).toBeUndefined();
    expect(d.rangedAtk).toBeUndefined();
    expect(d.issues[0].reason).toContain('我不替你挑');
  });

  it('数必须大于 0：「近战0」不算一格数', () => {
    const d = parseGeneralText('名：甲，魏，近战0');
    expect(d.meleeAtk).toBeUndefined();
    expect(d.issues[0].reason).toContain('大于 0');
  });
});

describe('技能这一格只记名', () => {
  it('名字后面挂了效果＝名字收下，那句效果退回第②步去拼', () => {
    const d = parseGeneralText('名：关羽，蜀，技能：武圣：远程攻击力+1');
    expect(d.skillNames).toEqual(['武圣']);
    expect(d.issues[0].raw).toContain('武圣');
    expect(d.issues[0].reason).toContain('请去第②步拼');
  });

  it('说了「技能」却没点出名字＝点名，不收一个空名', () => {
    const d = parseGeneralText('名：甲，魏，技能：');
    expect(d.skillNames).toEqual([]);
    expect(d.issues[0].reason).toContain('没点出名字');
  });

  it('清单里有一段只剩说明、没有名字＝那一段单独点名，别段照常收', () => {
    const d = parseGeneralText('名：甲，魏，技能：突袭和：只会杀');
    expect(d.skillNames).toEqual(['突袭']);
    expect(d.issues.map(i => i.raw)).toContain('：只会杀');
    expect(d.issues.some(i => i.reason.includes('没点到技能名'))).toBe(true);
  });

  it('一句也没点到技能＝回显说"进去第②步再加"，不假装收了什么', () => {
    const d = parseGeneralText('名：甲，魏');
    expect(d.skillNames).toEqual([]);
    expect(describeGeneralDraft(d).some(l => l.includes('这句话没点，进去第②步再加'))).toBe(true);
  });
});

describe('读不懂的一律点名，忽略的也要回显', () => {
  it('同一格写了两回＝后一句**不覆盖**前一句，而是说出矛盾在哪', () => {
    const d = parseGeneralText('名：甲，名：乙，势力魏，势力蜀');
    expect(d.name).toBe('甲');
    expect(d.faction).toBe('魏');
    expect(d.issues.map(i => i.reason).join(' ')).toContain('写了两回');
  });

  it('裸汉字先被当成将名时，后一句「名：」不覆盖它、并点名', () => {
    const d = parseGeneralText('太史慈，名：周泰，群');
    expect(d.name).toBe('太史慈');
    expect(d.issues[0].reason).toContain('没有覆盖它');
  });

  it('完全不知道是哪一格的一句＝原文照抄回来＋一句能照着改的话', () => {
    const d = parseGeneralText('名：甲，魏，骑术精湛');
    expect(d.issues[0].raw).toBe('骑术精湛');
    expect(d.issues[0].reason).toContain('能写的说法');
  });

  it('连接词被忽略也要在回显里说出来（不是悄悄丢掉）', () => {
    const d = parseGeneralText('一位，名将，名：甲，魏');
    expect(d.ignored).toEqual(['一位', '名将']);
    expect(d.name).toBe('甲');
    expect(describeGeneralDraft(d).some(l => l.includes('我当成连接词忽略掉的：一位、名将'))).toBe(true);
  });

  it('身份与归属这两格不由一句话代定：出现了也不收，并说清要您自己选', () => {
    const d = parseGeneralText('名：甲，魏，身份：三国有名，归属：官方');
    expect(d.issues).toHaveLength(2);
    expect(d.issues[0].reason).toContain('要你自己在那一排里选');
  });

  it('空话与垃圾输入都不炸：返回一个什么都不收的草稿', () => {
    for (const bad of ['', '   ', '，，，', '123', '4']) {
      const d = parseGeneralText(bad);
      expect(canAdoptGeneral(d)).toBe(false);
    }
    expect(parseGeneralText(null as unknown)).toEqual({ nameFromPosition: false, skillNames: [], issues: [], ignored: [] });
  });
});

describe('第①步（改一张已有的卡）那句回显说"这一格不动"', () => {
  it('同一份草稿在 create 与 edit 两种模式下说的不是一回事', () => {
    const d = parseGeneralText('名：甲，魏');
    expect(describeGeneralDraft(d, 'create').some(l => l.includes('按缺省'))).toBe(true);
    expect(describeGeneralDraft(d, 'edit').some(l => l.includes('体力：这句话没点＝这一格不动'))).toBe(true);
    expect(describeGeneralDraft(d, 'edit').some(l => l.includes('这两格不动'))).toBe(true);
  });
});

describe('段首那顶"帽子"要摘掉（用户 2026-10-30 裁：「一位郭淮」只该认到「郭淮」）', () => {
  it('裸名带量词＝只取「郭淮」，摘下来的原样回显、不静默丢', () => {
    const d = parseGeneralText('一位郭淮，魏');
    expect(d.name).toBe('郭淮');
    expect(d.nameFromPosition).toBe(true);
    expect(d.ignored).toEqual(['一位']);
    expect(d.issues).toEqual([]);
    const echo = describeGeneralDraft(d);
    expect(echo.some(l => l.includes('将名：郭淮'))).toBe(true);
    expect(echo.some(l => l.includes('我当成连接词忽略掉的：一位'))).toBe(true);
  });

  it('「名：」那一路同样剥：「名：一位郭淮」与「名：一名郭淮」「名为名将郭淮」都落「郭淮」', () => {
    for (const text of ['名：一位郭淮，魏', '名：一名郭淮，魏', '名为名将郭淮，魏']) {
      const d = parseGeneralText(text);
      expect(d.name).toBe('郭淮');
      expect(d.nameFromPosition).toBe(false);
      expect(d.ignored.length).toBeGreaterThan(0);
    }
  });

  it('帽子压在势力上也认：「一位蜀」＝势力蜀（剥完之后才送去比对五档）', () => {
    const d = parseGeneralText('一位蜀');
    expect(d.faction).toBe('蜀');
    expect(d.ignored).toEqual(['一位']);
    expect(d.name).toBeUndefined();
  });

  it('长词优先，切不出半个词：「一名郭淮」不许变成「名郭淮」', () => {
    const d = parseGeneralText('一名郭淮，魏');
    expect(d.name).toBe('郭淮');
    expect(d.ignored).toEqual(['一名']);
  });

  it('剥到剩下还是一顶帽子＝不许剥（宁可不剥，也剥不出「一位」这种半个名字）', () => {
    const d = parseGeneralText('一位一位');
    expect(d.name).toBe('一位一位');
    expect(d.ignored).toEqual([]);
    const e = parseGeneralText('名：一位一位');
    expect(e.name).toBe('一位一位');
    expect(e.ignored).toEqual([]);
  });

  it('不带帽子的裸名照旧（这条不许被这刀碰坏）', () => {
    const d = parseGeneralText('郭淮，魏');
    expect(d.name).toBe('郭淮');
    expect(d.ignored).toEqual([]);
  });
});
