/**
 * v2.9.24 刀2「一句话生成将领」（离线词表档，纯读入侧）。
 * 契约＝PROJECT_HANDOFF.md §12-140④／⑥／⑨㈡；纪律与 `src/skills/skillTextParse.ts` 同一套：
 * 读不懂的那一段**逐段点名**，绝不替玩家猜；五格里只有体力能兜底，
 * 而那个兜底不住在这里——住在 `generalProvenance.hpOrDefault`（与 Excel 导入同一格判据）。
 * 本文件不写库、不建卡、不碰编译链路；采用之后仍走 `createAuthoredGeneral` 那唯一一条建卡路。
 */
import { parseCountNumber } from '../../skills/skillGateText';
import { type Faction, allSkillTags } from '../../data/generals';
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
  /** 玩家没写「名：」而由第一句裸汉字当名字收下＝true，回显必须说出来。 */
  nameFromPosition: boolean;
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
/** 一段裸汉字＝在还没点明"名"之前，按位置当名字收下（回显里会写清是从第几句取的）。 */
const BARE_NAME_RE = /^[一-龥A-Za-z·]{1,8}$/;

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
 * ⚠️ 「,」「。」各自到底认不认＝**还没裁**（那两格还在待裁清单上）。今天先取
 * "整截收下＋逐段点名"这一半，为的是**不许静默**；证人也就只锁这一条，
 * 没钉"它必须被点名退回"——将来裁成"认"，改的是这一枚名单，不是那条证人。
 */
const UNREAD_PUNCTUATION = [',', '。'];
/** 与 `splitFragments` 同一批壳子，配对判据只这一处。 */
const OPEN_BRACKETS = ['（', '(', '「', '『', '【'];
const CLOSE_BRACKETS = ['）', ')', '」', '』', '】'];

/**
 * 这一段被整截收下的**真因**（说不出来就返回 undefined）。只讲今天逐字成立的事：
 * 这个标点不在分格与切名的集合里、那对壳子开了没关，于是后面那段话粘了进来。
 * 既不替玩家猜他想分几格，也不替他决定该怎么改——那是还没裁的那几格。
 */
function gluedMaterial(text: string): string | undefined {
  const punct = UNREAD_PUNCTUATION.find(ch => text.includes(ch));
  if (punct !== undefined) {
    return `那一个「${punct}」不在分格与切名的符号里（分格只认全角逗号、顿号、分号），所以这一段挤成了一格`;
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
 * 空格那句只在这里出现——它说的是**名字**里的那一枚空格（分不分开＝还没裁那一格，这里不改切法），
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
 * 将名里那一头**没关上的壳**：从第一枚找不到配平关口的左壳起，整截都不该留在名字里。
 * 判据（监督台 2026-11-03 裁）＝**同一个解析器对同一族必须同一行为**：闭合的壳今天已经是
 * 「取壳前的名字＋点名壳内那段」，没闭合的壳却把怪尾巴留在将名里，没有任何一种将来的裁法需要它
 * ——将名要进名册、要被另一台机器读。
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

/** 只在括号／书名号外面切段（「怒斩」里的顿号属于名字内部，切开就碎掉一个词）。 */
function splitFragments(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '（' || ch === '(' || ch === '「' || ch === '『' || ch === '【') depth++;
    else if (ch === '）' || ch === ')' || ch === '」' || ch === '』' || ch === '】') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[，、；;]/.test(ch)) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

/** 能当一个技能名首字的三个连接字——过去只在右边卡了一道，左边空着也照削。 */
const NAME_WORD_SEPARATORS = ['和', '与', '及'];

/**
 * 脱掉书名号／方括号那一层壳——**只有这一份**（切清单与顶层点名共用，别处不许再写一遍）。
 * 圆括号不在这里脱：那一族的壳里挂的是效果话，由 `skillNameAndTail` 另判。
 */
function stripQuoteShells(text: string): string {
  return text.replace(/[「」『』【】]/g, '');
}

/**
 * 技能清单切开。两类分隔词卡的是两道不同的边，这一格今天逐字成立：
 *  · 标点（顿号、两种逗号、斜杠）＝左右都空也照切（空段最后一起滤掉）；
 *  · 和／与／及＝**左右两侧都得有字**才下刀。这三个字本身能当一个技能名的头一个字
 *    （「和亲」「与民同乐」「及泉之勇」），只卡右边就等于把名字的首字削掉，
 *    而削短那一枚照样落进格子、零点名。
 * 名字**中间**那枚「和」到底算不算分隔词还没裁（界面那句示例用的就是这种写法），
 * 这里不往任何一边写死——左半边这一刀与三条待裁方案都不矛盾，所以先落。
 * 「」那对壳仍然先脱掉：顶层切段（`splitFragments`）特意不在括号内下刀，
 * 所以能走到这里的顿号只会出现在被壳保护的名字清单里。
 */
function splitSkillNames(text: string): string[] {
  const bare = stripQuoteShells(text);
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < bare.length; i++) {
    const ch = bare[i];
    const wordCut = NAME_WORD_SEPARATORS.includes(ch)
      && buf.trim() !== ''
      && /\S/.test(bare.charAt(i + 1));
    if (wordCut || /[、，,/]/.test(ch)) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
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
 * 一句话 → 名册字段。**每一段只认一种字段**，认不出就进 `issues`。
 * 同一格被写了两回＝后一句**不覆盖**前一句，而是点名"这一格写了两回"，
 * 让玩家自己看清矛盾在哪，不让解析器悄悄选一个。
 */
export function parseGeneralText(text: unknown): GeneralTextDraft {
  const draft: GeneralTextDraft = { nameFromPosition: false, skillNames: [], issues: [], ignored: [] };
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
      const names = splitSkillNames(m[1]);
      if (names.length === 0) {
        draft.issues.push({ raw: fragment, reason: '说了「技能」却没点出名字' });
      } else {
        for (const piece of names) {
          const { name, tail } = skillNameAndTail(piece);
          if (name === '') {
            draft.issues.push({ raw: piece, reason: '这一格没点到技能名' });
            continue;
          }
          if (isBadgeWord(name)) {
            draft.issues.push({
              raw: piece,
              reason: `「${name.trim()}」是徽章，不是技能名；徽章那一格在第②步那张卡上勾`,
              fromSkillList: true,
            });
            continue;
          }
          const field = fieldWordInSkillList(name);
          if (field !== undefined) {
            // 「攻击力」那一格不是"写在别处"就行——它本来就是两个数，得说清分开写。
            draft.issues.push({
              raw: piece,
              reason: field === '攻击力'
                ? `「${name}」是字段，不是技能名；攻击力有近战与远程两个数，请分开写（如「近战3」「远程2」）`
                : `「${name}」是字段，不是技能名；要写${field}请写在技能以外的那一格`,
              fromSkillList: true,
            });
            continue;
          }
          draft.skillNames.push(name);
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
        draft.issues.push({
          raw: fragment,
          reason: draft.nameFromPosition ? '前一句裸汉字已被当成将名，这一句没有覆盖它' : '将名写了两回，后一句没落进去',
        });
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

    if (draft.name === undefined && BARE_NAME_RE.test(fragment) && positiveCount(fragment) === undefined) {
      draft.name = fragment;
      draft.nameFromPosition = true;
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
 * 这一枚就是"能不能采用"的唯一判据（写成类型谓词＝调用方点了它之后 `name`／`faction`
 * 直接是已知的数，不必再各写一遍非空检查＝避免第二套判据从类型缝隙里长出来）。
 */
export function canAdoptGeneral(draft: GeneralTextDraft): draft is GeneralTextDraft & { name: string; faction: Faction } {
  return missingRequiredFields(draft).length === 0;
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
  if (draft.name) lines.push(draft.nameFromPosition
    ? `将名：${draft.name}（这句话没写「名：」，我按第一句的位置取的）`
    : `将名：${draft.name}`);
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
 * 「哪几段没落进这张卡」与「哪几格收下了、里面还粘着没认的东西」＝**两条采用腿共用这一份拼装**：
 * 第①步填格子那条腿（采用＝只动那几格）与直接建卡那条腿（采用＝卡真长出来）说的是同一件事，
 * 句子写两遍，下一次改动其中一遍就会漂——上一轮正是这个形状（建卡那条腿只字不提）。
 * 措辞逐字对得上真行为：卡**照样建得出**，所以只说"没落进去"，不说"已退回""没建成""要重做"
 * （"有丢件要不要按住采用钮"＝还没裁那一格，这一刀不碰）。
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
