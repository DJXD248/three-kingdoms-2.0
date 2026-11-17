#!/usr/bin/env node
// 现行判据账本生成器：从 PROJECT_HANDOFF.md 的 §12 逐字抽取每条原标题，分区排成一张表，
// 写成仓库根的 PROJECT_LIVING_CRITERIA.md。产物是投影，不是抄本——手改会在守卫测试里变红。
// 判据原文的唯一权威仍是 §12；本表只保证"逐字＋可定位＋不漏"。
// 挂账现状不在 §12：它住在 PROJECT_TASK_BOARD.md（唯一可手改的一页），由本生成器投影成「挂账状态地图」。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_FILE, parseBoard, validateTaskRecords, renderTaskMap, openTasks } from './livingCriteriaTasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANDOFF = 'PROJECT_HANDOFF.md';
const OUT = 'PROJECT_LIVING_CRITERIA.md';
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const CITE_RE = /[#§]\s?12-(\d{1,3})(?![0-9])/g;
const FREEZE_FROM = '2026-11-15';

function readText(full) {
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) return null;
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}

/**
 * 输入面＝git 跟踪清单（内容仍从磁盘读，所以未提交的改动能被抓到）。
 * 不按磁盘走：仓库里一份 gitignore 掉的临时日志就能让两处机器的产物字节不等，
 * 而守卫比的是逐字节（2026-11-16 CI #415 实抓，细账 §12-195⑫）。
 */
function trackedFiles() {
  let raw;
  try {
    raw = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--full-name'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error('取不到 git 跟踪清单（' + String(e.message).split('\n')[0] + '）＝输入面未定，必须非零退出');
    process.exit(1);
  }
  const list = raw.split('\0').filter(Boolean);
  if (list.length === 0) {
    console.error('git ls-files 返回空清单＝输入面未定，必须非零退出');
    process.exit(1);
  }
  return list;
}

if (!fs.existsSync(path.join(ROOT, HANDOFF))) {
  console.error('找不到 ' + HANDOFF);
  process.exit(1);
}
const files = trackedFiles()
  // 产物本身不进输入面：账本里的编号列会被引用正则命中，算进来＝第二次生成读到第一次的产物，不幂等。
  .filter((rel) => !SKIP_FILES.has(path.basename(rel)) && rel !== OUT)
  .map((rel) => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      console.error(`跟踪清单里的 ${rel} 在磁盘上缺失＝输入面未定（先把它恢复，别按缺文件的树出账本）`);
      process.exit(1);
    }
    if (fs.statSync(full).size > 4 * 1024 * 1024) return null;
    const text = readText(full);
    return text === null ? null : { rel, text };
  })
  .filter(Boolean);
const hf = files.find((f) => f.rel === HANDOFF);
if (!hf) { console.error('找不到 ' + HANDOFF + '（git 跟踪清单里没有它）'); process.exit(1); }
const lines = hf.text.split('\n');
const start = lines.findIndex((l) => /^## 12\./.test(l));
if (start < 0) { console.error('§12 标题找不到'); process.exit(1); }
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) if (/^## \d+\./.test(lines[i])) { end = i; break; }
const block = lines.slice(start, end);

const marks = [];
for (let i = 1; i < block.length; i++) if (/^\d{1,3}\. /.test(block[i])) marks.push(i);
if (marks.length === 0) { console.error('§12 条目一条都没抽到＝抽取失败，必须非零退出'); process.exit(1); }

const entries = marks.map((a, k) => {
  const b = k + 1 < marks.length ? marks[k + 1] : block.length;
  const body = block.slice(a, b).join('\n');
  const first = block[a];
  const num = Number(/^(\d{1,3})\. /.exec(first)[1]);
  const bold = /（[^）]*\*\*([\s\S]+?)\*\*/.exec(first) || /\*\*([\s\S]+?)\*\*/.exec(first.slice(0, 400));
  const raw = bold ? bold[1] : first.replace(/^\d{1,3}\. /, '');
  return { num, body, bytes: Buffer.byteLength(body, 'utf8'), head: raw.replace(/\s+/g, ' ').trim() };
});

const outCount = {};
const inCount = {};
let outHits = 0;
let inHits = 0;
const outFiles = new Set();
for (const f of files) {
  f.text.split('\n').forEach((line, li) => {
    for (const m of line.matchAll(CITE_RE)) {
      const n = Number(m[1]);
      const inside = f.rel === HANDOFF && li > start && li < end;
      if (inside) { inHits++; inCount[n] = (inCount[n] || 0) + 1; }
      else { outHits++; outCount[n] = (outCount[n] || 0) + 1; outFiles.add(f.rel); }
    }
  });
}

const PEND_RE = /PENDING|未验|挂起|尚未|待口令|待裁|待用户/;
const ZONES = [
  ['F 挂账未完', PEND_RE],
  ['E 联机与网络', /联机|房主|客人|网络|热座|席位|进程|net|relay|远端|两台机器|远程|跨机|Radmin|端口|代理|推不上|时钟/],
  ['D 内容与归属', /归属|官方将|词汇|Excel|卡面|描述|DIY|素材|内容量产|将领|卡池|原语|内置内容|称号/],
  ['C 玩法与结算', /结算|伤害|触发|响应|技能|时机|胜负|对局|锚|手牌|装备|判定|事件|行动|骰|抽牌|征召/],
  ['B 验证与闸门', /闸|lint|eslint|CI|测试|覆盖|证人|断言|E2E|浏览器|探针|cmp|字节|回归|基线|种子|录像|复算|取证/],
  ['A 流程与登记', /登记|流水线|标签|提交|推送|回填|收尾|版本|号形|分割|归档|交接|文档|记忆|口令|授权|待办|记账/],
];
const ZONE_ORDER = ZONES.map(([z]) => z).concat(['Z 未归类']);
for (const e of entries) {
  e.probe = e.head + ' ' + e.body.slice(0, 300);
  const hit = ZONES.find(([, re]) => re.test(e.probe));
  e.zone = hit ? hit[0] : 'Z 未归类';
  e.out = outCount[e.num] || 0;
  e.in = inCount[e.num] || 0;
  e.pend = PEND_RE.test(e.body);
}

const dupByNum = {};
for (const e of entries) dupByNum[e.num] = (dupByNum[e.num] || 0) + 1;
const dups = Object.entries(dupByNum).filter(([, c]) => c > 1).map(([n, c]) => n + ' 有 ' + c + ' 份');
const distinct = Object.keys(dupByNum).length;
const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
const cited = entries.filter((e) => e.out > 0).length;
const zero = entries.filter((e) => e.out === 0);
const pendOnly = entries.filter((e) => e.pend && !/今后|必须|待办/.test(e.body));
const zoneCount = {};
for (const e of entries) zoneCount[e.zone] = (zoneCount[e.zone] || 0) + 1;

// 挂账状态地图：任务板不合格（重号／缺字段／状态出枚举／落点指不到逐字原文／销账无主）＝非零退出。
// 指错路的地图比没有地图更坏，所以这里没有"警告着继续"这一档。
const boardPath = path.join(ROOT, BOARD_FILE);
if (!fs.existsSync(boardPath)) {
  console.error(`找不到 ${BOARD_FILE}＝挂账地图无源，必须非零退出（不许渲染成"今天没有挂账"）`);
  process.exit(1);
}
const board = parseBoard(readText(boardPath));
const boardProblems = [
  ...board.problems,
  ...validateTaskRecords(board, (rel) => {
    const full = path.join(ROOT, rel);
    return fs.existsSync(full) ? readText(full) : null;
  }),
];
if (boardProblems.length) {
  console.error(`${BOARD_FILE} 不合格（${boardProblems.length} 条）＝地图不投影，必须非零退出：`);
  for (const p of boardProblems) console.error('  - ' + p);
  process.exit(1);
}
const taskMapLines = renderTaskMap(board);
const openCount = openTasks(board).length;

const L = [];
const push = (...s) => L.push(s.join(''));
push('# PROJECT_LIVING_CRITERIA.md — 现行判据账本（§12 的投影）');
push('');
push('<!-- 本文件由 `node scripts/make-living-criteria.mjs` 生成，请勿手改：');
push('     守卫测试 scripts/livingCriteriaGuard.test.mjs 会现场重跑生成器并与本文件逐字节比对。 -->');
push('');
push('## 这一页为什么存在');
push('');
push('- 用户 ' + FREEZE_FROM + ' 裁定：「那就走"接手时少读点"这条线吧」。');
push('- 用户 2026-11-17 裁定（逐字）：「把接手时第一读从交接文档换成这张薄账本，然后把你所有没记录的代办都登记好」');
push('  ⇒ **接手的第一个读点＝这一页**，交接文档 `PROJECT_HANDOFF.md` 降为第二读；细账与边界＝§12-195⑮，未登记待办的清点结果＝§12-195⑯。');
push('- 三条一起成立：**§12 冻结为只读存档**（不删字、不改编号、**不再往里追加**）；**接手先查这一页**定位；');
push('  **要判哪句还作数，逐条回 §12 读原文**。');
push('- 这一页**故意不是第二份抄本**，而是从 §12 逐字抽出来的投影：抄本会漂移，投影不会——它由机器生成、被测试钉住。');
push('- 本轮只做到"账本层"。把原句子摘成分区正文（外部评审里的"薄纸正文"）属下一刀，且必须走生成器＋选择清单，**不许手抄**。');
push('  ⇒ 在那之前，**判据原文的唯一权威仍是 §12 本体**；本表只保证逐字、可定位、不漏，不替你判哪句还生效。');
push('- 新增判据的去处：写进**这一页的生成器选择清单**（下一刀建立）或直接改 §12 原文由生成器重投影；');
push('  过渡期（选择清单建立之前）＝写进 §12-195 的**分项续号**（⑨⑩……，见 §12-195⑧），**新条目**才是禁止的。');
push('  **不再往 §12 追加新条目**——那是 ' + FREEZE_FROM + ' 起的冻结令，有测试盯着。');
push('- **还有什么没做完**看下一节「挂账状态地图」：它从 `' + BOARD_FILE + '`（唯一可手改的挂账登记面）投影而来，');
push('  每格写清卡在谁手里、该去哪份文档读哪一句、第一个动作是什么；本轮挂账 **' + openCount + '** 格。');
push('');
for (const l of taskMapLines) push(l);
push('## 读数口径（本页自证，免得再吵）');
push('');
push('- §12 现有 **'.concat(String(entries.length), ' 条**（去重后 **', String(distinct), ' 个编号**），正文合计 **', totalBytes.toLocaleString('en-US'), ' 字节**。'));
if (dups.length) push('- 已知编号缺陷（**冻结但保留，绝不重编号**）：' + dups.join('；') + '。任何"按编号"的自动判据在重复号上无法判它指哪条。');
if (entries.some((e) => e.num === 0)) push('- 另有编号 `0` 一条（历史遗留）。它容易被当成格式错误吞掉，本表与守卫测试都把它当正常条目对待。');
push('- **段外被点名**（§12 之外，含交接文档其它章节）：按条 **', cited, '/', entries.length, '＝', ((cited / entries.length) * 100).toFixed(1), '%**，按字节 **',
  entries.filter((e) => e.out > 0).reduce((s, e) => s + e.bytes, 0).toLocaleString('en-US'), '/', totalBytes.toLocaleString('en-US'), '＝',
  ((entries.filter((e) => e.out > 0).reduce((s, e) => s + e.bytes, 0) / totalBytes) * 100).toFixed(1), '%**；引用出现 **', outHits, ' 次**，涉及 **',
  Object.keys(outCount).length, ' 个编号**，出处文件 **', outFiles.size, ' 个**。');
push('  ⇒ **按条与按字节是两种数法**（重复编号 `71` 让"条"比"编号"多一条），历轮那些"96.3%"指的是**按字节**，别混用。');
push('- **段内互引**（§12 自己点名自己）：出现 **', inHits, ' 次**，涉及 **', Object.keys(inCount).length, ' 个编号**＝第二个断链面，扫描时别只盯段外。');
push('- **段外零引用**：**', zero.length, ' 条**／', zero.reduce((s, e) => s + e.bytes, 0).toLocaleString('en-US'),
  ' 字节。**零引用不等于死条目**：一条规矩太基础、人人默认，反而没人按编号提它（本表把它单列在末节）。');
push('- 只写"挂起/未验/PENDING"而不带"今后/必须/待办"的＝**', pendOnly.length, ' 条**／',
  pendOnly.reduce((s, e) => s + e.bytes, 0).toLocaleString('en-US'), ' 字节。⇒ 拿祈使词当"活"标记会把最该留下的判成可搬，方向是反的。');
push('- 输入面＝**git 跟踪清单**（`git ls-files`）里的非二进制文件 **', files.length, ' 个**（排产物本身与锁文件；');
push('  内容按磁盘当前状态读，所以未提交的改动也算数）；');
push('  不按"磁盘上有什么扫什么"：仓库里一份被 gitignore 掉的临时日志就能让两台机器产出不同字节，而守卫比的是逐字节。');
push('  引用正则＝`[#§]\\s?12-(\\d{1,3})(?![0-9])`；条目识别＝§12 段内行首 `N. `。');
push('- 分区＝按条目**原标题＋正文前 300 字**的第一个命中，优先级 F>E>D>C>B>A（见生成器 `ZONES`），**是机械归类、不是语义判读**；`Z 未归类` 的条数就是机械归类的边界。');
push('');
push('## 分区总览');
push('');
push('| 分区 | 条数 | 字节 | 段外点名≥1 次 | 含挂账词 |');
push('|---|---|---|---|---|');
for (const z of ZONE_ORDER) {
  const rows = entries.filter((e) => e.zone === z);
  if (!rows.length) continue;
  push('| ', z, ' | ', rows.length, ' | ', rows.reduce((s, e) => s + e.bytes, 0).toLocaleString('en-US'), ' | ',
    rows.filter((e) => e.out > 0).length, ' | ', rows.filter((e) => e.pend).length, ' |');
}
push('');
push('## 账本正文');
push('');
for (const z of ZONE_ORDER) {
  const rows = entries.filter((e) => e.zone === z).sort((a, b) => a.num - b.num);
  if (!rows.length) continue;
  push('### ' + z + '（' + rows.length + ' 条）');
  push('');
  push('| §12 编号 | 原标题（逐字截取，最长 120 字） | 条目字节 | 段外点名 | 段内互引 | 含挂账词 |');
  push('|---|---|---|---|---|---|');
  for (const e of rows) {
    const head = e.head.length > 120 ? e.head.slice(0, 120) + '…' : e.head;
    push('| ', String(e.num), ' | ', head.replace(/\|/g, '¦'), ' | ', e.bytes.toLocaleString('en-US'), ' | ',
      e.out, ' | ', e.in, ' | ', e.pend ? '有' : '—', ' |');
  }
  push('');
}
push('## 段外零引用的 ', zero.length, ' 条（单列，别当成死条目清掉）');
push('');
push('| §12 编号 | 原标题 | 字节 | 含挂账词 |');
push('|---|---|---|---|');
for (const e of zero.sort((a, b) => a.num - b.num)) {
  push('| ', String(e.num), ' | ', (e.head.length > 110 ? e.head.slice(0, 110) + '…' : e.head).replace(/\|/g, '¦'), ' | ',
    e.bytes.toLocaleString('en-US'), ' | ', e.pend ? '有' : '—', ' |');
}
push('');
push('## 怎么重跑');
push('');
push('```');
push('node scripts/make-living-criteria.mjs        # 重生成（会覆盖本文件）');
push('git diff --stat PROJECT_LIVING_CRITERIA.md  # 改动面应当只来自 §12、生成器或任务板');
push('npx vitest run scripts/livingCriteriaGuard.test.mjs');
push('```');
push('');
push('- 挂账现状变了＝改 `' + BOARD_FILE + '`（一行一格），**不要**改本文件里那张地图。');
push('');

const out = L.join('\n').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(path.join(ROOT, OUT), out + '\n', 'utf8');
console.log('生成 ' + OUT + ' =', Buffer.byteLength(out + '\n', 'utf8'), '字节 ·', out.split('\n').length, '行 · 条目', entries.length, '· 挂账开放', openCount, '· 分区', JSON.stringify(zoneCount));
