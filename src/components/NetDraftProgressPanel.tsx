import type { NetDraftProgressRow } from '../network/netProtocol';

/**
 * 联机切片⑤b（v2.9.25）：征召那一段，桌上每个人走到哪儿了。
 *
 * 用户 2026-10-30 把这一格能说什么裁死：「和热座一样」**不**延伸到别人那几格的私有信息——
 * 别席的候选牌永不上线，客人看得见的就是进度那一行话（「第 2 席正在征召（已选 7/10）」）。
 * 那句「已选 n/10」与热座征召面板上的是同一句（`GeneralDraft.tsx` 里那一行），
 * 两边不会说出两种进度。
 *
 * 这里没有判据：那张表由房主算（`netDraftProgress`）、经 `netRoom` 那一格存着，
 * 房主与客人读的都是同一份，谁也不在自己屏幕上再算一遍。
 */

const stateText = (row: NetDraftProgressRow): string => {
  if (row.state === 'picking') return `正在征召（已选 ${row.picked}/${row.total}）`;
  if (row.state === 'done') return `已征召 ${row.picked}/${row.total}`;
  return '还没轮到';
};

export function NetDraftProgressPanel({ rows }: { rows: NetDraftProgressRow[] | null }) {
  const picking = rows?.find((row) => row.state === 'picking') ?? null;
  return (
    <div className="rounded-lg border border-amber-700/25 bg-black/25 px-3 py-2">
      <p className="text-xs text-amber-300/70 mb-1.5">征召进度（这张表由房主算，客人只照抄；里面一张牌也没有）</p>
      {rows === null ? (
        <p className="text-xs text-amber-200/40">还没开始征召（这一局还没开局，或者房主那边正在掷骰、分势力）。</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map(row => (
            <li
              key={row.seat}
              className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${
                row.state === 'picking' ? 'border-amber-500/50 bg-amber-950/30' : 'border-amber-700/20 bg-black/20'
              }`}
            >
              <span className="font-bold text-amber-200">第 {row.seat} 席</span>
              <span className="text-amber-100">{row.name}</span>
              <span
                className={`ml-auto text-xs ${
                  row.state === 'done' ? 'text-emerald-300/80' : row.state === 'picking' ? 'text-amber-200' : 'text-amber-200/45'
                }`}
              >
                {stateText(row)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <p className="text-xs text-amber-200/60 mt-1.5">
          现在轮到第 {picking.seat} 席挑将——他挑完，下一席才开始。
        </p>
      )}
      {rows !== null && rows.length > 0 && rows.every((row) => row.state === 'done') && (
        <p className="text-xs text-emerald-300/80 mt-1.5">各家池子都定下来了，接着是初始抽卡。</p>
      )}
    </div>
  );
}
