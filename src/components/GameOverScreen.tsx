import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { factionColors } from '../data/generals';
import { clearLocalGameSnapshot } from '../store/localGameSnapshot';
import { getLiveReplayDocument, getLiveReplayEntryCount, serializeLiveReplay } from '../replay/liveReplayRecorder';
import { buildGameplayLog } from '../replay/gameplayLog';
import {
  OPERATION_LOG_SUBFOLDER,
  REPLAY_SUBFOLDER,
  buildReplayBaseName,
  operationLogFileName,
  replayFileName,
} from '../replay/replayNaming';
import { saveArtifacts } from '../replay/replayStorage';

export default function GameOverScreen() {
  useEffect(() => {
    clearLocalGameSnapshot();
  }, []);
  const players = useGameStore((s) => s.players);
  const winnerId = useGameStore((s) => s.winnerId);
  const gameOverBanner = useGameStore((s) => s.gameOverBanner);
  const defeatEvent = useGameStore((s) => s.defeatEvent);
  const resetGame = useGameStore((s) => s.resetGame);
  const roomName = useGameStore((s) => s.roomName);
  const settings = useGameStore((s) => s.settings);

  const winner = players.find((player) => player.id === winnerId) ?? null;
  const defeatColor = defeatEvent?.faction ? factionColors[defeatEvent.faction] : '#ef4444';

  // ── replay / operation-log saving (2.2.6) ──
  const defaultBaseName = useMemo(
    () => buildReplayBaseName({ roomName, faction: winner?.faction, date: new Date() }),
    [roomName, winner?.faction],
  );
  const [replayName, setReplayName] = useState(defaultBaseName);
  const [saveStatus, setSaveStatus] = useState('');
  const [autoSavedNote, setAutoSavedNote] = useState('');
  const hasReplay = getLiveReplayEntryCount() > 0;
  const autoSaveRan = useRef(false);

  const outcomeNote = (outcome: 'folder' | 'downloaded' | 'pending', dirName: string | null) =>
    outcome === 'folder'
      ? `已保存到文件夹「${dirName ?? '所选路径'}」`
      : outcome === 'pending'
        ? '未授权保存目录，已暂存浏览器内存（不弹保存窗口），授权目录或点"保存"后自动补存'
        : '已按浏览器下载方式保存（未设置或未授权保存路径）';

  // Auto-save on match end: replays behind a settings toggle, operation log
  // on by default (per the 2.2.6 requirement). StrictMode double-mount is
  // guarded so each match ends up saved exactly once. 2.2.10: unattended —
  // writes only to an already-granted folder, otherwise parks in the pending
  // queue; never triggers downloads, so no hung "Save As" dialog remotely.
  useEffect(() => {
    if (autoSaveRan.current) return;
    autoSaveRan.current = true;
    const doc = getLiveReplayDocument();
    if (!doc || doc.entries.length === 0) return;
    const base = buildReplayBaseName({ roomName, faction: winner?.faction, date: new Date() });
    const jobs: Promise<string>[] = [];
    if (settings.autoSaveLog) {
      jobs.push(
        saveArtifacts(
          [{ subfolder: OPERATION_LOG_SUBFOLDER, file: { name: operationLogFileName(base), content: buildGameplayLog(doc) } }],
          { unattended: true },
        ).then((r) => outcomeNote(r, settings.replayDirName)),
      );
    }
    if (settings.autoSaveReplay) {
      jobs.push(
        saveArtifacts(
          [{ subfolder: REPLAY_SUBFOLDER, file: { name: replayFileName(base), content: JSON.stringify(doc, null, 2) } }],
          { unattended: true },
        ).then((r) => outcomeNote(r, settings.replayDirName)),
      );
    }
    if (jobs.length === 0) return;
    Promise.all(jobs)
      .then((notes) => setAutoSavedNote(`📥 结束自动保存：${notes.join('；')}`))
      .catch(() => setAutoSavedNote('⚠️ 自动保存未成功，可手动点击右侧"保存"按钮'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveReplayNow = async () => {
    const json = serializeLiveReplay();
    if (!json || getLiveReplayEntryCount() === 0) {
      setSaveStatus('本局没有可保存的录像数据');
      return;
    }
    setSaveStatus('正在保存…');
    const name = replayName.trim() || defaultBaseName;
    try {
      const outcome = await saveArtifacts([
        { subfolder: REPLAY_SUBFOLDER, file: { name: replayFileName(name), content: json } },
      ]);
      setSaveStatus(`💾 录像${outcomeNote(outcome, settings.replayDirName)}`);
    } catch {
      setSaveStatus('❌ 保存失败，请检查浏览器权限');
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center text-white"
      style={{
        background:
          'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
      }}
    >
        <div className="text-center animate-fadeIn px-6">
          <div className="text-8xl mb-6 animate-base-hit animate-pulse-glow">🏆</div>
          <h1 className="text-5xl font-black text-amber-200 mb-4">游戏结束</h1>
          {(gameOverBanner || defeatEvent) && (
            <div
              className="mb-5 inline-flex items-center gap-3 rounded-2xl border-2 px-7 py-3 animate-base-hit"
              style={{ borderColor: defeatColor, background: 'rgba(0,0,0,0.6)', boxShadow: `0 0 28px ${defeatColor}66` }}
            >
              <span className="text-3xl animate-pulse-glow">💥🏯</span>
              <span className="text-2xl font-black" style={{ color: defeatColor }}>
                {gameOverBanner ?? (defeatEvent?.faction ? `${defeatEvent.faction}势力击破` : '势力击破')}
              </span>
            </div>
          )}
          {winner ? (
            <>
              <p
                className="text-3xl font-bold mb-2"
                style={{ color: winner.faction ? factionColors[winner.faction] : '#fbbf24' }}
              >
                {winner.name}
              </p>
              <p className="text-xl text-amber-400">
                {winner.faction ? `${winner.faction} 势力获得胜利！` : '获得胜利！'}
              </p>
            </>
          ) : (
            <p className="text-xl text-amber-400">对局结束</p>
          )}

          {/* 是否保存本局录像：左侧重命名，右侧保存 */}
          <div
            className="mt-8 mx-auto max-w-xl rounded-2xl border border-amber-700/40 bg-black/50 px-5 py-4 text-left"
            data-testid="replay-save-panel"
          >
            <p className="text-amber-200 font-bold mb-3">💾 是否保存本局录像？</p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={replayName}
                onChange={(e) => setReplayName(e.target.value)}
                aria-label="录像名称"
                placeholder="录像名称（默认：房间名-势力-年月日时）"
                className="flex-1 min-w-0 rounded-lg bg-black/50 border border-amber-700/30 px-3 py-2 text-amber-100 placeholder-amber-800 focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={() => void saveReplayNow()}
                disabled={!hasReplay}
                className="shrink-0 rounded-lg bg-gradient-to-r from-emerald-700 to-teal-700 px-6 py-2 font-bold text-white transition-all hover:from-emerald-600 hover:to-teal-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-200/50">
              录像存入设置里所选"录像保存路径"的「{REPLAY_SUBFOLDER}」子文件夹；手动点"保存"且未设置路径时才走浏览器下载。
              自动保存永不弹系统保存窗口：未授权目录时本局内容暂存在浏览器内存，授权后自动补存。
              操作日志默认每局自动保存在同一目录的「{OPERATION_LOG_SUBFOLDER}」子文件夹。
            </p>
            {autoSavedNote && <p className="mt-1 text-xs text-green-300/80">{autoSavedNote}</p>}
            {saveStatus && <p className="mt-1 text-xs text-amber-300">{saveStatus}</p>}
          </div>

        <button
          onClick={resetGame}
          className="mt-10 rounded-xl bg-gradient-to-r from-amber-600 to-red-700 px-12 py-4 text-xl font-black text-white transition-all hover:scale-105 hover:from-amber-500 hover:to-red-600"
        >
          返回主菜单
        </button>
      </div>
    </div>
  );
}
