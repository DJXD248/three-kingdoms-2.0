/**
 * v2.8.1 开发者模式闸的 store 面：口令永不到达 store（只收摘要）、
 * 进入要凭据、退出不要凭据、免口令旁路 `setDeveloperMode` 已删除。
 * 本文件不出现任何明文口令——正确性用 devGate 导出的摘要常量证明。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { DEV_MODE_DIGEST } from '../domain/devGate';

describe('developer-mode gate (store surface)', () => {
  beforeEach(() => {
    useGameStore.setState({ developerMode: false } as never);
  });

  it('错摘要 / 空串 / null 一律拒，且 developerMode 逐字不变', () => {
    const { enableDeveloperMode } = useGameStore.getState();
    expect(enableDeveloperMode('f'.repeat(64))).toBe(false);
    expect(enableDeveloperMode('')).toBe(false);
    expect(enableDeveloperMode(null)).toBe(false);
    expect(useGameStore.getState().developerMode).toBe(false);
  });

  it('正确摘要才开门（store 只见到摘要，见不到口令）', () => {
    expect(useGameStore.getState().enableDeveloperMode(DEV_MODE_DIGEST)).toBe(true);
    expect(useGameStore.getState().developerMode).toBe(true);
  });

  it('退出开发者模式不需要任何凭据', () => {
    useGameStore.getState().enableDeveloperMode(DEV_MODE_DIGEST);
    useGameStore.getState().disableDeveloperMode();
    expect(useGameStore.getState().developerMode).toBe(false);
  });

  it('免口令旁路已从状态机删除（控制台无路可走）', () => {
    const keys = Object.keys(useGameStore.getState());
    expect(keys).not.toContain('setDeveloperMode');
    expect(keys).not.toContain('toggleDeveloperMode');
    expect(keys).toContain('enableDeveloperMode');
    expect(keys).toContain('disableDeveloperMode');
  });

  // jsdom 不实现 SubtleCrypto（`crypto.subtle` 为 undefined，实测 2026-09-27），
  // 所以本文件只用预置摘要；真实摘要链路（digestOfSecret + 已知向量）
  // 在 src/domain/devGate.test.ts 的 node 环境下钉，两边合起来覆盖全链。
  it('形态合法但不是本库摘要 ⇒ 仍拒（防"64 位十六进制就放行"的假闸）', () => {
    const wellFormedButWrong = 'a'.repeat(64);
    expect(wellFormedButWrong).toMatch(/^[0-9a-f]{64}$/);
    expect(wellFormedButWrong).not.toBe(DEV_MODE_DIGEST);
    expect(useGameStore.getState().enableDeveloperMode(wellFormedButWrong)).toBe(false);
    expect(useGameStore.getState().developerMode).toBe(false);
  });
});
