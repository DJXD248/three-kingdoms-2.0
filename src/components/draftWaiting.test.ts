/**
 * 2026-11-13 用户口令：「征召页面不要变化，只要下方的征召按钮换成一句『正在等待其他玩家完成征召』」。
 * 这一格钉住那句话与那把判据，并证人两端不各写一份。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isWaitingForOthers, WAITING_FOR_OTHERS_TEXT } from './draftWaiting';

const readSrc = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

describe('联机征召等待态的共用口径', () => {
  it('那句话逐字就是用户要的这一句', () => {
    expect(WAITING_FOR_OTHERS_TEXT).toBe('正在等待其他玩家完成征召');
  });

  it('只有「自己这一席有过名单」且「现在被不是我这一席挡住」才算在等别人', () => {
    expect(isWaitingForOthers(true, true)).toBe(true);
    // 还在自己这一席：照常挑将，不许提前写"在等别人"。
    expect(isWaitingForOthers(true, false)).toBe(false);
    // 从没轮到过自己：那屏仍写房主那句"还没轮到你这一席"，不许冒充"已完成在等别人"。
    expect(isWaitingForOthers(false, true)).toBe(false);
    expect(isWaitingForOthers(false, false)).toBe(false);
  });

  it('房主屏与客人屏共用同一句、同一把判据，字面只写在一个地方', () => {
    for (const file of ['components/GeneralDraft.tsx', 'components/GuestDraftStage.tsx']) {
      const src = readSrc(file);
      expect(src).toContain('WAITING_FOR_OTHERS_TEXT');
      expect(src).toContain('isWaitingForOthers(');
      expect(src).not.toContain("'正在等待其他玩家完成征召'");
    }
    expect(readSrc('components', 'draftWaiting.ts')).toContain("'正在等待其他玩家完成征召'");
  });
});
