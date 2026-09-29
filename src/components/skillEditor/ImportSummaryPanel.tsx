// 导入总结面板（v2.8.13）：常驻、可整段复制、点「知道了」才消失。
// 刻意不渲染成一句 5 秒即逝的 toast——v2.8.12 的取证教训就是浮层会读到假结果，
// 而且总结的价值恰恰在于"回头还能看"。面板所见与复制所得是同一个字符串。
import { useState } from 'react';
import { ImportSummaryEntry, renderSummaryText } from './importSummary';

function copyText(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function ImportSummaryPanel({
  entries, onDismiss,
}: { entries: ImportSummaryEntry[]; onDismiss: () => void }) {
  const [copyNotice, setCopyNotice] = useState('');
  if (entries.length === 0) return null;
  const text = renderSummaryText(entries);

  const handleCopy = async () => {
    let ok = false;
    const api = navigator.clipboard;
    if (api?.writeText) {
      try {
        await api.writeText(text);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) ok = copyText(text);
    setCopyNotice(ok ? '已复制，可直接粘进聊天记录' : '复制失败，请用鼠标选中文字手动复制');
  };

  return (
    <div data-testid="import-summary" role="region" aria-label="本次导入总结"
      className="mt-3 rounded-lg border border-sky-800/50 bg-sky-950/25 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] text-sky-200 font-bold">📋 本次导入总结</span>
        <div className="flex items-center gap-2">
          {copyNotice && <span className="text-[10px] text-sky-300/80">{copyNotice}</span>}
          <button onClick={handleCopy}
            className="px-2 py-0.5 rounded bg-sky-900/60 border border-sky-700/50 text-[10px] text-sky-100 hover:bg-sky-800/60">
            复制全文
          </button>
          <button onClick={onDismiss}
            className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700/50 text-[10px] text-emerald-100 hover:bg-emerald-800/60">
            知道了
          </button>
        </div>
      </div>
      <pre data-testid="import-summary-text"
        className="text-[11px] leading-5 text-sky-100/90 whitespace-pre-wrap font-sans select-text">{text}</pre>
    </div>
  );
}
