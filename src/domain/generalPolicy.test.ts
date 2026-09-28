/**
 * §H3 判定根（地基刀2）：三层共用的「这张卡现在能不能被改」。
 * 判据只有一条来源＝编号命名空间（legacy＝仓库账本官方卡），权限只决定
 * legacy 那一半；自建记录（`G-` 与 `D-` 两号段）在任何会话都可改。
 */
import { describe, it, expect } from 'vitest';
import { allGenerals } from '../data/generals';
import {
  denialMessage,
  isReadOnlyGeneral,
  mayModifyGeneral,
  partitionEditMap,
  partitionIdSet,
} from './generalPolicy';

const ledgerId = allGenerals[0].id;          // 'wei_001' 式仓库档案号
const draftId = 'G-00000000-0000';           // 开发者模式本地官方草稿
const diyId = 'D-00000000-0000';             // 玩家自建

const DEV = { developerMode: true };
const PLAYER = { developerMode: false };

describe('generalPolicy: 单一判定根', () => {
  it('仓库账本卡（legacy 号）：非开发者只读，开发者可改', () => {
    expect(mayModifyGeneral(ledgerId, PLAYER)).toEqual({ allowed: false, denial: 'OFFICIAL_READ_ONLY' });
    expect(mayModifyGeneral(ledgerId, DEV)).toEqual({ allowed: true });
    expect(isReadOnlyGeneral(ledgerId, PLAYER)).toBe(true);
    expect(isReadOnlyGeneral(ledgerId, DEV)).toBe(false);
  });

  it('自建记录（G-*/D-* 命名空间）：两种会话都可改', () => {
    for (const id of [draftId, diyId]) {
      expect(mayModifyGeneral(id, PLAYER)).toEqual({ allowed: true });
      expect(mayModifyGeneral(id, DEV)).toEqual({ allowed: true });
    }
  });

  it('未知形态落到更严的一边：空号与怪号一律按官方只读处理', () => {
    for (const id of ['', 'shu_001', 'UNKNOWN_ID', 'g-lower']) {
      expect(mayModifyGeneral(id, PLAYER).allowed).toBe(false);
    }
  });

  it('拒绝必须带大白话原因，不许只回一个 false', () => {
    expect(denialMessage('OFFICIAL_READ_ONLY')).toContain('官方');
    expect(denialMessage('OFFICIAL_READ_ONLY')).toContain('开发者模式');
  });
});

describe('generalPolicy: 分区（装配层用）', () => {
  it('差异层按权限分区，被挡的原样列出（不删、不改）', () => {
    const edits = { [ledgerId]: { hp: 9 }, [diyId]: { hp: 7 } };
    const { permitted, blocked } = partitionEditMap(edits, 'generalEdits', PLAYER);
    expect(Object.keys(permitted)).toEqual([diyId]);
    expect(blocked).toEqual([{ id: ledgerId, kind: 'generalEdits' }]);
    // 原对象不被分区改写
    expect(edits[ledgerId]).toEqual({ hp: 9 });
    expect(partitionEditMap(edits, 'generalEdits', DEV).blocked).toEqual([]);
  });

  it('禁用清单同样分区：官方将的禁用越权时回到池子里', () => {
    const { permitted, blocked } = partitionIdSet([ledgerId, diyId], 'disabled', PLAYER);
    expect([...permitted]).toEqual([diyId]);
    expect(blocked).toEqual([{ id: ledgerId, kind: 'disabled' }]);
  });
});
