/**
 * Replay/log persistence for the game window (2.2.6).
 *
 * The browser cannot write to a hand-typed disk path, so the "录像保存路径"
 * is a real folder picked once via the File System Access API. The directory
 * handle itself is kept in IndexedDB (localStorage can't store handles) and
 * the display name + toggles in localStorage. Writes go to
 * `<picked>/录像/…json` and `<picked>/操作日志/…log.txt`.
 *
 * 2.2.10 root fix: unattended auto-save (`unattended: true`) never triggers
 * OS-level dialogs — it only writes when the remembered folder's permission
 * is already 'granted' (queryPermission, never requestPermission), and
 * otherwise parks the files in a small in-session pending queue (no blob
 * download: browsers configured to "ask where to save" would pop a hung
 * Windows save dialog). Manual saves (user click) keep the download
 * fallback, and any successful folder save flushes the pending queue.
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
 * Test seam: pin the "remembered folder" handle (or lack thereof) without a
 * real IndexedDB/picker. Pass null to simulate "no directory configured".
 */
const dirHandleOverride: { active: boolean; handle: any | null } = { active: false, handle: null };
export function __setDirectoryHandleForTests(handle: any | null): void {
  dirHandleOverride.active = true;
  dirHandleOverride.handle = handle;
}
export function __clearDirectoryHandleOverrideForTests(): void {
  dirHandleOverride.active = false;
  dirHandleOverride.handle = null;
}

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

/** Resolve the remembered handle (test override first); no permission checks. */
async function loadStoredDirectoryHandle(): Promise<any | null> {
  if (dirHandleOverride.active) return dirHandleOverride.handle;
  if (!supportsFolderPicker()) return null;
  try {
    return (await idbGet<any>(DIR_HANDLE_KEY)) ?? null;
  } catch {
    return null;
  }
}

/** Stored directory handle with read-write permission confirmed (may prompt; user-gesture paths only). */
export async function getWritableReplayDirectory(): Promise<any | null> {
  const handle = await loadStoredDirectoryHandle();
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

/**
 * 2.2.10: permission check for unattended (auto-save) paths — only ever
 * returns a handle when access is *already* granted. Never calls
 * requestPermission, so it cannot pop a browser prompt in a remote session.
 */
export async function getSilentlyWritableReplayDirectory(): Promise<any | null> {
  const handle = await loadStoredDirectoryHandle();
  if (!handle || typeof handle.queryPermission !== 'function') return null;
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    return permission === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

export async function checkReplayDirectoryPermission(): Promise<DirPermission> {
  const handle = await loadStoredDirectoryHandle();
  if (!dirHandleOverride.active && !supportsFolderPicker()) return 'unsupported';
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

export type SaveOutcome = 'folder' | 'downloaded' | 'pending';

export interface SavedArtifact {
  subfolder: string;
  file: ExportFile;
}

/**
 * 2.2.10 pending queue: files an unattended auto-save could not write
 * silently (no granted directory). Kept in memory for the session, capped,
 * oldest dropped first. Flushed on the next successful folder save — never
 * via downloads, so a remote/unattended session can't hang on a save dialog.
 */
const PENDING_CAP = 12;
let pendingAutoSaves: SavedArtifact[] = [];

export function listPendingAutoSaves(): SavedArtifact[] {
  return [...pendingAutoSaves];
}

export function clearPendingAutoSaves(): void {
  pendingAutoSaves = [];
}

function enqueuePending(items: SavedArtifact[]): void {
  pendingAutoSaves = [...pendingAutoSaves, ...items].slice(-PENDING_CAP);
}

/**
 * Write anything still pending into the remembered folder when it is
 * silently writable. Returns how many files were flushed (0 when no
 * directory is available — the queue then simply waits).
 */
export async function flushPendingAutoSaves(): Promise<number> {
  if (pendingAutoSaves.length === 0) return 0;
  const dir = await getSilentlyWritableReplayDirectory();
  if (!dir) return 0;
  const items = pendingAutoSaves;
  try {
    for (const item of items) await writeToSubfolder(dir, item.subfolder, [item.file]);
    pendingAutoSaves = [];
    return items.length;
  } catch {
    return 0;
  }
}

/**
 * Save replay + operation log files.
 * - `unattended: true` (auto-save): writes only through an already-granted
 *   folder; otherwise parks the files in the pending queue. No downloads, no
 *   permission prompts — nothing that can open a dialog nobody is there to
 *   click (the 2.2.6 hung-"Save As" root cause).
 * - attended (user clicked save): folder first (may re-ask permission, the
 *   click authorises it), download fallback kept, and pending files are
 *   flushed along when the folder write succeeds.
 */
export async function saveArtifacts(
  files: SavedArtifact[],
  opts: { unattended?: boolean } = {},
): Promise<SaveOutcome> {
  if (opts.unattended) {
    const dir = await getSilentlyWritableReplayDirectory();
    if (dir) {
      try {
        for (const item of files) await writeToSubfolder(dir, item.subfolder, [item.file]);
        await flushPendingAutoSaves();
        return 'folder';
      } catch {
        enqueuePending(files);
        return 'pending';
      }
    }
    enqueuePending(files);
    return 'pending';
  }
  const dir = await getWritableReplayDirectory();
  if (dir) {
    try {
      for (const item of files) await writeToSubfolder(dir, item.subfolder, [item.file]);
      await flushPendingAutoSaves();
      return 'folder';
    } catch {
      // fall through to downloads
    }
  }
  downloadFiles(files.map(item => item.file));
  return 'downloaded';
}
