/**
 * v2.9.12 内容包 · 装包核对判据。
 * 这一份钉的是契约里最硬的两句：
 *  「绝不悄悄装一半」⇒ 有任何一条不合格，install 必须是空数组（不是"好的先装"）；
 *  「装不上＝说清为什么」⇒ 逐条点名＋整包一句话，两条都要有证人。
 * 另外钉住"外来文件不能冒充官方"与"不能把官方卡装成自制的"，
 * 因为包文件是别人发过来的，写进本机的东西必须过自己这一关。
 */
import { describe, it, expect } from 'vitest';
import { allGenerals, type General } from '../data/generals';
import { createAuthoredGeneral } from '../domain/generalProvenance';
import { DIY_PACK_FORMAT, DIY_PACK_KIND, buildDiyPack, packFingerprint, parseDiyPack } from './contentPack';
import { planInstall } from './installPack';

function diy(name: string, over: Partial<General> = {}): General {
  const created = createAuthoredGeneral(
    { name, faction: '蜀', hp: 4, identity: name, skills: [{ name: `${name}技`, description: '试验' }] },
    'DIY',
  );
  if (!created.ok) throw new Error(`setup failed: ${created.reason}`);
  return { ...created.general, ...over };
}

/** 走完整一遍：打包 → 读包 → 核对（用真文件形态，不喂合成对象——合成输入钉的是解析器，不是判据）。 */
function installFrom(cards: General[], existing: General[] = []) {
  const read = parseDiyPack(buildDiyPack(cards).text);
  return { read, plan: planInstall(read, { existingAuthored: existing }) };
}

/**
 * 伪造一份"文件自己说自己是好的"包：指纹按伪造内容现算，所以读包这关过得去，
 * 逼安装这一关自己把谎话抓出来。写出面本来会筛掉这些记录，但包文件是从别人手里
 * 接过来的，不能指望发件人那边守规矩。
 */
function installFromForged(cards: unknown[], existing: General[] = []) {
  const text = JSON.stringify({
    header: {
      kind: DIY_PACK_KIND, format: DIY_PACK_FORMAT, origin: 'DIY',
      exportedAt: '2026-10-18T08:00:00.000Z', createdWithApp: 'test',
      count: cards.length, fingerprint: packFingerprint(cards as General[]),
    },
    generals: cards,
  }, null, 2);
  const read = parseDiyPack(text);
  if (!read.ok) throw new Error(`伪造包本该过读包这关：${JSON.stringify(read.problems)}`);
  return { read, plan: planInstall(read, { existingAuthored: existing }) };
}

describe('装包：合格就整包装上', () => {
  it('两张都没见过的卡 ⇒ 装上两张，逐条写"合格，装上"', () => {
    const a = diy('张三'), b = diy('李四');
    const { plan } = installFrom([a, b]);
    expect(plan.ok).toBe(true);
    expect(plan.install.map(g => g.name)).toEqual(['张三', '李四']);
    expect(plan.headline).toContain('装上 2 张');
    expect(plan.lines.every(l => l.why === '合格，装上')).toBe(true);
  });

  it('装进去的卡与导出时逐字一样（编号不重新发、技能不被改写）', () => {
    const a = diy('张三');
    const { plan } = installFrom([a]);
    expect(plan.ok).toBe(true);
    expect(plan.install[0]).toEqual(a);
    expect(plan.install[0].id).toBe(a.id);
  });

  it('落库前把已知字段名筛一遍：包里的野字段进不了本机存档', () => {
    const smelly = { ...diy('张三'), evilKey: '别跟过来', skills: [{ name: '张三技', evilInner: 1 }] } as unknown as General;
    const { plan } = installFrom([smelly]);
    expect(plan.ok).toBe(true);
    expect('evilKey' in plan.install[0]).toBe(false);
    expect('evilInner' in (plan.install[0].skills[0] as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('装包：绝不半装', () => {
  it('一张势力写着野值 ⇒ 整包 install 是空数组，另一张好的也不装', () => {
    const good = diy('张三');
    const bad = diy('野势力将', { faction: '神' as never });
    const { plan } = installFrom([good, bad]);
    expect(plan.ok).toBe(false);
    expect(plan.install).toHaveLength(0);
    expect(plan.headline).toContain('一张也没有');
    const line = plan.lines.find(l => l.name === '野势力将')!;
    expect(line.verdict).toBe('refuse');
    expect(line.why).toContain('不是本程序认的字');
    expect(plan.lines.find(l => l.name === '张三')!.verdict).toBe('install');
  });

  it('体力、类型、攻击、护甲、技能清单这几格各错一次 ⇒ 每次都是一张也不装，理由点名到那张', () => {
    const broken: Array<[Partial<General>, string]> = [
      [{ hp: 0 }, '不是正数'],
      [{ hp: '四' as never }, '不是正数'],
      [{ type: '谋将' as never }, '类型'],
      [{ meleeAtk: -1 }, 'meleeAtk'],
      [{ rangedAtk: '二' as never }, 'rangedAtk'],
      [{ armor: null as never }, 'armor'],
      [{ skills: '一张嘴' as never }, '技能那一段'],
      [{ skills: [{ description: '没名字的技能' }] as never }, '没有技能名'],
      [{ skills: [{ name: '野徽章', tags: ['无敌技'] as never }] as never }, '没有的徽章'],
      [{ skills: [{ name: '野效果', effects: '不是清单' as never }] as never }, '效果那一段'],
      [{ skills: [{ name: '野门槛', conditions: '不是清单' as never }] as never }, '门槛那一段'],
      [{ skills: [{ name: '野触发', trigger: 3 as never }] as never }, '触发时机'],
      [{ identity: 7 as never }, '身份那一格'],
    ];
    for (const [over, expectWhy] of broken) {
      const { plan } = installFrom([diy('陪跑的将'), diy('坏将', over)]);
      expect(plan.ok, JSON.stringify(over)).toBe(false);
      expect(plan.install, JSON.stringify(over)).toHaveLength(0);
      expect(plan.lines.find(l => l.name === '坏将')!.why).toContain(expectWhy);
    }
  });

  it('文件本身读不通时也是一张不装，并把文件级的说法原样带给界面', () => {
    const read = parseDiyPack('这不是 JSON');
    const plan = planInstall(read, { existingAuthored: [] });
    expect(plan.ok).toBe(false);
    expect(plan.install).toHaveLength(0);
    expect(plan.lines).toHaveLength(0);
    expect(plan.headline).toContain('不是可读的 JSON');
  });
});

describe('装包：不许覆盖本机已有的卡', () => {
  it('同编号且一模一样 ⇒ "已经有了"，跳过但不算失败', () => {
    const a = diy('张三');
    const { plan } = installFrom([a], [a]);
    expect(plan.ok).toBe(false);
    expect(plan.install).toHaveLength(0);
    expect(plan.headline).toContain('已经有了');
    expect(plan.lines[0].verdict).toBe('already');
  });

  it('同编号但内容不一样 ⇒ 整包拒绝，绝不动本机那张', () => {
    const mine = diy('张三', { hp: 5 });
    const theirs = { ...mine, hp: 3 };
    const { plan } = installFrom([theirs, diy('别的将')], [mine]);
    expect(plan.ok).toBe(false);
    expect(plan.install).toHaveLength(0);
    const line = plan.lines.find(l => l.id === theirs.id)!;
    expect(line.verdict).toBe('refuse');
    expect(line.why).toContain('不会覆盖');
  });

  it('本机那张只是字段书写顺序不同 ⇒ 仍然认成"一模一样"，不误报冲突', () => {
    const a = diy('张三');
    const reshuffled = JSON.parse(JSON.stringify({ skills: a.skills, id: a.id, name: a.name, faction: a.faction, hp: a.hp, type: a.type, meleeAtk: a.meleeAtk, rangedAtk: a.rangedAtk, armor: a.armor, identity: a.identity, source: a.source })) as General;
    const { plan } = installFrom([reshuffled], [a]);
    expect(plan.lines[0].verdict).toBe('already');
  });

  it('包里同一张出现两遍且一模一样 ⇒ 按一份装；两遍内容不一样 ⇒ 整包不装', () => {
    const a = diy('张三');
    const twice = installFrom([a, { ...a }]);
    expect(twice.plan.ok).toBe(true);
    expect(twice.plan.install).toHaveLength(1);
    expect(twice.plan.lines[1].why).toContain('出现了两遍');

    const conflict = installFrom([a, { ...a, hp: 1 }]);
    expect(conflict.plan.ok).toBe(false);
    expect(conflict.plan.install).toHaveLength(0);
    expect(conflict.plan.lines[1].why).toContain('我不能替你猜');
  });
});

describe('装包：外来文件不能冒充别的东西', () => {
  it('包里塞官方名册的卡 ⇒ 逐条拒，理由是编号不在玩家自制名下', () => {
    const official = { ...allGenerals[0], source: 'DIY' as const };
    const { plan } = installFromForged([official, diy('张三')]);
    expect(plan.ok).toBe(false);
    expect(plan.install).toHaveLength(0);
    expect(plan.lines[0].why).toContain('D- 名下');
  });

  it('编号是 D- 但来源写官方 ⇒ 拒：编号与来源必须成对', () => {
    const lying = { ...diy('张三'), source: 'official' as const };
    const { plan } = installFromForged([lying]);
    expect(plan.ok).toBe(false);
    expect(plan.lines[0].verdict).toBe('refuse');
    expect(plan.lines[0].why).toContain('来源');
  });

  it('没有将名 ⇒ 拒，并且界面仍然能指出是第几条', () => {
    const nameless = { ...diy('张三'), name: '  ' };
    const { plan } = installFromForged([nameless]);
    expect(plan.ok).toBe(false);
    expect(plan.lines[0].name).toBe('（没有将名）');
    expect(plan.lines[0].why).toContain('缺了认账要用的字段');
  });

  it('整条不是个记录（数组里塞了个数字）⇒ 拒并报第几条，不崩', () => {
    const { plan } = installFromForged([diy('张三'), 42]);
    expect(plan.ok).toBe(false);
    expect(plan.install).toHaveLength(0);
    expect(plan.lines[1].name).toBe('（没有将名）');
    expect(plan.lines[1].why).toContain('不是一个将领记录');
  });
});
