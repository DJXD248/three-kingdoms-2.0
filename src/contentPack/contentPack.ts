/**
 * v2.9.12 DIY 内容包 · 打包与读包（纯判据：零 DOM、零存储、零随机、零网络）。
 *
 * 契约出处：PROJECT_ARCH_MAP.md §G 第 11 项＋§H 轨二、PROJECT_HANDOFF.md §13 第 6 条。
 * 用户 2026-09-27 口径逐字：这件事根本不该和房间绑在一起，它就是一个独立功能，可以先做。
 * 三条硬口径落在本模块与 installPack.ts：
 *  ① 包自带指纹与来源标记（`header.origin` 明写"玩家自制"，读侧逐条再核一遍）；
 *  ② 核对与提示由"安装"这个动作自己负责——装成功＝可用，装不上＝说清为什么；
 *  ③ 绝不静默吞掉、绝不半装（原子性在 installPack.ts / store 安装动作里）。
 *
 * 第一版只装**玩家自制将领**（`source:'DIY'` 那批，卡面按本机看到的最终形状带出）。
 * 本机对官方卡的修改不在包里——那是另一件事，形态已登记、等用户认可。
 */
import pkg from '../../package.json';
import type { Faction, General } from '../data/generals';
import { allFactions } from '../data/generals';
import { isRepositoryOfficial, idNamespace, sourceOf } from '../domain/generalProvenance';

export const DIY_PACK_KIND = 'three-kingdoms-diy-pack';
/** 认识这个格式号以内的包文件；比它新＝不硬猜，直接拒读并说明。 */
export const DIY_PACK_FORMAT = 1;
export const DIY_PACK_EXTENSION = '.tkdiy.json';
/** 一个包最多带多少张卡：防病态大文件把浏览器写死（也是界面要说清的一句话）。 */
export const MAX_PACK_GENERALS = 200;

export type DiyPackHeader = {
  kind: string;
  format: number;
  /** 来源标记：包里的东西一律是玩家自制，读侧逐条核这条是否名副其实。 */
  origin: 'DIY';
  exportedAt: string;
  createdWithApp: string;
  count: number;
  fingerprint: string;
};

export type DiyPack = { header: DiyPackHeader; generals: General[] };

export type PackProblemCode =
  | 'EMPTY_FILE'
  | 'NOT_JSON'
  | 'NOT_A_PACK_FILE'
  | 'NEWER_FORMAT'
  | 'NO_GENERALS'
  | 'COUNT_MISMATCH'
  | 'FINGERPRINT_MISMATCH'
  | 'TOO_MANY';

export type PackProblem = { code: PackProblemCode; detail: string };

export type PackRead =
  | { ok: true; pack: DiyPack; generals: General[] }
  | { ok: false; problems: PackProblem[] };

/**
 * 指纹文本：对象的键按字典序排、`undefined` 丢掉、数组保持记录顺序。
 * 为什么不让文件本身的字节当指纹——用户在微信里传一次、浏览器另存一次，
 * 缩进与行尾就可能变，但那不是"文件被改过"。按语义算，pretty 与否不影响结论。
 * 注：联机那边给按钮编号也有一套同样的排法（`network/netSeat.ts`），两处各自稳定即可，
 * 不需要跨模块相等——内容包要稳定的是"今年导出的包，明年还认得出"。
 */
export function stableText(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableText(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function djb2(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 两枚 32 位摘要拼起来。只用来抓"下载不全""被人改过一个字"这类意外，
 * 不扛有心人伪造（这一版不防作弊，与联机口径一致）。
 */
export function packFingerprint(generals: General[]): string {
  const text = stableText(generals);
  return `${fnv1a32(text)}-${djb2(text)}`;
}

/** 这张卡属不属于"可以进包"的那批＝玩家自制、编号在 D- 名下、不是仓库官方名册里的卡。 */
export function isPackableGeneral(g: General): boolean {
  return sourceOf(g) === 'DIY' && idNamespace(g.id) === 'D' && !isRepositoryOfficial(g);
}

/** 界面上"这次会打进包里的有哪几张"——先筛再报，别让按钮骗人。 */
export function selectPackableGenerals(authored: General[]): General[] {
  return authored.filter(isPackableGeneral);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function packFileName(generals: General[], fingerprint: string, at: Date): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `玩家自制将领包_${stamp}_${generals.length}张_${fingerprint.slice(0, 6)}${DIY_PACK_EXTENSION}`;
}

export type BuildOptions = { exportedAt?: Date; createdWithApp?: string };

/**
 * 打包。卡面按调用方给来的最终形状原样带出（界面传的是"本机看到的这张卡"，
 * 不是存储里的半成品差分），所以导出与看到的一致这条由调用方保证。
 */
export function buildDiyPack(generals: General[], options: BuildOptions = {}): { pack: DiyPack; text: string } {
  const at = options.exportedAt ?? new Date();
  const kept = generals.filter(isPackableGeneral);
  const pack: DiyPack = {
    header: {
      kind: DIY_PACK_KIND,
      format: DIY_PACK_FORMAT,
      origin: 'DIY',
      exportedAt: at.toISOString(),
      createdWithApp: options.createdWithApp ?? pkg.version,
      count: kept.length,
      fingerprint: packFingerprint(kept),
    },
    generals: kept,
  };
  return { pack, text: JSON.stringify(pack, null, 2) };
}

/**
 * 读包：只判"这个文件我认不认、指纹对不对得上"。
 * 每张卡合不合格、跟本机已有的撞不撞——那是安装（installPack.ts）的事，
 * 分成两步是为了让界面能先说一句"文件本身是好的"，再逐条给卡的说法。
 */
export function parseDiyPack(text: string): PackRead {
  if (text.trim() === '') return { ok: false, problems: [{ code: 'EMPTY_FILE', detail: '文件是空的（可能是下载没下来）' }] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problems: [{ code: 'NOT_JSON', detail: '文件内容不是可读的 JSON（多半不是本项目的包文件，或者存的时候被截断了）' }] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problems: [{ code: 'NOT_A_PACK_FILE', detail: '文件里没有一个包该有的"头部＋将领清单"两块内容' }] };
  }
  const raw = parsed as { header?: unknown; generals?: unknown };
  const header = raw.header as Partial<DiyPackHeader> | undefined;
  if (!header || typeof header !== 'object' || header.kind !== DIY_PACK_KIND) {
    return { ok: false, problems: [{ code: 'NOT_A_PACK_FILE', detail: `这个文件不是本项目的将领内容包（包里的标记是「${String(header?.kind ?? '没有')}」，本项目认的是「${DIY_PACK_KIND}」）` }] };
  }
  if (typeof header.format !== 'number' || header.format > DIY_PACK_FORMAT) {
    return {
      ok: false,
      problems: [{ code: 'NEWER_FORMAT', detail: `这个包是本程序更新版本导出的（包格式第 ${String(header.format)} 号，我只认到第 ${DIY_PACK_FORMAT} 号）。请更新程序后再装，我不会硬猜新格式。` }],
    };
  }
  if (!Array.isArray(raw.generals)) {
    return { ok: false, problems: [{ code: 'NO_GENERALS', detail: '文件里没有将领清单那一段' }] };
  }
  const generals = raw.generals as General[];
  if (generals.length === 0) {
    return { ok: false, problems: [{ code: 'NO_GENERALS', detail: '这个包是空的（一张将领也没有），装它没有任何意义' }] };
  }
  if (generals.length > MAX_PACK_GENERALS) {
    return { ok: false, problems: [{ code: 'TOO_MANY', detail: `这个包带了 ${generals.length} 张，超过一个包的上限 ${MAX_PACK_GENERALS} 张` }] };
  }
  const problems: PackProblem[] = [];
  if (typeof header.count === 'number' && header.count !== generals.length) {
    problems.push({ code: 'COUNT_MISMATCH', detail: `头部写着 ${header.count} 张，文件里实际有 ${generals.length} 张——清单被人加过或删过` });
  }
  if (typeof header.fingerprint === 'string' && header.fingerprint !== packFingerprint(generals)) {
    problems.push({ code: 'FINGERPRINT_MISMATCH', detail: '文件内容与指纹对不上——卡面在导出之后被改过（手改、传坏、下载不全都会是这个现象）' });
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, pack: { header: header as DiyPackHeader, generals }, generals };
}

/** 势力白名单：装包时逐条核，避免把外部文件的野值灌进引擎的词表。 */
export const PACK_FACTIONS: Faction[] = allFactions;
