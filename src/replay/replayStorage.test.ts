import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const downloadFiles = vi.fn();
vi.mock('../ai/browserExport', () => ({
  downloadFiles: (files: unknown) => downloadFiles(files),
}));

import {
  DEFAULT_REPLAY_SETTINGS,
  checkReplayDirectoryPermission,
  clearPendingAutoSaves,
  flushPendingAutoSaves,
  listPendingAutoSaves,
  loadReplaySettings,
  persistReplaySettings,
  saveArtifacts,
  supportsFolderPicker,
  __clearDirectoryHandleOverrideForTests,
  __setDirectoryHandleForTests,
} from './replayStorage';

describe('replaySettings 持久化（2.2.6）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无存档时取默认：录像自动保存关、日志自动保存开、路径未选', () => {
    expect(loadReplaySettings()).toEqual(DEFAULT_REPLAY_SETTINGS);
    expect(DEFAULT_REPLAY_SETTINGS).toEqual({ autoSaveReplay: false, autoSaveLog: true, replayDirName: null });
  });

  it('写入后读回一致；坏 JSON 回退默认', () => {
    persistReplaySettings({ autoSaveReplay: true, autoSaveLog: true, replayDirName: 'D盘录像' });
    expect(loadReplaySettings()).toEqual({ autoSaveReplay: true, autoSaveLog: true, replayDirName: 'D盘录像' });
    localStorage.setItem('three_kingdoms_replay_settings', '{oops');
    expect(loadReplaySettings()).toEqual(DEFAULT_REPLAY_SETTINGS);
  });
});

describe('replayStorage 降级路径（无 File System Access 环境）', () => {
  beforeEach(() => {
    downloadFiles.mockReset();
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it('不支持文件夹选择时权限检查为 unsupported，保存走下载', async () => {
    expect(supportsFolderPicker()).toBe(false);
    expect(await checkReplayDirectoryPermission()).toBe('unsupported');
    const outcome = await saveArtifacts([
      { subfolder: '操作日志', file: { name: 'x.log.txt', content: 'log' } },
    ]);
    expect(outcome).toBe('downloaded');
    expect(downloadFiles).toHaveBeenCalledWith([{ name: 'x.log.txt', content: 'log' }]);
  });

  it('不支持文件夹选择时，自动保存（unattended）也不下载，改为暂存', async () => {
    const outcome = await saveArtifacts(
      [{ subfolder: '操作日志', file: { name: 'y.log.txt', content: 'log' } }],
      { unattended: true },
    );
    expect(outcome).toBe('pending');
    expect(downloadFiles).not.toHaveBeenCalled();
    expect(listPendingAutoSaves()).toHaveLength(1);
    clearPendingAutoSaves();
    expect(listPendingAutoSaves()).toHaveLength(0);
  });
});

describe('replayStorage 治本暂存队列（2.2.10：自动保存永不弹窗）', () => {
  const mkDir = (permission: 'granted' | 'prompt') => {
    const writes: string[] = [];
    const requested: string[] = [];
    const dir = {
      name: '录像根目录',
      queryPermission: async () => permission,
      requestPermission: async () => {
        requested.push('readwrite');
        return permission;
      },
      getDirectoryHandle: async (sub: string) => ({
        getFileHandle: async (name: string) => ({
          createWritable: async () => ({
            write: async () => undefined,
            close: async () => {
              writes.push(`${sub}/${name}`);
            },
          }),
        }),
      }),
    };
    return { dir, writes, requested };
  };

  beforeEach(() => {
    downloadFiles.mockReset();
    clearPendingAutoSaves();
  });

  afterEach(() => {
    __clearDirectoryHandleOverrideForTests();
  });

  it('目录已授权时自动保存静默写入，不下载、不申请权限', async () => {
    const { dir, writes, requested } = mkDir('granted');
    __setDirectoryHandleForTests(dir);
    const outcome = await saveArtifacts(
      [{ subfolder: '操作日志', file: { name: 'a.log.txt', content: 'log' } }],
      { unattended: true },
    );
    expect(outcome).toBe('folder');
    expect(writes).toEqual(['操作日志/a.log.txt']);
    expect(requested).toHaveLength(0);
    expect(downloadFiles).not.toHaveBeenCalled();
  });

  it('权限处于 prompt（重启后需再授权）时：自动保存不申请权限、不下载，只暂存', async () => {
    const { dir, requested } = mkDir('prompt');
    __setDirectoryHandleForTests(dir);
    const outcome = await saveArtifacts(
      [{ subfolder: '录像', file: { name: 'b.json', content: '{}' } }],
      { unattended: true },
    );
    expect(outcome).toBe('pending');
    expect(requested).toHaveLength(0);
    expect(downloadFiles).not.toHaveBeenCalled();
    expect(listPendingAutoSaves()).toHaveLength(1);
  });

  it('授权目录后的下一次保存（无论自动或手动）自动补存暂存文件', async () => {
    const staging = mkDir('prompt');
    __setDirectoryHandleForTests(staging.dir);
    await saveArtifacts(
      [{ subfolder: '操作日志', file: { name: 'pending.log.txt', content: 'p' } }],
      { unattended: true },
    );
    expect(listPendingAutoSaves()).toHaveLength(1);
    const { dir, writes } = mkDir('granted');
    __setDirectoryHandleForTests(dir);
    const outcome = await saveArtifacts(
      [{ subfolder: '录像', file: { name: 'now.json', content: '{}' } }],
      { unattended: true },
    );
    expect(outcome).toBe('folder');
    expect(writes).toEqual(['录像/now.json', '操作日志/pending.log.txt']);
    expect(listPendingAutoSaves()).toHaveLength(0);
  });

  it('手动保存（用户点击）仍保留下载降级；无目录时暂存不被清空', async () => {
    __setDirectoryHandleForTests(null);
    await saveArtifacts(
      [{ subfolder: '操作日志', file: { name: 'q.log.txt', content: 'q' } }],
      { unattended: true },
    );
    const outcome = await saveArtifacts(
      [{ subfolder: '录像', file: { name: 'manual.json', content: '{}' } }],
    );
    expect(outcome).toBe('downloaded');
    expect(downloadFiles).toHaveBeenCalledWith([{ name: 'manual.json', content: '{}' }]);
    expect(listPendingAutoSaves()).toHaveLength(1);
    expect(await flushPendingAutoSaves()).toBe(0);
    expect(listPendingAutoSaves()).toHaveLength(1);
  });

  it('暂存队列封顶 12 份，丢最保新', async () => {
    __setDirectoryHandleForTests(null);
    for (let i = 0; i < 15; i += 1) {
      await saveArtifacts(
        [{ subfolder: '操作日志', file: { name: `f${i}.log.txt`, content: 'x' } }],
        { unattended: true },
      );
    }
    const names = listPendingAutoSaves().map((item) => item.file.name);
    expect(names).toHaveLength(12);
    expect(names[0]).toBe('f3.log.txt');
    expect(names[11]).toBe('f14.log.txt');
  });
});
