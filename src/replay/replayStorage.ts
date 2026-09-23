/**
 * Replay/log persistence for the game window (2.2.6).
 *
 * The browser cannot write to a hand-typed disk path, so the "录像保存路径"
 * is a real folder picked once via the File System Access API. The directory
 * handle itself is kept in IndexedDB (localStorage can't store handles) and
 * the display name + toggles in localStorage. Writes go to
 * `<picked>/录像/…json` and `<picked>/操作日志/…log.txt`. When the API is
 * unavailable, permission was revoked, or the user re-prompt was declined,
 * callers fall back to plain downloads.
 */
import { downloadFiles, type ExportFile } from '../ai/browserExport';

const DB_NAME = 'three-kingdoms-replays';
const STORE_NAME = 'handles';
const DIR_HANDLE_KEY = 'replaySaveDir';
const SETTINGS_KEY = 'three_kingdoms_replay_settings';

export interface ReplaySettingsPersisted {
  autoSaveReplay: boolean;
  autoSaveLog: boolean;
  replayDirName: string | null;
}

export const DEFAULT_REPLAY_SETTINGS: ReplaySettingsPersisted = {
  autoSaveReplay: false,
  autoSaveLog: true,
  replayDirName: null,
};

export function loadReplaySettings(): ReplaySettingsPersisted {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_REPLAY_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ReplaySettingsPersisted>;
    return {
      autoSaveReplay: parsed.autoSaveReplay === true,
      autoSaveLog: parsed.autoSaveLog !== false,
      replayDirName: typeof parsed.replayDirName === 'string' ? parsed.replayDirName : null,
    };
  } catch {
    return { ...DEFAULT_REPLAY_SETTINGS };
  }
}

export function persistReplaySettings(settings: ReplaySettingsPersisted): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Best effort; in-memory store stays authoritative for this session.
  }
}

export function supportsFolderPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openHandleDb();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export type DirPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

/**
 * Ask the user for the save folder and remember its handle. Returns
 * 'cancelled' when the picker was dismissed (previous choice kept).
 */
export async function pickReplayDirectory(): Promise<
  { status: 'picked'; name: string } | { status: 'cancelled' } | { status: 'unsupported' }
> {
  if (!supportsFolderPicker()) return { status: 'unsupported' };
  let handle: any;
  try {
    handle = await window.showDirectoryPicker!({ mode: 'readwrite' });
  } catch (err: any) {
    return String(err?.name ?? '') === 'AbortError' ? { status: 'cancelled' } : { status: 'unsupported' };
  }
  try {
    await idbSet(DIR_HANDLE_KEY, handle);
  } catch {
    // Handle survived only for this session; writes still work until reload.
  }
  return { status: 'picked', name: String(handle.name ?? '所选文件夹') };
}

export async function clearReplayDirectory(): Promise<void> {
  try {
    await idbDelete(DIR_HANDLE_KEY);
  } catch {
    // Ignore: nothing to clean.
  }
}

/** Stored directory handle with read-write permission confirmed (never prompts). */
export async function getWritableReplayDirectory(): Promise<any | null> {
  if (!supportsFolderPicker()) return null;
  let handle: any;
  try {
    handle = await idbGet<any>(DIR_HANDLE_KEY);
  } catch {
    return null;
  }
  if (!handle || typeof handle.getDirectoryHandle !== 'function') return null;
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return handle;
    const requested = await handle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

export async function checkReplayDirectoryPermission(): Promise<DirPermission> {
  if (!supportsFolderPicker()) return 'unsupported';
  let handle: any;
  try {
    handle = await idbGet<any>(DIR_HANDLE_KEY);
  } catch {
    return 'denied';
  }
  if (!handle || typeof handle.queryPermission !== 'function') return 'denied';
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    return permission === 'granted' || permission === 'prompt' ? permission : 'denied';
  } catch {
    return 'denied';
  }
}

/** Write files into `<dir>/<subfolder>/`. Throws when the write fails. */
export async function writeToSubfolder(dir: any, subfolder: string, files: ExportFile[]): Promise<void> {
  const target = await dir.getDirectoryHandle(subfolder, { create: true });
  for (const file of files) {
    const handle = await target.getFileHandle(file.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.content);
    await writable.close();
  }
}

export type SaveOutcome = 'folder' | 'downloaded';

/**
 * Save replay + operation log files. Prefers the remembered folder; falls
 * back to downloads when no folder is set / permission is missing.
 */
export async function saveArtifacts(files: { subfolder: string; file: ExportFile }[]): Promise<SaveOutcome> {
  const dir = await getWritableReplayDirectory();
  if (dir) {
    try {
      for (const item of files) await writeToSubfolder(dir, item.subfolder, [item.file]);
      return 'folder';
    } catch {
      // fall through to downloads
    }
  }
  downloadFiles(files.map(item => item.file));
  return 'downloaded';
}
