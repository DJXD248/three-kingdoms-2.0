/**
 * Developer-mode launcher for the background AI battle window: a small
 * config dialog on the main menu (how many AIs brawl, how many games,
 * seed, plus advanced pool/deck/skill knobs). "开始对战" opens the
 * `#ai-battle` window — battles run there and never block the game window.
 */
import { useState } from 'react';

export default function AiBattleConfig({ onClose }: { onClose: () => void }) {
  const [players, setPlayers] = useState(2);
  const [games, setGames] = useState(20);
  const [seed, setSeed] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [pool, setPool] = useState(8);
  const [deck, setDeck] = useState(60);
  const [skill, setSkill] = useState(35); // percent
  const [maxSteps, setMaxSteps] = useState(3000);
  const [blockedUrl, setBlockedUrl] = useState('');

  const start = () => {
    const q = new URLSearchParams({
      games: String(Math.max(1, Math.min(5000, games | 0))),
      seed: String(Math.max(0, seed | 0)),
      players: String(players),
      pool: String(Math.max(1, Math.min(30, pool | 0))),
      deck: String(Math.max(10, Math.min(400, deck | 0))),
      skill: String(Math.max(0, Math.min(100, skill | 0)) / 100),
      maxSteps: String(Math.max(50, maxSteps | 0)),
    });
    const base = window.location.href.split('#')[0];
    const url = `${base}#ai-battle?${q.toString()}`;
    const w = window.open(url, `ai-battle-${Date.now()}`, 'width=960,height=680');
    if (!w) {
      // Popup blocker got it — keep the dialog open and offer a manual link.
      setBlockedUrl(url);
      return;
    }
    onClose();
  };

  const numField = (label: string, value: number, set: (n: number) => void, hint: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-amber-300/80">{label}</span>
      <input
        type="number"
        value={value}
        onChange={e => set(Number(e.target.value) || 0)}
        className="bg-black/40 border border-amber-700/40 rounded px-2 py-1 text-amber-100 focus:outline-none focus:border-amber-400/70"
      />
      <span className="text-[11px] text-amber-500/40">{hint}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[420px] max-w-[92vw] rounded-2xl border border-amber-600/40 bg-[#140d08] p-6 text-amber-100 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-black tracking-wider mb-1">🤖 AI 对战演练</h2>
        <p className="text-xs text-amber-400/60 mb-4">
          在后台窗口让 AI 随机互搏找 bug，不占用游戏窗口；结束后右下角弹简报，可导出操作日志与录像。
        </p>
        <div className="mb-4">
          <p className="text-sm text-amber-300/80 mb-2">几个 AI 混战</p>
          <div className="flex gap-2">
            {[2, 3, 4].map(n => (
              <button
                key={n}
                onClick={() => setPlayers(n)}
                className={`flex-1 py-2 rounded-lg border font-bold transition-colors ${
                  players === n
                    ? 'border-amber-400/80 bg-amber-900/50 text-amber-100'
                    : 'border-amber-700/30 bg-black/30 text-amber-400/60 hover:border-amber-500/50'
                }`}
              >
                {n} 人
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {numField('打多少局', games, setGames, '1 - 5000')}
          {numField('起始种子', seed, setSeed, '同种子必复现')}
          {numField('步数上限', maxSteps, setMaxSteps, '单局防僵持')}
        </div>
        <button className="text-xs text-amber-400/60 hover:text-amber-200 mb-3" onClick={() => setAdvanced(!advanced)}>
          {advanced ? '▾' : '▸'} 高级设置（将池 / 牌堆 / 技能注入）
        </button>
        {advanced && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {numField('每人将池', pool, setPool, '1 - 30')}
            {numField('公共牌堆', deck, setDeck, '10 - 400')}
            {numField('技能注入 %', skill, setSkill, '武将带演练技能概率')}
          </div>
        )}
        {blockedUrl && (
          <div className="mb-4 rounded-lg border border-red-700/40 bg-red-950/30 px-3 py-2 text-sm">
            ⚠️ 后台窗口被浏览器的弹窗拦截挡住了。
            <a
              href={blockedUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-1 underline text-amber-300 hover:text-amber-100"
            >
              点这里手动打开对战窗口
            </a>
            （或允许本页面弹窗后重试）
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button className="px-4 py-2 rounded-lg text-amber-300/60 hover:text-amber-100" onClick={onClose}>
            取消
          </button>
          <button
            className="px-5 py-2 rounded-lg font-bold border border-amber-400/60 bg-gradient-to-r from-amber-900/60 to-red-900/50 hover:from-amber-800/70 hover:to-red-800/60"
            onClick={start}
          >
            🚀 开始对战
          </button>
        </div>
      </div>
    </div>
  );
}
