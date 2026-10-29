/**
 * 随机源兜底的证人（v2.9.25）。
 *
 * 这一档钉的是 2026-10-28 两台机器实测撞出来的那一声不响：客人对着 `http://<一串 IP>`
 * 点「进房间」，`crypto.randomUUID` 在那个上下文里**压根不存在**，取值当场抛异常，
 * 连一根线都没拨出去。而 J1–J4 全部实测走的是"同机＋localhost"，`localhost` 算安全上下文
 * ⇒ 覆盖面从没包括这一种。所以证人必须把浏览器演成"那两个函数不在"，
 * 正面断言的是**照样领得到号码**，不是"没抛异常"（后者只证了半句：领到号才算进得了房）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomPeerId } from './netRandom';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('安全上下文（https／localhost）：照旧用浏览器自己那个号', () => {
  it('randomUUID 在就用它，一个字节也不自己拼', () => {
    const spy = vi.fn(() => '11111111-2222-3333-4444-555555555555');
    vi.stubGlobal('crypto', { randomUUID: spy, getRandomValues: (b: Uint8Array) => b });
    expect(randomPeerId()).toBe('11111111-2222-3333-4444-555555555555');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('getRandomValues 在就用它取字节（比 Math.random 硬的那一层优先）', () => {
    const seen: number[] = [];
    const spy = vi.fn((b: Uint8Array) => {
      seen.push(b.length);
      b.fill(7);
      return b;
    });
    vi.stubGlobal('crypto', { getRandomValues: spy });
    expect(Array.from(randomBytes(4))).toEqual([7, 7, 7, 7]);
    expect(seen).toEqual([4]);
  });
});

describe('非安全上下文（http://一串 IP）：号码照样领得到，这才是"进得了房"', () => {
  it('randomUUID 不在 ⇒ 兜底号非空、在协议的 64 字符硬界内、且两次不一样', () => {
    vi.stubGlobal('crypto', { getRandomValues: (b: Uint8Array) => b.fill(9) });
    const a = randomPeerId();
    const b = randomPeerId();
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(b.length).toBeLessThanOrEqual(64);
    // 名册按 id 认人（房主拿 `from` 去重）⇒ 同一页领到两个相同的号＝第二个人被当成第一个。
    expect(a).not.toBe(b);
  });

  it('两个都不在 ⇒ 退到 Math.random 也照样出号，且随机源被冻住时靠那颗计数器不重号', () => {
    vi.stubGlobal('crypto', null);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const a = randomPeerId();
    const b = randomPeerId();
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
  });

  it('兜底号是安全字符集：它能进 URL、也能进界面那句话，不带空格与符号', () => {
    vi.stubGlobal('crypto', null);
    expect(randomPeerId()).toMatch(/^[a-z0-9-]+$/);
  });

  it('随机字节那一层没有熵源时也不抛，每格都落在一个字节里', () => {
    vi.stubGlobal('crypto', null);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bytes = randomBytes(8);
    expect(bytes).toHaveLength(8);
    expect(Array.from(bytes)).toEqual([128, 128, 128, 128, 128, 128, 128, 128]);
    for (const one of randomBytes(32)) expect(one).toBeGreaterThanOrEqual(0);
  });
});
