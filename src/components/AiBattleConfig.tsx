/**
 * Developer-mode launcher for the background AI battle window: a small
 * config dialog on the main menu (how many AIs brawl, how many games,
 * seed, per-seat policy + optional per-seat faction/general picks, plus
 * advanced pool/deck/skill knobs). "开始对战" opens the `#ai-battle`
 * window — battles run there and never block the game window. The chosen
 * seat setups are frozen for the whole batch (encoded into the hash once).
 */
import { useState } from 'react';
import { allFactions, allGenerals, type Faction } from '../data/generals';
import { encodeIdentityLock, encodeSeats, type AiBattleSeat } from '../ai/battleHash';
import type { IdentityLockBypass } from '../ai/matchSetup';

const LOCK_SWITCHES: Array<{ field: keyof Omit<IdentityLockBypass, 'identityWhitelist'>; label: string }> = [
  { field: 'off', label: '关闭身份锁（整批完全不锁）' },
  { field: 'allowSameFactionSeatSharing', label: '允许同势力座位共享同名将领' },
  { field: 'allowSameIdentitySameFactionMultiCopy', label: '允许同身份同势力在同座将池中出现多份' },
  { field: 'allowExplicitGeneralsIgnoreLock', label: '自选将领撞锁不拒批（照常入池）' },
  { field: 'lockIdentityGloballyAcrossFactions', label: '全局同身份互斥（加强档：跨势力跨座位也互斥）' },
];

const POLICY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'random', label: '随机（旧基线）' },
  { key: 'aggressive', label: '激进' },
  { key: 'balanced', label: '均衡' },
  { key: 'conservative', label: '保守' },
];

const EMPTY_SEATS: AiBattleSeat[] = [0, 1, 2, 3].map(() => ({ faction: '', generals: [] }));

export default function AiBattleConfig({ onClose }: { onClose: () => void }) {
  const [players, setPlayers] = useState(2);
  const [games, setGames] = useState(20);
  const [seed, setSeed] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [pool, setPool] = useState(8);
  const [deck, setDeck] = useState(60);
  const [skill, setSkill] = useState(35); // percent
  const [maxSteps, setMaxSteps] = useState(3000);
  const [policies, setPolicies] = useState<string[]>(['aggressive', 'random', 'random', 'random']);
  const [seats, setSeats] = useState<AiBattleSeat[]>(EMPTY_SEATS);
  const [blockedUrl, setBlockedUrl] = useState('');
  // v2.8.0 practice-window identity-lock bypasses — local to this dialog only,
  // encoded into the hash for the batch; defaults = full lock compliance.
  const [lockBypass, setLockBypass] = useState<IdentityLockBypass>({});
  const [whitelistText, setWhitelistText] = useState('');

  const setSeatPolicy = (index: number, key: string) =>
    setPolicies(prev => prev.map((p, i) => (i === index ? key : p)));

  const patchSeat = (index: number, patch: Partial<AiBattleSeat>) =>
    setSeats(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const anySeatPicked = seats.slice(0, players).some(s => s.faction !== '' || s.generals.length > 0);

  const start = () => {
    const q = new URLSearchParams({
      games: String(Math.max(1, Math.min(5000, games | 0))),
      seed: String(Math.max(0, seed | 0)),
      players: String(players),
      pool: String(Math.max(1, Math.min(30, pool | 0))),
      deck: String(Math.max(10, Math.min(400, deck | 0))),
      skill: String(Math.max(0, Math.min(100, skill | 0)) / 100),
      maxSteps: String(Math.max(50, maxSteps | 0)),
      policies: policies.slice(0, players).join(','),
    });
    // Only encode seats when at least one was touched; otherwise the whole
    // batch stays "random faction-pure pools" (2.2.8 default behaviour).
    if (anySeatPicked) q.set('seats', encodeSeats(seats.slice(0, players)));
    // v2.8.0 identity-lock bypasses: absent from the hash = full compliance.
    const whitelist = whitelistText.split(',').map(s => s.trim()).filter(Boolean);
    const flags = encodeIdentityLock(lockBypass);
    if (flags) q.set('lock', flags);
    if (whitelist.length > 0) q.set('lockwl', whitelist.join(','));
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
        <div className="mb-4">
          <p className="text-sm text-amber-300/80 mb-2">每个座位的 AI 策略</p>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: players }, (_, i) => i).map(i => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <span className="text-amber-400/70 shrink-0">座位 {i + 1}</span>
                <select
                  value={policies[i]}
                  onChange={e => setSeatPolicy(i, e.target.value)}
                  className="flex-1 bg-black/40 border border-amber-700/40 rounded px-1 py-1 text-amber-100 focus:outline-none focus:border-amber-400/70"
                >
                  {POLICY_OPTIONS.map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-amber-500/40 mt-1">三档策略基于"看一步局势估值"（阶段三）；档位强弱对比数据见 npm run ai-arena。</p>
        </div>
        <div className="mb-4">
          <p className="text-sm text-amber-300/80 mb-2">每个座位的势力 / 阵容（可选 · 允许重复 · 选定后整批锁定）</p>
          <div className="space-y-2">
            {Array.from({ length: players }, (_, i) => i).map(i => {
              const seat = seats[i];
              const poolGenerals = seat.faction
                ? allGenerals.filter(g => g.faction === seat.faction)
                : allGenerals;
              return (
                <div key={i} className="rounded-lg border border-amber-700/25 bg-black/20 p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400/70 shrink-0">座位 {i + 1}</span>
                    <select
                      value={seat.faction}
                      onChange={e => patchSeat(i, { faction: e.target.value as Faction | '', generals: [] })}
                      className="flex-1 bg-black/40 border border-amber-700/40 rounded px-1 py-1 text-amber-100 focus:outline-none focus:border-amber-400/70"
                    >
                      <option value="">随机势力</option>
                      {allFactions.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <select
                      value=""
                      onChange={e => {
                        const id = e.target.value;
                        if (id) patchSeat(i, { generals: [...seat.generals, id] });
                      }}
                      className="flex-1 bg-black/40 border border-amber-700/40 rounded px-1 py-1 text-amber-100 focus:outline-none focus:border-amber-400/70"
                    >
                      <option value="">＋添加将领…</option>
                      {poolGenerals.map(g => (
                        <option key={g.id} value={g.id}>{g.name}（{g.faction}·{g.hp}血）</option>
                      ))}
                    </select>
                  </div>
                  {seat.generals.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {seat.generals.map((gid, k) => (
                        <span
                          key={`${gid}_${k}`}
                          className="inline-flex items-center gap-1 rounded bg-amber-900/40 border border-amber-700/30 px-1.5 py-0.5 text-xs"
                        >
                          {allGenerals.find(g => g.id === gid)?.name ?? gid}
                          <button
                            className="text-amber-400/60 hover:text-red-300"
                            onClick={() => patchSeat(i, { generals: seat.generals.filter((_, j) => j !== k) })}
                          >
                            ✖
                          </button>
                        </span>
                      ))}
                      <button
                        className="text-xs text-amber-400/60 hover:text-amber-200 ml-1"
                        onClick={() => patchSeat(i, { generals: [] })}
                      >
                        清空（回到该势力整池随机抽）
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-amber-500/40 mt-1">
            只选势力＝从该势力武将池随机抽满将池；自选将领＝所选名单即该座位全部将池。
            v2.8.0 起默认遵循身份锁：同身份同势力的将领全局只许一座一份，撞锁会拒绝整批（下方旁路开关可放行）。
            开始后整个批次的阵容不再变化。
          </p>
        </div>
        <div className="mb-4">
          <p className="text-sm text-amber-300/80 mb-2">身份锁旁路开关（只对这一批演练生效；全部不勾＝严格遵循身份锁）</p>
          <div className="space-y-1">
            {LOCK_SWITCHES.map(({ field, label }) => (
              <label key={field} className="flex items-center gap-2 text-sm text-amber-100/80">
                <input
                  type="checkbox"
                  checked={lockBypass[field] === true}
                  onChange={() => setLockBypass(prev => ({ ...prev, [field]: !prev[field] }))}
                  className="accent-amber-500"
                />
                {label}
              </label>
            ))}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-amber-300/80">身份白名单（只锁这些身份，逗号分隔；留空＝全部身份参与锁）</span>
              <input
                type="text"
                value={whitelistText}
                onChange={e => setWhitelistText(e.target.value)}
                placeholder="如：关羽,曹操"
                className="bg-black/40 border border-amber-700/40 rounded px-2 py-1 text-amber-100 focus:outline-none focus:border-amber-400/70"
              />
            </label>
          </div>
          <p className="text-[11px] text-amber-500/40 mt-1">
            正式建房与 AI 自动征召始终遵循身份锁，不受这些开关影响；开关也不写入录像。每人候选张数可在高级设置「每人将池」调整。
          </p>
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
