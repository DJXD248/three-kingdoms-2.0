// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEV_MODE_DIGEST,
  digestOfSecret,
  isSecureDigestAvailable,
  matchesDeveloperModeDigest,
} from './devGate';

describe('devGate 摘要闸（口令永不出现在源码与产物中）', () => {
  it('SHA-256 已知向量钉死摘要实现', async () => {
    expect(await digestOfSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('同一输入两次摘要逐字一致（判定必须是纯函数）', async () => {
    expect(await digestOfSecret('x'.repeat(32))).toBe(
      await digestOfSecret('x'.repeat(32)),
    );
  });

  it('仓库内只有摘要，且形态合法', () => {
    expect(DEV_MODE_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });

  it('错摘要 / 空串 / null / 非十六进制一律不通过，且绝不回退明文比对', () => {
    expect(matchesDeveloperModeDigest(null)).toBe(false);
    expect(matchesDeveloperModeDigest('')).toBe(false);
    expect(matchesDeveloperModeDigest('0'.repeat(63))).toBe(false);
    expect(matchesDeveloperModeDigest('z'.repeat(64))).toBe(false);
    expect(matchesDeveloperModeDigest('anything-else')).toBe(false);
  });

  it('正确摘要通过（大小写不敏感，浏览器实现不回显原文）', async () => {
    expect(matchesDeveloperModeDigest(DEV_MODE_DIGEST)).toBe(true);
    expect(matchesDeveloperModeDigest(DEV_MODE_DIGEST.toUpperCase())).toBe(true);
  });

  it('真实摘要链路下错口令进不去（经 digestOfSecret，非手填串）', async () => {
    const wrong = await digestOfSecret('a-passphrase-nobody-uses-here');
    expect(wrong).toMatch(/^[0-9a-f]{64}$/);
    expect(matchesDeveloperModeDigest(wrong)).toBe(false);
  });

  it('环境探针与当前运行时一致（node 有 webcrypto；jsdom 无 SubtleCrypto ⇒ 依赖摘要的测试必须钉 node 环境）', () => {
    expect(isSecureDigestAvailable()).toBe(true);
  });
});
