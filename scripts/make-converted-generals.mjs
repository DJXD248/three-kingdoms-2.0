// 把仓库根的 转换后_三国卡牌.xlsx（工作表「可导入」）里**官方名册还没有的那些将**
// 生成为 src/data/generalsConverted.ts＝读法㈁「318 将真进名册」的唯一生产点。
// 单一事实源＝那张表；改完表重跑 `npm run roster-from-xlsx` 即可，绝不手抄。
//
// 三条硬口径（用户 2026-10-31 裁「先走读法㈁（318 将真进名册）」）：
//  ① 表里 318 将（向下填充「将领名称」「势力」两格后实测），与官方名册**同名同势力**的那
//     79 张**跳过**——名册里那张是用户自己写过的内容（将名／势力／体力／技能名归他），
//     生成器一个字都不许覆盖。判据取自 `src/data/generals.ts` 的真原文，不是猜的。
//  ② 收进来的每一枚技能**只带卡面文字（名字＋描述＋徽章）而不带结算载荷**：这一批技能行里没有
//     一枚带结构化载荷（转换表那条线逐行跑出来的档位表量的）。⇒ 这批卡在牌桌上一声不响，
//     与名册里既有的"只有名字与说明、没有 runtime"那一路同一条纪律（`generals.ts` 文件头）。
//  ③ 「强制发动」「每回合限几次」这两格**这一版不搬**：它们是两个行为开关，而这批技能没有
//     结算载荷＝永远没有"发动的那一刻"。把开关挂在一枚不会响的技能上＝"卡上印着规则、
//     结算没人管"那一族事故（§12-112）。表里那两列照旧留着，等哪一枚技能有了真内容再说。
//
// 判据全部**导出**：守卫测试 `scripts/generalsConverted.test.mjs` 用同一套函数从表再算一遍，
// 与仓库里那份已提交的成品逐字对账。验收不复造判据——测试自己另写一套读表口径，就会出现
// "表变了而钉子照样绿"的空跑（本项目在验收脚本上栽过一次）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

// 不用 `import.meta.dirname`：那枚要 Node 20.11+，CI 的 20.x 矩阵不保证有这一位。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, '转换后_三国卡牌.xlsx');
const OUTPUT = path.join(ROOT, 'src', 'data', 'generalsConverted.ts');
const ROSTER = path.join(ROOT, 'src', 'data', 'generals.ts');
export const SHEET = '可导入';

// 「强制发动」＝第 8 列、「每回合限几次」＝第 32 列：本工具**有意不读**（见上面口径③）。
export const COL = { name: 0, faction: 1, hp: 2, skillName: 5, tags: 6, description: 10 };
export const FACTIONS = ['魏', '蜀', '吴', '群', '晋'];
export const TAG_WORDS = ['锁定技', '限定技', '登场技', '遗计技', '觉醒技'];
const FACTION_ID = { 魏: 'wei', 蜀: 'shu', 吴: 'wu', 群: 'qun', 晋: 'jin' };
export const cell = (row, idx) => String(row[idx] ?? '').trim();

/** 一格里的徽章：`无`／空＝没有；多枚按 、、，、／、＋、"和""与"、空白拆，认不得的名字原样交回。 */
export function readTags(raw) {
  const v = raw.trim();
  if (!v || v === '无') return { tags: [], unknown: [] };
  const parts = v.split(/(?:、|,|，|;|；|\/|／|\+|＋|和|与|\s)+/).filter(Boolean);
  const tags = [];
  const unknown = [];
  for (const p of parts) (TAG_WORDS.includes(p) ? tags : unknown).push(p);
  return { tags: [...new Set(tags)], unknown };
}

/**
 * 同一张卡上把同一个技能名列了两行（表里的排版残留，实测 318 将里只有曹叡一枚：
 * 「明鉴」一行空着、下一行才写内容）。并成一枚，取**有字的那一行**；
 * 两行都写了字又不一样＝表自己矛盾，中止不猜。
 */
function mergeSameNameSkills(g) {
  const byName = new Map();
  for (const s of g.skills) {
    const prev = byName.get(s.name);
    if (!prev) {
      byName.set(s.name, s);
      continue;
    }
    if (prev.description && s.description && prev.description !== s.description) {
      throw new Error(`${g.name}（${g.faction}）的「${s.name}」在表里写了两遍而且不一样——生成中止，不替玩家挑一个`);
    }
    byName.set(s.name, prev.description ? prev : s);
  }
  return [...byName.values()];
}

/**
 * 表 → 将（按「将领名称」「势力」向下填充分组；两组之间不许插行，实测 0 例非连续）。
 * `rawRows`＝表里为这将列了几行技能；`skills.length`＝并掉同名重列之后的枚数。
 */
export function groupGenerals(rows) {
  const out = [];
  let current = null;
  let lastName = '';
  let lastFaction = '';
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 6) continue;
    const nameCellRaw = cell(row, COL.name);
    const factionCellRaw = cell(row, COL.faction);
    if (nameCellRaw) lastName = nameCellRaw;
    if (factionCellRaw) lastFaction = factionCellRaw;
    if (!lastName || !lastFaction) continue;
    const key = `${lastName}|${lastFaction}`;
    if (!current || current.key !== key) {
      current = { key, name: lastName, faction: lastFaction, hp: null, rawRows: 0, skills: [] };
      out.push(current);
    }
    const hpRaw = cell(row, COL.hp);
    if (hpRaw && current.hp === null) current.hp = Number(hpRaw);
    const skillName = cell(row, COL.skillName);
    // 表里"这一行没写技能名"的情况实测 0 例；真有就不收，绝不凭空造一枚空技能。
    if (!skillName) continue;
    current.rawRows += 1;
    current.skills.push({
      name: skillName,
      description: cell(row, COL.description),
      tags: readTags(cell(row, COL.tags)),
    });
  }
  return out.map((g) => ({ ...g, skills: mergeSameNameSkills(g) }));
}

/**
 * 官方名册此刻有哪些（将名,势力）＝读 `src/data/generals.ts` 的原文（这个工具是 build-time 的，
 * Node 直接跑，吃不了 .ts 的类型层）。认得太少就中止：宁可不写半个文件，也不要"以为名册是空的"
 * ⇒把名册里那张用户写过的卡复制一份进来变成两张同名同势力（那种重复会让座位装配当场中止）。
 */
export function readOfficialPairs(rosterText) {
  const pairs = [];
  const callRe = /createGeneral\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([魏蜀吴群晋])'/g;
  let hit;
  while ((hit = callRe.exec(rosterText))) pairs.push(`${hit[2]}|${hit[3]}`);
  if (pairs.length < 96) {
    throw new Error(`只从名册原文认出 ${pairs.length} 张（已知至少 96）⇒ 抽取规则跟不上名册的写法，生成中止`);
  }
  if (new Set(pairs).size !== pairs.length) throw new Error('官方名册内部有同名同势力重复——生成中止，不写半个文件');
  return pairs;
}

/** 表里的将 + 名册已有的对 ⇒ 该收下的那批（带 `sheet_` 号；顺序＝表的行序，绝不按中文排序）。 */
export function selectFresh(generals, officialPairs) {
  const official = new Set(officialPairs);
  const fresh = generals.filter((g) => !official.has(g.key));
  if (new Set(fresh.map((g) => g.key)).size !== fresh.length) throw new Error('表内同一（将名,势力）出现两段——生成中止');
  const noHp = fresh.filter((g) => !Number.isInteger(g.hp) || g.hp <= 0);
  if (noHp.length) {
    throw new Error(`有 ${noHp.length} 将的「体力」格读不出正整数（例：${noHp.slice(0, 3).map((g) => g.name).join('、')}）——生成中止，不猜数`);
  }
  const counters = {};
  return fresh.map((g) => {
    counters[g.faction] = (counters[g.faction] || 0) + 1;
    return { ...g, id: `sheet_${FACTION_ID[g.faction]}_${String(counters[g.faction]).padStart(3, '0')}` };
  });
}

/** 单引号字面量：表里确有单元格自带换行（如夏侯恩「护剑」），照实转义，不替玩家改文案。 */
export const strip = (s) =>
  `'${String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}'`;

export function emit(g, id) {
  const skills = g.skills.map((s) => {
    const parts = [`name: ${strip(s.name)}`];
    if (s.description) parts.push(`description: ${strip(s.description)}`);
    if (s.tags.tags.length) parts.push(`tags: [${s.tags.tags.map(strip).join(', ')}]`);
    return `    { ${parts.join(', ')} },`;
  });
  return `  createGeneral(${strip(id)}, ${strip(g.name)}, ${strip(g.faction)}, ${g.hp}, [\n${skills.join('\n')}\n  ]),`;
}

export function renderFile(withIds, totalGenerals, skippedCount) {
  const skillRows = withIds.reduce((n, g) => n + g.skills.length, 0);
  const mergedRows = withIds.reduce((n, g) => n + (g.rawRows - g.skills.length), 0);
  const unknownTags = [...new Set(withIds.flatMap((g) => g.skills.flatMap((s) => s.tags.unknown)))];
  const header = `// 本文件由 scripts/make-converted-generals.mjs 从仓库根的 转换后_三国卡牌.xlsx（工作表「${SHEET}」）生成，**请勿手改**：\n` +
    `// 要改内容就改那张表，然后跑 \`npm run roster-from-xlsx\`。守卫测试＝scripts/generalsConverted.test.mjs 会拿表逐字对账。\n` +
    `//\n` +
    `// 表里 ${totalGenerals} 将（向下填充后）｜与官方名册同名同势力、按纪律跳过的 ${skippedCount} 将｜本文件收下的 ${withIds.length} 将｜技能格 ${skillRows} 枚。\n` +
    `// 这 ${withIds.length} 张卡全部**只带卡面文字、不带结算载荷**⇒它们在牌桌上一声不响（今天会不会响＝表里那一列说的），\n` +
    `// 与名册里既有的"只有名字与说明、没有 runtime"那一路同一条纪律。带真结算内容的技能不进「技能表」⇒不改变「获得技能」的名单。\n` +
    `// 认不得的徽章名（原样留在表里、没有搬进名册）：${unknownTags.length ? unknownTags.join('、') : '无'}。\n` +
    `// 表里同一张卡上把同一个技能名列了两遍的行：${mergedRows} 行——已并成一枚（取有字那一行），名单与文字都没替玩家改。\n`;
  return [
    header,
    `import { createGeneral } from './createGeneral';`,
    `import type { General } from './generals';`,
    ``,
    `export const SHEET_GENERALS: General[] = [`,
    withIds.map((g) => emit(g, g.id)).join('\n'),
    `];`,
    ``,
  ].join('\n');
}

/**
 * 读表。`XLSX.readFile` 在 ESM 那一份构建里拿不到 fs（报 "Cannot access file"），
 * 所以自己读字节再交给它——同一套解析，少一个坑。
 */
export function readSheetRows() {
  const workbook = XLSX.read(fs.readFileSync(SOURCE), { type: 'buffer' });
  const sheet = workbook.Sheets[SHEET];
  if (!sheet) throw new Error(`表里没有工作表「${SHEET}」——生成中止，不写半个文件`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (cell(rows[0], COL.name) !== '将领名称') throw new Error(`「${SHEET}」首行第 1 格不是「将领名称」——生成中止`);
  return rows;
}

/** 表 + 名册原文 → 该收下的那批（两条进料都在这里面读，守卫测试问的是同一支）。 */
export function buildFromSource() {
  const generals = groupGenerals(readSheetRows());
  const officialPairs = readOfficialPairs(fs.readFileSync(ROSTER, 'utf8'));
  const withIds = selectFresh(generals, officialPairs);
  return { totalGenerals: generals.length, skippedCount: generals.length - withIds.length, withIds };
}

function main() {
  const { totalGenerals, skippedCount, withIds } = buildFromSource();
  fs.writeFileSync(OUTPUT, renderFile(withIds, totalGenerals, skippedCount), 'utf8');
  const skillRows = withIds.reduce((n, g) => n + g.skills.length, 0);
  const unknownTags = [...new Set(withIds.flatMap((g) => g.skills.flatMap((s) => s.tags.unknown)))];
  console.log(`已生成 ${path.relative(ROOT, OUTPUT)}：${withIds.length} 将／${skillRows} 枚技能（跳过 ${skippedCount} 张与官方同名同势力）｜按势力 ${FACTIONS.map((f) => `${f}:${withIds.filter((x) => x.faction === f).length}`).join(' ')}`);
  if (unknownTags.length) console.log(`⚠ 表里有名册认不得的徽章名，已留在表里没搬：${unknownTags.join('、')}`);
}

// 只有直接跑（`npm run roster-from-xlsx`）才动文件；守卫测试 import 这些判据时不许有副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
