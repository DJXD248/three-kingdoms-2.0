import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadFiles = vi.fn();
vi.mock('../ai/browserExport', () => ({
  downloadFiles: (files: unknown) => downloadFiles(files),
}));

import {
  DEFAULT_REPLAY_SETTINGS,
  checkReplayDirectoryPermission,
  loadReplaySettings,
  persistReplaySettings,
  saveArtifacts,
  supportsFolderPicker,
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
});
