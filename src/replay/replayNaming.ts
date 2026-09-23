/**
 * Pure file-naming helpers for saved replays / operation logs (2.2.6).
 *
 * Default name format requested by the user: 房间名 + 玩家势力 + 年月日时缩写,
 * e.g. `桃园结义-蜀-20260923-14`. Everything here is DOM-free and timezone is
 * whatever the local Date provides (games are local events).
 */

export interface ReplayNameInput {
  roomName: string;
  /** Winner's (or local player's) faction; null-ish → placeholder. */
  faction: string | null | undefined;
  date: Date;
}

/** Strip characters that are illegal/risky in file names, collapse blanks. */
export function sanitizeNamePart(raw: string, fallback = '未命名'): string {
  const cleaned = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 60) : fallback;
}

/** 年月日时缩写: `20260923-14`. */
export function formatYearMonthDayHour(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}`;
}

/** `房间名-势力-20260923-14` (base name without extension). */
export function buildReplayBaseName({ roomName, faction, date }: ReplayNameInput): string {
  const factionPart = faction && String(faction).trim().length > 0 ? sanitizeNamePart(String(faction), '无势力') : '无势力';
  return `${sanitizeNamePart(roomName)}-${factionPart}-${formatYearMonthDayHour(date)}`;
}

export function replayFileName(baseName: string): string {
  return `${sanitizeNamePart(baseName)}.json`;
}

export function operationLogFileName(baseName: string): string {
  return `${sanitizeNamePart(baseName)}.log.txt`;
}

/** Subfolders under the picked save directory. */
export const REPLAY_SUBFOLDER = '录像';
export const OPERATION_LOG_SUBFOLDER = '操作日志';
