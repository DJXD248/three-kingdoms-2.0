/**
 * The background AI-battle window (opened from the main menu in developer
 * mode via `#ai-battle?...`). It runs the same seeded battle runner as
 * `npm run ai-battle`, but in the browser: matches execute one per macrotask
 * so the window stays responsive, every game prints a live progress line,
 * and the finished batch offers operation-log / replay export (downloads or
 * a user-picked folder). On completion it posts a summary back to the opener,
 * which shows the bottom-right notice panel.
 */
import { useEffect, useRef, useState } from 'react';
import type { MatchResult } from '../ai/battleRunner';
import { runMatch } from '../ai/battleRunner';
import { policyByName, TIER_PROFILES } from '../ai/policies/strategyPolicy';
import { defaultMatchConfig } from '../ai/matchSetup';
import { buildFailureFiles, buildOperationLog, buildReplayBundle, summarizeMatches } from '../ai/battleReport';
import { downloadFiles, saveToFolder, type ExportFile } from '../ai/browserExport';
import { parseAiBattleHash, type AiBattleParams } from '../ai/battleHash';

const STATUS_LABEL: Record<MatchResult['status'], string> = {
  won: '✔ 分出胜负',
  stepsExhausted: '⏱ 步数耗尽',
  violation: '❌ 违例',
  'replay-diverged': '❌ 复放分叉',
};

export default function AiBattleWindow() {
  const paramsRef = useRef<AiBattleParams | null>(parseAiBattleHash(window.location.hash));
  const startedRef = useRef(false);
  const resultsRef = useRef<MatchResult[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(true);
  const [done, setDone] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const append = (text: string) =>
    setLines(prev => {
      const next = [...prev, text];
      return next.length > 600 ? next.slice(next.length - 600) : next;
    });

  useEffect(() => {
    if (startedRef.current) return; // StrictMode double-invoke guard
    startedRef.current = true;
    const params = paramsRef.current;
    if (!params) {
      setRunning(false);
      setDone(true);
      append('❌ 链接参数缺失：请从主菜单的「AI 对战演练」打开本窗口。');
      return;
    }
    void (async () => {
      append('═══ AI 自动对局（后台窗口） ═══');
      const seatPolicies = params.policies.map(key => policyByName(key) ?? policyByName('random')!);
      const policyLabel = params.policies
        .map((key, i) => `座位${i + 1}=${key === 'random' ? '随机' : TIER_PROFILES[key as keyof typeof TIER_PROFILES]?.label ?? key}`)
        .join(' · ');
      append(
        `配置：${params.players} 个 AI 混战 · ${params.games} 局 · 起始种子 ${params.seed} · ` +
          `将池 ${params.pool} · 牌堆 ${params.deck} · 技能注入 ${(params.skill * 100).toFixed(0)}% · 步数上限 ${params.maxSteps}`,
      );
      append(`策略：${policyLabel}`);
      append('');
      const t0 = Date.now();
      for (let i = 0; i < params.games; i += 1) {
        const seed = params.seed + i;
        const config = defaultMatchConfig(seed, {
          playerCount: params.players,
          poolPerPlayer: params.pool,
          deckSize: params.deck,
          skillInjection: params.skill,
        });
        const result = runMatch(config, { maxSteps: params.maxSteps, seatPolicies });
        resultsRef.current.push(result);
        const mark = result.violations.length > 0 ? ` ❌x${result.violations.length}` : '';
        const pad = String(params.games).length;
        append(
          `第 ${String(i + 1).padStart(pad)}/${params.games} 局 · seed ${seed} · ` +
            `${STATUS_LABEL[result.status]}${mark} · 胜者 ${result.winnerId ?? '-'} · ${result.steps} 步 · ${result.durationMs}ms`,
        );
        for (const v of result.violations.slice(0, 5)) append(`    ❌ 步 ${v.step} [${v.code}] ${v.detail}`);
        // Yield to the browser so the window keeps painting between games.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const summary = summarizeMatches(resultsRef.current);
      append('');
      append(
        `═══ 完成：${summary.games} 局 · 分出胜负 ${summary.won} · 步数耗尽 ${summary.exhausted} · ` +
          `违例 ${summary.violated}（条目 ${summary.violationTotal}） · 总耗时 ${Date.now() - t0}ms ═══`,
      );
      setRunning(false);
      setDone(true);
      try {
        window.opener?.postMessage(
          {
            kind: 'qoder-ai-battle-done',
            params,
            summary,
            artifacts: {
              logText: buildOperationLog(resultsRef.current),
              replayJson: buildReplayBundle(resultsRef.current),
              failures: buildFailureFiles(resultsRef.current),
            },
            reportedAt: Date.now(),
          },
          '*',
        );
      } catch {
        /* opener closed — the notice simply will not show */
      }
    })();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const exportFiles = (): ExportFile[] => {
    const results = resultsRef.current;
    const files: ExportFile[] = [
      { name: '操作日志.txt', content: buildOperationLog(results) },
      { name: '录像.json', content: buildReplayBundle(results) },
    ];
    for (const f of buildFailureFiles(results)) files.push({ name: `failure-${f.name}`, content: f.content });
    return files;
  };

  const handleSaveFolder = async () => {
    setSaveNote('正在写入…');
    const outcome = await saveToFolder(exportFiles());
    if (outcome === 'saved') {
      setSaveNote('✅ 已写入所选文件夹的 ai-battle-log/（含错误标注操作日志与全部录像）');
      return;
    }
    if (outcome === 'cancelled') {
      setSaveNote('已取消保存，可用下载按钮获取文件');
      return;
    }
    setSaveNote('当前环境不支持直接写文件夹，已改用下载（保存到浏览器下载目录）');
    downloadFiles(exportFiles());
  };

  return (
    <div
      className="min-h-screen flex flex-col text-amber-100 font-mono"
      style={{ background: 'linear-gradient(135deg, #0d0805 0%, #12101e 60%, #050308 100%)' }}
    >
      <div className="px-4 py-3 border-b border-amber-700/30 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-black tracking-wider">
          🤖 AI 自动对局（后台{running ? '运行中' : ' · 已完成'}）
        </h1>
        <div className="flex gap-2 text-sm">
          <button
            className="px-3 py-1 rounded border border-amber-600/40 hover:bg-amber-900/30 disabled:opacity-40"
            disabled={!done}
            onClick={() => downloadFiles([{ name: '操作日志.txt', content: buildOperationLog(resultsRef.current) }])}
          >
            📄 操作日志
          </button>
          <button
            className="px-3 py-1 rounded border border-amber-600/40 hover:bg-amber-900/30 disabled:opacity-40"
            disabled={!done}
            onClick={() => downloadFiles([{ name: '录像.json', content: buildReplayBundle(resultsRef.current) }])}
          >
            🎬 录像
          </button>
          <button
            className="px-3 py-1 rounded border border-emerald-600/40 hover:bg-emerald-900/30 disabled:opacity-40"
            disabled={!done}
            onClick={handleSaveFolder}
          >
            🗂 保存到文件夹
          </button>
          <button
            className="px-3 py-1 rounded border border-red-700/40 hover:bg-red-900/30"
            onClick={() => window.close()}
          >
            ✖ 关闭
          </button>
        </div>
      </div>
      <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-5 whitespace-pre-wrap">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.includes('❌')
                ? 'text-red-400 font-bold'
                : line.startsWith('═')
                  ? 'text-amber-300'
                  : ''
            }
          >
            {line}
          </div>
        ))}
      </div>
      <div className="px-4 py-2 border-t border-amber-700/30 text-xs text-amber-400/60 flex justify-between">
        <span>{saveNote || '本窗口与游戏主窗口互不干扰；结束后主窗口右下角会弹出简报。'}</span>
        <span>同 npm run ai-battle 引擎链路 · 零联网</span>
      </div>
    </div>
  );
}
