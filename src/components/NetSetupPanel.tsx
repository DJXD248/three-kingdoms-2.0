import type { EngineState } from '../core/GameState';
import { diceAllSettled, factionsAllAssigned, openingOf, type NetOpeningRow } from '../network/netSetupSteps';

/**
 * 联机切片⑤·腿1（㈢ 演出刀，v2.9.25）：开局那一段在客人屏上的那一格读数。
 *
 * 用户 2026-10-30 那句逐字＝「开始掷骰后进入掷骰画面（骰子滚动）主机先走定下数据（骰子停下），
 * 把数据传给客人，客人画面变动（骰子停下），分势力和征召同理」。落在这里＝**画面随后、数据先行**：
 * 第几步与那一步定下的数都读自同一条指名快照（判据住 `network/netSetupSteps`，这里一个也不重算），
 * 收到才画、没收到就写「还没定」。这一格**没有动画**：动画要画的是还没定下来的点数，
 * 而本机不许画一个没收到的数——迟到或重连的人因此直接落定，不回放滚动那一段。
 *
 * 只画公开的那五样（座次、称呼、骰子、势力、座次序）。别人那几席的手牌与征召池
 * 在这张表里没有落点，牌堆顺序更是一个字都不在这里。
 */

const rowText = (row: NetOpeningRow): string => {
  const roll = row.roll === null ? '🎲 还没定' : `🎲 ${row.roll}`;
  const faction = row.faction === null ? '势力还没定' : row.faction;
  const order = row.seatOrder === null ? '座次还没定' : `座次第 ${row.seatOrder + 1} 位`;
  return `${roll} · ${faction} · ${order}`;
};

export function NetSetupPanel({ snapshot }: { snapshot: EngineState | null }) {
  const { step, rows } = openingOf(snapshot);
  const rolling = !diceAllSettled(rows);
  const factionsWaiting = !factionsAllAssigned(rows);

  return (
    <div className="rounded-lg border border-amber-700/25 bg-black/25 px-3 py-2">
      <p className="text-xs text-amber-300/70 mb-1.5">
        开局那一段 · 掷骰 → 分势力 → 各家征召 → 初始抽卡（这里的数全是房主那边定下来发过来的，本机一颗骰子也不摇）
      </p>

      {step === 'none' && (
        <p className="text-xs text-amber-200/40">
          现在没有开局那一段的读数：房主那边还没开局（或那份读数不属于开局这一段）。他一点开始游戏，这里就跟着变。
        </p>
      )}

      {step === 'dice' && (
        rows.length === 0 ? (
          <p className="text-xs text-amber-200/40">房主那边说在掷骰，可这一份里一个席位也没收到。</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {rows.map(row => (
                <li key={row.seat} className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${row.roll === null ? 'border-amber-700/20 bg-black/20' : 'border-amber-500/40 bg-amber-950/25'}`}>
                  <span className="font-bold text-amber-200">第 {row.seat} 席</span>
                  <span className="text-amber-100">{row.name}</span>
                  <span className={`ml-auto text-xs ${row.roll === null ? 'text-amber-200/45' : 'text-amber-100'}`}>{rowText(row)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-200/60 mt-1.5">
              {rolling
                ? '房主那边骰子还在滚：这一格还没收到点数的席位写着「还没定」——收到那一刻才画出来，中间不画假点数。'
                : '骰子停下：点数是房主那边定下来才发过来的，点数大的先坐（那个「座次」也是房主算的，不是本机排的）。'}
            </p>
          </>
        )
      )}

      {step === 'faction' && (
        rows.length === 0 ? (
          <p className="text-xs text-amber-200/40">房主那边说在分势力，可这一份里一个席位也没收到。</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {rows.map(row => (
                <li key={row.seat} className="flex items-center gap-2 rounded border border-amber-700/20 bg-black/20 px-2 py-1 text-sm">
                  <span className="font-bold text-amber-200">第 {row.seat} 席</span>
                  <span className="text-amber-100">{row.name}</span>
                  <span className={`ml-auto text-xs ${row.faction === null ? 'text-amber-200/45' : 'text-emerald-300/80'}`}>{rowText(row)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-200/60 mt-1.5">
              {factionsWaiting
                ? '势力还没全到：收到哪一席就画哪一席，没收到的写着「还没定」。'
                : '势力也由房主那边定下并发来了（同一条快照，跟骰子一起到）。接着是各家征召。'}
            </p>
          </>
        )
      )}

      {step === 'draft' && (
        <p className="text-xs text-amber-200/60">
          房主那边已进入征召：各家挑到哪儿了看下面那张征召进度表（那张表里只有数量，一张牌也没有）。
          你自己那一席的候选名单在再下面那一格（联机切片⑤c：房主指名发给你的那一份，别人那一格不在里面）；
          点将与确认那颗钮还没做＝⑤d。
        </p>
      )}

      {step === 'play' && (
        <p className="text-xs text-emerald-300/80">
          开局那一段走完了（掷骰、分势力、各家征召、初始抽卡都过了），现在跟着变的是下面牌桌那一份局面。
        </p>
      )}
    </div>
  );
}
