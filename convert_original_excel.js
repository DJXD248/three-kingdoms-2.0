// 把外部的「三国卡牌.xlsx」（一张工作表一个势力，一格一条技能，技能名在前）
// 转成游戏编辑器能吃的「逐技能行」格式。
//
// 一条技能格的真实写法（实测 634 格）：
//   武圣：远程攻击力+1                 → 名：描述
//   替身：限定技，你被击杀时…          → 名：徽章，描述
//   无言：锁定技：你因技能…            → 名：徽章：描述
//   看破；你可以弃置2张手牌…           → 名；描述（原文用的是分号）
//   「威肆」当己方为角色为场上最多时…  → 「名」描述（原文用引号包住名字）
//   明鉴：                            → 名（没有描述）
//
// 读法逐条对齐 src/components/skillEditor/skillExcelParsers.ts 里的 parseSkillCell：
// 第一个分隔符（：:；;）左边是技能名，右边先剥「开头连续几枚徽章」再剩下的才是描述。
// 这里绝不"猜"触发时机和结构化效果——原文没写的东西不能凭空造。

import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import fs from 'fs';

const inputPath = 'G:\\THREE_KINGDOMS\\三国卡牌.xlsx';
const outputPath = 'G:\\THREE_KINGDOMS\\Qoder\\2.0\\转换后_三国卡牌.xlsx';

/** 徽章词表（与 domain/skillTags.ts 的 allSkillTags 一致） */
const TAGS = ['锁定技', '限定技', '登场技', '遗计技', '觉醒技'];
/** 原表里只当章节标题用的行（整行只有一格文字） */
const SECTION_TITLES = new Set(['标准包', '神话再临', 'SP', '一将成名', '原创之魂', '江山如故', '散卡']);
/** 异画/变体前缀：这些名字在游戏里没有对应将领，按原名导入＝新建一张卡 */
const VARIANT_RE = /^(⭐|转|梦|合|承|衰|兴|起)/;
const FACTION_MAP = {
  '蜀国': '蜀', '魏国': '魏', '吴国': '吴', '群雄（盟国）': '群', '晋国': '晋',
};

const splitTagList = (s) => s.split(/[\s,，、/／]+/).map(x => x.trim()).filter(Boolean);

/**
 * 体力补充表（2026-10-25 用户要求：没写体力的按三国杀武将补）。
 *
 * 原表只有魏国「散卡」那 26 行在名字后面写了数字（董昭 3、王双 8…），其余 293 张全空。
 * 取值优先级：**原表写了数字 > 本作名册同名同势力 > 这张表**。
 * 第二级优先于三国杀，是因为名册里的 95 将就是这个游戏的现行数值（个别与三国杀不同，
 * 例如本作董卓 4、三国杀 8）；导入时若走「修改现有」，照名册才不会平白改掉一张在用的卡。
 *
 * 每项 [体力, 把握]：
 *   '定' = 三国杀该武将的常规体力（标准包/神话再临/一将成名/sp 里广为人知的那些）
 *   '待' = 按同系武将的常规推的，手上没有权威表能逐条对——**请重点核这一批**
 * 变体前缀（⭐/转/梦/合/承/兴/起/衰）与本体同体力，代码会剥前缀再查一次。
 */
const HP_TABLE = new Map(Object.entries({
  // ── 魏 ──
  '魏|甄宓': [3, '待'],
  '魏|王基': [4, '定'],
  '魏|蒯良&蒯越': [3, '定'],
  '魏|郝昭': [4, '定'],
  '魏|毋丘俭': [4, '定'],
  '魏|杨修': [3, '定'],
  '魏|曹洪': [4, '定'],
  '魏|陈琳': [3, '待'],
  '魏|乐进': [4, '定'],
  '魏|曹昂': [4, '定'],
  '魏|文聘': [4, '定'],
  '魏|司马朗': [3, '定'],
  '魏|于禁': [4, '定'],
  '魏|曹植': [3, '定'],
  '魏|曹彰': [4, '定'],
  '魏|曹冲': [3, '定'],
  '魏|郭淮': [4, '定'],
  '魏|曹真': [4, '定'],
  '魏|陈群': [3, '定'],
  '魏|韩浩&史涣': [4, '待'],
  '魏|曹叡': [3, '定'],
  '魏|曹休': [4, '定'],
  '魏|钟繇': [3, '定'],
  '魏|娄圭': [3, '待'],
  '魏|夏侯荣': [3, '待'],
  '魏|曹芳': [3, '待'],
  '魏|郭循': [4, '待'],
  '魏|戏志才': [3, '定'],
  '魏|曹纯': [4, '定'],
  '魏|程昱': [3, '定'],
  '魏|蒋干': [3, '待'],
  '魏|朱灵': [4, '定'],
  '魏|曹嵩': [3, '待'],
  '魏|夏侯恩': [4, '待'],
  '魏|王粲': [3, '待'],
  '魏|嵇康': [3, '定'],
  '魏|郭皇后': [3, '定'],
  '魏|文钦': [4, '待'],
  '魏|郭照': [3, '待'],
  // ── 蜀 ──
  '蜀|伊籍': [3, '待'],
  '蜀|严颜': [4, '定'],
  '蜀|王平': [4, '定'],
  '蜀|陈到': [4, '定'],
  '蜀|诸葛瞻': [4, '定'],
  '蜀|孙尚香': [3, '定'],
  '蜀|关银屏': [3, '待'],
  '蜀|夏侯霸': [4, '定'],
  '蜀|夏侯氏': [3, '待'],
  '蜀|张星彩': [3, '待'],
  '蜀|甘夫人': [3, '待'],
  '蜀|马岱': [4, '定'],
  '蜀|法正': [3, '定'],
  '蜀|关兴&张苞': [4, '待'],
  '蜀|简雍': [3, '待'],
  '蜀|周仓': [4, '待'],
  '蜀|吴懿': [4, '待'],
  '蜀|张松': [3, '待'],
  '蜀|刘谌': [4, '待'],
  '蜀|董允': [3, '待'],
  '蜀|黄皓': [3, '待'],
  '蜀|马云禄': [4, '待'],
  '蜀|糜夫人': [3, '待'],
  '蜀|糜竺': [3, '待'],
  '蜀|孙乾': [3, '待'],
  '蜀|赵襄': [4, '待'],
  '蜀|张翼': [4, '待'],
  '蜀|张嶷': [4, '待'],
  '蜀|马忠': [4, '待'],
  '蜀|秦宓': [3, '待'],
  '蜀|沙摩柯': [4, '待'],
  '蜀|李密': [3, '待'],
  '蜀|刘永': [4, '待'],
  '蜀|高翔': [4, '待'],
  '蜀|关索': [4, '定'],
  '蜀|鲍三娘': [3, '待'],
  '蜀|赵统＆赵广': [4, '待'],
  '蜀|杨仪': [3, '待'],
  '蜀|吕凯': [3, '待'],
  '蜀|雷铜': [4, '待'],
  '蜀|吴班': [4, '待'],
  '蜀|黄权': [3, '待'],
  '蜀|费祎': [3, '定'],
  '蜀|邓芝': [3, '待'],
  '蜀|诸葛尚': [3, '待'],
  '蜀|王甫＆赵累': [4, '待'],
  '蜀|刘巴': [3, '待'],
  '蜀|李严': [3, '待'],
  '蜀|吴兰': [4, '待'],
  // 原表写作「缚彤」，用户 2026-10-25 确认应为「傅肜」（蜀，4 体力）——导入时改名
  '蜀|傅肜': [4, '定'],
  '蜀|李丰': [3, '待'],
  '蜀|陈震': [3, '待'],
  '蜀|霍峻': [4, '待'],
  '蜀|马承': [4, '待'],
  '蜀|许靖': [3, '待'],
  '蜀|吴苋': [3, '待'],
  // ── 吴 ──
  '吴|孙坚': [4, '定'],
  '吴|张昭&张紘': [3, '定'],
  '吴|陆绩': [3, '待'],
  '吴|孙亮': [3, '待'],
  '吴|周妃': [3, '待'],
  '吴|陆抗': [4, '定'],
  '吴|诸葛谨': [3, '定'],
  '吴|祖茂': [4, '待'],
  '吴|孙鲁育': [3, '待'],
  '吴|程普': [4, '定'],
  '吴|韩当': [4, '定'],
  '吴|潘璋&马忠': [4, '待'],
  '吴|虞翻': [3, '定'],
  '吴|朱然': [4, '定'],
  '吴|顾雍': [3, '定'],
  '吴|朱桓': [4, '定'],
  '吴|孙休': [3, '待'],
  '吴|朱治': [3, '待'],
  '吴|周舫': [4, '待'],
  '吴|周处': [4, '待'],
  '吴|孙峻': [3, '待'],
  '吴|孙鲁班': [3, '待'],
  '吴|卫温&诸葛直': [3, '待'],
  '吴|张璇': [3, '待'],
  '吴|范疆&张达': [4, '待'],
  // ── 群 ──
  '群|华雄': [6, '定'],
  '群|潘凤': [4, '待'],
  '群|颜良&文丑': [4, '定'],
  '群|许攸': [3, '定'],
  '群|卢植': [3, '待'],
  '群|刘协': [3, '定'],
  '群|伏完': [3, '待'],
  '群|张宝': [3, '定'],
  '群|何太后': [3, '待'],
  '群|张梁': [3, '待'],
  '群|张绣': [4, '定'],
  '群|刘表': [3, '定'],
  '群|马腾': [4, '定'],
  '群|伏皇后': [3, '定'],
  '群|李儒': [3, '定'],
  '群|蔡夫人': [3, '待'],
  '群|沮授': [3, '定'],
  '群|袁谭&袁尚': [4, '待'],
  '群|郝萌': [4, '待'],
  '群|张鲁': [3, '定'],
  '群|皇莆嵩': [4, '定'],
  '群|皇甫嵩': [4, '定'],
  '群|陶谦': [3, '待'],
  '群|严白虎': [4, '待'],
  '群|郭汜': [4, '定'],
  '群|李傕': [4, '定'],
  '群|荀湛': [3, '待'],
  '群|公孙渊': [4, '待'],
  '群|郭图&逢纪': [3, '待'],
  '群|曹节': [3, '待'],
  '群|胡车儿': [4, '待'],
  '群|彻里吉': [4, '待'],
  '群|何进': [4, '待'],
  '群|刘宏': [3, '待'],
  '群|桥玄': [3, '待'],
  '群|许劭': [3, '待'],
  '群|董白': [3, '待'],
  '群|杨彪': [3, '待'],
  '群|孔融': [3, '定'],
  '群|段煨': [4, '待'],
  '群|朱㑺': [4, '待'],
  '群|刘焉': [3, '待'],
  '群|王允': [3, '待'],
  '群|许贡': [4, '待'],
  '群|淳于琼': [4, '待'],
  '群|邹氏': [3, '待'],
  '群|陈登': [3, '待'],
  '群|司马昭': [4, '定'],
  '群|马超': [4, '定'],
  '群|甘宁': [4, '定'],
  '群|黄月英': [3, '定'],
  '群|赵云': [4, '定'],
  // 同名跨势力的三个魏/蜀版
  '魏|庞德': [4, '定'],
  '魏|蔡文姬': [3, '定'],
  '魏|贾诩': [3, '定'],
  '魏|诸葛诞': [4, '定'],
  '魏|姜维': [4, '定'],
  '魏|文鸯': [4, '定'],
  // ── 晋 ──
  '晋|司马伷': [3, '待'],
  '晋|张虎&乐綝': [4, '待'],
  '晋|夏侯徽': [3, '待'],
  '晋|羊徽瑜': [3, '待'],
  '晋|石苞': [4, '待'],
}));

const VARIANT_PREFIX_RE = /^(⭐|转|梦|合|承|衰|兴|起)/;

/** 原表错字／异写：用户确认过的改名（键＝原表写法，值＝本作用法） */
const NAME_FIX = new Map(Object.entries({
  '缚彤': '傅肜',
}));

/** 名册里有卡、但三国杀数值与之不同：点名提醒，仍按本作名册填（不动在用的卡） */
const ROSTER_SS_NOTE = new Map(Object.entries({
  '群|董卓': 8,
}));

/** 我只有低把握、用户尚未确认的三国杀数值：不覆盖，只在核对页点名 */
const SS_CONFIRM_LATER = new Map(Object.entries({
  // 2026-10-25 用户已确认：晋·司马昭／杜预／司马炎都按 4 ⇒ 本条清空（三张都不在原表里，只影响名册）
}));

/** 查体力：返回 { hp, source, confidence }。source 会写进「体力核对」页。 */
function resolveHp(name, faction, rosterHp, referenceHp, ownHp) {
  if (ownHp != null) return { hp: ownHp, source: '原表写的数字', confidence: '定' };
  const key = `${faction}|${name}`;
  if (referenceHp.has(key)) return { hp: referenceHp.get(key), source: '权威参考表（将领数据_参考.xlsx）', confidence: '定' };
  if (rosterHp.has(key)) return { hp: rosterHp.get(key), source: '本作名册（同名同势力）', confidence: '定' };
  if (HP_TABLE.has(key)) {
    const [hp, conf] = HP_TABLE.get(key);
    return { hp, source: conf === '定' ? '三国杀常规体力' : '三国杀常规体力（推测）', confidence: conf };
  }
  const base = name.replace(VARIANT_PREFIX_RE, '').trim();
  if (base !== name) {
    const bkey = `${faction}|${base}`;
    if (referenceHp.has(bkey)) return { hp: referenceHp.get(bkey), source: `变体取本体「${base}」·权威参考表`, confidence: '定' };
    if (rosterHp.has(bkey)) return { hp: rosterHp.get(bkey), source: `变体取本体「${base}」·本作名册`, confidence: '定' };
    if (HP_TABLE.has(bkey)) {
      const [hp, conf] = HP_TABLE.get(bkey);
      return { hp, source: `变体取本体「${base}」·三国杀${conf === '定' ? '' : '（推测）'}`, confidence: conf };
    }
  }
  // 跨势力兜底：同一武将在别的势力下有数值（起孙坚→吴孙坚、承关羽→蜀关羽…）
  for (const [k, v] of referenceHp) {
    if (k.split('|')[1] === base) return { hp: v, source: `同武将别势力参考表「${base}」`, confidence: '定' };
  }
  for (const [k, v] of rosterHp) {
    if (k.split('|')[1] === base) return { hp: v, source: `同武将别势力名册「${base}」`, confidence: '定' };
  }
  for (const [k, v] of HP_TABLE) {
    if (k.split('|')[1] === base) return { hp: v[0], source: `同武将别势力三国杀「${base}」`, confidence: v[1] };
  }
  return { hp: null, source: '没查到', confidence: '缺' };
}

/**
 * 解析一格技能。返回 null 表示这一格不是技能（空/纯备注）。
 * 与项目 parseSkillCell 同口径，唯一扩展：分号「；」也算名与描述的分隔符
 * （原表真的用分号写过一次：「看破；…」）。
 */
function parseSkillCell(cell) {
  const text = String(cell ?? '').trim();
  if (!text) return null;

  let name = '';
  let desc = '';

  const quoted = text.match(/^[「『](.+?)[」』](.*)$/);
  if (quoted) {
    name = quoted[1].trim();
    desc = quoted[2].trim();
  } else {
    const m = text.match(/[：:；;]/);
    if (m) {
      name = text.slice(0, m.index).trim();
      desc = text.slice(m.index + 1).trim();
    } else {
      name = text;
    }
  }
  if (!name) return null;

  const tags = [];
  const addTag = (t) => { if (TAGS.includes(t) && !tags.includes(t)) tags.push(t); };

  // 名字里带 <锁定技、遗计技> 的写法（原表没有，留作兼容）
  const bracket = name.match(/^(.+?)[<＜《](.+?)[>＞》]$/);
  if (bracket) {
    name = bracket[1].trim();
    for (const t of splitTagList(bracket[2])) addTag(t);
  }

  // 描述开头连续几枚徽章：剥掉，连分隔符一起剥（与项目 parseSkillCell 同一正则）
  for (;;) {
    const hit = TAGS.find(t => desc.startsWith(t)
      && (desc.length === t.length || /^[，,。.、；;：:\-\s]/.test(desc.slice(t.length))));
    if (!hit) break;
    addTag(hit);
    desc = desc.slice(hit.length).replace(/^[，,。.、；;：:\-\s]+/, '').trim();
  }

  return { name, desc, tags };
}

/** 名字格清洗：去尾冒号、拆出体力、拆出双势力标注。 */
function cleanGeneralName(raw) {
  let name = String(raw ?? '').trim();
  const notes = [];
  let hp;

  name = name.replace(/[：:]\s*$/, '').trim();

  const hpMatch = name.match(/^(.*\S)\s+(\d{1,2})$/);
  if (hpMatch) {
    name = hpMatch[1].trim();
    hp = Number(hpMatch[2]);
    notes.push(`原表名字后写了体力 ${hp}`);
  }

  const facMatch = name.match(/^(.*\S)\s+([^\s/／]+)\s*[/／]\s*([^\s/／]+)$/);
  if (facMatch) {
    name = facMatch[1].trim();
    notes.push(`原表标注了双势力「${facMatch[2]}/${facMatch[3]}」，本行按所在工作表记`);
  }

  return { name, hp, notes };
}

async function main() {
  const fileBuffer = fs.readFileSync(inputPath);
  const wbXlsx = XLSX.read(fileBuffer, { type: 'buffer' });

  /** 本作名册的体力：同名同势力时以它为准（就是游戏里那张卡现在的数值） */
  const rosterHp = new Map();
  const generalsSrc = fs.readFileSync('G:\\THREE_KINGDOMS\\Qoder\\2.0\\src\\data\\generals.ts', 'utf8');
  for (const m of generalsSrc.matchAll(/createGeneral\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\d+)/g)) {
    rosterHp.set(`${m[3]}|${m[2]}`, Number(m[4]));
  }

  /** 权威参考表（H6：唯一准）里写了体力的将领，优先于名册与我的记忆 */
  const referenceHp = new Map();
  const referencePath = 'G:\\THREE_KINGDOMS\\将领数据_参考.xlsx';
  if (fs.existsSync(referencePath)) {
    const refWb = XLSX.read(fs.readFileSync(referencePath), { type: 'buffer' });
    const refRows = XLSX.utils.sheet_to_json(refWb.Sheets[refWb.SheetNames[0]], { header: 1 });
    for (const r of refRows.slice(1)) {
      const [refName, refFaction, refHp] = r || [];
      if (!refName || typeof refFaction !== 'string' || !Number.isFinite(Number(refHp))) continue;
      referenceHp.set(`${String(refFaction).trim()}|${String(refName).trim()}`, Number(refHp));
    }
  }

  /** key = 工作表|将领名 → { faction, hp, notes, skills[], rows[] } */
  const blocks = new Map();
  const blocked = []; // 没进「可导入」或进去但缺东西的，全列在第二页
  let cellTotal = 0;
  let skillTotal = 0;
  let noDescCount = 0;
  let sectionRows = 0;
  let emptyGeneralRows = 0;

  for (const sheetName of wbXlsx.SheetNames) {
    const faction = FACTION_MAP[sheetName];
    if (!faction) continue; // 「规则」页与认不出的页跳过
    const rows = XLSX.utils.sheet_to_json(wbXlsx.Sheets[sheetName], { header: 1 });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const rawName = String(row[0] ?? '').trim();
      if (!rawName) continue;
      const rowNo = i + 1;
      const cells = row.slice(1).map(c => (c == null ? '' : String(c).trim())).filter(Boolean);

      if (SECTION_TITLES.has(rawName) && cells.length === 0) { sectionRows++; continue; }

      if (cells.length === 0) {
        emptyGeneralRows++;
        blocked.push(['未导入', `${sheetName} 第${rowNo}行 ${rawName}`, rawName,
          '原表这一行只有将领名，没有填任何技能']);
        continue;
      }

      const { name: parsedName, hp, notes } = cleanGeneralName(rawName);
      const name = NAME_FIX.get(parsedName) ?? parsedName;
      if (name !== parsedName) notes.push(`原表写作「${parsedName}」，用户确认应为「${name}」，已改名`);
      const key = `${sheetName}|${name}`;
      if (!blocks.has(key)) {
        blocks.set(key, { sheetName, faction, name, hp, notes: [...notes], skills: [], rows: [rowNo], rawName });
      } else {
        const b = blocks.get(key);
        b.rows.push(rowNo);
        blocked.push(['已导入·需确认', `${sheetName} 第${rowNo}行 ${rawName}`, rawName,
          `同一张工作表里「${name}」出现了两次（第 ${b.rows.join('、')} 行），已把两处技能合并进同一段`]);
      }
      const block = blocks.get(key);

      for (const cell of cells) {
        cellTotal++;
        const parsed = parseSkillCell(cell);
        if (!parsed) continue;

        // 原表里的一句备注被写在了技能格里：没有分隔符、是一整句白话
        if (!parsed.desc && /[，。]/.test(parsed.name) && parsed.name.length > 10) {
          blocked.push(['未导入', `${sheetName} 第${rowNo}行 ${name}`, cell,
            '这一格不是技能，是原表的一句备注，没有当技能收进来']);
          continue;
        }

        block.skills.push(parsed);
        skillTotal++;
        if (!parsed.desc) {
          noDescCount++;
          blocked.push(['已导入·缺内容', `${sheetName} 第${rowNo}行 ${name}`, cell,
            `技能「${parsed.name}」只有名字，原表没写描述；导入后要你在编辑器里补`]);
        }
      }
    }
  }

  // ── 写文件 ──
  const workbook = new ExcelJS.Workbook();
  const importWs = workbook.addWorksheet('可导入');
  const failWs = workbook.addWorksheet('转换失败');

  const EFFECT_GROUP = [
    '标注', '触发', '效果类型', '数值', '目标', '描述', '门槛',
    '我听谁', '改哪个数', '怎么改', '有效周期', '获得哪个技能',
  ];
  const headers = [
    '将领名称', '势力', '体力', '近战', '远程',
    '技能名称', '技能标签', '强制发动', '触发时机', '效果模式',
    '技能描述', '技能门槛', '我听谁',
    ...EFFECT_GROUP.map(h => `效果1${h}`),
    '设定备注',
  ];
  const hdr = importWs.addRow(headers);
  hdr.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFD700' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D1B0E' } };
  });

  const failHdr = failWs.addRow(['类型', '位置', '原文', '说明']);
  failHdr.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFD700' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D1B0E' } };
  });

  let rowCount = 0;

  /** 体力核对页：每张卡一行，标出这个数字是从哪儿来的、有没有把握 */
  const hpLedger = [];
  const hpCounts = { '原表写的数字': 0, '权威参考表（将领数据_参考.xlsx）': 0, '本作名册（同名同势力）': 0, '三国杀常规体力': 0, '三国杀常规体力（推测）': 0, '其他': 0 };
  const hpDivergences = [];

  for (const b of blocks.values()) {
    if (b.skills.length === 0) continue;

    const hpInfo = resolveHp(b.name, b.faction, rosterHp, referenceHp, b.hp);
    let hpSource = hpInfo.source;
    let hpConfidence = hpInfo.confidence;
    const ssValue = HP_TABLE.get(`${b.faction}|${b.name}`);
    const ssRosterNote = ROSTER_SS_NOTE.get(`${b.faction}|${b.name}`);
    const laterNote = SS_CONFIRM_LATER.get(`${b.faction}|${b.name}`);
    if (ssValue && ssValue[0] !== hpInfo.hp) {
      hpSource = `${hpSource}（三国杀是 ${ssValue[0]}）`;
      hpDivergences.push(`${b.faction}${b.name}：本作 ${hpInfo.hp} / 三国杀 ${ssValue[0]}`);
    } else if (ssRosterNote != null && ssRosterNote !== hpInfo.hp) {
      hpSource = `${hpSource}（三国杀是 ${ssRosterNote}）`;
      hpDivergences.push(`${b.faction}${b.name}：本作 ${hpInfo.hp} / 三国杀 ${ssRosterNote}`);
    }
    if (laterNote != null && laterNote !== hpInfo.hp) {
      hpSource = `${hpSource}（三国杀可能是 ${laterNote}，等你确认）`;
      hpConfidence = '待';
      hpDivergences.push(`${b.faction}${b.name}：暂用 ${hpInfo.hp} / 三国杀可能是 ${laterNote}（待你确认）`);
    }
    hpLedger.push([b.faction, b.name, hpInfo.hp ?? '', hpSource, hpConfidence]);
    if (hpInfo.source === '原表写的数字') hpCounts['原表写的数字']++;
    else if (hpInfo.source === '权威参考表（将领数据_参考.xlsx）') hpCounts['权威参考表（将领数据_参考.xlsx）']++;
    else if (hpInfo.source === '本作名册（同名同势力）') hpCounts['本作名册（同名同势力）']++;
    else if (hpInfo.source === '三国杀常规体力') hpCounts['三国杀常规体力']++;
    else if (hpInfo.source === '三国杀常规体力（推测）') hpCounts['三国杀常规体力（推测）']++;
    else hpCounts['其他']++;

    const notes = [...b.notes];
    if (b.hp == null) notes.push(`体力 ${hpInfo.hp ?? '（没查到）'}：${hpSource}，把握=${hpConfidence}`);
    if (VARIANT_RE.test(b.rawName)) {
      notes.push(`原表名字「${b.rawName}」带异画/变体记号，游戏名册里没有这一张：按原名导入会新建一张卡；若要覆盖原武将，请在导入时选「挂到现有将领上」`);
      blocked.push(['已导入·需确认', `${b.sheetName} ${b.name}`, b.rawName,
        '异画/变体卡：游戏名册里没有同名将领，导入时会让你选「新建」还是「挂到现有将领上」']);
    }

    b.skills.forEach((sk, idx) => {
      const first = idx === 0;
      importWs.addRow([
        first ? b.name : '',
        first ? b.faction : '',
        first ? (hpInfo.hp ?? '') : '',
        '',                // 近战：原表没有这一列，留空＝不改现有卡、新卡按体力推默认值
        '',                // 远程：同上
        sk.name,
        sk.tags.length > 0 ? sk.tags.join('、') : '无',
        '否',
        '无',
        '',                // 效果模式：没有结构化效果，留空
        sk.desc,
        '',                // 技能门槛
        '',                // 我听谁
        ...EFFECT_GROUP.map(() => ''),
        first ? notes.join('；') : '',
      ]);
      rowCount++;
    });
  }

  for (const r of blocked) failWs.addRow(r);
  failWs.columns = [{ width: 16 }, { width: 34 }, { width: 60 }, { width: 76 }];
  importWs.columns = [{ width: 14 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 },
    { width: 14 }, { width: 16 }, { width: 8 }, { width: 10 }, { width: 10 }, { width: 70 }];

  // ── 体力核对页：没把握的排最前，方便逐条看一眼 ──
  const HP_RANK = { '缺': 0, '待': 1, '定': 2 };
  hpLedger.sort((a, b) => (HP_RANK[a[4]] ?? 3) - (HP_RANK[b[4]] ?? 3));
  const hpWs = workbook.addWorksheet('体力核对');
  const hpHdr = hpWs.addRow(['势力', '将领名称', '体力', '这个数字从哪儿来', '把握']);
  hpHdr.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFD700' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D1B0E' } };
  });
  for (const r of hpLedger) {
    const row = hpWs.addRow(r);
    if (r[4] !== '定') row.getCell(5).font = { color: { argb: 'FFC0392B' }, bold: true };
  }
  hpWs.columns = [{ width: 6 }, { width: 16 }, { width: 6 }, { width: 46 }, { width: 6 }];
  hpWs.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await workbook.xlsx.writeBuffer();
  fs.writeFileSync(outputPath, buf);

  console.log(`✅ 已生成：${outputPath}`);
  console.log(`   可导入：${rowCount} 行技能（${blocks.size} 张将领卡）`);
  console.log(`   转换失败：${blocked.length} 条待看`);
  console.log(`   实测：技能格 ${cellTotal} 个 → 收进 ${skillTotal} 条技能`);
  console.log(`   跳过章节标题行 ${sectionRows} 行；只有名字没有技能的行 ${emptyGeneralRows} 行`);
  console.log(`   只有技能名、没有描述 ${noDescCount} 条`);
  console.log(`   体力取数：原表 ${hpCounts['原表写的数字']} / 参考表 ${hpCounts['权威参考表（将领数据_参考.xlsx）']} / ` +
    `本作名册 ${hpCounts['本作名册（同名同势力）']} / ` +
    `三国杀有把握 ${hpCounts['三国杀常规体力']} / 三国杀推测 ${hpCounts['三国杀常规体力（推测）']} / 其他 ${hpCounts['其他']}`);
  console.log(`   没查到体力的卡：${hpLedger.filter(r => r[4] === '缺').length} 张`);
  if (hpDivergences.length > 0) {
    console.log(`   本作名册与三国杀数值不同的 ${hpDivergences.length} 张（已在「体力核对」页注明）：`);
    for (const d of hpDivergences) console.log(`     · ${d}`);
  }
}

main().catch(err => {
  console.error('❌ 生成失败:', err);
  process.exit(1);
});
