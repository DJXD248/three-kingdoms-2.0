/**
 * v2.9.24 刀2「一句话生成将领」（离线词表档，纯读入侧）。
 * 契约＝PROJECT_HANDOFF.md §12-140④／⑥／⑨㈡，分隔标点／括号／徽章粘连／门禁那几格
 * 已于 2026-11-04 由用户本人逐条裁完＝**§12-162 那 12 条**（本节 ① 是他的原话，冲突时以原话为准）；
 * 纪律与 `src/skills/skillTextParse.ts` 同一套：
 * 读不懂的那一段**逐段点名**，绝不替玩家猜；五格里只有体力能兜底，
 * 而那个兜底不住在这里——住在 `generalProvenance.hpOrDefault`（与 Excel 导入同一格判据）。
 * 本文件不写库、不建卡、不碰编译链路；采用之后仍走 `createAuthoredGeneral` 那唯一一条建卡路。
 */
import { parseCountNumber } from '../../skills/skillGateText';
import { type Faction, allGenerals, allSkillTags } from '../../data/generals';
import { hpOrDefault } from '../../domain/generalProvenance';
import { IMPORT_FACTIONS } from './skillExcelParsers';

export interface GeneralTextIssue {
  raw: string;
  reason: string;
  /**
   * 这一段**其实落进格子了**，只是里面还粘着今天没被任何一条规则认过的东西——
   * 与"整段没落进去"是两回事，回显那一句必须分开说，不然就成了假话。
   */
  glued?: boolean;
  /**
   * 这一枚点名出自「技能」那一格的清单里（字段词、徽章词被拦下那两族），不是顶层某一段没落格。
   * 回显那句要用它分辨两种"这一格是空的"：写了、但每一枚都被拦下 ≠ 一个字都没写。
   * 按**出处**记，不按措辞猜：将来那句话再改，这条判据不会被一起改掉。
   */
  fromSkillList?: boolean;
}

/** 一句话读出来的名册字段（与「新建将领」那一排、以及 `AuthoredGeneralInput` 一一对应）。 */
export interface GeneralTextDraft {
  name?: string;
  faction?: Faction;
  /** 只有这句话里点了数才挂；没点＝留空，由采用那一步交给 `hpOrDefault` 兜底。 */
  hp?: number;
  meleeAtk?: number;
  rangedAtk?: number;
  /** 只记名，效果一律留空（§12-140④：照「只有描述不结算」那条既有形态，绝不硬编效果）。 */
  skillNames: string[];
  /** 读不懂／形状不合法 ⇒ 这一段没落任何字段，逐段点名给玩家看。 */
  issues: GeneralTextIssue[];
  /** 被当成连接词忽略掉的词（玩家看得见"这几句我没当意思"，不是偷偷丢）。 */
  ignored: string[];
}

/** 只当连接词、不承载任何字段的值（忽略时必须回显给玩家）。 */
const CONNECTIVES = ['一位', '一个', '一名', '名将', '新将', '新建将领', '请', '立即', '并且', '同时', '另外', '其中'];

/** 这一格要玩家自己定，一句话里出现了也不接（身份锁与归属都是人为决定，§H1）。 */
const HUMAN_ONLY_KEYS = ['身份', '归属', '来源', '锁定', '白锁', '金锁'];

const NAME_RE = /^(?:将名|将领名|姓名|名字|叫作|叫做|名为|名)[:：]?(.+)$/;
const FACTION_KEY_RE = /^(?:势力|阵营|国别|所属势力|所属国|国)[:：]?(.+)$/;
const HP_KEY_RE = /^(?:体力|血量|生命值|生命|初始体力|HP|hp)[:：]?(.+)$/;
const HP_TAIL_RE = /^(.+?)点?(?:体力|血量|生命值|生命)$/;
const MELEE_RE = /^近战(?:攻击力|攻|攻击|武力|伤害)?[:：]?(.+)$/;
const RANGED_RE = /^远程(?:攻击力|攻|攻击|武力|伤害)?[:：]?(.+)$/;
/** 名字后面可空＝"说了「技能」却没点出名字"也要接住并点名，不能让它掉到最后那句通用退回。 */
const SKILLS_RE = /^(?:技能|技能名|自带技能|自带|会|掌握)[:：]?(.*)$/;
/** 只写了一个"攻击力"：近战与远程是两个数，不许替玩家挑哪一个。 */
const AMBIGUOUS_ATK_RE = /^(?:原始攻击力|攻击力|武力|初始攻击力)[:：]?/;

function factionOf(text: string): Faction | undefined {
  const f = text.trim().replace(/国$/, '');
  return IMPORT_FACTIONS.find(candidate => candidate === f);
}

/**
 * 剥掉段首那些"说话时带的帽子"（用户 2026-10-30 裁：「**一位郭淮**」这种显然只该认到「郭淮」）。
 * 词表只有一份＝`CONNECTIVES`，这里不另起一张名单；每次只剥一枚**前缀**、剥下来的原样交给回显点名，
 * 绝不静默丢。长词优先，免得「一名郭淮」先被短词切成「名郭淮」。
 * 剥空了（剩下的什么都不是）就把原段整段交回去——宁可不剥，也不替玩家造一个名字。
 */
function stripLeadingConnective(fragment: string): { rest: string; dropped: string[] } {
  const dropped: string[] = [];
  let rest = fragment.trim();
  for (;;) {
    const hit = [...CONNECTIVES]
      .sort((a, b) => b.length - a.length)
      .find(word => {
        if (!rest.startsWith(word)) return false;
        const remainder = rest.slice(word.length).trim();
        return remainder !== '' && !CONNECTIVES.includes(remainder);
      });
    if (hit === undefined) break;
    rest = rest.slice(hit.length).trim();
    dropped.push(hit);
  }
  return { rest, dropped };
}

/** 只认数字与汉字数目字，且必须大于 0；读不出来就交回点名，绝不兜底。 */
function positiveCount(text: string): number | undefined {
  const n = parseCountNumber(text);
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

/**
 * 今天既不分格、也不切名的标点：整截照收，但必须说出来。
 * 「,」不算分隔＝用户 2026-11-04 裁完的第 2 条；`。` 已从这一枚名单搬进分隔符（第 3 条）。
 */
const UNREAD_PUNCTUATION = [','];
/** 与 `splitFragments` 同一批壳子，配对判据只这一处。 */
const OPEN_BRACKETS = ['（', '(', '「', '『', '【'];
const CLOSE_BRACKETS = ['）', ')', '」', '』', '】'];

/**
 * 这一段被整截收下的**真因**（说不出来就返回 undefined）。只讲今天逐字成立的事：
 * 这个标点不在分格与切名的集合里、那对壳子开了没关，于是后面那段话粘了进来。
 */
function gluedMaterial(text: string): string | undefined {
  const punct = UNREAD_PUNCTUATION.find(ch => text.includes(ch));
  if (punct !== undefined) {
    return `那一个「${punct}」不在分格与切名的符号里（分格只认全角逗号、顿号、句号、分号），所以这一段挤成了一格`;
  }
  let depth = 0;
  for (const ch of text) {
    if (OPEN_BRACKETS.includes(ch)) depth++;
    else if (CLOSE_BRACKETS.includes(ch)) depth--;
  }
  if (depth > 0) return '那一头括号／书名号开了没关上，后面那段话被一起粘进这一格';
  if (depth < 0) return '多了一个关口的壳，这一段没读全';
  return undefined;
}

/**
 * 数读不出来的第二种真因：括号里还另有一格，而分格只在这对壳**外面**下刀，
 * 于是里面那截跟着整段一起被送去读了这一个字段。
 * 这一条只用于"没落进格子"那句解释——将名里带一对括号是玩家要的名字本身，不该当粘件点名。
 */
function bracketedFieldInside(fragment: string, field: string): string | undefined {
  const at = fragment.search(/[（(]/);
  if (at < 0) return undefined;
  const inside = fragment.slice(at + 1).replace(/[（(）)]/g, '').trim();
  if (inside === '') return undefined;
  return `括号里的「${inside}」没跟「${field}」这一格分家，整段被当成一句话说`;
}

/** 数读不出来时，真因常常不在数上，而是这一段粘着别的段落——那句要跟着说。 */
function unreadNumberReason(field: string, fragment: string): string {
  const base = `${field}那一串读不出数（只认数字或汉字数目字，且要大于 0）`;
  const why = gluedMaterial(fragment) ?? bracketedFieldInside(fragment, field);
  return why === undefined ? base : `${base}；真因不在数上——${why}`;
}

/**
 * 已经落进格子那几段（将名与技能名）也过一遍：里面若还粘着没认的标点、没关上的壳或空格，
 * **给一句说出来**，不许静默收下。这一趟不改任何字段的落法，也不碰「能不能采用」那道判据。
 * 空格那句只在这里出现——它说的是**名字**里的那一枚空格（第 4 条用户 2026-11-04 已裁＝空格不算分隔，
 * 所以这一趟既不改切法、也不静默收下，只把"里面还粘着一枚空格"说出来），
 * 借 `gluedMaterial` 那三条时它管的是"这一段为什么挤住"，措辞换到"这个名字"会说不通。
 */
function nameGlueReason(text: string): string | undefined {
  const why = gluedMaterial(text);
  if (why !== undefined) return why;
  if (/\s/.test(text)) return '这个名字里有空格，我没把它当分隔';
  return undefined;
}

function flagGluedMaterial(draft: GeneralTextDraft): void {
  const landed = [...(draft.name === undefined ? [] : [draft.name]), ...draft.skillNames];
  for (const text of landed) {
    const why = nameGlueReason(text);
    if (why === undefined) continue;
    if (draft.issues.some(i => i.raw === text && i.reason === why)) continue;
    draft.issues.push({ raw: text, reason: why, glued: true });
  }
}

/**
 * 徽章（技能标签）那五枚的名字**不在这儿另抄一份**：用的就是 `src/domain/skillTags.ts`
 * 认徽章时读的那一枚 `allSkillTags`（`skillTags.test.ts` 还钉着它与说明表逐字同集）。
 */
const BADGE_WORDS = allSkillTags as readonly string[];
const isBadgeWord = (text: string): boolean => BADGE_WORDS.includes(text.trim());

/**
 * 第 1 条甲档问的那本「名册」＝**卡上出现过的技能名**（含只有名字、还没配效果内容的空壳）。
 * 刻意不用 `skills/skillNameIndex.ts` 那本册子：它按"有没有真效果"过滤（管的是"能不能被获得"），
 * 而这里问的是"这个名字像不像一枚技能名"——`突袭``骁果` 在 effect 册子上查不到，却是卡上的真名。
 * ⚠️ 取的是仓库里那份静态名册（`allGenerals`），**不含**本机 DIY 卡与卡面编辑：
 * 玩家自己新起的名还没进册子，"两枚并提"里带一枚自造名会被按第 1 条拦下（在册的诚实缺口）。
 */
const ROSTER_SKILL_NAMES = new Set<string>(
  allGenerals.flatMap(general => general.skills.map(skill => String(skill?.name ?? '').trim()).filter(Boolean)),
);
const isInRoster = (name: string): boolean => ROSTER_SKILL_NAMES.has(name.trim());

/**
 * 将名里那一头**没关上的壳**：从第一枚找不到配平关口的左壳起，整截都不该留在名字里。
 * 判据（监督台 2026-11-03 裁 ⇒ 用户本人 2026-11-04 第 6 条裁完＝括号开了没关时**括号里那一段整个不要**，
 * 但丢了什么要报一句，不许静默）**同一个解析器对同一族必须同一行为**：闭合的壳今天已经是
 * 「取壳前的名字＋点名壳内那段」，没闭合的壳若把怪尾巴留在将名里，将名要进名册、要被另一台机器读。
 * ⚠️ 这里只**清名字**，绝不替玩家猜后面那截是势力还是体力：整截只点名，一格都不落。
 */
function splitAtUnclosedBracket(text: string): { head: string; tail: string } | undefined {
  const openAt: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (OPEN_BRACKETS.includes(ch)) openAt.push(i);
    else if (CLOSE_BRACKETS.includes(ch)) openAt.pop();
  }
  if (openAt.length === 0) return undefined;
  const at = openAt[0];
  return { head: text.slice(0, at), tail: text.slice(at).trim() };
}

/**
 * 技能清单里只写了「攻击力＋数」这一枚。
 * ⚠️ **不接**顶层那句 `AMBIGUOUS_ATK_RE`（`:56`）：它管的是「攻击力3 独立成段」那一形，
 * 那里没有"技能清单"这一层语境，两形各自有各自的落点；把它接进来等于改顶层行为。
 * 认"是不是数"用的还是 `positiveCount` 那一把尺——读不出数的（如技能名里真有「攻击力」二字打头
 * 又不带数）仍当技能名收，不许把猜出来的数当成玩家写的数。
 */
const ATK_IN_LIST_RE = /^攻击力[:：]?(.+)$/;

/**
 * 技能清单里冒出来的一枚**字段**（「体力4」这种字段词后面跟着数）。
 * 认的法子不另起一套：把这一枚送去问那四条现成的字段正则，问得出一个**大于 0 的数**才算。
 * 「近战距离二」那类问不出数的仍是技能名——不许把猜出来的数当成玩家写的数。
 */
function fieldWordInSkillList(name: string): string | undefined {
  const hp = name.match(HP_KEY_RE);
  if (hp !== null && positiveCount(hp[1]) !== undefined) return '体力';
  const melee = name.match(MELEE_RE);
  if (melee !== null && positiveCount(melee[1]) !== undefined) return '近战';
  const ranged = name.match(RANGED_RE);
  if (ranged !== null && positiveCount(ranged[1]) !== undefined) return '远程';
  const atk = name.match(ATK_IN_LIST_RE);
  if (atk !== null && positiveCount(atk[1]) !== undefined) return '攻击力';
  return undefined;
}

/**
 * 顶层分格。只在括号／书名号外面下刀（「怒斩」里的顿号属于名字内部，切开就碎掉一个词），
 * 认的分隔符＝全角逗号、分号、句号（第 3 条裁完搬进来）、顿号（`,` 已裁＝不算，见 `UNREAD_PUNCTUATION`）。
 * ⚠️ 顿号有一条例外：**这一段已经落在「技能」那一格里就不在这里下刀**。
 * 第 5 条裁「`技能：突袭、和亲` 带不带壳都切成两枚」，而顶层这一刀会把后一枚甩出"技能清单"这一层语境，
 * 让它掉进最底下那句「这一句我不知道是哪一格」——那句甩锅话正是这一条要消灭的东西。
 * 切法交给 `splitSkillNames`（清单里面认顿号）。
 */
function splitFragments(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '（' || ch === '(' || ch === '「' || ch === '『' || ch === '【') depth++;
    else if (ch === '）' || ch === ')' || ch === '」' || ch === '』' || ch === '】') depth = Math.max(0, depth - 1);
    if (depth === 0 && (/[，；;。]/.test(ch) || (ch === '、' && !SKILLS_RE.test(buf)))) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

/** 能当一个技能名首字的三个连接字——首字那一档不削（「和亲」「与民同乐」「及泉之勇」是真名）。 */
const NAME_WORD_SEPARATORS = ['和', '与', '及'];

/**
 * 脱掉书名号／方括号那一层壳——**只有这一份**（切清单与顶层点名共用，别处不许再写一遍）。
 * 圆括号不在这里脱：那一族的壳里挂的是效果话，由 `skillNameAndTail` 另判。
 */
function stripQuoteShells(text: string): string {
  return text.replace(/[「」『』【】]/g, '');
}

/**
 * 技能清单切开（第 2／3／5 条裁完后的形状）：顿号、全角逗号、句号都算分隔符，
 * 左右都空也照切（空段最后一起滤掉）；**半角逗号 `,` 已裁＝不算**，
 * 它落进 `UNREAD_PUNCTUATION` 那一族：整截收下、但必须点名，不许静默。
 * **半角 `/` 不属于那 12 条里的任何一条**⇒ 保持它在：它从这一刀开工之前就是分格符，
 * 第 1 轮重写这一枚字符集时把它跟着 `,` 一起摘了＝两枚真名退成一枚怪名（证人见测试「半角斜杠」那一组）。
 * 全角 `／` 不在这一枚字符集里，也不是本轮该补的：改前改后都是整串静默收下，归主人裁。
 * 壳在这一层**不脱**——第 8 条要按"名字后面粘着一枚带壳的徽章"这个形状认它，脱早了形状就没了；
 * 脱壳仍然只有 `stripQuoteShells` 那一份，切完之后逐枚脱。
 * 名字**中间**那枚「和／与／及」不在这里下刀，见 `cutIntoRosterNames`（第 1 条甲档）。
 */
function splitSkillNames(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    if (/[、，。/]/.test(ch)) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

/** 一枚名字**中间**的连接字位置（两侧都有字才算；「和亲」那种首字不算）。 */
function middleConnectorAt(text: string): number {
  for (let i = 1; i < text.length - 1; i++) {
    if (!NAME_WORD_SEPARATORS.includes(text[i])) continue;
    if (text.slice(0, i).trim() === '' || text.slice(i + 1).trim() === '') continue;
    return i;
  }
  return -1;
}

/**
 * 第 1 条甲档（用户原话「去名册里查，查得到才切」）：这一刀切出来的是**两枚**名字，
 * 就得每一枚都在名册上查得到才算数。查不到＝不下刀，也**不许**把并提那整串当一枚技能名收下
 * （他那句事实：官方技能名里不存在「XX和XX」，两枚并排出现通常是效果里的话）。
 * 递归写法管三枚以上：`武圣和咆哮和单骑` 只有每一枚都查得到才切成三枚。
 * ⚠️ 切开了就必须**一枚都不许丢**：`[right]` 那种写法把左半吞掉了（本轮实测抓到过），
 *    而"切完少一枚、issues 还是空的"正是这一刀最不该出现的悄悄丢件。
 */
function cutIntoRosterNames(text: string): string[] | undefined {
  const at = middleConnectorAt(text);
  if (at < 0) return undefined;
  const left = text.slice(0, at).trim();
  const right = text.slice(at + 1).trim();
  if (!isInRoster(left)) return undefined;
  const deeper = cutIntoRosterNames(right);
  if (deeper !== undefined) return [left, ...deeper];
  return isInRoster(right) ? [left, right] : undefined;
}

/**
 * 第 9 条（用户 2026-11-04 裁）：`技能：攻击力0`＝**非法格式**。
 * 上面那道 `fieldWordInSkillList` 用的尺要求"大于 0"，0 这一档问都不问就漏过去，
 * 于是它被当成一枚技能名收下——他原话：这种技能名他没写过，「攻击力为0／变为0」只出现在效果里。
 * 只补"读得出数、但那数不是正数"这一档；打头的词照旧只认「攻击力」，不顺手扩到近战／远程。
 */
function zeroValuedAtkField(name: string): boolean {
  const atk = name.match(ATK_IN_LIST_RE);
  return atk !== null && parseCountNumber(atk[1]) !== undefined;
}

/**
 * 第 10 条（用户 2026-11-04 裁，他写的是"暂时"）：字段词套着壳、又写在**技能以外**的位置＝非法格式。
 * 只认"整段被一对壳包住、脱壳后是一枚字段词＋读得出的数"这一形；
 * 裸写 `体力4` 那一格照常收，这里不把它一起判掉（界面那句必须与真行为对得上＝§12-112）。
 */
function shellWrappedField(fragment: string): string | undefined {
  const wrapped = fragment.match(/^[「『【](.+)[」』】]$/);
  if (wrapped === null) return undefined;
  const inner = wrapped[1].trim();
  const fields: readonly [string, RegExp][] = [['体力', HP_KEY_RE], ['近战', MELEE_RE], ['远程', RANGED_RE]];
  for (const [field, re] of fields) {
    const m = inner.match(re);
    if (m !== null && parseCountNumber(m[1]) !== undefined) return field;
  }
  return undefined;
}

/** 名字后面挂着的那截（冒号后的效果话／括号里的说明）＝这一刀不收，但必须点名。 */
function skillNameAndTail(piece: string): { name: string; tail: string } {
  const atColon = piece.split(/[：:]/);
  const head = atColon[0];
  const paren = head.split(/[（(]/);
  const name = paren[0].trim();
  const tail = [paren[1] ?? '', atColon.slice(1).join('：')].map(s => s.replace(/[）)]$/, '').trim()).filter(Boolean).join('；');
  return { name, tail };
}

/**
 * 一枚（已经切开、已经脱壳的）技能清单成员落格：括号／徽章／字段／非法格式四道闸，过了才进 `skillNames`。
 * 返回值＝落进那一格的名字（没落＝undefined），第 8 条那句"写法少见"要用它复述收下的到底是哪一枚。
 * 第 6 条：这一枚里括号开了没关＝括号里那一段整个不要，只留壳前那个名字，丢了什么单独点名。
 * 第 7 条：多出来的关口（`单骑）`）先剥掉再收，别让废字串进名册；名字照样落格，
 *         所以那句算"收下了、里面还粘着"（`glued`），不算"没落进去"。
 */
function takeSkillName(draft: GeneralTextDraft, rawPiece: string): string | undefined {
  const dropped = splitAtUnclosedBracket(rawPiece);
  const piece = dropped === undefined ? rawPiece : dropped.head.trim();
  const { name, tail } = skillNameAndTail(piece);
  const bare = name.replace(/^[）)]+|[）)]+$/g, '').trim();
  const closeStripped = bare !== name && bare !== '';
  const landed = closeStripped ? bare : name;
  if (landed === '') {
    draft.issues.push({ raw: rawPiece, reason: '这一格没点到技能名' });
    return undefined;
  }
  if (isBadgeWord(landed)) {
    draft.issues.push({
      raw: piece,
      reason: `「${landed}」是徽章，不是技能名；徽章那一格在第②步那张卡上勾`,
      fromSkillList: true,
    });
    return undefined;
  }
  const field = fieldWordInSkillList(landed);
  if (field !== undefined) {
    // 「攻击力」那一格不是"写在别处"就行——它本来就是两个数，得说清分开写。
    draft.issues.push({
      raw: piece,
      reason: field === '攻击力'
        ? `「${landed}」是字段，不是技能名；攻击力有近战与远程两个数，请分开写（如「近战3」「远程2」）`
        : `「${landed}」是字段，不是技能名；要写${field}请写在技能以外的那一格`,
      fromSkillList: true,
    });
    return undefined;
  }
  if (zeroValuedAtkField(landed)) {
    draft.issues.push({
      raw: piece,
      reason: `「${landed}」是非法格式：攻击力那一格只写大于 0 的数，「攻击力为0／变为0」那种话属于效果——技能名这一格我不收这种写法`,
      fromSkillList: true,
    });
    return undefined;
  }
  draft.skillNames.push(landed);
  if (closeStripped) {
    draft.issues.push({ raw: rawPiece, reason: `多了一个关口的壳，剥掉之后按「${landed}」收进技能名这一格`, glued: true });
  }
  if (dropped !== undefined) {
    draft.issues.push({
      raw: dropped.tail,
      reason: '这一刀的括号开了没关上，括号里那一段整个不要（这种写法一般是技能名还没定下来）——技能名请写定了再填这一格',
      fromSkillList: true,
    });
  }
  if (tail !== '') {
    // 壳里那句到底是徽章还是效果，决定这句话怎么说——把「锁定技」叫"效果"就是假话（§9）。
    const badgeTail = stripQuoteShells(tail).trim();
    draft.issues.push({
      raw: piece,
      reason: isBadgeWord(badgeTail)
        ? `您那句徽章（「${badgeTail}」）名册这一格不收，请去第②步那张卡上勾`
        : `这一刀只取技能名，您那句效果（「${tail}」）请去第②步拼——名册这一格不收效果`,
    });
  }
  return landed;
}

/**
 * 一句话 → 名册字段。**每一段只认一种字段**，认不出就进 `issues`。
 * 同一格被写了两回＝后一句**不覆盖**前一句，而是点名"这一格写了两回"，
 * 让玩家自己看清矛盾在哪，不让解析器悄悄选一个。
 */
export function parseGeneralText(text: unknown): GeneralTextDraft {
  const draft: GeneralTextDraft = { skillNames: [], issues: [], ignored: [] };
  if (typeof text !== 'string' || text.trim() === '') return draft;

  for (const piece0 of splitFragments(text)) {
    if (CONNECTIVES.includes(piece0)) {
      draft.ignored.push(piece0);
      continue;
    }
    const piece = stripLeadingConnective(piece0);
    for (const word of piece.dropped) draft.ignored.push(word);
    const fragment = piece.rest;

    let m = fragment.match(SKILLS_RE);
    if (m) {
      // 第 6 条：整条清单里括号开了没关＝从那一枚壳起的整段不要（他的理由＝这种写法是技能名还没定下来），
      // 但"丢了什么"必须报，不许静默。清单本身平衡时不截，交给 `takeSkillName` 逐枚判里面的那一形。
      const dropped = splitAtUnclosedBracket(m[1]);
      const names = splitSkillNames(dropped === undefined ? m[1] : dropped.head);
      if (dropped !== undefined) {
        draft.issues.push({
          raw: dropped.tail,
          reason: '这一刀的括号开了没关上，括号里那一段整个不要（这种写法一般是技能名还没定下来）——技能名请写定了再填这一格',
          fromSkillList: true,
        });
      }
      if (names.length === 0) {
        if (dropped === undefined) draft.issues.push({ raw: fragment, reason: '说了「技能」却没点出名字' });
      } else {
        for (const rawPiece of names) {
          // 第 8 条：徽章粘在技能名后面（`武圣「锁定技」`）＝切开，不许静默吞成一枚怪名。
          // 结尾允许连着几枚关口壳（`「武圣「锁定技」」` 这种整串再套一层的写法），
          // 否则外层那枚壳一挡，这一形就退回"怪名静默收下"——正是这一条要消灭的形状。
          const attach = rawPiece.match(/^(.+?)[「『【]([^「」『』【】]+)[」』】]+$/);
          if (attach !== null && isBadgeWord(attach[2])) {
            const landedName = takeSkillName(draft, stripQuoteShells(attach[1]).trim());
            if (landedName !== undefined) {
              draft.issues.push({
                raw: rawPiece,
                reason: `这种写法少见：「${attach[2].trim()}」是徽章，我把它从技能名「${landedName}」后面剥开了——`
                  + `技能名这一格只留「${landedName}」，徽章去第②步那张卡上勾`,
                glued: true,
              });
              continue;
            }
            // 壳前那一截没过闸（它自己就是徽章／字段）：落回下面那条常规路，不在这里造第二套判据。
          }
          const piece = stripQuoteShells(rawPiece).trim();
          const rosterCut = cutIntoRosterNames(piece);
          if (rosterCut === undefined && middleConnectorAt(piece) >= 0) {
            // 第 1 条甲档：切出来的名字名册查不到＝这一刀不许下，也不许把并提那整串当一枚技能名收下。
            draft.issues.push({
              raw: piece,
              reason: '两枚技能名中间夹一个「和／与／及」＝名册上查不到这种技能名，这种话一般在效果里才出现'
                + '（例：获得「武圣」和「咆哮」）——技能这一格只写名字，要写几枚请用顿号分开',
              fromSkillList: true,
            });
            continue;
          }
          for (const single of rosterCut ?? [piece]) takeSkillName(draft, single);
        }
      }
      continue;
    }

    m = fragment.match(MELEE_RE);
    if (m) {
      if (draft.meleeAtk !== undefined) draft.issues.push({ raw: fragment, reason: '近战写了两回，后一句没落进去' });
      else {
        const n = positiveCount(m[1]);
        if (n === undefined) draft.issues.push({ raw: fragment, reason: unreadNumberReason('近战', fragment) });
        else draft.meleeAtk = n;
      }
      continue;
    }

    m = fragment.match(RANGED_RE);
    if (m) {
      if (draft.rangedAtk !== undefined) draft.issues.push({ raw: fragment, reason: '远程写了两回，后一句没落进去' });
      else {
        const n = positiveCount(m[1]);
        if (n === undefined) draft.issues.push({ raw: fragment, reason: unreadNumberReason('远程', fragment) });
        else draft.rangedAtk = n;
      }
      continue;
    }

    if (AMBIGUOUS_ATK_RE.test(fragment)) {
      draft.issues.push({ raw: fragment, reason: '攻击力有近战与远程两个数，请写明「近战3」或「远程2」（我不替你挑）' });
      continue;
    }

    m = fragment.match(HP_KEY_RE) ?? fragment.match(HP_TAIL_RE);
    if (m) {
      if (draft.hp !== undefined) draft.issues.push({ raw: fragment, reason: '体力写了两回，后一句没落进去' });
      else {
        const n = positiveCount(m[1]);
        if (n === undefined) draft.issues.push({ raw: fragment, reason: unreadNumberReason('体力', fragment) });
        else draft.hp = n;
      }
      continue;
    }

    m = fragment.match(FACTION_KEY_RE);
    if (m) {
      const f = factionOf(m[1]);
      if (f === undefined) draft.issues.push({ raw: fragment, reason: `势力「${m[1].trim()}」不在这五个里：${IMPORT_FACTIONS.join('／')}` });
      else if (draft.faction !== undefined) draft.issues.push({ raw: fragment, reason: '势力写了两回，后一句没落进去' });
      else draft.faction = f;
      continue;
    }

    const bare = factionOf(fragment);
    if (bare !== undefined) {
      if (draft.faction !== undefined) draft.issues.push({ raw: fragment, reason: '势力写了两回，后一句没落进去' });
      else draft.faction = bare;
      continue;
    }

    // 先脱壳再判徽章：`「锁定技」`／`【限定技】` 与裸写的 `锁定技` 是同一个东西，
    // 不许一个说真话（是徽章）、一个说「这一句我不知道是哪一格」。落格结果不变（徽章从不进清单）。
    const badge = stripQuoteShells(fragment).trim();
    if (isBadgeWord(badge)) {
      draft.issues.push({ raw: fragment, reason: `「${badge}」是徽章，不是技能名；徽章那一格在第②步那张卡上勾` });
      continue;
    }

    if (HUMAN_ONLY_KEYS.some(key => fragment.startsWith(key))) {
      draft.issues.push({ raw: fragment, reason: '这一格要你自己在那一排里选（身份与归属不由一句话定）' });
      continue;
    }

    m = fragment.match(NAME_RE);
    if (m) {
      if (draft.name !== undefined) {
        draft.issues.push({ raw: fragment, reason: '将名写了两回，后一句没落进去' });
      } else {
        const val = stripLeadingConnective(m[1]);
        for (const word of val.dropped) draft.ignored.push(word);
        const cut = splitAtUnclosedBracket(val.rest);
        if (cut === undefined) {
          draft.name = val.rest;
        } else {
          const head = cut.head.trim();
          if (head !== '') draft.name = head;
          draft.issues.push({
            raw: cut.tail,
            reason: '那一头括号／书名号开了没关上，所以从这枚壳起的整截只点名、一格都不落'
              + '（里面的势力／体力／技能我不替您猜，请一句一格重写）',
          });
        }
      }
      continue;
    }

    // 第 11 条（用户 2026-11-04 裁：「没写『名：』时按位置猜将名，不留，没写将名就提示并退回」）：
    // **过去这一档下面**会把第一句裸汉字当名字收下（`张飞，蜀，体力4` 把将名猜成「张飞」、
    // `技能：限定技、突袭` 猜成「突袭」），现在不猜了——这句话没点到将名就空着，
    // 由「缺了：将名」那一行提示、由采用那一步退回（见 `canAdoptGeneral`）。
    // 再往下那两格是第 10 条与"不知道是哪一格"的常规点名，与猜名字无关。
    const fieldInShell = shellWrappedField(fragment);
    if (fieldInShell !== undefined) {
      // 第 10 条：带壳的字段写在技能以外＝非法格式（裸写那一格仍然照常收，见 `HP_KEY_RE` 那一路）。
      draft.issues.push({
        raw: fragment,
        reason: `${fragment}＝非法格式：字段词套着壳、又不在「技能」那一格里，这个位置我不收；`
          + `${fieldInShell}那一格请裸写（别套壳）`,
      });
      continue;
    }

    const glued = gluedMaterial(fragment);
    draft.issues.push({
      raw: fragment,
      reason: glued === undefined
        ? '这一句我不知道是哪一格（能写的说法：名／势力／体力／近战／远程／技能）'
        : `这一段挤成了一格，所以哪一格都不像（${glued}）——能写的说法：名／势力／体力／近战／远程／技能，一句一格`,
    });
  }
  flagGluedMaterial(draft);
  return draft;
}

/** 名字与势力缺一个就不许采用＝「五格缺了就问，只给体力兜底」。 */
export function missingRequiredFields(draft: GeneralTextDraft): string[] {
  const missing: string[] = [];
  if (!draft.name) missing.push('将名');
  if (!draft.faction) missing.push('势力');
  return missing;
}

/**
 * 「这一段是不是有东西没落进格子」＝第 12 条要问的那一格（用户 2026-11-04 裁：有东西没落进去就退回）。
 * `glued` 那些**已经落进格子了**（只是里面还粘着没认的东西），不算"没落进去"——把它一起算进来
 * 就成了假话，也让"收下了、里面还粘着"那一族与"整段没落"那一族分不开。
 * 判据取自点名的**落格与否**，不取自措辞，也不取自字段本身（解析器不许拿玩家没写的东西造门槛）。
 * 界面（那颗钮按住时那句"错在哪里"）也调这一枚——门槛与措辞共用同一个出处，才不会一处改了另一处漂。
 */
export function hasUnlandedSegment(draft: GeneralTextDraft): boolean {
  return draft.issues.some(issue => issue.glued !== true);
}

/**
 * 这一枚就是"能不能采用"的唯一判据（写成类型谓词＝调用方点了它之后 `name`／`faction`
 * 直接是已知的数，不必再各写一遍非空检查＝避免第二套判据从类型缝隙里长出来）。
 * 两条：**缺了将名／势力不许采用**，**有段落没落进这张卡也不许采用**
 * （第 12 条＝用户 2026-11-04 当面授权改这一枚门禁，见 §12-162③；此前那颗钮一字不动）。
 */
export function canAdoptGeneral(draft: GeneralTextDraft): draft is GeneralTextDraft & { name: string; faction: Faction } {
  return missingRequiredFields(draft).length === 0 && !hasUnlandedSegment(draft);
}

/**
 * 「系统会怎么说」＝采用前给玩家看的那几句回显（与 v2.9.9 那一刀的纪律同一形状：
 * 先说出来、点采用才落格子）。每一句都对得上采用之后真正会发生的事。
 * 同一句话在两条路上的意思不同，所以回显也不同：
 *  · 'create' 没点的数＝新建这张将时兜底（体力）或由体力推（近战／远程）；
 *  · 'edit'   没点的数＝**这一格不动**，沿用卡上现有的数（绝不因为玩家没提就把手填过的数抹成缺省）。
 */
export function describeGeneralDraft(draft: GeneralTextDraft, mode: 'create' | 'edit' = 'create'): string[] {
  const lines: string[] = [];
  if (draft.name) lines.push(`将名：${draft.name}`);
  if (draft.faction) lines.push(`势力：${draft.faction}`);
  lines.push(draft.hp === undefined
    ? mode === 'edit'
      ? `体力：这句话没点＝这一格不动（卡上现有的数继续用）`
      : `体力：这句话没点，按缺省 ${hpOrDefault(undefined)} 建（与导入 Excel 同一格判据）`
    : `体力：${draft.hp}`);
  if (draft.meleeAtk === undefined && draft.rangedAtk === undefined) {
    lines.push(mode === 'edit'
      ? '近战／远程：这句话没点＝这两格不动'
      : '近战／远程：没点，按体力推（体力≥4 武将 2／1，否则文将 1／2）');
  } else {
    lines.push(`近战／远程：${draft.meleeAtk ?? '没点'}／${draft.rangedAtk ?? '没点'}`);
  }
  // 「这一格是空的」有两种，说的话不一样：玩家写了、可每一枚都被本刀那两道闸拦下场，
  // 再说"这句话没点"就是假话（监督台 2026-11-03 第 16 件）。判据取自点名的**出处**，
  // 不取自措辞，也不取自"清单里有没有字"——后者会把真没写那一形一起翻成假话。
  const allSkillPiecesRejected = draft.skillNames.length === 0
    && draft.issues.some(issue => issue.fromSkillList === true);
  lines.push(draft.skillNames.length > 0
    ? `技能：${draft.skillNames.join('、')}（只记名，效果留空，请去第②步逐格拼）`
    : allSkillPiecesRejected
      ? '技能：那一格写的我没认成技能名，一个都没落（逐条点名见下面）'
      : '技能：这句话没点，进去第②步再加');
  if (draft.ignored.length > 0) lines.push(`我当成连接词忽略掉的：${draft.ignored.join('、')}`);
  for (const issue of draft.issues) {
    lines.push(issue.glued
      ? `✕ 这一格收下了，但里面还粘着没认的东西：「${issue.raw}」——${issue.reason}`
      : `✕ 没落进去的那一段：「${issue.raw}」——${issue.reason}`);
  }
  return lines;
}

/** 采用时要不要提一句"体力按缺省建"＝缺省那半句的出处也只有一份。 */
export function hpWasDefaulted(draft: GeneralTextDraft): boolean {
  return draft.hp === undefined;
}

/**
 * 「哪几段没落进这张卡」与「哪几格收下了、里面还粘着没认的东西」＝**面板与两条采用腿共用这一份拼装**：
 * 第①步填格子那条腿（采用＝只动那几格）与直接建卡那条腿（采用＝卡真长出来）说的是同一件事，
 * 句子写两遍，下一次改动其中一遍就会漂——上一轮正是这个形状（建卡那条腿只字不提）。
 * 第 12 条（用户 2026-11-04 裁）：有段落没落进去＝**采用那一步退回、那颗钮按住**，
 * 所以这一份拼装现在的用处是"说明错误在哪里"（`canAdoptGeneral` 用同一个判据拦人，措辞与真行为对得上＝§12-112）；
 * 走到这两条腿时必然是"落齐了"的那一类，`glued` 那一族（收下了但还粘着）仍然照常报。
 * 两族不是一回事：`glued` 那一段其实已经填进格子了，说它"没落进去"就是假话。
 */
export function unsettledSegments(draft: GeneralTextDraft): string[] {
  const quote = (list: string[]) => list.map(raw => `「${raw}」`).join(' ');
  const out: string[] = [];
  const skipped = quote(draft.issues.filter(i => !i.glued).map(i => i.raw));
  const glued = quote(draft.issues.filter(i => i.glued).map(i => i.raw));
  if (skipped !== '') out.push(`没落进去的：${skipped}`);
  if (glued !== '') out.push(`这几格收下了、里面还粘着没认的东西：${glued}`);
  return out;
}
