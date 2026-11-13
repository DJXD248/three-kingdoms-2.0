import type { EngineState } from '../core/GameState';
import { factionColors } from '../data/generals';

/**
 * 联机开局两段在客人屏上的全屏画面（2026-11-11 同网真机反馈）。
 *
 * 用户原话＝「座次分配和势力分配与热座游戏时的画面不一样，我的要求是保持一致；
 * 主机点击开始游戏后，主机和客机的画面都要变化」。
 *
 * 所以这一格逐字照抄热座那两屏的版式（同一层背景、同一颗标题、同一组卡片），
 * 数据只读房主发来的那一份指名快照里的**公开字段**：称呼、点数、势力、座次。
 * 没收到就画「?」／「还没定」，绝不画一个本机编出来的数（沿用 netSetupSteps 的诚实边界）。
 *
 * 这一屏没有任何按钮：骰子与势力由房主那台机器定，客人不参与决定，只跟着变。
 * 组件挂在 OnlineLobby 里而不是 App 的 phase 分支上，是为了让连线与收快照的回调
 * 始终保持挂载——换的是画面，不是那根线。
 */

type OpeningRow = {
  key: string;
  name: string;
  roll: number | null;
  faction: string | null;
  order: number | null;
};

function rowsOf(snapshot: EngineState | null): OpeningRow[] {
  const players = (snapshot as { players?: unknown } | null)?.players;
  if (!Array.isArray(players)) return [];
  return players.map((raw, index) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      key: String(p.id ?? index),
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : `玩家${index + 1}`,
      roll: typeof p.diceRoll === 'number' && Number.isInteger(p.diceRoll) && p.diceRoll > 0
        ? p.diceRoll
        : null,
      faction: typeof p.faction === 'string' && p.faction.length > 0 ? p.faction : null,
      order: typeof p.seatOrder === 'number' && Number.isInteger(p.seatOrder) && p.seatOrder >= 0
        ? p.seatOrder
        : null,
    };
  });
}

const shellStyle = {
  background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
};

export default function GuestOpeningStage({ snapshot }: { snapshot: EngineState | null }) {
  const isDice = snapshot?.phase === 'diceRoll';
  const rows = rowsOf(snapshot);
  const allRolled = rows.length > 0 && rows.every(r => r.roll !== null);
  const allAssigned = rows.length > 0 && rows.every(r => r.faction !== null);

  let footer: string;
  if (isDice) {
    footer = allRolled
      ? '骰子停下：点数是房主那台机器定好发过来的，点数大的先坐。'
      : '房主那台机器正在投骰：还没收到点数的席位显示「?」。';
  } else {
    footer = allAssigned
      ? '势力已分配：接着进入选将。'
      : '房主那台机器正在分配势力…';
  }

  return (
    <div className="fixed inset-0 z-[60] min-h-screen text-white flex flex-col items-center justify-center" style={shellStyle}>
      <h1 className="text-3xl font-black text-amber-200 mb-2 tracking-wider">
        {isDice ? '🎲 投掷骰子' : '🎌 势力分配'}
      </h1>
      <p className="text-amber-500/60 mb-8">
        {isDice ? '12面骰子决定座次' : '随机分配玩家主势力'}
      </p>

      <div className="flex gap-8 mb-8">
        {rows.map(row => {
          if (isDice) {
            return (
              <div key={row.key} className="flex flex-col items-center">
                <div className="w-28 h-28 rounded-xl border-2 border-amber-500 bg-amber-900/20 flex items-center justify-center mb-3 text-4xl font-black">
                  <span className="text-amber-200">{row.roll ?? '?'}</span>
                </div>
                <p className="text-amber-200 font-bold text-lg">{row.name}</p>
                {row.order !== null && (
                  <div className="mt-2 flex flex-col items-center">
                    <p className="text-amber-400 text-sm">🏅 座次: {row.order + 1}</p>
                    {row.roll !== null && (
                      <p className="text-amber-500/50 text-xs mt-0.5">掷出 {row.roll} 点</p>
                    )}
                  </div>
                )}
              </div>
            );
          }
          const color = row.faction
            ? factionColors[row.faction as keyof typeof factionColors] ?? '#555'
            : '#555';
          return (
            <div key={row.key} className="flex flex-col items-center">
              <div className="w-24 h-24 rounded-xl border-2 flex items-center justify-center mb-3"
                style={{ borderColor: color, backgroundColor: row.faction ? color + '20' : '#1a1a1a' }}>
                {row.faction
                  ? <span className="text-4xl font-black" style={{ color }}>{row.faction}</span>
                  : <span className="text-3xl">❓</span>}
              </div>
              <p className="text-amber-200 font-bold">{row.name}</p>
              <p className="text-xs text-amber-400/60">座次 {row.order === null ? '还没定' : row.order + 1}</p>
            </div>
          );
        })}
      </div>

      <p className="text-amber-400/50 text-sm animate-pulse">{footer}</p>
      <p className="text-amber-200/35 text-xs mt-6">
        这一屏只读：骰子与势力都由房主那台机器定，你这边会跟着一起变。
      </p>
    </div>
  );
}
