import { describe, expect, it } from 'vitest';
import {
  OPERATION_LOG_SUBFOLDER,
  REPLAY_SUBFOLDER,
  buildReplayBaseName,
  formatYearMonthDayHour,
  operationLogFileName,
  replayFileName,
  sanitizeNamePart,
} from './replayNaming';

describe('replayNaming（2.2.6 录像/日志命名）', () => {
  it('年月日时缩写为 yyyyMMdd-HH，小时补零', () => {
    expect(formatYearMonthDayHour(new Date(2026, 8, 23, 9, 41))).toBe('20260923-09');
    expect(formatYearMonthDayHour(new Date(2026, 11, 1, 23, 0))).toBe('20261201-23');
  });

  it('默认名 = 房间名-玩家势力-年月日时', () => {
    const name = buildReplayBaseName({
      roomName: '桃园结义',
      faction: '蜀',
      date: new Date(2026, 8, 23, 14, 5),
    });
    expect(name).toBe('桃园结义-蜀-20260923-14');
  });

  it('无势力用占位符', () => {
    expect(
      buildReplayBaseName({ roomName: 'R1', faction: null, date: new Date(2026, 0, 2, 3, 0) }),
    ).toBe('R1-无势力-20260102-03');
  });

  it('清洗文件名非法字符：路径分隔/冒号/问号等被移除，空白折叠为下划线', () => {
    expect(sanitizeNamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(sanitizeNamePart(' 两 个 空 格 ')).toBe('两_个_空_格');
    expect(sanitizeNamePart('...')).toBe('未命名');
    expect(sanitizeNamePart('', '兜底')).toBe('兜底');
  });

  it('录像与日志文件后缀固定，子文件夹常量与需求一致', () => {
    expect(replayFileName('X-蜀-2026')).toBe('X-蜀-2026.json');
    expect(operationLogFileName('X-蜀-2026')).toBe('X-蜀-2026.log.txt');
    expect(REPLAY_SUBFOLDER).toBe('录像');
    expect(OPERATION_LOG_SUBFOLDER).toBe('操作日志');
  });
});
