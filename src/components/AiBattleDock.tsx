/**
 * Bottom-right completion notice for the main game window.
 *
 * The background battle window posts its summary + artifacts here when the
 * batch finishes; this dock shows the 简报 (打了几局/完成几局/错了几局) plus
 * the export buttons (操作日志 with ❌ annotations / 录像 / 保存到文件夹).
 * Only visible while developer mode is on.
 */
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { BattleSummary } from '../ai/battleReport';
import type { AiBattleParams } from '../ai/battleHash';
import { downloadFiles, saveToFolder, type ExportFile } from '../ai/browserExport';

interface DonePayload {
  kind: 'qoder-ai-battle-done';
  params: AiBattleParams;
  summary: BattleSummary;
  artifacts: {
    logText: string;
    replayJson: string;
    failures: { name: string; content: string }[];
  };
  reportedAt: number;
}

export default function AiBattleDock() {
  const developerMode = useGameStore(s => s.developerMode);
  const [payload, setPayload] = useState<DonePayload | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as DonePayload | undefined;
      if (data && data.kind === 'qoder-ai-battle-done') {
        setPayload(data);
        setNote('');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!developerMode || !payload) return null;

  const s = payload.summary;
  const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '-');
  const files = (): ExportFile[] => [
    { name: '操作日志.txt', content: payload.artifacts.logText },
    { name: '录像.json', content: payload.artifacts.replayJson },
    ...payload.artifacts.failures.map(f => ({ name: `failure-${f.name}`, content: f.content })),
  ];

  const handleSaveFolder = async () => {
    const outcome = await saveToFolder(files());
    if (outcome === 'saved') {
      setNote('✅ 已写入所选文件夹 ai-battle-log/');
    } else if (outcome === 'cancelled') {
      setNote('已取消，可用下方按钮改为下载');
    } else {
      setNote('环境不支持直接写文件夹，已改为下载');
      downloadFiles(files());
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[130] w-[340px] rounded-xl border border-amber-500/40 bg-[#140d08]/95 text-amber-100 shadow-2xl shadow-black/60 backdrop-blur animate-slideUp">
      <div className="px-4 py-3 border-b border-amber-700/30 flex items-center justify-between">
        <h3 className="font-black tracking-wider">🤖 AI 对战演练 · 结束简报</h3>
        <button className="text-amber-400/60 hover:text-amber-200" onClick={() => setPayload(null)}>
          ✖
        </button>
      </div>
      <div className="px-4 py-3 text-sm space-y-1">
        <p>
          共 <b>{s.games}</b> 局（{payload.params.players} 个 AI · 种子 {payload.params.seed} 起）
        </p>
        <p className="text-emerald-300">✔ 分出胜负：{s.won} 局 · 胜方分布 {JSON.stringify(s.winnerCounts)}</p>
        <p className="text-amber-300">⏱ 步数耗尽未分胜负：{s.exhausted} 局</p>
        <p className={s.violated > 0 ? 'text-red-400 font-bold' : 'text-emerald-300'}>
          {s.violated > 0 ? '❌' : '✔'} 违例局：{s.violated}（违例条目 {s.violationTotal}）
        </p>
        <p className="text-amber-400/60 text-xs">
          耗时 总 {s.totalMs}ms · 均 {s.avgMs}ms/局 · 最慢 {s.slowestMs}ms
        </p>
        {s.factionStats && s.factionStats.length > 0 && (
          <div className="pt-1">
            <p className="text-amber-300 text-xs mb-1">
              ⚖️ 势力平衡（胜率=胜席/出场 · 死亡率=阵亡/登场 · 击杀率=击杀/攻击）
            </p>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-amber-400/70">
                  <th className="text-left font-normal">势力</th>
                  <th className="text-right font-normal">出场</th>
                  <th className="text-right font-normal">胜率</th>
                  <th className="text-right font-normal">登场/阵亡</th>
                  <th className="text-right font-normal">死亡率</th>
                  <th className="text-right font-normal">攻击/击杀</th>
                  <th className="text-right font-normal">击杀率</th>
                </tr>
              </thead>
              <tbody>
                {s.factionStats.map(f => (
                  <tr key={f.faction} className="border-t border-amber-700/20">
                    <td className="text-left font-bold">{f.faction}</td>
                    <td className="text-right">{f.seats}</td>
                    <td className="text-right">{pct(f.wins, f.seats)}</td>
                    <td className="text-right">
                      {f.deployed}/{f.deaths}
                    </td>
                    <td className="text-right">{pct(f.deaths, f.deployed)}</td>
                    <td className="text-right">
                      {f.attacks}/{f.kills}
                    </td>
                    <td className="text-right">{pct(f.kills, f.attacks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {note && <p className="text-xs text-amber-200">{note}</p>}
      </div>
      <div className="px-4 pb-3 flex flex-wrap gap-2 text-sm">
        <button
          className="px-3 py-1.5 rounded border border-amber-600/40 hover:bg-amber-900/30"
          onClick={() => downloadFiles([{ name: '操作日志.txt', content: payload.artifacts.logText }])}
        >
          📄 操作日志（错误处 ❌ 标注）
        </button>
        <button
          className="px-3 py-1.5 rounded border border-amber-600/40 hover:bg-amber-900/30"
          onClick={() => downloadFiles([{ name: '录像.json', content: payload.artifacts.replayJson }])}
        >
          🎬 全部录像
        </button>
        <button
          className="px-3 py-1.5 rounded border border-emerald-600/40 hover:bg-emerald-900/30"
          onClick={handleSaveFolder}
        >
          🗂 保存到文件夹
        </button>
      </div>
    </div>
  );
}
