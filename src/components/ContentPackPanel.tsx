/**
 * v2.9.12 DIY 内容包 · 界面（PROJECT_ARCH_MAP.md §G 第 11 项／§13 第 6 条）。
 * 用户 2026-09-27 口径：这是独立功能，不跟开房或远程联机绑。
 * 界面上要说清的三件事：包里有什么、没什么；装上了几张；装不上时逐条为什么。
 */
import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { downloadFiles } from '../ai/browserExport';
import type { General } from '../data/generals';
import {
  MAX_PACK_GENERALS,
  buildDiyPack,
  packFileName,
  parseDiyPack,
  selectPackableGenerals,
} from '../contentPack/contentPack';
import { findRecordProblem, planInstall, type InstallLine } from '../contentPack/installPack';

const VERDICT_MARK: Record<InstallLine['verdict'], string> = {
  install: '⬇️',
  already: '➖',
  refuse: '✕',
};

export function ContentPackPanel() {
  const authoredGenerals = useGameStore(s => s.authoredGenerals);
  const getGeneralWithEdits = useGameStore(s => s.getGeneralWithEdits);
  const installAuthoredGenerals = useGameStore(s => s.installAuthoredGenerals);
  const [report, setReport] = useState<{ ok: boolean; headline: string; lines: InstallLine[] } | null>(null);

  const packable = selectPackableGenerals(authoredGenerals);
  const tooMany = packable.length > MAX_PACK_GENERALS;
  // 打包带出的是"本机看到的这张卡"（含卡面与技能的修改），不是存储里的半成品差分。
  const cards = packable.map(g => getGeneralWithEdits(g));
  // 导出前先按装包那一侧的同一份判据自检：本机编辑器允许、但包不认的卡（比如技能没名字），
  // 一旦写进包，别的机器会整包拒装——那就等于这份文件永远装不上。
  const flawed: InstallLine[] = [];
  const clean: General[] = [];
  cards.forEach((g, index) => {
    const why = findRecordProblem(g);
    if (why) flawed.push({ index, id: g.id, name: g.name, verdict: 'refuse', why });
    else clean.push(g);
  });

  const writePack = (list: General[]) => {
    const { pack, text } = buildDiyPack(list);
    downloadFiles([{ name: packFileName(list, pack.header.fingerprint, new Date()), content: text }]);
    setReport({
      ok: true,
      headline: `已导出 ${list.length} 张玩家自制将领。指纹 ${pack.header.fingerprint}——对方装包时会对不上就说明文件被改过或没传全。`,
      lines: list.map((g, index) => ({ index, id: g.id, name: g.name, verdict: 'install', why: '在包里' })),
    });
  };

  const handleExport = () => {
    if (packable.length === 0) {
      setReport({ ok: false, headline: '这台机器上现在一张玩家自制的将也没有，导出来的包会是空的。先在「新建将领」里做几张。', lines: [] });
      return;
    }
    if (tooMany) {
      setReport({ ok: false, headline: `现在有 ${packable.length} 张，超过一个包的上限 ${MAX_PACK_GENERALS} 张，先删掉一些再导出。`, lines: [] });
      return;
    }
    if (flawed.length > 0) {
      setReport({
        ok: false,
        headline: `先别急着导：${packable.length} 张里有 ${flawed.length} 张带着装包那一侧不认的毛病（逐条见下面），写出去对方会整包拒装。${clean.length > 0 ? `你可以把它们改好再导，也可以只导出合格的 ${clean.length} 张。` : '合格的一张也没有，先把下面这些改好。'}`,
        lines: flawed,
      });
      return;
    }
    writePack(cards);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const read = parseDiyPack(text);
    const plan = planInstall(read, { existingAuthored: authoredGenerals });
    if (!plan.ok) {
      setReport({ ok: false, headline: plan.headline, lines: plan.lines });
      return;
    }
    const result = installAuthoredGenerals(plan.install);
    if (result.refused.length > 0) {
      setReport({
        ok: false,
        headline: `这个包没有装上（一张也没有）。库里这一层挡下了：${result.refused.join('；')}`,
        lines: plan.lines,
      });
      return;
    }
    setReport({ ok: true, headline: plan.headline, lines: plan.lines });
  };

  return (
    <div className="px-6 py-3 border-b border-amber-800/30 bg-amber-900/10 space-y-2 flex-shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={handleExport}
          className="px-4 py-1.5 rounded-lg text-sm font-bold bg-amber-700 text-white hover:bg-amber-600 transition-all active:scale-95">
          📦 导出内容包（{packable.length} 张）
        </button>
        {flawed.length > 0 && clean.length > 0 && (
          <button onClick={() => writePack(clean)}
            className="px-4 py-1.5 rounded-lg text-sm font-bold bg-amber-900/60 text-amber-100 hover:bg-amber-800 transition-all active:scale-95">
            只导出合格的 {clean.length} 张
          </button>
        )}
        <label className="px-4 py-1.5 rounded-lg text-sm font-bold bg-cyan-800/70 text-cyan-100 hover:bg-cyan-700 cursor-pointer transition-all">
          📥 导入内容包
          <input type="file" accept=".json,.tkdiy.json,application/json"
            onChange={e => void handleFile(e.target.files?.[0])} className="hidden" />
        </label>
        <span className="text-[11px] text-amber-200/70">
          包里只有你自制的将（连卡面带技能）；你对官方卡的修改、锁定与禁用不在包里。
        </span>
        {flawed.length > 0 && (
          <span className="text-[11px] text-red-300/80">
            其中 {flawed.length} 张带着包不认的毛病，点导出会先点名，不会写出一份装不上的文件。
          </span>
        )}
      </div>

      {report && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${report.ok ? 'border-green-700/40 bg-green-900/20' : 'border-red-700/40 bg-red-900/20'}`}>
          <p className={`font-bold ${report.ok ? 'text-green-300' : 'text-red-300'}`}>
            {report.ok ? '✅' : '⛔'} {report.headline}
          </p>
          {report.lines.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-amber-100/80">
              {report.lines.map(line => (
                <li key={`${line.index}-${line.id}`}>
                  {VERDICT_MARK[line.verdict]} {line.name}
                  <span className="text-amber-200/40">（{line.id}）</span> — {line.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
