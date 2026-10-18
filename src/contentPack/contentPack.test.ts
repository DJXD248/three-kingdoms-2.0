/**
 * v2.9.12 内容包 · 打包与读包判据。
 * 钉的是契约里"包自带指纹与来源标记"＋"装不上＝说清为什么"的前半段：
 * 文件本身好不好，跟卡合不合格是两步，这里只管第一步。
 * 特别注意 **改过一个字的那份必须被抓**（下面的 tamper 用例），
 * 因为用户手里的文件是别人发过来的，中间可能被传坏、也可能被手改。
 */
import { describe, it, expect } from 'vitest';
import pkg from '../../package.json';
import { allGenerals, type General } from '../data/generals';
import { createAuthoredGeneral } from '../domain/generalProvenance';
import {
  DIY_PACK_FORMAT,
  DIY_PACK_KIND,
  MAX_PACK_GENERALS,
  buildDiyPack,
  packFileName,
  packFingerprint,
  parseDiyPack,
  selectPackableGenerals,
  stableText,
} from './contentPack';

function diy(name: string, hp = 4): General {
  const created = createAuthoredGeneral({ name, faction: '蜀', hp, identity: name, skills: [{ name: '试验技' }] }, 'DIY');
  if (!created.ok) throw new Error(`setup failed: ${created.reason}`);
  return created.general;
}

/** 把包里某一张的某个字段改掉（模拟"传坏/手改"），指纹必须翻脸。 */
function tamper(text: string, from: string, to: string): string {
  expect(text.includes(from)).toBe(true);
  return text.replace(from, to);
}

describe('内容包：打包', () => {
  it('包头部写清来源标记、张数、指纹与出自哪个版本', () => {
    const { pack } = buildDiyPack([diy('张三'), diy('李四')], { exportedAt: new Date('2026-10-18T08:00:00Z') });
    expect(pack.header.kind).toBe(DIY_PACK_KIND);
    expect(pack.header.format).toBe(DIY_PACK_FORMAT);
    expect(pack.header.origin).toBe('DIY');
    expect(pack.header.count).toBe(2);
    expect(pack.header.createdWithApp).toBe(pkg.version);
    expect(pack.header.exportedAt).toBe('2026-10-18T08:00:00.000Z');
    expect(pack.header.fingerprint).toBe(packFingerprint(pack.generals));
  });

  it('官方卡与非 DIY 记录进不了包：筛子先落在写出面', () => {
    const officialDraft = createAuthoredGeneral({ name: '官方草稿将', faction: '魏', hp: 4 }, 'official');
    expect(officialDraft.ok).toBe(true);
    if (!officialDraft.ok) return;
    const pool = [allGenerals[0], officialDraft.general, diy('真正的自制将')];
    expect(selectPackableGenerals(pool).map(g => g.name)).toEqual(['真正的自制将']);
    const { pack } = buildDiyPack(pool);
    expect(pack.generals).toHaveLength(1);
  });

  it('文件名带日期、张数与指纹前段（一眼认出是不是同一份）', () => {
    const cards = [diy('张三')];
    const name = packFileName(cards, packFingerprint(cards), new Date('2026-10-18T08:00:00Z'));
    expect(name).toMatch(/^玩家自制将领包_2026-10-18_1张_[0-9a-f]{6}\.tkdiy\.json$/);
  });

  it('指纹只认内容：同一批同顺序必相等；换了记录顺序就是另一份文件', () => {
    const cards = [diy('张三'), diy('李四')];
    const a = buildDiyPack(cards, { exportedAt: new Date('2026-10-18T08:00:00Z') });
    const b = buildDiyPack([...cards].reverse(), { exportedAt: new Date('2026-10-19T08:00:00Z') });
    // 记录顺序是内容的一部分：换了顺序＝另一份文件，抓得住才叫指纹
    expect(a.pack.header.fingerprint).not.toBe(b.pack.header.fingerprint);
    expect(a.pack.header.fingerprint).toBe(buildDiyPack(cards).pack.header.fingerprint);
  });
});

describe('内容包：读包', () => {
  it('自己导出的包原样读回：内容与张数逐字回来', () => {
    const cards = [diy('张三'), diy('李四', 3)];
    const { text } = buildDiyPack(cards);
    const read = parseDiyPack(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.generals).toEqual(cards);
    expect(read.pack.header.count).toBe(2);
  });

  it('换个排版（压成一行）再读，指纹照样认：比的是内容不是字节', () => {
    const { pack } = buildDiyPack([diy('张三')]);
    const minified = JSON.stringify(pack);
    expect(minified).not.toBe(JSON.stringify(pack, null, 2));
    const read = parseDiyPack(minified);
    expect(read.ok).toBe(true);
  });

  it('键的写入顺序换了不算改内容（stableText 排字典序，摘要只认语义）', () => {
    expect(stableText({ a: 1, b: [2, 3] })).toBe(stableText({ b: [2, 3], a: 1 }));
    expect(stableText({ a: 1, b: 2 })).not.toBe(stableText({ a: 1, b: 3 }));
  });

  const cases: Array<[string, string, (text: string) => string, string]> = [
    ['空文件', 'EMPTY_FILE', () => '   ', '文件是空的'],
    ['不是 JSON', 'NOT_JSON', () => '这不是JSON{{{', '不是可读的 JSON'],
    ['别的软件的文件', 'NOT_A_PACK_FILE', () => JSON.stringify({ header: { kind: 'other-app' }, generals: [] }), '不是本项目的将领内容包'],
    ['没有清单', 'NO_GENERALS', (t) => t.replace('"generals": [', '"generalsX": ['), '没有将领清单'],
    ['空包', 'NO_GENERALS', () => JSON.stringify({ header: { kind: DIY_PACK_KIND, format: 1, generals: [] }, generals: [] }), '这个包是空的'],
    ['超上限', 'TOO_MANY', () => JSON.stringify({ header: { kind: DIY_PACK_KIND, format: 1 }, generals: Array.from({ length: MAX_PACK_GENERALS + 1 }, () => ({})) }), '超过一个包的上限'],
    ['新格式不硬猜', 'NEWER_FORMAT', (t) => t.replace(`"format": ${DIY_PACK_FORMAT}`, '"format": 99'), '本程序更新版本导出的'],
    ['张数被改', 'COUNT_MISMATCH', (t) => t.replace('"count": 2', '"count": 3'), '头部写着 3 张'],
    ['卡面被改过一个字', 'FINGERPRINT_MISMATCH', (t) => tamper(t, '"name": "张三"', '"name": "张四"'), '与指纹对不上'],
  ];

  for (const [label, code, mutate, expectText] of cases) {
    it(`${label} ⇒ 拒读并说清（${code}）`, () => {
      const base = buildDiyPack([diy('张三'), diy('李四')]).text;
      const read = parseDiyPack(mutate(base));
      expect(read.ok).toBe(false);
      if (read.ok) return;
      expect(read.problems[0].code).toBe(code);
      expect(read.problems[0].detail).toContain(expectText);
    });
  }

  it('文件里既改了张数又改了卡面 ⇒ 两条一起报，不挑一条说话', () => {
    const base = buildDiyPack([diy('张三'), diy('李四')]).text;
    const broken = tamper(tamper(base, '"count": 2', '"count": 1'), '"name": "张三"', '"name": "张四"');
    const read = parseDiyPack(broken);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems.map(p => p.code).sort()).toEqual(['COUNT_MISMATCH', 'FINGERPRINT_MISMATCH']);
  });
});
