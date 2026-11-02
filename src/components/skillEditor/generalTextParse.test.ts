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

type ParsedGeneral = ReturnType<typeof parseGeneralText>;

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

  // 刀2a 第⑤件：标题原写「顿号属于技能名内部、没被切开」，与下面的断言（两枚）逐字相反。
  // 监督台裁＝**断言一字不动**，只把标题改成与真行为一致。
  // 括号里那枚顿号**该不该**切开＝「壳内切不切」那格还没裁⇒这句标题只如实登记今天的形状。
  it('「吴国」这种带国字的势力＝同一个势力；闭合壳里的顿号今天被当成清单分隔＝两枚（这一格未裁，标题只登记现状）', () => {
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

  // ── 已裁（口令 §16＋§17②）：这一格被本刀自己的两道闸全数拦下时，那句不许再说"没点"。
  //    正向三形**各一枚 `it`**（§17②）：同一枚 `it` 里 `expect` 一抛就停，三形挤一个循环时
  //    一份红字只说一件事、剩下几趟断言根本不跑。每枚内部仍跑 `create`／`edit`＝同一份证人的
  //    两条腿（第 16 件第 3 条：两模式共用一根轴），不必拆成六枚。
  //    "不再出现「这句话没点」"**只圈「技能：」这一行**——同一份回显里「体力：这句话没点…」是
  //    另一格、本刀不碰，整份去比那一串字永远红（监督台快照 `probe15now-out.txt:48` 同形）。
  const REJECTED_ALL_LINE = '技能：那一格写的我没认成技能名，一个都没落（逐条点名见下面）';
  const NOTHING_SAY_LINE = '技能：这句话没点，进去第②步再加';
  const skillLineOf = (text: string, mode?: 'create' | 'edit') =>
    describeGeneralDraft(parseGeneralText(text), mode).filter(l => l.startsWith('技能：'));

  it('〔正向·字段〕「技能：体力4」全被拦下＝那一格说「没认成技能名，一个都没落」，两模式逐字同一句', () => {
    for (const mode of ['create', 'edit'] as const) {
      expect(skillLineOf('名：郭淮，蜀，技能：体力4', mode), mode).toEqual([REJECTED_ALL_LINE]);
    }
  });

  it('〔正向·徽章〕「技能：限定技」全被拦下＝那一格说同一句，两模式逐字同一句', () => {
    for (const mode of ['create', 'edit'] as const) {
      expect(skillLineOf('名：郭淮，蜀，技能：限定技', mode), mode).toEqual([REJECTED_ALL_LINE]);
    }
  });

  it('〔正向·攻击力〕「技能：攻击力3」全被拦下＝那一格说同一句，两模式逐字同一句', () => {
    for (const mode of ['create', 'edit'] as const) {
      expect(skillLineOf('名：郭淮，蜀，技能：攻击力3', mode), mode).toEqual([REJECTED_ALL_LINE]);
    }
  });

  //    反向＝真没写那几形一字不许变，**同样按形状各一枚 `it`**（§17②）。
  //    只写正向，下次有人把判据换成"清单是空的"或"有 issue 就算"就没人拦——两种改法都会把这几形一起翻成假话。
  it('〔反向·整句没写技能〕「名：郭淮，蜀」那一行仍说「这句话没点，进去第②步再加」', () => {
    expect(skillLineOf('名：郭淮，蜀')).toEqual([NOTHING_SAY_LINE]);
  });

  it('〔反向·写了个空清单〕「名：甲，魏，技能：」那一行仍说老话，不落进"没认成"那一支', () => {
    expect(skillLineOf('名：甲，魏，技能：')).toEqual([NOTHING_SAY_LINE]);
  });

  //    `锁定技` 写在**顶层**、技能那一格仍是空的：这一枚挡的正是"看 issues 非空就翻口"那一种写法。
  it('〔反向·徽章写在顶层〕「名：郭淮，蜀，锁定技」那一行仍说老话——别处有投诉不算这一格写过', () => {
    expect(skillLineOf('名：郭淮，蜀，锁定技')).toEqual([NOTHING_SAY_LINE]);
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

/**
 * 刀2a 的契约只有一条：**没有一段是悄悄收下的**。
 * 这里一律不写「能不能采用」（硬闸还没裁），也不写名字中间那枚「和」该怎么切（同样没裁）。
 *
 * ⚠️ 这一组里两档口径别写串了（监督台 2026-11-02 撤回半句、2026-11-03 定稿口令 §0 裁完后的形状）：
 *  · **壳开了没关上**＝**已裁**：将名只取第一枚未闭合左壳**之前**的内容，后面那整截只点名、
 *    一格都不落（判据＝与**闭合**那一族同一行为，见 §0）。⇒ 证人**写硬**，钉的是"名字干净＋那截被点名"，
 *    不再是上一轮那条"整串进将名"（那条钉的是待修的形状，已撤）。
 *  · **徽章词／字段词混进技能清单**＝**已裁**：这一枚不进 `skillNames`，另给一句真话
 *    （上一轮那句「身份与归属」是假话——徽章不是那一格）。
 *  · **半角逗号认不认／句号当不当分隔／空格当不当分隔／闭合壳里面下不下刀**＝**还没裁**那几格 ⇒ 只写
 *    **反向证人**：钉「不许既没落格、又没交代」。**绝**不断言它必须被点名退回（那会把口径锁死，
 *    他日裁「认」时这行就与那个裁法相冲），**也**不断言它必须被完整解出。
 *    ⇒ 这一档标的是「未定口径、只锁住不静默」，不是已裁。
 */
describe('落进格子那几段里粘着没认的东西＝必须点名，不许静默收下', () => {
  /** 这一段有没有被点名（原文逐字出现在某条退回复里）。 */
  const named = (d: ParsedGeneral, raw: string) => d.issues.some(i => i.raw === raw);
  it('技能名以「和／与／及」开头＝整枚收下，首字不再被当分隔词削掉', () => {
    for (const name of ['和亲', '与民同乐', '及泉之勇']) {
      const d = parseGeneralText(`名：郭淮，蜀，技能：${name}`);
      expect(d.skillNames, name).toEqual([name]);
      expect(d.issues, name).toEqual([]);
    }
  });

  // ── ㈤ 壳开了没关上＝**已裁**（口令 §0／§1）：名字清干净，后面那整截只点名 ──────────────
  it('括号没关上＝将名只取壳前那一截，壳起的整段一格不落、单独点名', () => {
    const d = parseGeneralText('名：郭淮（蜀');
    expect(d.name).toBe('郭淮');
    expect(named(d, '（蜀'), '怪尾巴没被单独点名＝要么静默，要么还粘在名字里').toBe(true);
    expect(d.issues[0].glued, '那整截一个字段都没落，不该算"收下了但粘着"').toBeUndefined();
    expect(d.issues[0].reason).toContain('开了没关上');
    expect(d.faction).toBeUndefined();
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('壳后头挤了一整排字段＝魏／体力4／突袭 一个都不许落，只在那一句点名里原样出现', () => {
    const d = parseGeneralText('名：郭淮（字长文，魏，体力4，技能：突袭');
    expect(d.name).toBe('郭淮');
    expect(d.faction).toBeUndefined();
    expect(d.hp).toBeUndefined();
    expect(d.skillNames).toEqual([]);
    expect(d.issues.map(i => i.raw)).toEqual(['（字长文，魏，体力4，技能：突袭']);
    expect(d.issues[0].reason).toContain('开了没关上');
  });

  it('闭合的那一族行为不许变（取壳前的名＋点名壳内那段）——没闭合的这一族照同一判据清名字', () => {
    const d = parseGeneralText('名：郭淮，魏，技能：武圣（锁定技）');
    expect(d.skillNames).toEqual(['武圣']);
    // 口令 §9：那句里「锁定技」叫"效果"是假话 ⇒ 措辞改，**落格一字未动**（上面那一行就是这条）
    expect(d.issues[0].reason).toContain('您那句徽章');
  });

  // ── 已裁（口令 §2）：徽章词不是技能名——这一枚不进清单，那句理由也不许再说"身份与归属" ──────
  it('徽章词单独成段／排在清单里＝都不进技能名，另点一句「是徽章，不是技能名」', () => {
    const cases: [string, string][] = [
      ['名：郭淮，蜀，锁定技', '锁定技'],
      ['名：郭淮，蜀，技能：锁定技', '锁定技'],
      ['名：郭淮，蜀，技能：突袭、限定技', '限定技'],
    ];
    for (const [text, badge] of cases) {
      const d = parseGeneralText(text);
      expect(d.skillNames.includes(badge), text).toBe(false);
      expect(named(d, badge), `${text}：这一枚既没落格也没点名`).toBe(true);
      expect(d.issues.find(i => i.raw === badge)?.reason, text).toContain('是徽章，不是技能名');
      expect(d.issues.find(i => i.raw === badge)?.reason, text).not.toContain('身份与归属');
    }
  });

  // ── 已裁（口令 §8）：带壳的徽章词与裸写的同一个东西＝同一句真话，不许一个说"不知道是哪一格"
  it('「锁定技」／【限定技】这些写法＝先脱壳再判徽章，得到的那句与裸写逐字同一', () => {
    const cases: [string, string, string][] = [
      ['名：郭淮，蜀，技能：突袭，「锁定技」', '「锁定技」', '锁定技'],
      ['名：郭淮，蜀，【限定技】', '【限定技】', '限定技'],
      ['名：郭淮，蜀，技能：突袭，「登场技」', '「登场技」', '登场技'],
    ];
    for (const [text, raw, badge] of cases) {
      const d = parseGeneralText(text);
      expect(d.skillNames, text).not.toContain(badge);
      // 点名用的仍是玩家写的那一截（带壳原样），不改 raw 的形状
      expect(named(d, raw), `${text}：这一段既没落格也没点名`).toBe(true);
      const reason = d.issues.find(i => i.raw === raw)?.reason ?? '';
      expect(reason, text).toBe(`「${badge}」是徽章，不是技能名；徽章那一格在第②步那张卡上勾`);
      // 与裸写那一枚得到的话**逐字相同**（同一句真话；不同＝又长回两套句子）
      const bare = parseGeneralText(`名：郭淮，蜀，${badge}`);
      expect(bare.issues[0].reason, text).toBe(reason);
    }
  });

  // ── 已裁（口令 §3）：字段词＋数混进技能清单＝不是技能名，且绝不替玩家把数落到那一格 ──────
  it('「技能：体力4」这类＝不落进技能名，也不替玩家填体力，只点一句「是字段，不是技能名」', () => {
    const cases: [string, string, keyof ParsedGeneral][] = [
      ['名：郭淮，蜀，技能：体力4', '体力4', 'hp'],
      ['名：郭淮，蜀，技能：远程2', '远程2', 'rangedAtk'],
      ['名：郭淮，蜀，技能：近战三', '近战三', 'meleeAtk'],
    ];
    for (const [text, piece, cell] of cases) {
      const d = parseGeneralText(text);
      expect(d.skillNames, text).toEqual([]);
      expect(d[cell], `${text}：那一格被替玩家猜着填了`).toBeUndefined();
      expect(named(d, piece), `${text}：这一段既没落格也没点名`).toBe(true);
      expect(d.issues[0].reason, text).toContain('是字段，不是技能名');
    }
  });

  // ── 已裁（口令 §7）：「攻击力＋数」与 §3 那一族同判据，但它那一句要另说（两个数，不替玩家挑）
  //    ⚠️ 顶层独立成段那一形（`攻击力3` 不写在「技能：」里）走的是 `AMBIGUOUS_ATK_RE`，
  //    口令令它一字不动 ⇒ 那条另有在册证人（上面「我不替你挑」那一枚），这里不重复钉、也不接进来。
  it('「技能：攻击力3」＝不落进技能名、不替玩家填近战或远程，且那句要说明是两个数', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：攻击力3');
    expect(d.skillNames).toEqual([]);
    expect(d.meleeAtk, '那一格被替玩家猜着填了').toBeUndefined();
    expect(d.rangedAtk, '那一格被替玩家猜着填了').toBeUndefined();
    expect(named(d, '攻击力3'), '这一段既没落格也没点名').toBe(true);
    const reason = d.issues.find(i => i.raw === '攻击力3')?.reason ?? '';
    expect(reason).toContain('是字段，不是技能名');
    expect(reason).toBe('「攻击力3」是字段，不是技能名；攻击力有近战与远程两个数，请分开写（如「近战3」「远程2」）');
    // 读不出数的「攻击力」打头那一枚仍当技能名收——不许把猜出来的数当成玩家写的数
    const noNumber = parseGeneralText('名：郭淮，蜀，技能：攻击力');
    expect(noNumber.skillNames, '没有数，就不是"字段＋数"那一族').toEqual(['攻击力']);
  });

  // ── 已裁（口令 §9）：闭合壳里那句是徽章还是效果，决定这句话怎么说（措辞；落格一字不动）
  it('壳里那句命中徽章＝说「您那句徽章」；不命中＝仍说「效果」——两形都只收名字', () => {
    const badge = parseGeneralText('名：郭淮，魏，技能：武圣（锁定技）');
    expect(badge.skillNames).toEqual(['武圣']);
    expect(badge.issues[0].reason).toBe('您那句徽章（「锁定技」）名册这一格不收，请去第②步那张卡上勾');
    expect(badge.issues[0].reason).not.toContain('效果');
    const effect = parseGeneralText('名：郭淮，魏，技能：武圣（摸一张牌）');
    expect(effect.skillNames).toEqual(['武圣']);
    expect(effect.issues[0].reason).toContain('您那句效果');
  });

  // ── ㈢ 半角逗号认不认＝**还没裁**那一格。下面每一行都写成析取：
  //    「要么干净落格，要么有个交代」——他日裁"认"，那半自动赢；裁"点名"，也自动赢；
  //    只有"既没落格也没点名"这一种悄悄的形状会红。**不钉**它必须被点名退回。
  it('〔未定口径·只锁不静默〕「名：郭淮,势力蜀」不许出现『将名含, ＋ 一条没退 ＋ 采用钮亮』', () => {
    const d = parseGeneralText('名：郭淮,势力蜀');
    // 监督台 2026-11-02 原话那三件套
    expect((d.name ?? '').includes(',') && d.issues.length === 0 && canAdoptGeneral(d)).toBe(false);
    const solvedCleanly = d.name === '郭淮' && d.faction === '蜀';
    expect(solvedCleanly || named(d, '郭淮,势力蜀'), '这一段既没落格也没点名').toBe(true);
  });

  it('〔未定口径·只锁不静默〕没写「名：」那一串同样不许悄悄丢掉', () => {
    const d = parseGeneralText('郭淮,势力蜀,体力4');
    const anythingLanded = d.name !== undefined || d.faction !== undefined || d.hp !== undefined;
    expect(anythingLanded || named(d, '郭淮,势力蜀,体力4'), '这一段既没落格也没点名').toBe(true);
  });

  it('〔未定口径·只锁不静默〕数那一格被「,」挤住：两个数要么都落格，要么点名', () => {
    const d = parseGeneralText('名：郭淮，蜀，近战3,远程2');
    const solvedCleanly = d.meleeAtk === 3 && d.rangedAtk === 2;
    expect(solvedCleanly || named(d, '近战3,远程2'), '这两个数既没落格也没点名').toBe(true);
  });

  it('〔未定口径·只锁不静默〕闭合括号里塞字段：两格要么都解出，要么点名', () => {
    const d = parseGeneralText('名：郭淮，蜀，体力4（远程2）');
    const solvedCleanly = d.hp === 4 && d.rangedAtk === 2;
    expect(solvedCleanly || named(d, '体力4（远程2）'), '这一段既没落格也没点名').toBe(true);
  });

  // ── ㈣ 句号当不当分隔＝同样还没裁：只锁"不许静默收成怪名"。
  //    这里**不**断言句号必须被当成分隔符，也**不**断言它必须不算——两半都不钉死。
  it('〔未定口径·只锁不静默〕「技能：突袭。骁果」不许收成一句都没点名的怪名', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：突袭。骁果');
    const hasOddName = d.skillNames.some(n => n.includes('。'));
    expect(hasOddName && d.issues.length === 0, '带句号的整串被静默收下').toBe(false);
    const splitCleanly = d.skillNames.length === 2 && !hasOddName;
    expect(splitCleanly || named(d, '突袭。骁果'), '这一段既没切开也没点名').toBe(true);
  });

  // ── 空格那一族＝与逗号／句号同一档：只锁"不许静默"，**不钉**空格算不算分隔（那一格还没裁）。
  it('〔未定口径·只锁不静默〕名字里含空格：要么干净切成几枚，要么逐字点名', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：武圣 单骑');
    const hasOddName = d.skillNames.some(n => /\s/.test(n));
    expect(hasOddName && d.issues.length === 0, '带空格的整串被静默收下').toBe(false);
    const splitCleanly = d.skillNames.length === 2 && !hasOddName;
    expect(splitCleanly || named(d, '武圣 单骑'), '这一段既没切开也没点名').toBe(true);
    const asName = parseGeneralText('名：郭淮 蜀');
    expect((asName.name ?? '').includes(' ') && asName.issues.length === 0, '将名里的空格被静默收下').toBe(false);
  });

  it('回显那两句分得开：收下了的说「收下了但还粘着」，没落进去的才说「没落进去」', () => {
    // 用的是"多了一枚关口的壳"那一族＝与未裁的三格标点无关，这句回显证人不会跟着口径翻。
    const gluedEcho = describeGeneralDraft(parseGeneralText('名：郭淮）'));
    expect(gluedEcho.some(l => l.startsWith('✕ 这一格收下了，但里面还粘着没认的东西：「郭淮）」'))).toBe(true);
    expect(gluedEcho.some(l => l.includes('✕ 没落进去的那一段'))).toBe(false);
    const notLandedEcho = describeGeneralDraft(parseGeneralText('名：甲，魏，骑术精湛'));
    expect(notLandedEcho.some(l => l.startsWith('✕ 没落进去的那一段：「骑术精湛」'))).toBe(true);
    expect(notLandedEcho.some(l => l.includes('✕ 这一格收下了'))).toBe(false);
    // 一句话里两族同时在场＝各说各的，不许并成一句（这句里"没落进去"的是「攻击力3」，"粘着"的是那枚多出来的壳）
    const both = describeGeneralDraft(parseGeneralText('势力魏，攻击力3，名：郭淮）'));
    expect(both.filter(l => l.startsWith('✕ 没落进去的那一段：「攻击力3」')).length).toBe(1);
    expect(both.filter(l => l.startsWith('✕ 这一格收下了，但里面还粘着没认的东西：「郭淮）」')).length).toBe(1);
    // 壳没关那一族现在属于"没落进去"那一半（名字清干净了，尾巴整截没落）
    const bracketEcho = describeGeneralDraft(parseGeneralText('名：郭淮（蜀'));
    expect(bracketEcho.some(l => l.startsWith('✕ 没落进去的那一段：「（蜀」'))).toBe(true);
    expect(bracketEcho.some(l => l.includes('✕ 这一格收下了'))).toBe(false);
  });
});
