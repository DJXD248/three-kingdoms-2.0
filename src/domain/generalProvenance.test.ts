/**
 * v2.8.5 内容层地基刀1：将领记录的来源与不变量（契约 = ARCH_MAP §H1/§H2）。
 * 冻结集合是 {id, source} 两个，identity 属可编辑内容字段（用户 2026-09-28 更正）。
 */
import { describe, it, expect } from 'vitest';
import { allGenerals } from '../data/generals';
import {
  DIY_ID_PREFIX,
  FROZEN_GENERAL_FIELDS,
  OFFICIAL_DRAFT_ID_PREFIX,
  createAuthoredGeneral,
  frozenFieldWrites,
  idNamespace,
  isAcceptableAuthoredRecord,
  isAuthoredId,
  isRepositoryOfficial,
  sourceOf,
  stripFrozenFields,
} from './generalProvenance';

const baseInput = { name: '测试将', faction: '蜀' as const, hp: 4 };
const fixedId = () => '00000000-0000-4000-8000-000000000001';

describe('frozen set (§H1)', () => {
  it('冻结的就是 id 与 source 两个字段，identity 不在其中', () => {
    expect([...FROZEN_GENERAL_FIELDS].sort()).toEqual(['id', 'source']);
    expect(FROZEN_GENERAL_FIELDS).not.toContain('identity');
  });

  it('任何改动补丁里出现冻结字段都要被点名并报出来，不许静默吃掉', () => {
    expect(frozenFieldWrites({ id: 'wei_001', source: 'DIY', hp: 3 })).toEqual(['id', 'source']);
    expect(frozenFieldWrites({ hp: 3, identity: '孙策' })).toEqual([]);
    const { clean, rejected } = stripFrozenFields({ id: 'wei_001', source: 'DIY', name: '关羽', identity: '云长' });
    expect(rejected).toEqual(['id', 'source']);
    expect(clean).toEqual({ name: '关羽', identity: '云长' });
  });
});

describe('two layers of official (§H2)', () => {
  it('无 source 字段＝按官方对待（更严的一侧），仓库档案另判', () => {
    expect(sourceOf({})).toBe('official');
    expect(sourceOf({ source: 'DIY' })).toBe('DIY');
    expect(isRepositoryOfficial(allGenerals[0])).toBe(true);
  });

  it('仓库 95 将一律 legacy 命名空间 ⇒ 本地新建永不撞号', () => {
    for (const g of allGenerals) {
      expect(idNamespace(g.id)).toBe('legacy');
      expect(isAuthoredId(g.id)).toBe(false);
    }
  });

  it('新建记录的命名空间随来源走：official→G-，DIY→D-', () => {
    const draft = createAuthoredGeneral(baseInput, 'official', fixedId);
    const diy = createAuthoredGeneral(baseInput, 'DIY', fixedId);
    expect(draft.ok && draft.general.id.startsWith(OFFICIAL_DRAFT_ID_PREFIX)).toBe(true);
    expect(diy.ok && diy.general.id.startsWith(DIY_ID_PREFIX)).toBe(true);
    expect(isRepositoryOfficial(diy.ok ? diy.general : allGenerals[0])).toBe(false);
  });
});

describe('createAuthoredGeneral (§H1 唯一发号口)', () => {
  it('创建时把身份显式写进数据：未填＝当刻的名字，填了＝就用那个', () => {
    const implicit = createAuthoredGeneral(baseInput, 'DIY', fixedId);
    const explicit = createAuthoredGeneral({ ...baseInput, identity: '测试身份' }, 'DIY', fixedId);
    expect(implicit.ok && implicit.general.identity).toBe('测试将');
    expect(explicit.ok && explicit.general.identity).toBe('测试身份');
  });

  it('显式留空＝无身份（永不锁），不会被悄悄补成名字', () => {
    const none = createAuthoredGeneral({ ...baseInput, identity: '' }, 'DIY', fixedId);
    expect(none.ok && none.general.identity).toBe('');
  });

  it('名字与身份是两回事：同名允许，靠身份区分', () => {
    const a = createAuthoredGeneral({ ...baseInput, identity: '甲' }, 'DIY', fixedId);
    const b = createAuthoredGeneral({ ...baseInput, identity: '乙' }, 'DIY', () => '00000000-0000-4000-8000-000000000002');
    expect(a.ok && b.ok && a.general.name === b.general.name).toBe(true);
    expect(a.ok && b.ok && a.general.id === b.general.id).toBe(false);
    expect(a.ok && b.ok && a.general.identity !== b.general.identity).toBe(true);
  });

  it('武将/文将数值沿用建卡口径（体力≥4 为武将）', () => {
    const warrior = createAuthoredGeneral({ ...baseInput, hp: 4 }, 'DIY', fixedId);
    const scholar = createAuthoredGeneral({ ...baseInput, hp: 3 }, 'DIY', fixedId);
    expect(warrior.ok && [warrior.general.type, warrior.general.meleeAtk, warrior.general.rangedAtk]).toEqual(['武将', 2, 1]);
    expect(scholar.ok && [scholar.general.type, scholar.general.meleeAtk, scholar.general.rangedAtk]).toEqual(['文将', 1, 2]);
  });

  it('拒发号并报原因：空名 / 非法体力 / 本机没有编号源，三种都留痕', () => {
    expect(createAuthoredGeneral({ ...baseInput, name: '   ' }, 'DIY', fixedId)).toEqual({ ok: false, reason: 'NAME_REQUIRED' });
    expect(createAuthoredGeneral({ ...baseInput, hp: 0 }, 'DIY', fixedId)).toEqual({ ok: false, reason: 'HP_INVALID' });
    expect(createAuthoredGeneral({ ...baseInput, hp: NaN }, 'DIY', fixedId)).toEqual({ ok: false, reason: 'HP_INVALID' });
    expect(createAuthoredGeneral(baseInput, 'DIY', () => undefined as unknown as string))
      .toEqual({ ok: false, reason: 'ID_SOURCE_UNAVAILABLE' });
  });

  it('真实编号源可用时两个新建各得唯一号（不依赖注入也要成立）', () => {
    const first = createAuthoredGeneral(baseInput, 'DIY');
    const second = createAuthoredGeneral(baseInput, 'DIY');
    expect(first.ok && second.ok && first.general.id !== second.general.id).toBe(true);
  });
});

describe('isAcceptableAuthoredRecord（本地存档准入）', () => {
  const created = createAuthoredGeneral(baseInput, 'DIY', fixedId);
  if (!created.ok) throw new Error('fixture failed to mint an id');
  const ok = created.general;

  it('合法自建记录放行', () => {
    expect(isAcceptableAuthoredRecord(ok)).toBe(true);
  });

  it('仓库档案号冒充自建＝拒（本地清单永不遮蔽官方将）', () => {
    expect(isAcceptableAuthoredRecord({ ...ok, id: allGenerals[0].id })).toBe(false);
  });

  it('号与来源不匹配＝拒（G- 配 DIY、D- 配 official 都算损坏）', () => {
    expect(isAcceptableAuthoredRecord({ ...ok, id: `${OFFICIAL_DRAFT_ID_PREFIX}x`, source: 'DIY' })).toBe(false);
    expect(isAcceptableAuthoredRecord({ ...ok, id: `${DIY_ID_PREFIX}x`, source: 'official' })).toBe(false);
  });

  it('缺来源 / 缺名字 / 非对象＝拒', () => {
    expect(isAcceptableAuthoredRecord({ ...ok, source: undefined })).toBe(false);
    expect(isAcceptableAuthoredRecord({ ...ok, name: '  ' })).toBe(false);
    expect(isAcceptableAuthoredRecord(null)).toBe(false);
    expect(isAcceptableAuthoredRecord('wei_001')).toBe(false);
  });
});
