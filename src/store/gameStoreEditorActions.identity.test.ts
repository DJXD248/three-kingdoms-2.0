/**
 * v2.8.0 身份管理注册表 CRUD (D1 保守方案):
 * 新建去重、改名级联引用者、删被引用身份=拒删+列出引用者、
 * 旧 generalEdits 无 identity 字段=零迁移直接兼容（缺省派生自名字）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { allGenerals } from '../data/generals';
import type { General } from '../data/generals';

const guanYu = allGenerals.find(g => g.name === '关羽' && g.faction === '蜀')!;
const other = allGenerals.find(g => g.faction === '魏')!;

describe('identity registry CRUD', () => {
  beforeEach(() => {
    useGameStore.setState({
      // §H3: 本文件全部案例都在动官方将的差异层，须在开发者模式会话内。
      developerMode: true,
      identityRegistry: [],
      generalEdits: {},
      skillEdits: {},
    } as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  it('addIdentity: 去空、去重、trim 入库', () => {
    const { addIdentity } = useGameStore.getState();
    expect(addIdentity('  ')).toBe(false);
    expect(addIdentity(' 赵云 ')).toBe(true);
    expect(useGameStore.getState().identityRegistry).toEqual(['赵云']);
    expect(addIdentity('赵云')).toBe(false);
  });

  it('renameIdentity: 级联更新引用该身份的将领编辑', () => {
    useGameStore.setState({
      identityRegistry: ['甲身份'],
      generalEdits: { [other.id]: { identity: '甲身份', hp: 5 } },
    } as never);
    const { renameIdentity } = useGameStore.getState();
    expect(renameIdentity('不存在', '乙')).toBe(false);
    expect(renameIdentity('甲身份', ' ')).toBe(false);
    expect(renameIdentity('甲身份', '乙身份')).toBe(true);
    expect(useGameStore.getState().identityRegistry).toEqual(['乙身份']);
    expect(useGameStore.getState().generalEdits[other.id]).toEqual({ identity: '乙身份', hp: 5 });
  });

  it('deleteIdentity: 显式引用者挡删除并列出名单', () => {
    useGameStore.setState({
      identityRegistry: ['关二爷'],
      generalEdits: { [guanYu.id]: { identity: '关二爷' } },
    } as never);
    const result = useGameStore.getState().deleteIdentity('关二爷');
    expect(result.ok).toBe(false);
    expect(result.referrers).toContain('关羽');
    expect(useGameStore.getState().identityRegistry).toEqual(['关二爷']);
  });

  it('deleteIdentity: 官方派生身份（名字同名）同样不可删', () => {
    useGameStore.getState().addIdentity('关羽');
    const result = useGameStore.getState().deleteIdentity('关羽');
    expect(result.ok).toBe(false);
    expect(result.referrers).toContain(guanYu.name);
  });

  it('deleteIdentity: 无引用可删；显式空身份不算引用', () => {
    useGameStore.setState({
      identityRegistry: ['游离身份'],
      generalEdits: { [other.id]: { identity: '' } },
    } as never);
    expect(useGameStore.getState().deleteIdentity('游离身份').ok).toBe(true);
    expect(useGameStore.getState().identityRegistry).toEqual([]);
  });

  it('getGeneralWithEdits: 旧档（无 identity 键）零迁移，官方派生身份=名字', () => {
    const merged = useGameStore.getState().getGeneralWithEdits(guanYu as General);
    expect(merged.identity).toBeUndefined();
    // 显式 '' 必须存活合并（不能被真值判断吞掉）
    useGameStore.setState({ generalEdits: { [guanYu.id]: { identity: '' } } } as never);
    expect(useGameStore.getState().getGeneralWithEdits(guanYu as General).identity).toBe('');
  });
});
