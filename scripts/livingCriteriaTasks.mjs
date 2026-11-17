// 挂账状态地图的唯一实现：记号语法、校验、渲染。
// 生成器 scripts/make-living-criteria.mjs 与守卫 scripts/livingCriteriaGuard.test.mjs 都从这里取判据
// ＝"验收脚本的判据向实现要"：两边各写一套解析，就会出现"地图坏了但守卫空跑蒙绿"的弱证人。
// 本模块纯函数、不碰磁盘：文件由调用方以 readFile(相对路径) 注入，探针才能凭空造坏形状。

export const BOARD_FILE = 'PROJECT_TASK_BOARD.md';
export const OPEN_MARK = '⧗挂账';
export const CLOSE_MARK = '⧗销账';
export const FIELD_SEP = '｜';
export const ANCHOR_SEP = '::';
export const MIN_ANCHOR_LEN = 6;
export const OPEN_FIELDS = ['事', '状态', '等谁', '落点', '下一步'];
export const CLOSE_FIELDS = ['凭据'];
// 状态枚举刻意小：一格挂账只需要说清"卡在哪一类"，具体细节在事／下一步里写。
export const STATUSES = ['等业主', '待两台机器', '待收口', '待复量', '待开工', '进行中', '挂起'];
// 地图表的排列序＝最该被接手者先看见的排前面。
export const STATUS_ORDER = STATUSES;

const cell = (s) => String(s ?? '').replace(/\|/g, '¦').replace(/\s+/g, ' ').trim();

/** 逐行解析任务板。代码围栏内的行不算记录（语法示例写在围栏里）。 */
export function parseBoard(text) {
  const opens = [];
  const closes = [];
  const problems = [];
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    const where = `第 ${i + 1} 行`;
    if (line.trimStart().startsWith('```')) { inFence = !inFence; return; }
    if (inFence) return;
    const trimmed = line.trim();
    const kind = trimmed.startsWith(OPEN_MARK) ? 'open'
      : trimmed.startsWith(CLOSE_MARK) ? 'close' : null;
    if (!kind) return;
    if (!line.startsWith(OPEN_MARK) && !line.startsWith(CLOSE_MARK)) {
      problems.push(`${where}：记录必须顶格写（缩进行只当示例，会被整块跳过）`);
      return;
    }
    const parts = trimmed.slice(kind === 'open' ? OPEN_MARK.length : CLOSE_MARK.length).split(FIELD_SEP);
    const id = (parts.shift() || '').trim();
    if (!/^K-\d{2,3}$/.test(id)) {
      problems.push(`${where}：编号「${id || '（空）'}」不合法＝必须形如 K-01`
        + '（纯数字会被账本正文表当成 §12 条目行，两张表会串）');
      return;
    }
    const fields = {};
    const allowed = kind === 'open' ? OPEN_FIELDS : CLOSE_FIELDS;
    for (const p of parts) {
      if (!p.trim()) continue;
      const eq = p.indexOf('=');
      if (eq < 0) { problems.push(`${where}：${id} 的「${cell(p)}」没有＝号＝字段写法是 名=值`); continue; }
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim();
      if (!allowed.includes(k)) { problems.push(`${where}：${id} 的字段「${k}」不在清单里（可用＝${allowed.join('／')}）`); continue; }
      if (fields[k]) problems.push(`${where}：${id} 的字段「${k}」写了两遍`);
      fields[k] = v;
    }
    const missing = allowed.filter((f) => !fields[f]);
    if (missing.length) problems.push(`${where}：${id} 缺字段 ${missing.join('／')}`);
    if (kind === 'open') {
      if (fields['状态'] && !STATUSES.includes(fields['状态'])) {
        problems.push(`${where}：${id} 的状态「${fields['状态']}」不在枚举里（可用＝${STATUSES.join('／')}）`);
      }
      opens.push({ id, line: i + 1, fields, kind });
    } else {
      closes.push({ id, line: i + 1, fields, kind });
    }
  });
  // 抽取失败必须说话：空清单会被渲染成"今天没有挂账"，那是最坏的一种假绿。
  if (opens.length === 0) problems.push('任务板一块挂账都没解析到＝抽取失败，不许当成"没有挂账"');
  return { opens, closes, problems, totalLines: lines.length };
}

/** 跨记录判据（重复号／孤儿销账）＋ 落点锚逐字核验。readFile(相对路径) 读不到就返回 null。 */
export function validateTaskRecords({ opens, closes }, readFile) {
  const problems = [];
  const seen = new Map();
  for (const o of opens) {
    if (seen.has(o.id)) problems.push(`第 ${o.line} 行：${o.id} 与第 ${seen.get(o.id)} 行重号＝一格挂账只能有一条现状`);
    else seen.set(o.id, o.line);
  }
  const closed = new Set();
  for (const c of closes) {
    if (!seen.has(c.id)) problems.push(`第 ${c.line} 行：销账 ${c.id} 找不到对应的挂账＝凭据不能凭空存在`);
    if (closed.has(c.id)) problems.push(`第 ${c.line} 行：${c.id} 销账写了不止一条`);
    else closed.add(c.id);
  }
  for (const o of opens) {
    const raw = o.fields['落点'] || '';
    const at = raw.indexOf(ANCHOR_SEP);
    if (at < 0) { problems.push(`${o.id} 的落点没有 ${ANCHOR_SEP}（写法＝相对路径${ANCHOR_SEP}文档里逐字存在的一句话）`); continue; }
    const file = raw.slice(0, at).trim();
    const anchor = raw.slice(at + ANCHOR_SEP.length).trim();
    if (!file) { problems.push(`${o.id} 的落点没有文件路径`); continue; }
    if (/^([a-zA-Z]:[\\/]|[\\/])/.test(file) || file.split('/').includes('..')) {
      problems.push(`${o.id} 的落点「${file}」不是仓库内相对路径＝地图只能指向仓库里人人取得到的东西`);
      continue;
    }
    const text = readFile(file);
    if (text === null || text === undefined) { problems.push(`${o.id} 的落点文件 ${file} 读不到＝地图指向了不存在的文档`); continue; }
    if (anchor.length < MIN_ANCHOR_LEN) problems.push(`${o.id} 的逐字锚「${anchor}」短于 ${MIN_ANCHOR_LEN} 字＝这种锚随处命中，等于没指路`);
    else if (!text.includes(anchor)) problems.push(`${o.id} 的逐字锚「${anchor}」在 ${file} 里找不到＝那句话被改了或本来就写错，地图不许指向不存在的原文`);
  }
  return problems;
}

export function openTasks({ opens, closes }) {
  const closed = new Set(closes.map((c) => c.id));
  return opens.filter((o) => !closed.has(o.id));
}

const statusRank = (s) => {
  const i = STATUS_ORDER.indexOf(s);
  return i < 0 ? STATUS_ORDER.length : i;
};
const byStatusThenId = (a, b) => (statusRank(a.fields['状态']) - statusRank(b.fields['状态'])) || a.id.localeCompare(b.id);

/** 渲染成账本里那一节（返回整行数组；表格固定 6 格、首格是 K- 编号，绝不与 §12 正文表撞形）。 */
export function renderTaskMap({ opens, closes }) {
  const out = [];
  const push = (s = '') => out.push(s);
  const open = openTasks({ opens, closes }).slice().sort(byStatusThenId);
  const done = closes.slice().sort((a, b) => a.id.localeCompare(b.id));
  const tally = {};
  for (const o of open) tally[o.fields['状态']] = (tally[o.fields['状态']] || 0) + 1;

  push('## 挂账状态地图（谁等谁 · 去哪儿读 · 下一步）');
  push('');
  push(`- **这一节回答"还有什么没做完"**：开放 **${open.length}** 格／已销账 **${done.length}** 格。`
    + '按状态汇总＝' + STATUS_ORDER.filter((s) => tally[s]).map((s) => `${s} ${tally[s]}`).join(' · ') + '。');
  push(`- 它是 **\`${BOARD_FILE}\`** 的投影：那张表是**唯一可以手改**的挂账登记面，本页仍然一个字都不许手改。`
    + '记号语法、字段清单、状态枚举、落点必须逐字命中，全由 `scripts/livingCriteriaTasks.mjs` 校验，不合格生成器直接非零退出。');
  push('- **接手的人（或模型）只用这一节就能定今天干什么**：`状态＝等业主／待两台机器` 的格**不要自己动手**，`待开工／待收口／待复量／进行中` 的格照 `下一步` 开工。');
  push('- `落点` 那一格给的是**该去读哪份文档的哪一句**（文件 · 逐字锚），比"见交接文档"可定位；判据原文仍在 §12，本表只保证指得到。');
  push('');
  push('| 挂账 | 事 | 状态 | 等谁 | 落点（文件 ▸ 逐字锚） | 下一步 |');
  push('|---|---|---|---|---|---|');
  for (const o of open) {
    const raw = o.fields['落点'] || '';
    const at = raw.indexOf(ANCHOR_SEP);
    const where = at < 0 ? raw : `${raw.slice(0, at).trim()} ▸ ${raw.slice(at + ANCHOR_SEP.length).trim()}`;
    push(`| ${o.id} | ${cell(o.fields['事'])} | ${cell(o.fields['状态'])} | ${cell(o.fields['等谁'])} | ${cell(where)} | ${cell(o.fields['下一步'])} |`);
  }
  push('');
  if (done.length) {
    push('### 已销账（挂账行留着不删，只补一行销账凭据）');
    push('');
    push('| 销账 | 事 | 当初状态 | 凭据 |');
    push('|---|---|---|---|');
    for (const c of done) {
      const o = opens.find((x) => x.id === c.id);
      push(`| ${c.id} | ${cell(o ? o.fields['事'] : '')} | ${cell(o ? o.fields['状态'] : '')} | ${cell(c.fields['凭据'])} |`);
    }
    push('');
  }
  return out;
}
