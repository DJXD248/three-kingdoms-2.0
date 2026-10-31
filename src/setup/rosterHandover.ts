/**
 * 乙 线第二片（2026-10-31）＝**名册交料那道原子闸**。
 *
 * 契约落点＝`PROJECT_ARCH_MAP.md` §G 第 12 条。他那两句裁决逐字＝
 * ㈠ 「算牌那台机器，换一台/一个人不参与打牌。」＝档二（算牌的机器不是任何一位玩家）；
 * ㈡ 「选甲，开房间那位玩家把名单交给算牌机器」＝名册来源。
 * 由此得这一片要成立的一句话：**开房间那位玩家把本机那份"效力名册"交上来，
 * 算牌机器要么整份收下、要么明说没收下——绝不留半份名册继续算牌。**
 * 交料成功与否自此就是名册一致性的**全部**（第 12 条那句"降级"）：第 0 步 ㈡ 那枚
 * "两边各留名册、只比摘要"的握手在档二＋甲下变了性质，比摘要仍要有，但它比的是
 * **收下的那一份**，不是"各算各的再看运气"。
 *
 * 三条判据的来源（都不是本文件新造的）：
 *  ① **取料＝效力、不是字节**：`pool` 要的是 store 那侧 `poolGenerals()` 的输出
 *     （§H3 第③层让同一份存档在两台上不一样地生效，按 localStorage 字节交料一定假绿）；
 *     `disabledIds` 要的是 `effectiveDisabledGenerals()` 那一份过滤后的编号集合。
 *  ② **指纹算法复用内容包那两支**＝`contentPack.stableText`（键按字典序、`undefined` 丢、
 *     数组保记录序）＋`digestText`（两枚 32 位摘要）。这一选择自带一句诚实边界，抄在那
 *     个文件的注释里：它只抓"下载不全／被人改过一个字"这类意外，**不扛有心人伪造**⇒
 *     这枚指纹是**分叉预警**，不是安全机制，措辞不许往上长（ARCH_MAP 第 11 条 ㈡）。
 *  ③ **逐张卡面的字段尺复用装包那一侧**＝`installPack.findGeneralFieldProblem` ＋
 *     `sanitizeGeneralRecord`；认账那半段走 `domain/generalProvenance` 现成的那几把
 *     （`isAcceptableAuthoredRecord`／`isRepositoryOfficial`／`idNamespace`；`sourceOf`
 *     那一把在这里**没有**直接调用——原因写在 `provenanceProblem` 里：未验的 `unknown`
 *     不该 cast 成它的入参形状）。本文件零新判据。
 *
 * ⚠️ 两件今天**没做**的，不许被这条文件认领：
 *  · **跨机器的交料通道**还没接——这一片把"收"与"交"两侧都做成了纯函数，命令行
 *    （`npm run opening-compute -- --roster-file 文件.json`）是它今天唯一真走得通的路；
 *    握手那一格（`VersionStamp` 的第四格，名字已定＝`content`，⚠️ 不叫 `roster`——协议里
 *    `t:'roster'` 说的是"屋里坐着哪些人"）要等第三片"引擎转移搬进进程"一起接，
 *    本文件**不 import 任何 `src/network/` 的东西**，也不把名册内容随快照发出去（那是
 *    ARCH_MAP 第 11 条 ㈡ 末那条"顺手就会做错的事"，在这里挡住）。
 *  · **`format` 只有一枚**，读不懂的新形态一律整份拒并说清要什么，不硬猜。
 *  · 内容包那 200 张的帽子（`MAX_PACK_GENERALS`）**不适用**在这里——那是防"下载不全的
 *    大文件"，而官方名册今天就有 335 张，照搬会把正常交料判成失败。
 */
import type { General } from '../data/generals';
import { digestText, stableText } from '../contentPack/contentPack';
import { findGeneralFieldProblem, sanitizeGeneralRecord } from '../contentPack/installPack';
import {
  idNamespace,
  isAcceptableAuthoredRecord,
  isRepositoryOfficial,
} from '../domain/generalProvenance';
import type { OpeningRoster } from './openingCompute';

/** 交料的格式号；比它新＝不硬猜，整份退回并说明。 */
export const ROSTER_SUBMISSION_FORMAT = 1;

/** 交上来的那份料的可序列化形状＝「效力名册」的两个零件（不是那六格存档的字节）。 */
export interface RosterSubmission {
  format: number;
  /** 编辑合并之后的整份名单（官方＋本机自制）。**记录序是效力的一部分**：发候选时按这个次序取数，次序换了就不是同一局。 */
  pool: General[];
  /** 这一台机器上被关掉的编号（store 那侧＝`effectiveDisabledGenerals()`）。这是一枚集合，次序不属效力。 */
  disabledIds: string[];
}

/**
 * 收料的回执。类型本身就是那道原子闸：`accepted:false` 那一支**装不下名册**，
 * 所以"半份名册继续算牌"在这个文件里不是纪律问题，是写不出来的形状。
 */
export type RosterReceipt =
  | {
      accepted: true;
      roster: OpeningRoster;
      /** 按效力取的那枚指纹（＝将来握手第四格 `content` 的值）。 */
      content: string;
      poolCount: number;
      disabledCount: number;
      /** 收下了、但有几件事该让玩家看见——绝不静默（沿用"拒不得静默"那条口径）。 */
      notes: string[];
    }
  | {
      accepted: false;
      /** 一句人话的标题，界面直接当红字用。 */
      reason: string;
      /** 逐条毛病（第一处之外还要说清其余，免得玩家修一条再撞一条）。 */
      problems: string[];
      content: null;
      roster: null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeEntry(raw: unknown, index: number): string {
  const label = `第 ${String(index + 1)} 条`;
  if (!isRecord(raw)) return label;
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : null;
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : null;
  if (id && name) return `${label}（${name}·${id}）`;
  if (id) return `${label}（${id}）`;
  if (name) return `${label}（${name}）`;
  return label;
}

/** 认账那半段：这张卡的编号与来源对不对得上它声称的那一层。返回 null＝认。 */
function provenanceProblem(g: Record<string, unknown>): string | null {
  if (isAcceptableAuthoredRecord(g)) {
    // 本机自制那一路（编号与来源已对上）；官方卡不许撞进这一路。
    return isRepositoryOfficial(g)
      ? '这张的编号在程序自带的官方名册里，却又被当成本机自制的卡交上来——同一张卡不能有两个主人'
      : null;
  }
  const id = typeof g.id === 'string' ? g.id : '';
  if (isRepositoryOfficial({ id })) {
    // 仓库账本那张官方卡：卡面本来不带 `source`，写了就必须是官方，不能被外来文件改成自制。
    // 这里绕一手 `sourceOf` 的入参形状是有意的——`g.source` 此刻还是 `unknown`，直接 cast 成
    // `GeneralSource` 会把"来源写的是别的字"这种情况伪装成一个合法值；所以把不是那两枚字的
    // 也照样判成"不是官方"，再交给下面那句话点名。
    const claimedSource = g.source === undefined || g.source === 'official' ? 'official' : String(g.source);
    return claimedSource === 'official'
      ? null
      : `编号「${id}」是程序自带的官方卡，这份料却把它的来源写成「${claimedSource}」`;
  }
  const space = idNamespace(id);
  if (space === 'G') return `编号「${id}」挂在官方编号名下、来源却不是官方——编号与来源必须对上才敢认`;
  if (space === 'D') return `编号「${id}」挂在玩家自制编号名下、来源却不是玩家自制——编号与来源必须对上才敢认`;
  return `编号「${id}」既不在程序自带的官方名册里，也不在本机自制的编号名下——两边账本不是同一份，禁止开始`;
}

/** 一份料里逐条过一遍；返回所有毛病（一条也不修、也不"能收多少收多少"）。 */
function collectProblems(pool: readonly unknown[], disabledIdsRaw: readonly unknown[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  pool.forEach((raw, index) => {
    if (!isRecord(raw)) {
      problems.push(`${describeEntry(raw, index)}不是一个将领记录（这份料的结构不对）`);
      return;
    }
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (id === '') {
      problems.push(`${describeEntry(raw, index)}没有编号——算牌机器认卡只认编号，没编号这一份不能整份收下`);
      return;
    }
    const first = seen.get(id);
    if (first !== undefined) {
      problems.push(`编号「${id}」在这份名册里出现了两次（第 ${String(first + 1)} 条与第 ${String(index + 1)} 条）——同一颗牌发两遍，开局必分叉`);
      return;
    }
    seen.set(id, index);
    const provenance = provenanceProblem(raw);
    if (provenance !== null) {
      problems.push(`${describeEntry(raw, index)}：${provenance}`);
      return;
    }
    const field = findGeneralFieldProblem(raw);
    if (field !== null) problems.push(`${describeEntry(raw, index)}：${field}`);
  });
  for (const [index, value] of disabledIdsRaw.entries()) {
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`关掉的编号里第 ${String(index + 1)} 个不是编号（要的是卡的编号那一串字）`);
    }
  }
  return problems;
}

/**
 * 按效力取指纹：卡面对象的键按字典序、`undefined` 丢掉、记录序保留、
 * 被关掉的编号当集合（先排序）。⇒ pretty 与否、键的书写次序、`disabledIds` 的次序都不同一值；
 * 而任何一处真的效力差异（体力、势力、徽章、技能、少一张、多一张、次序换到发料那一层）都换值。
 */
export function rosterContentFingerprint(pool: readonly General[], disabledIds: Iterable<string>): string {
  const disabled = [...new Set([...disabledIds])].sort();
  return digestText(stableText({ pool: pool.map(sanitizeGeneralRecord), disabledIds: disabled }));
}

/** 交的那一侧：把 store 递来的两份输出做成一份可序列化的料（逐张先按已知字段名筛一遍）。 */
export function buildRosterSubmission(
  pool: readonly General[],
  disabledIds: Iterable<string>,
): RosterSubmission {
  return {
    format: ROSTER_SUBMISSION_FORMAT,
    pool: pool.map(sanitizeGeneralRecord),
    disabledIds: [...new Set([...disabledIds])].sort(),
  };
}

function refuse(reason: string, problems: string[]): RosterReceipt {
  return { accepted: false, reason, problems, content: null, roster: null };
}

/** 原子闸：整份收下，或者整份退回。收下的那一支才会带名册来。 */
export function acceptRosterSubmission(raw: unknown): RosterReceipt {
  if (!isRecord(raw)) return refuse('这份料不是一个名册记录（结构不对），一张也没收。', []);
  if (typeof raw.format !== 'number') {
    return refuse('这份料没写格式号，程序不猜它是什么形态，一张也没收。', ['缺 `format` 那一格（当前格式号＝' + String(ROSTER_SUBMISSION_FORMAT) + '）']);
  }
  if (raw.format > ROSTER_SUBMISSION_FORMAT) {
    return refuse(`这份料由更新的程序写出（格式号 ${String(raw.format)}＞这台认识的 ${String(ROSTER_SUBMISSION_FORMAT)}），不硬猜，一张也没收。`, []);
  }
  if (raw.format < ROSTER_SUBMISSION_FORMAT) {
    return refuse(`这份料的格式号 ${String(raw.format)} 比这台认识的 ${String(ROSTER_SUBMISSION_FORMAT)} 旧，这台没读过那种形态，一张也没收。`, []);
  }
  if (!Array.isArray(raw.pool)) {
    return refuse('这份料里没有「将的名单」那一格（要的是一个一个将领记录列出来的清单），一张也没收。', ['缺 `pool` 那一格，或它不是清单']);
  }
  const disabledIdsRaw = raw.disabledIds === undefined ? [] : raw.disabledIds;
  if (!Array.isArray(disabledIdsRaw)) {
    return refuse('这份料里「关掉的编号」那一格不是清单，说不清哪些被关掉，一张也没收。', ['`disabledIds` 要的是编号列出来的清单；这一格没有＝当作一个都没关']);
  }
  if (raw.pool.length === 0) {
    return refuse('这份料是一份空名册——一张将都没有，这不叫交料，一张也没收。', []);
  }
  const problems = collectProblems(raw.pool, disabledIdsRaw);
  if (problems.length > 0) {
    return refuse(`这份名册没收下：一共查出 ${String(problems.length)} 处毛病，整份退回（不留半份继续算牌）。`, problems);
  }

  // 收下的那一刻就按已知字段名筛一遍（与装包同一支 `sanitizeGeneralRecord`）：
  // 外来料不能往算牌进程的账里塞野键，也不能把"多带一格"算成一处效力差异。
  const pool = (raw.pool as General[]).map(sanitizeGeneralRecord);
  const notes: string[] = [];
  const dedupedDisabled = [...new Set(disabledIdsRaw as string[])];
  if (dedupedDisabled.length !== disabledIdsRaw.length) {
    notes.push(`关掉的编号里有重复，按一处算（写了 ${String(disabledIdsRaw.length)} 个、实际 ${String(dedupedDisabled.length)} 个）。`);
  }
  const idsInPool = new Set(pool.map(general => general.id));
  const stranded = dedupedDisabled.filter(id => !idsInPool.has(id));
  if (stranded.length > 0) {
    notes.push(`关掉的编号里有 ${String(stranded.length)} 个不在这份名册里（${stranded.slice(0, 3).join('、')}${stranded.length > 3 ? '…' : ''}）——它们不改变发料，算牌机器照旧收下整份。`);
  }
  const disabled = new Set(dedupedDisabled);
  const roster: OpeningRoster = { pool, disabledIds: disabled };
  return {
    accepted: true,
    roster,
    content: rosterContentFingerprint(pool, disabled),
    poolCount: pool.length,
    disabledCount: disabled.size,
    notes,
  };
}

/** 文件／网络帧那一侧的入口：读不懂 JSON 也算"没收下"，并且说的是同一句人话。 */
export function acceptRosterSubmissionText(text: string): RosterReceipt {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    return refuse(`这份料不是能读的 JSON（${error instanceof Error ? error.message : '读不懂'}），一张也没收。`, []);
  }
  return acceptRosterSubmission(raw);
}
