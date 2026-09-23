import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useEffect } from 'react';
import {
  checkReplayDirectoryPermission,
  clearReplayDirectory,
  pickReplayDirectory,
  supportsFolderPicker,
} from '../replay/replayStorage';
import { OPERATION_LOG_SUBFOLDER, REPLAY_SUBFOLDER } from '../replay/replayNaming';

export default function Settings({ onBack, hideDeveloper = false }: { onBack?: () => void; hideDeveloper?: boolean }) {
  const setPhase = useGameStore(s => s.setPhase);
  const settings = useGameStore(s => s.settings);
  const updateSettings = useGameStore(s => s.updateSettings);
  const developerMode = useGameStore(s => s.developerMode);
  const toggleDeveloperMode = useGameStore(s => s.toggleDeveloperMode);

  useEffect(() => {
    if (!onBack) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onBack]);

  const [showDevDialog, setShowDevDialog] = useState(false);
  const [devPassword, setDevPassword] = useState('');
  const [devError, setDevError] = useState('');

  const handleDevToggle = () => {
    if (developerMode) {
      toggleDeveloperMode('djxdzx000');
      return;
    }
    setShowDevDialog(true);
    setDevPassword('');
    setDevError('');
  };

  const handleDevConfirm = () => {
    const ok = toggleDeveloperMode(devPassword);
    if (ok) {
      setShowDevDialog(false);
      setPhase('menu');
    } else {
      setDevError('密码错误');
    }
  };

  // ── 录像与日志（2.2.6）──
  const [replayDirHint, setReplayDirHint] = useState('');
  const canPickFolder = supportsFolderPicker();

  useEffect(() => {
    if (!canPickFolder || !settings.replayDirName) return;
    let alive = true;
    void checkReplayDirectoryPermission().then(permission => {
      if (!alive) return;
      if (permission === 'prompt') {
        setReplayDirHint('💡 浏览器重启后需在下次保存时重新授权（点"选择文件夹"可立即恢复授权）');
      }
    });
    return () => { alive = false; };
  }, [canPickFolder, settings.replayDirName]);

  const handlePickReplayDir = async () => {
    setReplayDirHint('');
    const result = await pickReplayDirectory();
    if (result.status === 'picked') {
      updateSettings({ replayDirName: result.name });
      setReplayDirHint(`✅ 已设置录像保存路径：「${result.name}」`);
    } else if (result.status === 'cancelled') {
      setReplayDirHint('已取消选择，保持原路径不变');
    } else {
      setReplayDirHint('⚠️ 当前浏览器不支持文件夹选择，保存将走浏览器下载');
    }
  };

  const handleClearReplayDir = async () => {
    await clearReplayDirectory();
    updateSettings({ replayDirName: null });
    setReplayDirHint('已清除保存路径，之后改为浏览器下载保存');
  };

  return (
    <div className="min-h-screen text-white flex flex-col" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-amber-800/30">
        <button onClick={onBack ?? (() => setPhase('menu'))} className="text-amber-400 hover:text-amber-200 transition-colors">
          ← 返回{onBack ? '对局' : '主菜单'}
        </button>
        <h1 className="text-2xl font-bold text-amber-200 tracking-wider">⚙️ 游戏设置</h1>
        <div className="w-32" />
      </div>

      <div className="flex-1 flex items-start justify-center pt-10 overflow-y-auto pb-10">
        <div className="w-full max-w-xl space-y-6 px-6">
          <SettingGroup title="显示设置">
            <SettingRow label="分辨率">
              <select value={settings.resolution}
                onChange={e => updateSettings({ resolution: e.target.value })}
                className="bg-black/50 border border-amber-700/30 rounded px-3 py-1.5 text-amber-100 focus:outline-none focus:border-amber-500">
                <option value="1280x720">1280×720</option>
                <option value="1600x900">1600×900</option>
                <option value="1920x1080">1920×1080</option>
                <option value="2560x1440">2560×1440</option>
              </select>
            </SettingRow>
            <SettingRow label="窗口模式">
              <select value={settings.windowMode}
                onChange={e => updateSettings({ windowMode: e.target.value })}
                className="bg-black/50 border border-amber-700/30 rounded px-3 py-1.5 text-amber-100 focus:outline-none focus:border-amber-500">
                <option value="窗口">窗口</option>
                <option value="无边框全屏">无边框全屏</option>
                <option value="全屏">全屏</option>
              </select>
            </SettingRow>
            <SettingRow label="动画速度">
              <div className="flex items-center gap-3">
                <input type="range" min="0.5" max="3" step="0.5"
                  value={settings.animationSpeed}
                  onChange={e => updateSettings({ animationSpeed: parseFloat(e.target.value) })}
                  className="w-32 accent-amber-500" />
                <span className="text-amber-300 w-12 text-right">{settings.animationSpeed}x</span>
              </div>
            </SettingRow>
          </SettingGroup>

          <SettingGroup title="音频设置">
            <SettingRow label="主音量">
              <SliderControl value={settings.masterVolume} onChange={v => updateSettings({ masterVolume: v })} />
            </SettingRow>
            <SettingRow label="音乐音量">
              <SliderControl value={settings.musicVolume} onChange={v => updateSettings({ musicVolume: v })} />
            </SettingRow>
            <SettingRow label="特效音量">
              <SliderControl value={settings.sfxVolume} onChange={v => updateSettings({ sfxVolume: v })} />
            </SettingRow>
          </SettingGroup>

          <SettingGroup title="对局设置">
            <SettingRow label="自动保存">
              <button
                onClick={() => updateSettings({ autoSave: !settings.autoSave })}
                className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all ${
                  settings.autoSave ? 'bg-green-700 text-white hover:bg-green-600' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {settings.autoSave ? '已开启' : '未开启'}
              </button>
            </SettingRow>
            <p className="text-xs text-amber-200/50">开启后，每次回合结束会自动保存当前对局。</p>
          </SettingGroup>

          <SettingGroup title="录像与日志">
            <SettingRow label="录像保存路径">
              <div className="flex items-center gap-2">
                <span className="text-amber-300/80 text-sm max-w-40 truncate">
                  {settings.replayDirName ? `「${settings.replayDirName}」` : '未选择（保存时走浏览器下载）'}
                </span>
                <button
                  onClick={() => void handlePickReplayDir()}
                  className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-600 transition-all"
                >
                  选择文件夹
                </button>
                {settings.replayDirName && (
                  <button
                    onClick={() => void handleClearReplayDir()}
                    className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600 transition-all"
                  >
                    清除
                  </button>
                )}
              </div>
            </SettingRow>
            <SettingRow label="每局自动保存录像">
              <button
                onClick={() => updateSettings({ autoSaveReplay: !settings.autoSaveReplay })}
                className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all ${
                  settings.autoSaveReplay ? 'bg-green-700 text-white hover:bg-green-600' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {settings.autoSaveReplay ? '已开启' : '未开启'}
              </button>
            </SettingRow>
            <SettingRow label="自动保存操作日志">
              <button
                onClick={() => updateSettings({ autoSaveLog: !settings.autoSaveLog })}
                className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all ${
                  settings.autoSaveLog ? 'bg-green-700 text-white hover:bg-green-600' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {settings.autoSaveLog ? '已开启' : '未开启'}
              </button>
            </SettingRow>
            {replayDirHint && <p className="text-xs text-amber-300/70">{replayDirHint}</p>}
            <p className="text-xs text-amber-200/50">
              浏览器不允许直接填写电脑路径，"选择文件夹"即为设置路径（等效做法）。结束后录像存入所选目录的「{REPLAY_SUBFOLDER}」子文件夹，
              操作日志存入「{OPERATION_LOG_SUBFOLDER}」子文件夹；命名默认为 房间名-势力-年月日时。操作日志默认每局自动保存。
            </p>
          </SettingGroup>

          {!hideDeveloper && <SettingGroup title="开发者选项">
            <SettingRow label="开发者模式">
              <button
                onClick={handleDevToggle}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  developerMode
                    ? 'bg-green-700 text-white hover:bg-green-600'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {developerMode ? '已开启' : '未开启'}
              </button>
            </SettingRow>
            {developerMode && (
              <>
                <p className="text-xs text-green-400/60">
                  ✅ 开发者模式已激活 — 卡牌图鉴中可使用将领编辑器
                </p>
                <SettingRow label="技能测试场">
                  <button
                    onClick={() => useGameStore.getState().startTestArena()}
                    className="px-4 py-1.5 rounded-lg text-sm font-bold bg-amber-700 text-white hover:bg-amber-600 transition-all"
                  >
                    ⚗️ 进入测试场
                  </button>
                </SettingRow>
              </>
            )}
          </SettingGroup>}
        </div>
      </div>

      {/* Password dialog */}
      {showDevDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-purple-600/40 bg-gradient-to-b from-gray-900 to-black p-8 text-center shadow-2xl">
            <div className="text-5xl mb-4">🔒</div>
            <h2 className="text-2xl font-black text-purple-300 mb-4">开发者模式</h2>
            <p className="text-amber-100/50 text-sm mb-4">请输入开发者密码</p>
            <input
              type="password"
              value={devPassword}
              onChange={e => { setDevPassword(e.target.value); setDevError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleDevConfirm(); }}
              placeholder="输入密码"
              className="w-full px-4 py-2.5 rounded-lg bg-black/50 border border-purple-700/30 text-purple-100 placeholder-purple-700/40 mb-2 focus:outline-none focus:border-purple-500 text-center"
              autoFocus
            />
            {devError && <p className="text-red-400 text-sm mb-2">{devError}</p>}
            <div className="flex gap-3 mt-4">
              <button onClick={handleDevConfirm}
                className="flex-1 py-3 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-600 transition-all">
                确认
              </button>
              <button onClick={() => setShowDevDialog(false)}
                className="flex-1 py-3 rounded-xl bg-gray-700 text-white font-bold hover:bg-gray-600 transition-all">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-amber-800/30 rounded-xl overflow-hidden">
      <div className="bg-amber-900/20 px-4 py-2 border-b border-amber-800/30">
        <h3 className="text-amber-300 font-bold">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-amber-100/80">{label}</span>
      {children}
    </div>
  );
}

function SliderControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min="0" max="100" value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        className="w-32 accent-amber-500" />
      <span className="text-amber-300 w-10 text-right">{value}%</span>
    </div>
  );
}
