/**
 * Browser-side export helpers for AI battle artifacts.
 *
 * Two paths: (1) classic blob downloads (work everywhere, files land in the
 * browser's download folder); (2) File System Access API — the user picks a
 * real folder once and we write the whole bundle into `ai-battle-log/`
 * (Chrome/Edge; falls back to downloads otherwise).
 */
export interface ExportFile {
  name: string;
  content: string;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<any>;
  }
}

function triggerDownload(file: ExportFile): void {
  const blob = new Blob([file.content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadFiles(files: ExportFile[]): void {
  files.forEach((file, i) => setTimeout(() => triggerDownload(file), i * 300));
}

/**
 * Write files into `<picked>/ai-battle-log/`. Returns 'saved' on success,
 * 'unavailable' when the API is missing/blocked (caller should offer
 * downloads), 'cancelled' when the user dismissed the picker.
 */
export async function saveToFolder(files: ExportFile[], subfolder = 'ai-battle-log'): Promise<'saved' | 'unavailable' | 'cancelled'> {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') return 'unavailable';
  let root: any;
  try {
    root = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err: any) {
    return String(err?.name ?? '') === 'AbortError' ? 'cancelled' : 'unavailable';
  }
  try {
    const dir = await root.getDirectoryHandle(subfolder, { create: true });
    for (const file of files) {
      const handle = await dir.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.content);
      await writable.close();
    }
    return 'saved';
  } catch {
    return 'unavailable';
  }
}
