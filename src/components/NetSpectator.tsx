import type { EngineState } from '../core/GameState';
import { factionColors } from '../data/generals';
import { hiddenCount, isHiddenEntry } from '../network/snapshotView';

/**
 * J2 客人端牌桌：房主发来的**已遮蔽**快照，只读渲染。
 *
 * 这里刻意不复用 GameBoard：那张牌桌是为热座设计的（它画的是"当前那一席的手牌"），
 * 客人拿到的快照里本来也只有数量。切片③（v2.9.25）之后，房主按席位各出一份——
 * **收件人自己那一席**的手牌与征召池是照发内容的（牌本来就是他的，他在本地玩时
 * 也一直看得见），别人的仍只发数量。所以这一格现在分两种画法：
 * 自己那一行画出牌面，别人那一行画出张数。
 * "哪一席是我"是从房主发来的席位表读的（`mySeat`），客人这边一律不自算座次。
 * 全程没有任何按钮：这一格只画局面本身。客人动手（J4＝v2.9.11）在下面的席位表那一格，
 * 按的是房主算好发来的那一份清单，牌桌这一格仍然一处也不可点。
 */
export default function NetSpectator({ snapshot, mySeat = null }: { snapshot: EngineState | null; mySeat?: number | null }) {
  return (
    <div className="rounded-lg border border-sky-800/35 bg-black/30 px-3 py-2.5">
      <p className="text-xs font-bold text-sky-300/85 mb-0.5">👀 牌桌 · 这一局由房主算牌，这里只画局面，要动手看下面席位表</p>

      {!snapshot || snapshot.players.length === 0 ? (
        <p className="text-xs text-amber-200/45">
          还没收到房主发来的局面——房主那边开了局、动了牌，这里就会跟着变。
        </p>
      ) : (
        <>
          <p className="text-[11px] text-amber-200/55 mb-1.5">
            第 {snapshot.round} 轮 · 轮到
            <span className="ml-1 font-bold text-amber-100">
              {snapshot.players.find((p) => p.id === snapshot.currentPlayerId)?.name ?? '—'}
            </span>
            {typeof snapshot.metadata?.winnerId === 'number' && (
              <span className="ml-2 font-bold text-emerald-300">
                本局结束：{snapshot.players.find((p) => p.id === snapshot.metadata?.winnerId)?.name ?? '—'}
              </span>
            )}
          </p>
          <ul className="flex flex-col gap-1.5">
            {snapshot.players.map((p) => {
              const color = factionColors[(p.faction ?? '蜀') as keyof typeof factionColors] ?? '#eab308';
              const active = p.id === snapshot.currentPlayerId;
              const mine = mySeat !== null && Number(p.id) === mySeat;
              const field = Array.isArray(p.fieldGenerals) ? p.fieldGenerals : [];
              // 只有"我这席"且这一格确实是放开的那一份才画牌面；遮着的（或席位表还没到）画张数。
              const hand = mine ? revealedEntries(p.hand) : null;
              const pool = mine ? revealedEntries(p.generalPool) : null;
              return (
                <li
                  key={String(p.id)}
                  className={`rounded border px-2 py-1.5 ${active ? 'border-amber-500/60 bg-amber-900/20' : 'border-amber-700/20 bg-black/20'} ${p.isAlive === false ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="font-bold" style={{ color }}>{String(p.name ?? '')}</span>
                    <span className="text-amber-200/50">{String(p.faction ?? '')}</span>
                    {mine && <span className="text-[10px] font-bold text-emerald-300/85">你的席位</span>}
                    {active && <span className="text-[10px] text-amber-300/80">行动中</span>}
                    {p.isAlive === false && <span className="text-[10px] text-red-300/70">已阵亡</span>}
                    <span className="ml-auto text-[11px] text-amber-200/55">
                      🏯{Number(p.baseHp ?? 0)} · 🃏{hiddenCount(p.hand)} 张 · 👤{hiddenCount(p.generalPool)} 员
                    </span>
                  </div>
                  {(hand || pool) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {hand && (
                        <>
                          <span className="text-[10px] text-emerald-300/60">手牌</span>
                          {hand.length === 0 ? (
                            <span className="text-[10px] text-amber-200/30">空</span>
                          ) : (
                            hand.map((c, i) => <span key={`h${i}`} className={privateChip}>{nameOf(c)}</span>)
                          )}
                        </>
                      )}
                      {pool && (
                        <>
                          <span className="text-[10px] text-emerald-300/60">我的征召池</span>
                          {pool.length === 0 ? (
                            <span className="text-[10px] text-amber-200/30">空</span>
                          ) : (
                            pool.map((g, i) => <span key={`g${i}`} className={privateChip}>{nameOf(g)}</span>)
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {field.length === 0 ? (
                      <span className="text-[10px] text-amber-200/30">场上没有将领</span>
                    ) : (
                      field.map((fg, i) => {
                        const g = (fg as { general?: { name?: string } }).general;
                        const hp = (fg as { currentHp?: number }).currentHp ?? 0;
                        const armor = (fg as { currentArmor?: number }).currentArmor ?? 0;
                        return (
                          <span key={i} className="rounded border border-amber-700/25 bg-black/25 px-1.5 py-0.5 text-[10px] text-amber-100">
                            {String(g?.name ?? '?')} <span className="text-red-300/80">{hp}</span>
                            <span className="text-sky-300/70">/甲{armor}</span>
                          </span>
                        );
                      })
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[10px] text-amber-200/35">
            牌堆里还剩 {hiddenCount(snapshot.deck)} 张 · 弃牌堆 {hiddenCount(snapshot.discardPile)} 张 ·
            {mySeat === null
              ? ' 现在还没给你排定席位，所以你看到的是数量而不是牌面（排位子后你自己的手牌会画出来）。'
              : ' 你自己那一席的手牌与征召池画的是牌面（房主发给你的是指名的那一份），别人的仍只发数量，牌堆顺序谁都不发。'}
          </p>
        </>
      )}
    </div>
  );
}

const privateChip = 'rounded border border-emerald-700/35 bg-emerald-950/25 px-1.5 py-0.5 text-[10px] text-emerald-100';

/** 这一格放开过（每一项都是真内容）才返回那份数组；还是遮着的就返回 null ⇒ 界面退回画张数。 */
function revealedEntries(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  return value.some(isHiddenEntry) ? null : value;
}

function nameOf(value: unknown): string {
  return String((value as { name?: unknown } | null)?.name ?? '?');
}
