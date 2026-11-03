/**
 * 「一句话生成将领」反解那一份文件的证人（刀A＝用户 2026-11-04 当面裁完的 12 条落地）。
 *
 * 每条裁定的**原话**与翻成判据的那一句在 `PROJECT_HANDOFF.md` §12-162；这一份只管"证人对不对得上真行为"。
 *
 * 写这一份时守的四条（都是历轮栽过的，不是装饰）：
 *  ① **弱断言不配当证人**：每条都要能回答"把实现换成另一个合理值，它会不会红"。
 *     凡"不为空""大于 0"这类都配上逐字的 `raw`／`reason`／`unsettled` 一起钉。
 *  ② **按形状拆 `it`**：一枚 `it` 里第一条断言一抛，后面的断言根本不跑⇒十二裁每一条至少一枚独立 `it`，
 *     同一裁定的不同形状也各一枚（只有"同一枚判据要走 create／edit 两条腿"这种同轴形状允许并排循环）。
 *  ③ **这里的每一个读数都来自现场跑过的那份最小输入**（仓库外的只读探针 `probe-rulings`／`probe-shell`／`probe-final`），
 *     不是推出来的；与直觉不同的形状（例：第 2 条的逗号那一形仍能采用）探针里都有，照实钉。
 *  ④ **裁定与裁定叠加出的后果照实钉**：例 第 3 条把句号当分格 ＋ 第 12 条"有段落没落就按住"⇒
 *     `技能：突袭。骁果` 里那枚 `骁果` 落不进任何一格＝整句采用不了。写在这里是**说清现状**，不是替他改规则。
 */
import { describe, it, expect } from 'vitest';
import {
  canAdoptGeneral, describeGeneralDraft, hasUnlandedSegment, hpWasDefaulted,
  missingRequiredFields, parseGeneralText, unsettledSegments,
} from './generalTextParse';
import { DEFAULT_HP_WHEN_MISSING } from '../../domain/generalProvenance';

type ParsedGeneral = ReturnType<typeof parseGeneralText>;

/** 这一段有没有被点名（原文逐字出现在某一条退回复的 `raw` 上）。 */
const named = (d: ParsedGeneral, raw: string) => d.issues.some(i => i.raw === raw);
/** 只取回显里「技能」那一行（同一份回显别处也有"这句话没点"，拿整份去比会误红）。 */
const skillLineOf = (text: string, mode?: 'create' | 'edit') =>
  describeGeneralDraft(parseGeneralText(text), mode).filter(l => l.startsWith('技能：'));
const REJECTED_ALL_LINE = '技能：那一格写的我没认成技能名，一个都没落（逐条点名见下面）';
const NOTHING_SAY_LINE = '技能：这句话没点，进去第②步再加';
/** 第 1 条那句拒收的话（逐字取自探针读数，三枚 `it` 共用）。 */
const R1_REFUSAL = '两枚技能名中间夹一个「和／与／及」＝名册上查不到这种技能名，这种话一般在效果里才出现（例：获得「武圣」和「咆哮」）——技能这一格只写名字，要写几枚请用顿号分开';

describe('一句话 → 名册字段：认得出的写法', () => {
  it('六格都点到的那句＝六格都读到，一句投诉也没有，那颗钮点得动', () => {
    const d = parseGeneralText('名：关兴，蜀，体力4，近战2，远程1，技能：武圣和咆哮');
    expect(d.name).toBe('关兴');
    expect(d.faction).toBe('蜀');
    expect(d.hp).toBe(4);
    expect(d.meleeAtk).toBe(2);
    expect(d.rangedAtk).toBe(1);
    expect(d.skillNames).toEqual(['武圣', '咆哮']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
    expect(unsettledSegments(d)).toEqual([]);
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

  it('「吴国」这种带国字的势力＝同一个势力；壳里的顿号切成两枚（第 5 条裁后不再挂"未裁"那句）', () => {
    const d = parseGeneralText('名：周瑜，吴国，技能：「英姿、反间」');
    expect(d.faction).toBe('吴');
    expect(d.skillNames).toEqual(['英姿', '反间']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
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
    expect(d.issues[0].reason).toBe('势力「徐」不在这五个里：魏／蜀／吴／群／晋');
  });

  it('「体力：强」＝数读不出来就退回点名，绝不兜底成一个像样的数', () => {
    const d = parseGeneralText('名：关羽，蜀，体力：强');
    expect(d.hp).toBeUndefined();
    expect(d.issues[0].raw).toBe('体力：强');
    expect(d.issues[0].reason).toBe('体力那一串读不出数（只认数字或汉字数目字，且要大于 0）');
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('只写「攻击力3」＝近战与远程两个数，不替玩家挑哪一个', () => {
    const d = parseGeneralText('名：马超，蜀，攻击力3');
    expect(d.meleeAtk).toBeUndefined();
    expect(d.rangedAtk).toBeUndefined();
    expect(d.issues[0].raw).toBe('攻击力3');
    expect(d.issues[0].reason).toBe('攻击力有近战与远程两个数，请写明「近战3」或「远程2」（我不替你挑）');
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('数必须大于 0：「近战0」不算一格数', () => {
    const d = parseGeneralText('名：甲，魏，近战0');
    expect(d.meleeAtk).toBeUndefined();
    expect(d.issues[0].raw).toBe('近战0');
    expect(d.issues[0].reason).toBe('近战那一串读不出数（只认数字或汉字数目字，且要大于 0）');
  });
});

describe('技能这一格只记名', () => {
  it('名字后面挂了效果＝名字收下，那整段没落进格子（配合第 12 条＝这句采用不了）', () => {
    const d = parseGeneralText('名：关羽，蜀，技能：武圣：远程攻击力+1');
    expect(d.skillNames).toEqual(['武圣']);
    expect(d.issues[0].raw).toBe('武圣：远程攻击力+1');
    expect(d.issues[0].reason).toBe('这一刀只取技能名，您那句效果（「远程攻击力+1」）请去第②步拼——名册这一格不收效果');
    expect(unsettledSegments(d)).toEqual(['没落进去的：「武圣：远程攻击力+1」']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('说了「技能」却没点出名字＝点名，不收一个空名', () => {
    const d = parseGeneralText('名：甲，魏，技能：');
    expect(d.skillNames).toEqual([]);
    expect(d.issues[0].raw).toBe('技能：');
    expect(d.issues[0].reason).toBe('说了「技能」却没点出名字');
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('一句也没点到技能＝回显说"进去第②步再加"，不假装收了什么', () => {
    const d = parseGeneralText('名：甲，魏');
    expect(d.skillNames).toEqual([]);
    expect(describeGeneralDraft(d).some(l => l.includes(NOTHING_SAY_LINE))).toBe(true);
  });

  // ── 已裁（口令 §16＋§17②）：这一格被本刀自己的两道闸全数拦下时，那句不许再说"没点"。
  //    正向三形**各一枚 `it`**（§17②）：同一枚 `it` 里 `expect` 一抛就停，三形挤一个循环时
  //    一份红字只说一件事、剩下几趟断言根本不跑。每枚内部仍跑 `create`／`edit`＝同一份证人的
  //    两条腿（第 16 件第 3 条：两模式共用一根轴），不必拆成六枚。
  //    "不再出现「这句话没点」"**只圈「技能：」这一行**——同一份回显里「体力：这句话没点…」是
  //    另一格、本刀不碰，整份去比那一串字永远红。
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
  it('同一格写了两回＝后一句**不覆盖**前一句，而是说出矛盾在哪（并且整句退回）', () => {
    const d = parseGeneralText('名：甲，名：乙，势力魏，势力蜀');
    expect(d.name).toBe('甲');
    expect(d.faction).toBe('魏');
    expect(d.issues.map(i => i.raw)).toEqual(['名：乙', '势力蜀']);
    expect(d.issues.map(i => i.reason)).toEqual(['将名写了两回，后一句没落进去', '势力写了两回，后一句没落进去']);
    expect(unsettledSegments(d)).toEqual(['没落进去的：「名：乙」 「势力蜀」']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('完全不知道是哪一格的一句＝原文照抄回来＋一句能照着改的话', () => {
    const d = parseGeneralText('名：甲，魏，骑术精湛');
    expect(d.issues[0].raw).toBe('骑术精湛');
    expect(d.issues[0].reason).toBe('这一句我不知道是哪一格（能写的说法：名／势力／体力／近战／远程／技能）');
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('连接词被忽略也要在回显里说出来（不是悄悄丢掉）', () => {
    const d = parseGeneralText('一位，名将，名：甲，魏');
    expect(d.ignored).toEqual(['一位', '名将']);
    expect(d.name).toBe('甲');
    expect(describeGeneralDraft(d).some(l => l.includes('我当成连接词忽略掉的：一位、名将'))).toBe(true);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('身份与归属这两格不由一句话代定：出现了也不收，并说清要您自己选', () => {
    const d = parseGeneralText('名：甲，魏，身份：三国有名，归属：官方');
    expect(d.issues.map(i => i.raw)).toEqual(['身份：三国有名', '归属：官方']);
    expect(d.issues[0].reason).toBe('这一格要你自己在那一排里选（身份与归属不由一句话定）');
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('空话与垃圾输入都不炸：返回一个什么都不收的草稿', () => {
    for (const bad of ['', '   ', '，，，', '123', '4']) {
      expect(canAdoptGeneral(parseGeneralText(bad)), bad).toBe(false);
    }
    expect(parseGeneralText(null as unknown)).toEqual({ skillNames: [], issues: [], ignored: [] });
    expect(parseGeneralText('')).toEqual({ skillNames: [], issues: [], ignored: [] });
    expect(missingRequiredFields(parseGeneralText('   '))).toEqual(['将名', '势力']);
    expect(hasUnlandedSegment(parseGeneralText('   '))).toBe(false);
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

// ═══════════════ 2026-11-04 十二裁（§12-162）：一条一组，一组按形状拆若干枚 `it` ═══════════════

describe('第 1 条（甲）：名字中间的「和／与／及」＝切出来的名字去名册里查，查得到才切', () => {
  it('「突袭和骁果」两枚都在册＝切成两枚，且**一枚都不许丢**（这一形栽过：切完只回右半＝悄悄丢左半）', () => {
    const d = parseGeneralText('名：张辽，势力魏，体力4，技能：突袭和骁果');
    expect(d.skillNames).toEqual(['突袭', '骁果']);
    expect(d.skillNames.length).toBe(2);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('「武圣和咆哮」＝两枚；「武圣和咆哮和单骑」＝三枚（切完的枚数要数得出）', () => {
    expect(parseGeneralText('名：郭淮，蜀，技能：武圣和咆哮').skillNames).toEqual(['武圣', '咆哮']);
    const three = parseGeneralText('名：郭淮，蜀，技能：武圣和咆哮和单骑');
    expect(three.skillNames).toEqual(['武圣', '咆哮', '单骑']);
    expect(three.issues).toEqual([]);
    expect(canAdoptGeneral(three)).toBe(true);
  });

  it('「与」「及」与「和」同一把尺：武圣与咆哮／武圣及咆哮都切成两枚', () => {
    expect(parseGeneralText('名：郭淮，蜀，技能：武圣与咆哮').skillNames).toEqual(['武圣', '咆哮']);
    const ji = parseGeneralText('名：郭淮，蜀，技能：武圣及咆哮');
    expect(ji.skillNames).toEqual(['武圣', '咆哮']);
    expect(ji.issues).toEqual([]);
  });

  it('切出来有一枚不在名册＝整段拦下、一枚都不落（不许留半枚怪名进卡）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：武圣和兴师');
    expect(d.skillNames).toEqual([]);
    expect(d.issues.map(i => i.raw)).toEqual(['武圣和兴师']);
    expect(d.issues[0].reason).toBe(R1_REFUSAL);
    expect(d.issues[0].fromSkillList).toBe(true);
    expect(unsettledSegments(d)).toEqual(['没落进去的：「武圣和兴师」']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('效果里那种并提（`获得"武圣"和"咆哮"`）＝按他给的那条事实拦下：那不是技能清单', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：获得"武圣"和"咆哮"');
    expect(d.skillNames).toEqual([]);
    expect(d.issues[0].raw).toBe('获得"武圣"和"咆哮"');
    expect(d.issues[0].reason).toBe(R1_REFUSAL);
    expect(canAdoptGeneral(d)).toBe(false);
    expect(skillLineOf('名：郭淮，蜀，技能：获得"武圣"和"咆哮"')).toEqual([REJECTED_ALL_LINE]);
  });

  it('首字就是「和／与／及」的名字不许被削掉首字（和亲／与民同乐／及泉之勇整枚收下）', () => {
    for (const name of ['和亲', '与民同乐', '及泉之勇']) {
      const d = parseGeneralText(`名：郭淮，蜀，技能：${name}`);
      expect(d.skillNames, name).toEqual([name]);
      expect(d.issues, name).toEqual([]);
      expect(canAdoptGeneral(d), name).toBe(true);
    }
  });

  it('「突袭和：只会杀」这一形**改了**：整段拦下（曾是收下「突袭」＋甩一句"没点到技能名"）', () => {
    const d = parseGeneralText('名：甲，魏，技能：突袭和：只会杀');
    expect(d.skillNames).toEqual([]);
    expect(d.issues.map(i => i.raw)).toEqual(['突袭和：只会杀']);
    expect(d.issues[0].reason).toBe(R1_REFUSAL);
    expect(canAdoptGeneral(d)).toBe(false);
  });
});

describe('第 2 条：半角逗号 `,` 不算分格符（今天当分隔⇒裁后不当）', () => {
  it('「名：郭淮,势力蜀」＝整串落进将名那一格，但必须点名"这个符号不在分格里"（不静默）', () => {
    const d = parseGeneralText('名：郭淮,势力蜀');
    expect(d.name).toBe('郭淮,势力蜀');
    expect(d.faction).toBeUndefined();
    expect(missingRequiredFields(d)).toEqual(['势力']);
    expect(d.issues.map(i => i.raw)).toEqual(['郭淮,势力蜀']);
    expect(d.issues[0].glued).toBe(true);
    expect(d.issues[0].reason).toContain('不在分格与切名的符号里');
    expect(unsettledSegments(d)).toEqual(['这几格收下了、里面还粘着没认的东西：「郭淮,势力蜀」']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('技能清单里的半角逗号＝整串当一枚名字收下＋点名粘着⇒按第 12 条这句仍能采用（照实登记，不是替他加闸）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：突袭,骁果');
    expect(d.skillNames).toEqual(['突袭,骁果']);
    expect(d.issues[0].glued).toBe(true);
    expect(d.issues[0].reason).toContain('不在分格与切名的符号里');
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('两个数被半角逗号挤住＝都不落，且那句要说清真因不在数上', () => {
    const d = parseGeneralText('名：郭淮，蜀，近战3,远程2');
    expect(d.meleeAtk).toBeUndefined();
    expect(d.rangedAtk).toBeUndefined();
    expect(d.issues.map(i => i.raw)).toEqual(['近战3,远程2']);
    expect(d.issues[0].reason).toContain('真因不在数上');
    expect(unsettledSegments(d)).toEqual(['没落进去的：「近战3,远程2」']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('没写「名：」那一串带半角逗号＝一格都不落，只点名（与第 11 条不猜名叠加的形状）', () => {
    const d = parseGeneralText('郭淮,势力蜀,体力4');
    expect(d.name).toBeUndefined();
    expect(d.faction).toBeUndefined();
    expect(d.hp).toBeUndefined();
    expect(unsettledSegments(d)).toEqual(['没落进去的：「郭淮,势力蜀,体力4」']);
    expect(d.issues[0].reason).toContain('挤成了一格');
    expect(canAdoptGeneral(d)).toBe(false);
  });
});

describe('第 3 条：句号 `。` 算分格符（今天不当⇒裁后当）', () => {
  it('「名：郭淮。蜀」＝句号当分格：两格都落，一句投诉都没有', () => {
    const d = parseGeneralText('名：郭淮。蜀');
    expect(d.name).toBe('郭淮');
    expect(d.faction).toBe('蜀');
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('三段都用句号分开＝三格各归各（名／势力／体力）', () => {
    const d = parseGeneralText('名：郭淮。蜀。体力4');
    expect(d.name).toBe('郭淮');
    expect(d.faction).toBe('蜀');
    expect(d.hp).toBe(4);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('技能清单里写句号＝句号把这一格切成两句：`突袭` 落，`骁果` 落不进任何一格⇒这句采用不了', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：突袭。骁果');
    expect(d.skillNames).toEqual(['突袭']);
    expect(d.issues.map(i => i.raw)).toEqual(['骁果']);
    expect(d.issues[0].glued).toBeUndefined();
    expect(unsettledSegments(d)).toEqual(['没落进去的：「骁果」']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('壳**里面**的句号照旧切成两枚（第 3 条裁的是格与格之间的分家；壳内下刀那一族按现状钉）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：「突袭。骁果」');
    expect(d.skillNames).toEqual(['突袭', '骁果']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });
});

describe('第 4 条：空格不算分隔（这一条裁的是"不动"，证人钉的就是它没被顺手改掉）', () => {
  it('「技能：武圣 单骑」＝空格没被当分隔：整串当一枚名收下＋点名「这个名字里有空格」', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：武圣 单骑');
    expect(d.skillNames).toEqual(['武圣 单骑']);
    expect(d.issues.map(i => i.raw)).toEqual(['武圣 单骑']);
    expect(d.issues[0].reason).toBe('这个名字里有空格，我没把它当分隔');
    expect(d.issues[0].glued).toBe(true);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('将名里的空格同样不当分隔（「名：郭淮 蜀」＝一格都不分）', () => {
    const d = parseGeneralText('名：郭淮 蜀');
    expect(d.name).toBe('郭淮 蜀');
    expect(d.faction).toBeUndefined();
    expect(d.issues[0].reason).toBe('这个名字里有空格，我没把它当分隔');
    expect(missingRequiredFields(d)).toEqual(['势力']);
  });
});

describe('第 5 条：顿号 `、` 带不带壳都切两枚', () => {
  it('裸写「突袭、骁果」＝两枚（曾经是只落一枚＋甩一句"不知道是哪一格"）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：突袭、骁果');
    expect(d.skillNames).toEqual(['突袭', '骁果']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('带壳「「英姿、反间」」＝同样两枚（壳内外同一把尺）', () => {
    const d = parseGeneralText('名：周瑜，吴，技能：「英姿、反间」');
    expect(d.skillNames).toEqual(['英姿', '反间']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('顿号写在**格与格之间**＝分格：「名：郭淮、势力蜀」两格各归各', () => {
    const d = parseGeneralText('名：郭淮、势力蜀');
    expect(d.name).toBe('郭淮');
    expect(d.faction).toBe('蜀');
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('三枚连写＝切出的枚数数得出（突袭、骁果、武圣）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：突袭、骁果、武圣');
    expect(d.skillNames).toEqual(['突袭', '骁果', '武圣']);
    expect(canAdoptGeneral(d)).toBe(true);
  });
});

/**
 * 斜杠那一族＝**用户 12 条一条也没点它的名**⇒ 判据是「没裁的形状保持原样」。
 * 半角 `/` 在刀A 第 1 轮之前就一直是分格符；那一轮重写 `splitSkillNames` 时把字符集从
 * `[、，,/]` 换成 `[、，。]`，`/` 跟着掉了 ⇒ 同一句从"切成两枚真名"退成"静默收下 `武圣/咆哮`
 * 一枚怪名、`issues=[]`、那颗钮还亮着"——正是这条线要消灭的形状。这两枚钉的是**倒退本身**，
 * 不是给斜杠立新规则。
 */
describe('半角斜杠 `/`：没裁的形状不许顺手改（它一直是技能清单的分格符）', () => {
  it('「技能：武圣/咆哮」＝切成两枚真名，一句投诉也没有，那颗钮点得动（第 1 轮曾做成一枚怪名）', () => {
    const d = parseGeneralText('名：郭淮，魏，技能：武圣/咆哮');
    expect(d.skillNames).toEqual(['武圣', '咆哮']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  // 〔现状·未裁〕这一枚钉的是**今天真发生的**，不是说"应该这样"：全角 `／` 在刀A 开工之前就是
  // 整串静默收下，本轮（修订轮）明确不补它——它不在 12 条里，也不属本刀带来的倒退，归主人裁。
  // 哪天裁了它，这枚证人要跟着翻，别让它把"静默"钉成永久合同。
  it('〔现状·未裁〕「技能：武圣／咆哮」＝整串当一枚技能名收下、一句投诉也没有，那颗钮照样点得动', () => {
    const d = parseGeneralText('名：郭淮，魏，技能：武圣／咆哮');
    expect(d.skillNames).toEqual(['武圣／咆哮']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });
});

describe('第 6 条：括号开了没关上＝那一段整个不要，只留前面的名，并且报丢了什么', () => {
  it('「技能：武圣（突袭、单骑」＝只留 `武圣`，那整截不静默、单独点名', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：武圣（突袭、单骑');
    expect(d.skillNames).toEqual(['武圣']);
    expect(d.issues.map(i => i.raw)).toEqual(['（突袭、单骑']);
    expect(d.issues[0].glued).toBeUndefined();
    expect(d.issues[0].reason).toContain('开了没关上');
    expect(d.issues[0].reason).toContain('这种写法一般是技能名还没定下来');
    expect(unsettledSegments(d)).toEqual(['没落进去的：「（突袭、单骑」']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('将名里开了没关上＝名字清干净，从壳起的整截一格不落', () => {
    const d = parseGeneralText('名：郭淮（蜀');
    expect(d.name).toBe('郭淮');
    expect(d.faction).toBeUndefined();
    expect(d.issues.map(i => i.raw)).toEqual(['（蜀']);
    expect(d.issues[0].reason).toContain('那一头括号／书名号开了没关上');
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

  it('回显只说「没落进去的那一段」——那一截一个字段都没落，不许说成"收下了但还粘着"', () => {
    const echo = describeGeneralDraft(parseGeneralText('名：郭淮（蜀'));
    expect(echo.some(l => l.startsWith('✕ 没落进去的那一段：「（蜀」'))).toBe(true);
    expect(echo.some(l => l.includes('✕ 这一格收下了'))).toBe(false);
  });
});

describe('第 7 条：多一个右括号＝剥掉它，按正常技能名收', () => {
  it('「单骑）」＝剥壳后按「单骑」收进技能名这一格（曾经原样进名册＝引擎查不到这名字）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：单骑）');
    expect(d.skillNames).toEqual(['单骑']);
    expect(d.issues.map(i => i.raw)).toEqual(['单骑）']);
    expect(d.issues[0].glued).toBe(true);
    expect(d.issues[0].reason).toBe('多了一个关口的壳，剥掉之后按「单骑」收进技能名这一格');
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('右括号打头那一形（`）单骑`）＝同一句真话、同一个名', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：）单骑');
    expect(d.skillNames).toEqual(['单骑']);
    expect(d.issues[0].reason).toBe('多了一个关口的壳，剥掉之后按「单骑」收进技能名这一格');
    expect(unsettledSegments(d)).toEqual(['这几格收下了、里面还粘着没认的东西：「）单骑」']);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('「武圣（突袭、单骑）」＝两族同场：`（突袭` 整段没落，`单骑）` 落格但粘着，各自点名', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：武圣（突袭、单骑）');
    expect(d.skillNames).toEqual(['武圣', '单骑']);
    expect(d.issues.map(i => i.raw)).toEqual(['（突袭', '单骑）']);
    expect(unsettledSegments(d)).toEqual([
      '没落进去的：「（突袭」',
      '这几格收下了、里面还粘着没认的东西：「单骑）」',
    ]);
    expect(canAdoptGeneral(d)).toBe(false);
  });
});

describe('第 8 条：徽章粘在技能名后面＝切开，不再静默', () => {
  it('「技能：武圣「锁定技」」＝技能「武圣」落格＋徽章从名字后剥开＋说一句这写法少见', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：武圣「锁定技」');
    expect(d.skillNames).toEqual(['武圣']);
    expect(d.issues.map(i => i.raw)).toEqual(['武圣「锁定技」']);
    expect(d.issues[0].glued).toBe(true);
    expect(d.issues[0].reason).toContain('这种写法少见');
    expect(d.issues[0].reason).toContain('我把它从技能名「武圣」后面剥开了');
    expect(canAdoptGeneral(d)).toBe(true);
  });

  it('「单骑「限定技」」＝同一族的另一枚徽章，措辞同一形状（不许只处理锁定技）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：单骑「限定技」');
    expect(d.skillNames).toEqual(['单骑']);
    expect(d.issues[0].reason).toContain('「限定技」是徽章，我把它从技能名「单骑」后面剥开了');
    expect(unsettledSegments(d)).toEqual(['这几格收下了、里面还粘着没认的东西：「单骑「限定技」」']);
  });

  it('壳里再套壳（`「武圣「锁定技」」`）不许静默收成「武圣锁定技」：同样剥开＋点名（栽过的那形）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：「武圣「锁定技」」');
    expect(d.skillNames).toEqual(['武圣']);
    expect(d.skillNames).not.toContain('武圣锁定技');
    expect(d.issues.map(i => i.raw)).toEqual(['「武圣「锁定技」」']);
    expect(d.issues[0].glued).toBe(true);
    expect(d.issues[0].reason).toContain('这种写法少见');
  });

  it('圆括号那一族（`武圣（锁定技）`）＝只落名、那一段没落进格子⇒配合第 12 条这句采用不了', () => {
    const d = parseGeneralText('名：郭淮，魏，技能：武圣（锁定技）');
    expect(d.skillNames).toEqual(['武圣']);
    expect(d.issues[0].raw).toBe('武圣（锁定技）');
    expect(d.issues[0].reason).toBe('您那句徽章（「锁定技」）名册这一格不收，请去第②步那张卡上勾');
    expect(canAdoptGeneral(d)).toBe(false);
  });
});

describe('第 9 条：`技能：攻击力0`＝判非法格式（这名字他没写过，那种话只出现在效果里）', () => {
  it('「攻击力0」不进技能名，那句要说清是非法格式、不是"不知道是哪一格"', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：攻击力0');
    expect(d.skillNames).toEqual([]);
    expect(d.issues.map(i => i.raw)).toEqual(['攻击力0']);
    expect(d.issues[0].reason).toBe('「攻击力0」是非法格式：攻击力那一格只写大于 0 的数，「攻击力为0／变为0」那种话属于效果——技能名这一格我不收这种写法');
    expect(d.issues[0].fromSkillList).toBe(true);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('「技能：攻击力3」＝字段不是技能名，且不替玩家填近战或远程', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：攻击力3');
    expect(d.skillNames).toEqual([]);
    expect(d.meleeAtk).toBeUndefined();
    expect(d.rangedAtk).toBeUndefined();
    expect(d.issues.find(i => i.raw === '攻击力3')?.reason)
      .toBe('「攻击力3」是字段，不是技能名；攻击力有近战与远程两个数，请分开写（如「近战3」「远程2」）');
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('读不出数的裸「攻击力」仍当技能名收——不许把猜出来的数当成玩家写的数', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：攻击力');
    expect(d.skillNames).toEqual(['攻击力']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });

  // 诚实登记（第 9 条只给了「攻击力」那一族）：`体力0` 今天仍按普通名收下。
  // 这一枚钉的是**现状**；交回里"还没覆盖的形状"有一条就是它——他日裁了就把它改成裁定那一形。
  it('〔现状·未裁〕「技能：体力0」仍被当一枚技能名收下（第 9 条只裁了「攻击力」那一族）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：体力0');
    expect(d.skillNames).toEqual(['体力0']);
    expect(d.issues).toEqual([]);
  });
});

describe('第 10 条：带壳的字段写在技能以外＝也判非法格式', () => {
  it('「「体力4」」＝不落进体力那一格，那句说非法格式＋教他裸写', () => {
    const d = parseGeneralText('名：郭淮，蜀，「体力4」');
    expect(d.hp).toBeUndefined();
    expect(d.issues.map(i => i.raw)).toEqual(['「体力4」']);
    expect(d.issues[0].reason).toBe('「体力4」＝非法格式：字段词套着壳、又不在「技能」那一格里，这个位置我不收；体力那一格请裸写（别套壳）');
    expect(d.issues[0].glued).toBeUndefined();
    expect(unsettledSegments(d)).toEqual(['没落进去的：「「体力4」」']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('「「近战3」」＝同一形状，且那句话里不许出现替玩家编的数（没有"例：近战4"那种话）', () => {
    const d = parseGeneralText('名：郭淮，蜀，「近战3」');
    expect(d.meleeAtk).toBeUndefined();
    expect(d.issues[0].reason).toBe('「近战3」＝非法格式：字段词套着壳、又不在「技能」那一格里，这个位置我不收；近战那一格请裸写（别套壳）');
    expect(d.issues[0].reason).not.toContain('例：');
  });

  it('〔反向〕裸写「体力4」仍照常收＝第 10 条只拦带壳那一形，不许把裸写一起改掉', () => {
    const d = parseGeneralText('名：郭淮，蜀，体力4');
    expect(d.hp).toBe(4);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
  });
});

describe('第 11 条：没写「名：」＝不替玩家按位置猜将名，提示并退回', () => {
  it('「技能：限定技、突袭」这一形曾经把将名猜成「突袭」＝现在将名空着、缺了那一格说出来', () => {
    const d = parseGeneralText('技能：限定技、突袭');
    expect(d.name).toBeUndefined();
    expect(d.skillNames).toEqual(['突袭']);
    expect(missingRequiredFields(d)).toEqual(['将名', '势力']);
    expect(describeGeneralDraft(d).some(l => l.startsWith('将名：'))).toBe(false);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('裸写在最前面的汉字＝不再当名字，逐字点名"不知道是哪一格"', () => {
    const d = parseGeneralText('张飞，蜀，体力4');
    expect(d.name).toBeUndefined();
    expect(d.faction).toBe('蜀');
    expect(d.hp).toBe(4);
    expect(d.issues.map(i => i.raw)).toEqual(['张飞']);
    expect(d.issues[0].reason).toBe('这一句我不知道是哪一格（能写的说法：名／势力／体力／近战／远程／技能）');
    expect(missingRequiredFields(d)).toEqual(['将名']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('裸名在前、后面又写了「名：」＝收「名：」那一格，前面那截照样点名（不覆盖、也不猜）', () => {
    const d = parseGeneralText('太史慈，名：周泰，群');
    expect(d.name).toBe('周泰');
    expect(d.faction).toBe('群');
    expect(d.issues.map(i => i.raw)).toEqual(['太史慈']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('段首帽子仍要剥（第 11 条与 2026-10-30 那条的交点）：「一位郭淮，魏」＝帽子记进忽略、将名仍空', () => {
    const d = parseGeneralText('一位郭淮，魏');
    expect(d.name).toBeUndefined();
    expect(d.faction).toBe('魏');
    expect(d.ignored).toEqual(['一位']);
    expect(d.issues.map(i => i.raw)).toEqual(['郭淮']);
    expect(missingRequiredFields(d)).toEqual(['将名']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('写了「名：」那一帽子的路照常：「名：一位郭淮，魏」＝落「郭淮」，忽略的词回显', () => {
    const d = parseGeneralText('名：一位郭淮，魏');
    expect(d.name).toBe('郭淮');
    expect(d.faction).toBe('魏');
    expect(d.ignored).toEqual(['一位']);
    expect(d.issues).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
    expect(describeGeneralDraft(d).some(l => l.includes('我当成连接词忽略掉的：一位'))).toBe(true);
  });

  it('「一名郭淮，魏」与「一位」同一族：帽子记下来，名字不猜', () => {
    const d = parseGeneralText('一名郭淮，魏');
    expect(d.name).toBeUndefined();
    expect(d.ignored).toEqual(['一名']);
    expect(d.issues.map(i => i.raw)).toEqual(['郭淮']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('帽子压在势力上仍认：「一位蜀」＝势力蜀、将名空（剥完之后才送去比对五档）', () => {
    const d = parseGeneralText('一位蜀');
    expect(d.faction).toBe('蜀');
    expect(d.name).toBeUndefined();
    expect(d.ignored).toEqual(['一位']);
    expect(d.issues).toEqual([]);
    expect(missingRequiredFields(d)).toEqual(['将名']);
  });

  it('剥到剩下还是一顶帽子＝不许剥（「一位一位」一句都不收，也不静默）', () => {
    const d = parseGeneralText('一位一位');
    expect(d.name).toBeUndefined();
    expect(d.ignored).toEqual([]);
    expect(d.issues.map(i => i.raw)).toEqual(['一位一位']);
    expect(missingRequiredFields(d)).toEqual(['将名', '势力']);
    expect(canAdoptGeneral(d)).toBe(false);
  });

  it('只有势力没有名＝那一格空着、一句投诉也没有，也不许猜（「魏」这一形）', () => {
    const d = parseGeneralText('魏');
    expect(d.faction).toBe('魏');
    expect(d.name).toBeUndefined();
    expect(d.issues).toEqual([]);
    expect(missingRequiredFields(d)).toEqual(['将名']);
    expect(canAdoptGeneral(d)).toBe(false);
  });
});

describe('第 12 条：有东西没落进这张卡＝退回＋那颗「采用」按住＋错误说清楚', () => {
  it('〔门槛〕一句里有一段没落＝`hasUnlandedSegment` 为真、`canAdoptGeneral` 为假', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：突袭，骑术精湛');
    expect(d.issues.map(i => i.raw)).toEqual(['骑术精湛']);
    expect(hasUnlandedSegment(d)).toBe(true);
    expect(canAdoptGeneral(d)).toBe(false);
    expect(unsettledSegments(d)).toEqual(['没落进去的：「骑术精湛」']);
  });

  it('〔措辞与真行为对得上〕那句点名同时出现在回显里，写清"哪一段＋为什么"（两模式同一份拼装）', () => {
    const d = parseGeneralText('名：郭淮，蜀，技能：突袭，骑术精湛');
    const line = '✕ 没落进去的那一段：「骑术精湛」——这一句我不知道是哪一格（能写的说法：名／势力／体力／近战／远程／技能）';
    for (const mode of ['create', 'edit'] as const) {
      expect(describeGeneralDraft(d, mode), mode).toContain(line);
    }
  });

  it('〔反向·只有粘着那一族〕落进格子了、里面还粘着＝**不拦**（说它"没落进去"是假话）', () => {
    const d = parseGeneralText('势力魏，名：郭淮）');
    expect(d.name).toBe('郭淮）');
    expect(hasUnlandedSegment(d)).toBe(false);
    expect(canAdoptGeneral(d)).toBe(true);
    expect(unsettledSegments(d)).toEqual(['这几格收下了、里面还粘着没认的东西：「郭淮）」']);
  });

  it('〔反向·落齐了〕「名：甲，魏」＝两格都有、一段都没丢⇒那颗钮点得动', () => {
    const d = parseGeneralText('名：甲，魏');
    expect(hasUnlandedSegment(d)).toBe(false);
    expect(missingRequiredFields(d)).toEqual([]);
    expect(canAdoptGeneral(d)).toBe(true);
    expect(unsettledSegments(d)).toEqual([]);
  });

  it('〔门槛的另一半〕缺了势力＝照样退回，但这一形**不是**"没落进去"（两句不许串）', () => {
    const d = parseGeneralText('名：孟获');
    expect(d.issues).toEqual([]);
    expect(hasUnlandedSegment(d)).toBe(false);
    expect(missingRequiredFields(d)).toEqual(['势力']);
    expect(canAdoptGeneral(d)).toBe(false);
    expect(unsettledSegments(d)).toEqual([]);
  });

  it('〔两族同场〕各说各的，不许并成一句', () => {
    const d = parseGeneralText('势力魏，攻击力3，名：郭淮）');
    expect(unsettledSegments(d)).toEqual([
      '没落进去的：「攻击力3」',
      '这几格收下了、里面还粘着没认的东西：「郭淮）」',
    ]);
    expect(hasUnlandedSegment(d)).toBe(true);
    expect(canAdoptGeneral(d)).toBe(false);
    const echo = describeGeneralDraft(d);
    expect(echo.filter(l => l.startsWith('✕ 没落进去的那一段：「攻击力3」')).length).toBe(1);
    expect(echo.filter(l => l.startsWith('✕ 这一格收下了，但里面还粘着没认的东西：「郭淮）」')).length).toBe(1);
  });

  it('〔叠加后果·照实钉〕效果那句被推到第②步＝按第 12 条整句退回（曾经这种话照样能采用）', () => {
    const d = parseGeneralText('名：郭淮，魏，技能：武圣（摸一张牌）');
    expect(d.skillNames).toEqual(['武圣']);
    expect(d.issues[0].reason).toContain('您那句效果');
    expect(hasUnlandedSegment(d)).toBe(true);
    expect(canAdoptGeneral(d)).toBe(false);
  });
});

describe('徽章词／字段词混进技能清单＝都不进技能名，那句是真话', () => {
  it('徽章词单独成段／排在清单里＝都不进技能名，另点一句「是徽章，不是技能名」', () => {
    const cases: [string, string][] = [
      ['名：郭淮，蜀，锁定技', '锁定技'],
      ['名：郭淮，蜀，技能：限定技', '限定技'],
      ['名：郭淮，蜀，技能：突袭、限定技', '限定技'],
    ];
    for (const [text, badge] of cases) {
      const d = parseGeneralText(text);
      expect(d.skillNames.includes(badge), text).toBe(false);
      expect(named(d, badge), `${text}：这一枚既没落格也没点名`).toBe(true);
      expect(d.issues.find(i => i.raw === badge)?.reason, text)
        .toBe(`「${badge}」是徽章，不是技能名；徽章那一格在第②步那张卡上勾`);
      expect(d.issues.find(i => i.raw === badge)?.reason, text).not.toContain('身份与归属');
    }
  });

  it('「锁定技」／【限定技】／「登场技」＝先脱壳再判徽章，得到的那句与裸写逐字同一', () => {
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

  it('「技能：体力4／远程2／近战三」＝不落进技能名，也不替玩家填那一格', () => {
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
      expect(canAdoptGeneral(d), text).toBe(false);
    }
  });

  it('闭合壳里那句命中徽章＝说「您那句徽章」；不命中＝仍说「效果」——两形都只收名字', () => {
    const badge = parseGeneralText('名：郭淮，魏，技能：武圣（锁定技）');
    expect(badge.skillNames).toEqual(['武圣']);
    expect(badge.issues[0].reason).toBe('您那句徽章（「锁定技」）名册这一格不收，请去第②步那张卡上勾');
    expect(badge.issues[0].reason).not.toContain('效果');
    const effect = parseGeneralText('名：郭淮，魏，技能：武圣（摸一张牌）');
    expect(effect.skillNames).toEqual(['武圣']);
    expect(effect.issues[0].reason).toContain('您那句效果');
  });

  it('数那一格被括号挤住＝两格都不落，那句要说清真因在"没分家"不在数上', () => {
    const d = parseGeneralText('名：郭淮，蜀，体力4（远程2）');
    expect(d.hp).toBeUndefined();
    expect(d.rangedAtk).toBeUndefined();
    expect(d.issues[0].raw).toBe('体力4（远程2）');
    expect(d.issues[0].reason).toContain('真因不在数上');
    expect(canAdoptGeneral(d)).toBe(false);
  });
});

describe('回显那两句分得开：收下了的说「收下了但还粘着」，没落进去的才说「没落进去」', () => {
  it('两族各自的措辞不许串（用的是"多了一枚关口的壳"那一族＝与标点那几格无关）', () => {
    const gluedEcho = describeGeneralDraft(parseGeneralText('名：郭淮）'));
    expect(gluedEcho.some(l => l.startsWith('✕ 这一格收下了，但里面还粘着没认的东西：「郭淮）」'))).toBe(true);
    expect(gluedEcho.some(l => l.includes('✕ 没落进去的那一段'))).toBe(false);
    const notLandedEcho = describeGeneralDraft(parseGeneralText('名：甲，魏，骑术精湛'));
    expect(notLandedEcho.some(l => l.startsWith('✕ 没落进去的那一段：「骑术精湛」'))).toBe(true);
    expect(notLandedEcho.some(l => l.includes('✕ 这一格收下了'))).toBe(false);
  });
});
