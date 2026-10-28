/**
 * v2.9.24 刀2「一句话生成将领」（离线词表档，纯读入侧）。
 * 契约＝PROJECT_HANDOFF.md §12-140④／⑥／⑨㈡；纪律与 `src/skills/skillTextParse.ts` 同一套：
 * 读不懂的那一段**逐段点名**，绝不替玩家猜；五格里只有体力能兜底，
 * 而那个兜底不住在这里——住在 `generalProvenance.hpOrDefault`（与 Excel 导入同一格判据）。
 * 本文件不写库、不建卡、不碰编译链路；采用之后仍走 `createAuthoredGeneral` 那唯一一条建卡路。
 */
import { parseCountNumber } from '../../skills/skillGateText';
import type { Faction } from '../../data/generals';
import { hpOrDefault } from '../../domain/generalProvenance';
import { IMPORT_FACTIONS } from './skillExcelParsers';

export interface GeneralTextIssue {
  raw: string;
  reason: string;
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
const CONNECTIVES = ['一位', '一个', '名将', '新将', '新建将领', '请', '立即', '并且', '同时', '另外', '其中'];

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

/** 只认数字与汉字数目字，且必须大于 0；读不出来就交回点名，绝不兜底。 */
function positiveCount(text: string): number | undefined {
  const n = parseCountNumber(text);
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
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

function splitSkillNames(text: string): string[] {
  // 「」那对壳先脱掉：顶层切段（`splitFragments`）特意不在括号内下刀，所以能走到这里的
  // 顿号**只会**出现在被壳保护的名字清单里——脱壳后再按顿号分，才不至于一格技能名被切开。
  return text.replace(/[「」『』【】]/g, '')
    .split(/[、，,/]|(?:和)(?=\S)|(?:与)(?=\S)|(?:及)(?=\S)/)
    .map(s => s.trim()).filter(Boolean);
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

  for (const fragment of splitFragments(text)) {
    if (CONNECTIVES.includes(fragment)) {
      draft.ignored.push(fragment);
      continue;
    }

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
          draft.skillNames.push(name);
          if (tail !== '') {
            draft.issues.push({ raw: piece, reason: `这一刀只取技能名，您那句效果（「${tail}」）请去第②步拼——名册这一格不收效果` });
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
        if (n === undefined) draft.issues.push({ raw: fragment, reason: '近战那一串读不出数（只认数字或汉字数目字，且要大于 0）' });
        else draft.meleeAtk = n;
      }
      continue;
    }

    m = fragment.match(RANGED_RE);
    if (m) {
      if (draft.rangedAtk !== undefined) draft.issues.push({ raw: fragment, reason: '远程写了两回，后一句没落进去' });
      else {
        const n = positiveCount(m[1]);
        if (n === undefined) draft.issues.push({ raw: fragment, reason: '远程那一串读不出数（只认数字或汉字数目字，且要大于 0）' });
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
        if (n === undefined) draft.issues.push({ raw: fragment, reason: '体力那一串读不出数（只认数字或汉字数目字，且要大于 0）' });
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
        draft.name = m[1].trim();
      }
      continue;
    }

    if (draft.name === undefined && BARE_NAME_RE.test(fragment) && positiveCount(fragment) === undefined) {
      draft.name = fragment;
      draft.nameFromPosition = true;
      continue;
    }

    draft.issues.push({ raw: fragment, reason: '这一句我不知道是哪一格（能写的说法：名／势力／体力／近战／远程／技能）' });
  }
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
  lines.push(draft.skillNames.length > 0
    ? `技能：${draft.skillNames.join('、')}（只记名，效果留空，请去第②步逐格拼）`
    : '技能：这句话没点，进去第②步再加');
  if (draft.ignored.length > 0) lines.push(`我当成连接词忽略掉的：${draft.ignored.join('、')}`);
  for (const issue of draft.issues) lines.push(`✕ 没落进去的那一段：「${issue.raw}」——${issue.reason}`);
  return lines;
}

/** 采用时要不要提一句"体力按缺省建"＝缺省那半句的出处也只有一份。 */
export function hpWasDefaulted(draft: GeneralTextDraft): boolean {
  return draft.hp === undefined;
}
